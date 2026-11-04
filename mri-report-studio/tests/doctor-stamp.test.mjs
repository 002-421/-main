import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDoctorStamp, containsDoctorStamp } from '../src/doctor-stamp.ts';

test('doctor stamp export is repeatable and preserves the date in place', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Врач-рентгенолог: Иванов Иван Иванович' },
    { type: 'text', text: '  Дата: 04.11.2026' },
  ] }, { type: 'paragraph', content: [
    { type: 'image', attrs: { alt: 'Подпись и печать врача', src: 'old' } },
    { type: 'text', text: 'Дата: 01.01.2000' },
  ] }] };
  const stamps = { 'Иванов Иван Иванович': 'data:image/png;base64,stamp' };
  const sizes = { 'Иванов Иван Иванович': { width: 120, height: 40 } };
  const once = attachDoctorStamp(doc, stamps, sizes);
  const twice = attachDoctorStamp(once, stamps, sizes);
  const nodes = twice.content;
  const stampNodes = [];
  const walk = node => { if (node.type === 'image' && node.attrs?.alt === 'Подпись и печать врача') stampNodes.push(node); node.content?.forEach(walk); };
  walk(twice);
  assert.equal(stampNodes.length, 1);
  assert.equal(stampNodes[0].attrs.src, stamps['Иванов Иван Иванович']);
  assert.ok(containsDoctorStamp(twice));
  assert.match(nodes.map(node => JSON.stringify(node)).join(' '), /Дата: 04\.11\.2026/);
  assert.equal(nodes[0].type, 'paragraph');
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].content.filter(node => node.type === 'image').length, 1);
  assert.equal(nodes[0].content.find(node => node.type === 'image').attrs.width, 250);
  assert.equal(nodes[0].content.find(node => node.type === 'image').attrs.floating, true);
  assert.equal(doc.content[0].content[0].text, 'Врач-рентгенолог: Иванов Иван Иванович');
});
