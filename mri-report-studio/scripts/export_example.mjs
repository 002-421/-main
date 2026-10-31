/** Rebuild the downloadable Word template using the same exporter as the app. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeTemplateDocument } from '../src/catalog.ts';
import { prepareInlineDocument } from '../src/inline-fields.ts';
import { exportDocx } from '../src/docx.ts';

const root = new URL('../', import.meta.url);
const font = {
  name: 'DejaVu Sans',
  data: new Uint8Array(await readFile(new URL('src/assets/fonts/DejaVuSans.ttf', root))),
  bold: new Uint8Array(await readFile(new URL('src/assets/fonts/DejaVuSans-Bold.ttf', root))),
  italic: new Uint8Array(await readFile(new URL('src/assets/fonts/DejaVuSans-Oblique.ttf', root))),
  boldItalic: new Uint8Array(await readFile(new URL('src/assets/fonts/DejaVuSans-BoldOblique.ttf', root))),
};
const doc = prepareInlineDocument(makeTemplateDocument('brain'));
const blob = await exportDocx(doc, {
  profile: 'brain', templateId: 'brain', kind: 'template',
  title: 'МРТ головы — шаблон описания', fonts: [font],
});
const output = new URL('downloads/MRI_Alliance_Head_Template.docx', root);
await mkdir(new URL('downloads/', root), { recursive: true });
await writeFile(output, new Uint8Array(await blob.arrayBuffer()));
console.log(`${fileURLToPath(output)}: ${blob.size.toLocaleString('en-US')} bytes`);
