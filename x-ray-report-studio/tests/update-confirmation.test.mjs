import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('update install requires one centered explicit confirmation with the approved copy', async () => {
  const [workspace, styles] = await Promise.all([
    fs.readFile(new URL('../src/workspace.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /Убедитесь, что все отчёты были сохранены локально\.<\/p><p>Установить обновление сейчас\?/);
  assert.match(workspace, /id="cancel-update-confirmation">Отмена/);
  assert.match(workspace, /id="confirm-update-install">ОК/);
  assert.match(workspace, /#cancel-update-confirmation[^]*?closeDialog\(\)/);
  assert.match(workspace, /#confirm-update-install[^]*?window\.desktop!\.installUpdate\(\)/);
  assert.ok(styles.includes('.update-confirm-actions{display:flex;justify-content:center'));
  assert.doesNotMatch(workspace, /не экспортированы в Word или PDF/);
  assert.doesNotMatch(workspace, /Черновики сохранены на этом компьютере\. Установить обновление сейчас/);
  assert.ok(styles.includes('.update-confirm-actions{display:flex;justify-content:center;gap:12px'));
});
