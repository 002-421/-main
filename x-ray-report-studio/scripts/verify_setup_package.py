"""Verify an X-ray Report Studio Setup ZIP and optionally write a test manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from zipfile import BadZipFile, ZipFile


SETUP_ROOT = 'X-ray Report Studio Setup/'
ALLOWED_HOSTS = {'github.com', 'raw.githubusercontent.com'}


def local_requires(source: str) -> set[str]:
    return {match.group(1) for match in re.finditer(
        r"\brequire\s*\(\s*['\"](\./[^'\"]+)['\"]\s*\)", source
    )}


def verify_setup_package(archive_path: Path, source_root: Path, expected_version: str) -> str:
    """Check version, packaged Electron modules, and their local require graph."""
    try:
        with ZipFile(archive_path) as archive:
            bad_entry = archive.testzip()
            if bad_entry:
                raise ValueError(f'Corrupt ZIP entry: {bad_entry}')
            names = set(archive.namelist())
            package_path = SETUP_ROOT + 'app/package.json'
            if package_path not in names:
                raise ValueError('Setup ZIP does not contain app/package.json.')
            package = json.loads(archive.read(package_path).decode('utf-8'))
            if package.get('version') != expected_version:
                raise ValueError(f"Expected version {expected_version}, found {package.get('version')}.")
            if package.get('main') != 'electron/main.cjs':
                raise ValueError('Packaged Electron entry point is incorrect.')

            source_files = {path.name: path for path in source_root.glob('*.cjs') if path.is_file()}
            if 'main.cjs' not in source_files:
                raise ValueError('Source Electron main.cjs is missing.')
            packaged_files = {
                name.removeprefix(SETUP_ROOT + 'app/electron/')
                for name in names
                if name.startswith(SETUP_ROOT + 'app/electron/') and name.endswith('.cjs')
            }
            missing = sorted(set(source_files) - packaged_files)
            if missing:
                raise ValueError('Electron modules missing from Setup ZIP: ' + ', '.join(missing))

            for module_name, source_path in source_files.items():
                source = source_path.read_text(encoding='utf-8')
                for specifier in local_requires(source):
                    target = specifier[2:]
                    candidates = [target] if target.endswith('.cjs') else [target + '.cjs', target + '/index.cjs']
                    if not any(candidate in packaged_files for candidate in candidates):
                        raise ValueError(f'{module_name} requires missing local module {specifier}.')
            if SETUP_ROOT + 'app/dist/index.html' not in names:
                raise ValueError('Setup ZIP does not contain the renderer.')
    except BadZipFile as error:
        raise ValueError('Setup archive is not a valid ZIP file.') from error
    return hashlib.sha256(archive_path.read_bytes()).hexdigest()


def compare_zip_contents(candidate_path: Path, reference_path: Path) -> dict[str, list[str]]:
    """Compare uncompressed ZIP entries to distinguish content from container differences."""
    with ZipFile(candidate_path) as candidate, ZipFile(reference_path) as reference:
        candidate_names = set(candidate.namelist())
        reference_names = set(reference.namelist())
        common = candidate_names & reference_names
        return {
            'missing': sorted(reference_names - candidate_names),
            'added': sorted(candidate_names - reference_names),
            'different': sorted(name for name in common if candidate.read(name) != reference.read(name)),
        }


def zip_entry_diagnostics(candidate_path: Path, reference_path: Path) -> list[dict[str, object]]:
    """Describe differing entries without logging their contents."""
    rows = []
    with ZipFile(candidate_path) as candidate, ZipFile(reference_path) as reference:
        candidate_names = set(candidate.namelist())
        reference_names = set(reference.namelist())
        for name in sorted(candidate_names & reference_names):
            candidate_bytes = candidate.read(name)
            reference_bytes = reference.read(name)
            if candidate_bytes == reference_bytes:
                continue
            first_difference = next((i for i, (left, right) in enumerate(zip(candidate_bytes, reference_bytes))
                                     if left != right), min(len(candidate_bytes), len(reference_bytes)))
            row: dict[str, object] = {
                'name': name,
                'candidateBytes': len(candidate_bytes),
                'referenceBytes': len(reference_bytes),
                'candidateSha256': hashlib.sha256(candidate_bytes).hexdigest(),
                'referenceSha256': hashlib.sha256(reference_bytes).hexdigest(),
                'firstDifferentByte': first_difference,
            }
            if name.endswith('.txt') or name.endswith('.html'):
                row['candidateCRLF'] = candidate_bytes.count(b'\r\n')
                row['referenceCRLF'] = reference_bytes.count(b'\r\n')
                row['candidateTailHex'] = candidate_bytes[-32:].hex()
                row['referenceTailHex'] = reference_bytes[-32:].hex()
                row['sameAfterNewlineNormalization'] = (
                    candidate_bytes.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
                    == reference_bytes.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
                )
            if name.endswith('THIRD_PARTY_LICENSES.txt'):
                heading = re.compile(r'^={60}\n([^\n]+)\n', re.MULTILINE)
                candidate_headings = set(heading.findall(candidate_bytes.decode('utf-8', errors='replace')))
                reference_headings = set(heading.findall(reference_bytes.decode('utf-8', errors='replace')))
                row['addedLicenseHeadings'] = sorted(candidate_headings - reference_headings)
                row['missingLicenseHeadings'] = sorted(reference_headings - candidate_headings)
            rows.append(row)
    return rows


def zip_container_diagnostics(candidate_path: Path, reference_path: Path) -> dict[str, object]:
    """Compare ZIP metadata only; never expose entry payloads."""
    fields = (
        'compress_type', 'date_time', 'create_system', 'create_version', 'extract_version',
        'flag_bits', 'volume', 'internal_attr', 'external_attr', 'extra', 'comment',
        'CRC', 'file_size', 'compress_size',
    )
    with ZipFile(candidate_path) as candidate, ZipFile(reference_path) as reference:
        candidate_infos = candidate.infolist()
        reference_infos = reference.infolist()
        candidate_by_name = {info.filename: info for info in candidate_infos}
        reference_by_name = {info.filename: info for info in reference_infos}
        entry_differences = []
        for name in sorted(candidate_by_name.keys() & reference_by_name.keys()):
            left, right = candidate_by_name[name], reference_by_name[name]
            changed = {}
            for field in fields:
                left_value, right_value = getattr(left, field), getattr(right, field)
                if left_value != right_value:
                    if isinstance(left_value, bytes):
                        left_value, right_value = left_value.hex(), right_value.hex()
                    changed[field] = {'candidate': left_value, 'reference': right_value}
            if changed:
                entry_differences.append({'name': name, 'fields': changed})
        left_order = [info.filename for info in candidate_infos]
        right_order = [info.filename for info in reference_infos]
        return {
            'entryOrderMatches': left_order == right_order,
            'candidateOrder': left_order if left_order != right_order else [],
            'referenceOrder': right_order if left_order != right_order else [],
            'archiveCommentMatches': candidate.comment == reference.comment,
            'entryMetadataDifferences': entry_differences,
        }


def write_candidate_manifest(url: str, version: str, sha256: str, output: Path) -> None:
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError('Candidate URL must use HTTPS on a supported GitHub host.')
    if not parsed.path.endswith('/downloads/X-ray_Report_Studio_Windows_Setup.zip'):
        raise ValueError('Candidate URL must point to the Windows Setup ZIP.')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or not re.fullmatch(r'[a-f0-9]{64}', sha256):
        raise ValueError('Candidate version or SHA256 is invalid.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'version': version, 'url': url, 'sha256': sha256}, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', required=True, type=Path)
    parser.add_argument('--source-electron', required=True, type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--candidate-url')
    parser.add_argument('--manifest-out', type=Path)
    parser.add_argument('--reference-zip', type=Path)
    args = parser.parse_args()
    digest = verify_setup_package(args.zip, args.source_electron, args.version)
    print(f'SETUP VERIFIED: version {args.version}, {args.zip.stat().st_size} bytes, SHA256 {digest}')
    if args.reference_zip:
        differences = compare_zip_contents(args.zip, args.reference_zip)
        details = zip_entry_diagnostics(args.zip, args.reference_zip)
        container = zip_container_diagnostics(args.zip, args.reference_zip)
        print('REFERENCE ENTRY COMPARISON: ' + json.dumps(
            {'entries': differences, 'details': details, 'container': container},
            ensure_ascii=False, separators=(',', ':')
        ))
    if args.candidate_url or args.manifest_out:
        if not args.candidate_url or not args.manifest_out:
            parser.error('--candidate-url and --manifest-out must be used together.')
        write_candidate_manifest(args.candidate_url, args.version, digest, args.manifest_out)
        print(f'Candidate manifest written: {args.manifest_out}')


if __name__ == '__main__':
    main()
