import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from scripts.verify_setup_package import verify_setup_package, write_candidate_manifest


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

    def test_writes_candidate_manifest_without_touching_canonical_manifest(self):
        output = self.root / 'latest-0.4.54-candidate.json'
        url = 'https://github.com/002-421/-main/raw/refs/heads/codex/xrs-06-release-0.4.54/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip'
        write_candidate_manifest(url, '0.4.54', 'a' * 64, output)
        self.assertEqual(json.loads(output.read_text(encoding='utf-8'))['url'], url)


if __name__ == '__main__':
    unittest.main()
