const fs = require('node:fs');
const { validateManifest } = require('../electron/update-channel.cjs');

const [filename, expectedVersion] = process.argv.slice(2);
if (!filename || !expectedVersion) throw new Error('Usage: validate_update_manifest.cjs <manifest.json> <version>');
const json = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(json);
const accepted = validateManifest(manifest, 'stable');
if (accepted.version !== expectedVersion) throw new Error('Candidate manifest version does not match the expected release.');
console.log(`Updater accepted versioned release URL and ZIP SHA256: ${accepted.sha256}`);
