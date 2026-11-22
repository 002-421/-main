import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await readFile(path.join(root, 'tests/fixtures/spine-review-v8-integrity.json'), 'utf8'));
const archivePath = process.argv[2] || process.env.XRS_SPINE_REVIEW_V8_ARCHIVE;
if (!archivePath) {
  console.error('Usage: node scripts/verify-spine-review-v8.mjs <XRS_Spine_Templates_0.4.77_Review_v8.zip>');
  process.exit(2);
}

const bytes = await readFile(archivePath);
const archiveHash = createHash('sha256').update(bytes).digest('hex');
assert.equal(archiveHash, fixture.sourceArchive.sha256, 'Review v8 archive SHA-256 does not match the approved source');
const outer = unzipSync(bytes);
const catalog = JSON.parse(await readFile(path.join(root, 'src/catalog.json'), 'utf8'));
const filesByTitle = {
  'ШОП': 'spine-shop', 'ШОП+М': 'spine-shop-m', 'ШОП+АРТ': 'spine-shop-art',
  'ГОП': 'spine-gop', 'ГОП+М': 'spine-gop-m', 'ПОП': 'spine-pop', 'ПОП+М': 'spine-pop-m', 'ККОП': 'spine-kkop',
};
const normalize = text => text.normalize('NFC').replace(/[\u00a0\u202f]/gu, ' ').replace(/\s+/gu, ' ').trim();
const decodeXml = text => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function docxParagraphs(docxBytes, id) {
  const files = unzipSync(docxBytes);
  for (const [name, xml] of Object.entries(files)) {
    if (/^word\/.*\.xml$/u.test(name) && /<w:(?:ins|del)(?:\s|>)/u.test(strFromU8(xml))) {
      throw new Error(`${id}: unresolved Track Changes remain in ${name}`);
    }
  }
  const document = strFromU8(files['word/document.xml'] ?? new Uint8Array());
  const body = document.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/u)?.[1];
  assert.ok(body, `${id}: DOCX document body is missing`);
  const paragraphs = [];
  for (const match of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu)) {
    const text = [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map(item => decodeXml(item[1])).join('');
    const value = normalize(text);
    if (value) paragraphs.push(value);
  }
  return paragraphs;
}

function catalogParagraphs(doc) {
  const paragraphs = [];
  const plain = node => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(plain).join('');
  const walk = node => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = normalize(plain(node));
      if (text) paragraphs.push(text);
    } else for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return paragraphs;
}

const beforeSignature = paragraphs => {
  const at = paragraphs.findIndex(text => /^Врач(?:-рентгенолог)?\s*:/iu.test(text));
  return paragraphs.slice(0, at < 0 ? paragraphs.length : at);
};
for (const [title, id] of Object.entries(filesByTitle)) {
  const entry = Object.keys(outer).find(name => name.startsWith('Редакция_DOCX/') && path.posix.basename(name).startsWith(`${title}-`) && name.endsWith('.docx'));
  assert.ok(entry, `${id}: approved DOCX is missing from Review v8 archive`);
  const approved = beforeSignature(docxParagraphs(outer[entry], id));
  const current = beforeSignature(catalogParagraphs(catalog.templates.find(template => template.id === id)?.doc ?? { type: 'doc' }));
  assert.deepEqual(current, approved, `${id}: XRS medical text before the system-managed signature differs from Review v8`);
}

console.log(`PASS: Review v8 archive ${archiveHash}; approved medical text matches all eight catalog templates; no unresolved Track Changes.`);
