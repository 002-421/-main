"""Prepare the pinned CPU llama.cpp runtime for the Windows Electron app."""
from pathlib import Path
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime-cache' / 'llama-cpp-win-x64'
VERSION = '3.22.2'


def prepare_ai_runtime():
    manifest = {
        'name': 'mri-report-studio-ai-runtime', 'private': True,
        'dependencies': {
            'node-llama-cpp': VERSION,
            '@node-llama-cpp/win-x64': VERSION,
        },
    }
    RUNTIME.mkdir(parents=True, exist_ok=True)
    package_file = RUNTIME / 'package.json'
    expected = json.dumps(manifest, sort_keys=True)
    native_addon = RUNTIME / 'node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node'
    if package_file.exists() and package_file.read_text(encoding='utf-8') == expected and (RUNTIME / 'node_modules/node-llama-cpp').is_dir() and native_addon.is_file():
        return RUNTIME / 'node_modules'
    package_file.write_text(expected, encoding='utf-8')
    environment = os.environ.copy()
    environment['npm_config_cache'] = str(ROOT / '.runtime-cache/npm-cache')
    subprocess.run([
        'npm', 'install', '--prefix', str(RUNTIME), '--force', '--os=win32', '--cpu=x64',
        '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund',
    ], check=True, env=environment)
    if not native_addon.is_file():
        raise RuntimeError('Pinned Windows CPU llama.cpp binding was not installed.')
    return RUNTIME / 'node_modules'
