import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

from scripts.package_setup import ROOT, is_single_platform_package, write_zip
from scripts.verify_setup_package import (
    compare_zip_contents, verify_setup_package, write_candidate_manifest,
    zip_container_diagnostics, zip_entry_diagnostics,
)


class SetupPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'electron'
        self.source.mkdir()
        (self.source / 'main.cjs').write_text("require('./helper.cjs');", encoding='utf-8')
        (self.source / 'helper.cjs').write_text('module.exports = {};', encoding='utf-8')
        self.archive = self.root / 'setup.zip'
        self.write_archive(include_helper=True)

    def tearDown(self):
        self.temp.cleanup()

    def write_archive(self, include_helper):
        with ZipFile(self.archive, 'w') as archive:
            base = 'X-ray Report Studio Setup/app/'
            archive.writestr(base + 'package.json', json.dumps({'version': '0.4.54', 'main': 'electron/main.cjs'}))
            archive.writestr(base + 'dist/index.html', '<html></html>')
            archive.writestr(base + 'electron/main.cjs', (self.source / 'main.cjs').read_text(encoding='utf-8'))
            if include_helper:
                archive.writestr(base + 'electron/helper.cjs', (self.source / 'helper.cjs').read_text(encoding='utf-8'))

    def test_accepts_complete_setup_and_computes_sha256(self):
        self.assertEqual(len(verify_setup_package(self.archive, self.source, '0.4.54')), 64)

    def test_rejects_missing_transitive_local_module(self):
        self.write_archive(include_helper=False)
        with self.assertRaisesRegex(ValueError, 'missing from Setup ZIP'):
            verify_setup_package(self.archive, self.source, '0.4.54')

    def test_rejects_version_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'Expected version'):
            verify_setup_package(self.archive, self.source, '0.4.53')

    def test_compares_archive_payloads_without_exposing_file_contents(self):
        reference = self.root / 'reference.zip'
        with ZipFile(reference, 'w') as archive:
            archive.writestr('same.txt', 'same')
            archive.writestr('changed.txt', 'old')
            archive.writestr('removed.txt', 'gone')
        candidate = self.root / 'candidate.zip'
        with ZipFile(candidate, 'w') as archive:
            archive.writestr('same.txt', 'same')
            archive.writestr('changed.txt', 'new')
            archive.writestr('added.txt', 'new')
        self.assertEqual(compare_zip_contents(candidate, reference), {
            'missing': ['removed.txt'], 'added': ['added.txt'], 'different': ['changed.txt']
        })

    def test_platform_specific_optional_binaries_do_not_affect_license_inventory(self):
        self.assertTrue(is_single_platform_package({'os': ['win32'], 'cpu': ['x64']}))
        self.assertTrue(is_single_platform_package({'cpu': ['arm64']}))
        self.assertFalse(is_single_platform_package({'os': ['linux', 'win32'], 'cpu': ['x64', 'arm64']}))
        self.assertFalse(is_single_platform_package({}))

    def test_zip_entry_order_uses_case_sensitive_posix_names(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            root = Path(directory)
            source = root / 'case-order'
            source.mkdir()
            for name in ('b.txt', 'Z.txt', 'a.txt'):
                (source / name).write_text(name, encoding='utf-8')
            archive = root / 'case-order.zip'
            write_zip(source, archive, ZIP_STORED)
            with ZipFile(archive) as package:
                self.assertEqual(package.namelist(), [
                    'case-order/Z.txt', 'case-order/a.txt', 'case-order/b.txt'
                ])

    def test_reports_safe_entry_diagnostics_without_payload_text(self):
        reference = self.root / 'diagnostic-reference.zip'
        candidate = self.root / 'diagnostic-candidate.zip'
        with ZipFile(reference, 'w') as archive:
            archive.writestr('app/dist/index.html', '<p>reference</p>\r\n')
            archive.writestr('THIRD_PARTY_LICENSES.txt', '=' * 60 + '\npackage-old 1.0\nlicense body\n')
        with ZipFile(candidate, 'w') as archive:
            archive.writestr('app/dist/index.html', '<p>reference</p>\n')
            archive.writestr('THIRD_PARTY_LICENSES.txt', '=' * 60 + '\npackage-new 2.0\nother body\n')

        diagnostics = zip_entry_diagnostics(candidate, reference)
        renderer = next(row for row in diagnostics if row['name'].endswith('index.html'))
        licenses = next(row for row in diagnostics if row['name'].endswith('THIRD_PARTY_LICENSES.txt'))
        self.assertTrue(renderer['sameAfterNewlineNormalization'])
        self.assertEqual(licenses['addedLicenseHeadings'], ['package-new 2.0'])
        self.assertEqual(licenses['missingLicenseHeadings'], ['package-old 1.0'])
        self.assertNotIn('other body', str(diagnostics))
        self.assertNotIn('license body', str(diagnostics))

    def test_reports_zip_container_metadata_without_entry_contents(self):
        details = zip_container_diagnostics(self.archive, self.archive)
        self.assertTrue(details['entryOrderMatches'])
        self.assertEqual(details['entryMetadataDifferences'], [])
        self.assertTrue(details['archiveCommentMatches'])

    def test_writes_candidate_manifest_without_touching_canonical_manifest(self):
        output = self.root / 'latest-0.4.54-candidate.json'
        url = 'https://github.com/002-421/-main/raw/refs/heads/codex/xrs-06-release-0.4.54/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip'
        write_candidate_manifest(url, '0.4.54', 'a' * 64, output)
        self.assertEqual(json.loads(output.read_text(encoding='utf-8'))['url'], url)

    def test_stored_setup_zip_is_byte_stable(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            root = Path(directory)
            package = root / 'Setup'
            package.mkdir()
            (package / 'file.txt').write_text('synthetic package data', encoding='utf-8')
            first, second = root / 'first.zip', root / 'second.zip'
            write_zip(package, first, ZIP_STORED)
            write_zip(package, second, ZIP_STORED)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with ZipFile(first) as archive:
                self.assertEqual(archive.getinfo('Setup/file.txt').compress_type, ZIP_STORED)
                self.assertEqual(archive.getinfo('Setup/file.txt').create_system, 3)


if __name__ == '__main__':
    unittest.main()
