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
        print('REFERENCE ENTRY COMPARISON: ' + json.dumps(differences, ensure_ascii=False, separators=(',', ':')))
    if args.candidate_url or args.manifest_out:
        if not args.candidate_url or not args.manifest_out:
            parser.error('--candidate-url and --manifest-out must be used together.')
        write_candidate_manifest(args.candidate_url, args.version, digest, args.manifest_out)
        print(f'Candidate manifest written: {args.manifest_out}')


if __name__ == '__main__':
    main()
