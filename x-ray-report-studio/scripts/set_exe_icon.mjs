import fs from 'node:fs';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const [executablePath, iconPath] = process.argv.slice(2);
if (!executablePath || !iconPath) throw new Error('Usage: node set_exe_icon.mjs <executable> <icon.ico>');
const executable = PE.NtExecutable.from(fs.readFileSync(executablePath));
const resources = PE.NtExecutableResource.from(executable);
const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
if (!iconGroups.length) throw new Error('The executable contains no icon resource group.');
const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
for (const group of iconGroups) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    group.id,
    group.lang,
    icon.icons.map(item => item.data),
  );
}
resources.outputResource(executable);
fs.writeFileSync(executablePath, Buffer.from(executable.generate()));
console.log(`Applied ${iconGroups.length} icon resource group(s) to ${executablePath}`);
