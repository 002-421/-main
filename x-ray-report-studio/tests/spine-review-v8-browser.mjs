import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

const root = process.cwd();
const profile = await mkdtemp(path.join(os.tmpdir(), 'xrs-spine-v8-'));
const bundledElectron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const electronPath = process.env.ELECTRON_PATH || (existsSync(bundledElectron) ? bundledElectron : undefined);
const electronOptions = {
  ...(electronPath ? { executablePath: electronPath } : {}),
  cwd: root,
  args: ['.', `--user-data-dir=${profile}`, '--no-sandbox', '--ozone-platform=headless', '--disable-gpu'],
};
const ids = ['spine-shop', 'spine-shop-m', 'spine-shop-art', 'spine-gop', 'spine-gop-m', 'spine-pop', 'spine-pop-m', 'spine-kkop'].filter(id => !process.env.SPINE_IDS || process.env.SPINE_IDS.split(',').includes(id));
const persistedReports = new Map();
let app = await _electron.launch(electronOptions);
let page;
try {
  page = await app.firstWindow();
  const rendererErrors = [];
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.locator('.report-content').waitFor();
  await page.locator('[data-tab="templates"]').click();
  await page.locator('#area-select').selectOption('spine');

  for (const id of ids) {
    await page.locator(`[data-template="${id}"]`).click();
    const patientId = `${id}.patient`;
    const patient = page.locator(`[data-field-id="${patientId}"]`);
    await patient.waitFor();
    const fields = await page.locator('.report-content [data-template-field]').evaluateAll(nodes =>
      nodes.map(node => node.dataset.fieldId));
    assert.deepEqual(fields, [
      `${id}.number`, patientId, `${id}.birthdate`,
      'HEAD.BASE.2.FIELD.0043', `${id}.reportdate`,
    ], `${id}: original XRS fields and IDs remain present`);
    await page.evaluate(() => {
      const editor = document.querySelector('.report-content').editor;
      let candidate;
      editor.state.doc.descendants((node, position) => {
        if (!node.isText || !node.marks.some(mark => mark.type.name === 'highlight' && mark.attrs.color?.toLowerCase() === '#ffff00')) return;
        if (!candidate && !node.marks.some(mark => mark.type.name === 'templateField')) candidate = { position, node };
      });
      if (!candidate) throw new Error('A yellow text range is required to create the synthetic numeric sequence');
      // Some templates have fewer than three real numeric prompts. Append a
      // disposable same-run sequence so each template exercises the reported
      // adjacent-range failure without changing any stored template.
      const tr = editor.state.tr.replaceWith(candidate.position, candidate.position + candidate.node.nodeSize,
        editor.schema.text(candidate.node.text + ' XRSSEQTEST 0,0 0,0 0,0 XRSSEQENDTEST', candidate.node.marks)).setMeta('preserve-yellow-highlight', true);
      editor.view.dispatch(tr);
    });

    const replaceWithDigit = async (digit, mode = 'type') => {
      const selected = await page.evaluate(() => {
        const root = document.querySelector('.report-content');
        if (!root) return { error: 'report was not found' };
        const editable = root.matches('[contenteditable]') ? root : root.querySelector('[contenteditable]') ?? root;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node, afterMarker = false;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? '';
          const marker = text.indexOf('XRSSEQTEST');
          if (marker >= 0) {
            afterMarker = true;
            const tail = text.slice(marker + 'XRSSEQTEST'.length);
            const end = tail.indexOf('XRSSEQENDTEST');
            const targetText = end < 0 ? tail : tail.slice(0, end);
            const match = /(?<![\d,])0,0(?![\d,])/.exec(targetText);
            if (match) {
              const offset = marker + 'XRSSEQTEST'.length + match.index;
              if (!node.parentElement?.closest('mark[data-color="#ffff00"]')) return { error: 'synthetic sequence lost its yellow mark' };
              editable.focus();
              const range = document.createRange();
              range.setStart(node, offset + 1);
              range.collapse(true);
              const selection = getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              return { ok: true, value: text.slice(offset, offset + 3) };
            }
            if (end >= 0) return { error: 'no unfilled placeholder remains in the synthetic range' };
            continue;
          }
          if (!afterMarker) continue;
          const end = text.indexOf('XRSSEQENDTEST');
          const targetText = end < 0 ? text : text.slice(0, end);
          const match = /(?<![\d,])0,0(?![\d,])/.exec(targetText);
          if (!match) {
            if (end >= 0) return { error: 'no unfilled placeholder remains in the synthetic range' };
            continue;
          }
          if (!node.parentElement?.closest('mark[data-color="#ffff00"]')) return { error: 'synthetic sequence lost its yellow mark' };
          editable.focus();
          const range = document.createRange();
          range.setStart(node, match.index + 1);
          range.collapse(true);
          const selection = getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return { ok: true, value: text.slice(match.index, match.index + 3) };
        }
        return { error: 'yellow synthetic 0,0 placeholder was not found', yellow: [...document.querySelectorAll('.report-content mark[data-color="#ffff00"]')].map(el => el.textContent) };
      });
      assert.equal(selected.ok, true, `${id}: select the next placeholder in the same yellow run (${JSON.stringify(selected)})`);
      const before = await page.evaluate(() => {
        const editor = document.querySelector('.report-content').editor;
        return { cursor: editor.state.selection.from, text: editor.state.doc.textBetween(0, editor.state.doc.content.size) };
      });
      if (mode === 'paste') {
        await app.evaluate(({clipboard}, value) => clipboard.writeText(value), digit);
        await page.keyboard.press('Control+v');
      } else await page.keyboard.insertText(digit);
      const next = await page.evaluate(({ digit, before }) => {
        const editor = document.querySelector('.report-content').editor;
        let zeros = 0;
        editor.state.doc.descendants(node => {
          if (!node.isText) return;
          const yellow = node.marks.some(mark => mark.type.name === 'highlight' && mark.attrs.color?.toLowerCase() === '#ffff00');
          zeros += [...node.text.matchAll(/(?<![\d,])0,0(?![\d,])/g)].filter(() => yellow).length;
        });
        const text = editor.state.doc.textBetween(0, editor.state.doc.content.size);
        const markerPosition = text.indexOf('XRSSEQTEST');
        const markerEnd = markerPosition < 0 ? -1 : text.indexOf('XRSSEQENDTEST', markerPosition);
        const sequenceText = markerPosition < 0 ? '' : text.slice(markerPosition + 'XRSSEQTEST'.length, markerEnd < 0 ? undefined : markerEnd);
        const sequenceZeros = [...sequenceText.matchAll(/(?<![\d,])0,0(?![\d,])/g)].length;
        const changed = [...text].findIndex((value, index) => value !== before.text[index]);
        const cursor = editor.state.selection.from;
        const previous = editor.state.doc.resolve(cursor).nodeBefore;
        return { zeros, sequenceZeros, text, changed, previousText: previous?.text ?? '', previousYellow: Boolean(previous?.marks.some(mark => mark.type.name === 'highlight' && mark.attrs.color?.toLowerCase() === '#ffff00')), digit, beforeCursor: before.cursor, cursor };
      }, { digit, before });
      assert.ok(next.text.includes(digit), `${id}: entered digit is present (${JSON.stringify(next)})`);
      assert.ok(next.changed >= 0, `${id}: document changed after typing (${JSON.stringify(next)})`);
      assert.equal(next.previousYellow, false, `${id}: entered measurement has no yellow fill`);
      return next;
    };

    const firstRemaining = await replaceWithDigit('7');
    assert.equal(firstRemaining.sequenceZeros, 2, `${id}: first entry leaves both later prompts in the same yellow run`);
    assert.ok(firstRemaining.zeros > 0, `${id}: later highlighted numeric prompts remain after the first edit`);
    const secondRemaining = await replaceWithDigit('8');
    assert.equal(secondRemaining.sequenceZeros, 1, `${id}: second measurement is independently replaced within that yellow run`);
    const thirdRemaining = await replaceWithDigit('9', 'paste');
    assert.equal(thirdRemaining.sequenceZeros, 0, `${id}: pasted third measurement is replaced without clearing adjacent prompts early`);

    await page.keyboard.press('Control+z');
    assert.ok(await page.evaluate(() => {
      const editor = document.querySelector('.report-content').editor;
      let count = 0;
      editor.state.doc.descendants(node => {
        if (node.isText && node.text.includes('0,0') &&
            node.marks.some(mark => mark.type.name === 'highlight' && mark.attrs.color?.toLowerCase() === '#ffff00')) count++;
      });
      return count > 0;
    }), `${id}: Undo restores a highlighted numeric prompt`);
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => document.querySelector('#save-state')?.textContent === 'Сохранено на компьютере');
    const reportId = await page.locator('.report-tab.active [data-report-select]').getAttribute('data-report-select');
    const savedText = await page.evaluate(() => document.querySelector('.report-content').editor.state.doc.textBetween(0, document.querySelector('.report-content').editor.state.doc.content.size));
    persistedReports.set(reportId, savedText);
  }

  assert.deepEqual(rendererErrors, []);
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent === 'Сохранено на компьютере');
  await app.close();
  app = await _electron.launch(electronOptions);
  page = await app.firstWindow();
  await page.locator('.report-content').waitFor();
  assert.equal(await page.locator('.report-tab').count(), ids.length + 1, 'the eight synthetic reports and the original blank report remain available after relaunch');
  for (const [reportId, expectedText] of persistedReports) {
    await page.locator(`[data-report-select="${reportId}"]`).click();
    const restoredText = await page.evaluate(() => document.querySelector('.report-content').editor.state.doc.textBetween(0, document.querySelector('.report-content').editor.state.doc.content.size));
    assert.equal(restoredText, expectedText, `${reportId}: edited template text is unchanged after Electron restart`);
  }
  console.log('PASS: sequential yellow 0,0 replacement across all eight Spine templates, retained field IDs, Undo/Redo, and workspace persistence after Electron restart.');
} finally {
  await app.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
