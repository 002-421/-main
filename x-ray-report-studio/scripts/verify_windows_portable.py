"""Verify the contents of the unpublished Windows portable smoke-test ZIP."""
from argparse import ArgumentParser
from hashlib import sha256
from pathlib import Path
from zipfile import BadZipFile, ZipFile


def fail(message):
    raise SystemExit(f'Portable package verification failed: {message}')


def main():
    parser = ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('--expected-html', type=Path, required=True)
    args = parser.parse_args()
    if not args.archive.is_file() or not args.expected_html.is_file():
        fail('archive or expected build HTML is missing')

    root = 'X-ray Report Studio/'
    names = set()
    try:
        with ZipFile(args.archive) as package:
            damaged = package.testzip()
            if damaged:
                fail(f'corrupt ZIP member: {damaged}')
            names = {name.replace('\\', '/') for name in package.namelist()}
            required = {
                root + 'X-ray Report Studio.exe',
                # Electron 45's official Windows distribution no longer ships
                # chrome_elf.dll or a separate resources/electron.asar.
                # Verify the runtime resources that are present in that layout.
                root + 'chrome_100_percent.pak',
                root + 'chrome_200_percent.pak',
                root + 'd3dcompiler_47.dll',
                root + 'electron_wer.dll',
                root + 'ffmpeg.dll',
                root + 'icudtl.dat',
                root + 'resources.pak',
                root + 'resources/default_app.asar',
                root + 'snapshot_blob.bin',
                root + 'v8_context_snapshot.bin',
                root + 'locales/en-US.pak',
                root + 'resources/app/dist/index.html',
                root + 'resources/app/electron/main.cjs',
            }
            missing = sorted(required - names)
            if missing:
                fail('missing required files: ' + ', '.join(missing))
            if any(name.lower().endswith('.gguf') for name in names):
                fail('unexpected model weights found in portable package')

            html_name = root + 'resources/app/dist/index.html'
            packaged_html = package.read(html_name)
            expected_html = args.expected_html.read_bytes()
            if sha256(packaged_html).digest() != sha256(expected_html).digest():
                fail('packaged renderer does not match the current build output')

            # These markers verify the bundle contains actual dictionary payloads,
            # alongside license and morphology metadata, rather than remote loaders.
            markers = (
                'dictionary-ru 3.0.0', 'dictionary-en 4.0.0', 'OpenCorpora',
                'words.dawg', 'абажур', 'гиперинтенсивный',
            )
            absent = [marker for marker in markers if marker.encode('utf-8') not in packaged_html]
            if absent:
                fail('embedded dictionary markers missing: ' + ', '.join(absent))
    except (BadZipFile, OSError, ValueError) as error:
        fail(str(error))

    print(f'PASS: portable ZIP has Electron runtime, current renderer and embedded dictionaries ({args.archive.stat().st_size} bytes).')


if __name__ == '__main__':
    main()
