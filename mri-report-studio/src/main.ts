import './style.css';
import { createIcons, Activity, FilePlus2, FolderOpen, Save, Copy, FileDown, Plus, Search, Check, ShieldCheck, Undo2, Redo2, Bold, Italic, Underline, Strikethrough, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, AlignJustify, Table2, Highlighter, PanelRight, Layers, X, ChevronRight, Trash2, Upload, Download, Menu, Type, CheckCheck, ArrowRight, Settings2, Rows3, Columns3 } from 'lucide';
import DOMPurify from 'dompurify';
import { makeEditor } from './editor';
import { builtinModules, profiles, makeDocument, collectFields, insertModule, removeModule, moduleNode, validateDraft, validateLibrary, draftVersion, type RichNode, type Module } from './model';

declare global {
  interface Window {
    desktop?: { exportPDF: (filename: string) => Promise<{ canceled: boolean; path?: string }>; copyReport: (html: string, text: string) => Promise<void> };
  }
}

const icons = { Activity, FilePlus2, FolderOpen, Save, Copy, FileDown, Plus, Search, Check, ShieldCheck, Undo2, Redo2, Bold, Italic, Underline, Strikethrough, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, AlignJustify, Table2, Highlighter, PanelRight, Layers, X, ChevronRight, Trash2, Upload, Download, Menu, Type, CheckCheck, ArrowRight, Settings2, Rows3, Columns3 };
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const STORAGE_KEY = 'mri-report-studio.draft.v1';
const LIBRARY_KEY = 'mri-report-studio.library.v1';
const cache: Record<string, { body: RichNode; conclusion?: RichNode }> = {};
let profile = 'brain';
let customModules: Module[] = [];
let selectedField = '';
let filterMode = 'empty';
let saveTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let suppressUpdates = false;
let savingFailed = false;
let documentChanged = false;

function toast(message: string, error = false) {
  $('.toast')?.remove();
  const element = document.createElement('div');
  element.className = `toast${error ? ' error' : ''}`;
  element.role = error ? 'alert' : 'status';
  element.textContent = message;
  document.body.append(element);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.remove(), 4500);
}

try { customModules = validateLibrary(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]')); }
catch { /* A broken local library must not prevent access to the report. */ }
let initial = makeDocument();
let recoveryError = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const result = validateDraft(JSON.parse(saved));
    initial = result.doc;
    profile = result.profile;
    const extras = result.customModules.filter(m => !customModules.some(x => x.id === m.id));
    customModules.push(...extras);
  }
} catch { recoveryError = true; }

$('#app').innerHTML = `
<div class="shell">
  <aside class="sidebar" aria-label="Библиотека модулей">
    <div class="brand"><div class="brand-mark">${icon('activity')}</div><div><strong>МРТ · Студия</strong><small>Редактор описаний</small></div></div>
    <div class="sidebar-heading">Исследование <button id="change-profile" title="Новое исследование">Изменить ${icon('chevron-right')}</button></div>
    <div class="base-label" id="base-label"></div>
    <div class="sidebar-heading" style="padding-top:10px">Дополнительные модули <button id="library" title="Управление библиотекой">${icon('settings-2')}</button></div>
    <label class="sidebar-search">${icon('search')}<input type="search" id="module-search" placeholder="Найти модуль…" aria-label="Найти модуль"></label>
    <div class="module-list" id="module-list"></div>
    <button class="finding-button" id="add-finding">${icon('plus')} Добавить отдельную находку</button>
    <div class="sidebar-footer"><span class="local-dot"></span> Данные остаются на компьютере</div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div><div class="doc-eyebrow">Рабочее пространство</div><div class="doc-name"><span id="document-name">Новое описание</span><span id="save-state" class="saved-pill">Локальный черновик</span></div></div>
      <div class="top-actions">
        <button class="btn quiet" id="toggle-modules" title="Модули">${icon('menu')}</button>
        <button class="btn quiet" id="new-report" title="Новое исследование">${icon('file-plus-2')}<span class="optional-label">Новое</span></button>
        <button class="btn quiet" id="open-draft" title="Открыть описание">${icon('folder-open')}<span class="optional-label">Открыть</span></button>
        <button class="btn" id="save-draft" title="Сохранить редактируемое описание">${icon('save')}<span class="optional-label">Сохранить</span></button>
        <button class="btn" id="copy-report" title="Копировать с форматированием для Word">${icon('copy')}<span class="optional-label">Копировать</span></button>
        <button class="btn primary" id="export-pdf">${icon('file-down')} PDF</button>
      </div>
    </header>
    <div class="ribbon" role="toolbar" aria-label="Форматирование текста">
      <div class="ribbon-group"><button class="tool" data-command="undo" title="Отменить (Ctrl+Z)">${icon('undo-2')}</button><button class="tool" data-command="redo" title="Повторить (Ctrl+Y)">${icon('redo-2')}</button></div>
      <div class="ribbon-group"><select id="font-family" class="font-family" aria-label="Шрифт"><option value="Arial">Arial</option><option value="Times New Roman">Times New Roman</option><option value="Calibri">Calibri</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option></select><select id="font-size" aria-label="Размер шрифта"><option value="12px">9</option><option value="13.333px">10</option><option value="14px" selected>10,5</option><option value="14.667px">11</option><option value="16px">12</option><option value="18.667px">14</option><option value="21.333px">16</option><option value="24px">18</option><option value="32px">24</option></select></div>
      <div class="ribbon-group"><button class="tool" data-command="bold" title="Полужирный (Ctrl+B)">${icon('bold')}</button><button class="tool" data-command="italic" title="Курсив (Ctrl+I)">${icon('italic')}</button><button class="tool" data-command="underline" title="Подчёркивание (Ctrl+U)">${icon('underline')}</button><button class="tool" data-command="strike" title="Зачёркивание">${icon('strikethrough')}</button><label class="color-tool" title="Цвет текста"><input type="color" id="text-color" value="#233044" aria-label="Цвет текста"></label><button class="tool" data-command="highlight" title="Выделение цветом">${icon('highlighter')}</button><button class="tool" data-command="clear" title="Очистить форматирование">${icon('type')}</button></div>
      <div class="ribbon-group"><button class="tool" data-align="left" title="По левому краю">${icon('align-left')}</button><button class="tool" data-align="center" title="По центру">${icon('align-center')}</button><button class="tool" data-align="right" title="По правому краю">${icon('align-right')}</button><button class="tool" data-align="justify" title="По ширине">${icon('align-justify')}</button></div>
      <div class="ribbon-group"><button class="tool" data-command="bulletList" title="Маркированный список">${icon('list')}</button><button class="tool" data-command="orderedList" title="Нумерованный список">${icon('list-ordered')}</button><select id="line-height" aria-label="Межстрочный интервал"><option value="1.15">1,15</option><option value="1.45" selected>1,45</option><option value="1.5">1,5</option><option value="2">2</option></select></div>
      <div class="ribbon-group"><button class="tool" id="table-tools" title="Таблица">${icon('table-2')}</button><button class="tool active" id="toggle-highlights" title="Подсветка заполненных полей">${icon('check-check')}</button><button class="tool" id="toggle-inspector" title="Поля документа">${icon('panel-right')}</button></div>
    </div>
    <div class="workspace">
      <div class="canvas" id="canvas">
        <div class="canvas-top"><span class="with-icon">${icon('file-down')} Документ · A4</span><span>Нажмите на выделенное поле, чтобы заполнить</span></div>
        <article class="paper"><div id="editor"></div></article>
      </div>
      <aside class="inspector" aria-label="Заполнение полей">
        <div class="inspector-head"><div class="inspector-title">Поля документа <small id="field-progress"></small></div><div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div></div>
        <div class="field-panel" id="field-panel"><div class="field-context">Начните с данных пациента</div><div class="field-label">Выберите жёлтое поле в документе</div><p class="field-hint">Здесь появится поле ввода. Заполненный текст сразу отобразится в описании.</p><button class="btn primary" id="first-field" style="width:100%">Заполнить первое поле ${icon('arrow-right')}</button></div>
        <div class="inspector-tabs"><button data-filter="empty" class="active">Незаполненные <span id="empty-count"></span></button><button data-filter="all">Все поля</button></div>
        <input type="search" class="fields-search" id="field-search" placeholder="Поиск по полям…" aria-label="Поиск по полям">
        <div class="field-list" id="field-list"></div>
      </aside>
    </div>
    <footer class="statusbar"><span id="status-left">${icon('shield-check')} Локальное сохранение</span><span><span id="word-count"></span> <span>·</span> <span id="module-count"></span> <span>·</span> v0.1</span></footer>
  </main>
</div>
<input class="file-input" type="file" id="draft-file" accept=".json,.mri.json">
<input class="file-input" type="file" id="library-file" accept=".json">
`;

let editor = makeEditor($('#editor'), initial, selectField);

function allModules() { return [...builtinModules, ...customModules]; }
function documentJSON() { return editor.getJSON() as RichNode; }
function draftData() { return { format: 'mri-report-studio', version: draftVersion, savedAt: new Date().toISOString(), profile, doc: documentJSON(), customModules }; }
function restoreContent(doc: RichNode) {
  suppressUpdates = true;
  try { editor.commands.setContent(doc); } finally { suppressUpdates = false; }
  if (!collectFields(doc).some(f => f.id === selectedField)) { selectedField = ''; renderFieldPanel(); }
  renderModules(); renderFields(); changed();
}

function changed() {
  documentChanged = true;
  $('#save-state').textContent = 'Сохраняется…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
  renderCounts();
}
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draftData()));
    $('#save-state').textContent = 'Черновик сохранён';
    $('#status-left').innerHTML = `${icon('shield-check')} Сохранено на этом компьютере`;
    savingFailed = false;
  } catch {
    $('#save-state').textContent = 'Не сохранено';
    $('#status-left').textContent = 'Сохраните файл описания через кнопку «Сохранить»';
    if (!savingFailed) toast('Не удалось сохранить локальный черновик. Сохраните описание отдельным файлом.', true);
    savingFailed = true;
  }
  refreshIcons();
}
function refreshIcons() { createIcons({ icons, attrs: { 'aria-hidden': 'true' } }); }

editor.on('update', () => {
  if (suppressUpdates) return;
  changed(); renderFields();
  if (!selectedField) return;
  const field = collectFields(documentJSON()).find(f => f.id === selectedField);
  if (!field) { selectedField = ''; renderFieldPanel(); return; }
  const input = document.querySelector<HTMLTextAreaElement>('#field-value');
  if (input && document.activeElement !== input) input.value = field.value;
});
editor.on('selectionUpdate', updateRibbon);
editor.on('transaction', updateRibbon);

function renderCounts() {
  const doc = documentJSON();
  const fields = collectFields(doc);
  const filled = fields.filter(f => f.value.trim()).length;
  $('#field-progress').textContent = `${filled} из ${fields.length}`;
  $('#empty-count').textContent = String(fields.length - filled);
  $('#progress-fill').style.width = `${fields.length ? filled / fields.length * 100 : 100}%`;
  const text = editor.getText();
  $('#word-count').textContent = `${text.split(/\s+/).filter(Boolean).length} слов`;
  const modules = doc.content?.filter(n => n.type === 'reportSection' && n.attrs?.moduleId) ?? [];
  $('#module-count').textContent = `Модулей: ${modules.length}`;
  const first = fields.find(f => f.id === 'base.1');
  $('#document-name').textContent = first?.value.trim() || 'Новое описание';
}

function renderModules() {
  const query = $('#module-search') as HTMLInputElement;
  const selected = new Set(documentJSON().content?.map(n => n.attrs?.moduleId).filter(Boolean));
  $('#base-label').innerHTML = `${escape(profiles.find(p => p.id === profile)?.title)}<span>Основной протокол</span>`;
  $('#module-list').innerHTML = allModules().filter(m => m.id !== 'F01' && m.title.toLowerCase().includes(query.value.toLowerCase())).map(m => `
    <button type="button" class="module-option${selected.has(m.id) ? ' selected' : ''}" data-module="${escape(m.id)}" aria-pressed="${selected.has(m.id)}" title="${escape(m.use ?? m.title)}">
      <span class="module-check">${selected.has(m.id) ? icon('check') : ''}</span><span class="module-name">${escape(m.title)}${m.custom ? '<small>Свой модуль</small>' : ''}</span>
    </button>`).join('');
  refreshIcons();
}

function renderFields() {
  const fields = collectFields(documentJSON());
  const query = ($('#field-search') as HTMLInputElement).value.toLowerCase();
  const rows = fields.filter(f => (filterMode === 'all' || !f.value.trim()) && `${f.hint} ${f.section} ${f.value}`.toLowerCase().includes(query));
  $('#field-list').innerHTML = rows.length ? rows.map(f => `
    <button class="field-item${f.value.trim() ? ' filled' : ''}${selectedField === f.id ? ' current' : ''}" data-field="${escape(f.id)}">
      <strong>${escape(f.section)}</strong><span class="field-dot"></span>${escape(f.hint)}${f.value ? `<small>${escape(f.value)}</small>` : ''}
    </button>`).join('') : `<div class="field-empty">${query ? 'По вашему запросу полей нет.' : 'Все поля заполнены.<br>Проверьте описание перед выгрузкой.'}</div>`;
  renderCounts();
}

function selectField(id: string) {
  selectedField = id;
  renderFieldPanel(); renderFields();
  document.querySelectorAll('.field-current').forEach(el => el.classList.remove('field-current'));
  const el = document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
  el?.classList.add('field-current');
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('.inspector').classList.add('open');
  setTimeout(() => $('#field-value')?.focus(), 0);
}

function renderFieldPanel() {
  const field = collectFields(documentJSON()).find(f => f.id === selectedField);
  if (!field) {
    $('#field-panel').innerHTML = `<div class="field-context">Заполнение описания</div><div class="field-label">Выберите поле в документе</div><p class="field-hint">Жёлтым отмечены незаполненные поля. Свободный текст можно редактировать прямо на странице.</p><button class="btn primary" id="first-field" style="width:100%">Следующее поле ${icon('arrow-right')}</button>`;
    refreshIcons(); return;
  }
  const options = field.hint.includes(' / ') ? field.hint.split(' / ').filter(t => t.length < 65 && !/удалить|выполнено —|указать|описание|перечень|значение|локализация/.test(t)) : [];
  $('#field-panel').innerHTML = `
    <div class="field-context">${escape(field.section)}</div><label class="field-label" for="field-value">${escape(field.hint)}</label>
    <textarea id="field-value" placeholder="Введите данные…" aria-label="Значение выбранного поля">${escape(field.value)}</textarea>
    ${options.length ? `<div class="quick-options" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${options.map(t => `<button class="btn" data-quick="${escape(t)}" style="font-size:10px;padding:5px 7px">${escape(t)}</button>`).join('')}</div>` : ''}
    <div class="field-actions"><button class="btn quiet" id="delete-field" title="Удалить необязательное поле">${icon('trash-2')} Удалить</button><button class="btn primary" id="next-field">Далее ${icon('arrow-right')}</button></div>
    <p class="field-hint">Ctrl + Enter — перейти к следующему полю.</p>`;
  $('#field-value').addEventListener('input', () => updateField(($('#field-value') as HTMLTextAreaElement).value));
  $('#field-value').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); nextField(); } });
  refreshIcons();
}

function updateField(value: string) {
  let done = false;
  editor.state.doc.descendants((node, pos) => {
    if (!done && node.type.name === 'reportField' && node.attrs.id === selectedField) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value }));
      done = true;
    }
  });
  renderFields();
}

function nextField() {
  const fields = collectFields(documentJSON());
  const index = fields.findIndex(f => f.id === selectedField);
  const next = [...fields.slice(index + 1), ...fields.slice(0, index + 1)].find(f => !f.value.trim());
  if (next) selectField(next.id); else { toast('Все поля заполнены. Проверьте итоговое описание.'); renderFieldPanel(); }
}

function toggleModule(id: string) {
  const module = allModules().find(m => m.id === id);
  if (!module) return;
  const doc = documentJSON();
  if (doc.content?.some(n => n.attrs?.id === id)) {
    const result = removeModule(doc, id);
    if (result.body) cache[id] = { body: result.body, conclusion: result.conclusion };
    restoreContent(result.doc);
    toast(`Модуль «${module.title}» убран. Его текст сохранён до закрытия приложения.`);
  } else {
    const result = cache[id] ?? moduleNode(module);
    restoreContent(insertModule(doc, result.body, result.conclusion));
    toast(`Добавлен модуль «${module.title}»`);
  }
}

function addFinding() {
  const id = `F01_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const result = moduleNode(builtinModules.find(m => m.id === 'F01')!, id);
  const count = (documentJSON().content?.filter(n => n.attrs?.moduleId === 'F01').length ?? 0) + 1;
  result.body.attrs!.title = `Находка ${count}`;
  (result.body.content![0].content![0]).text = `Находка ${count}`;
  restoreContent(insertModule(documentJSON(), result.body));
  const first = collectFields(result.body)[0];
  if (first) selectField(first.id);
  toast('Добавлен блок отдельной находки');
}

function updateRibbon() {
  document.querySelectorAll<HTMLElement>('[data-command]').forEach(button => {
    const name = button.dataset.command!;
    button.classList.toggle('active', !['undo', 'redo', 'clear'].includes(name) && editor.isActive(name));
  });
  document.querySelectorAll<HTMLElement>('[data-align]').forEach(button => button.classList.toggle('active', editor.isActive({ textAlign: button.dataset.align })));
  const family = editor.getAttributes('textStyle').fontFamily;
  if (family) ($('#font-family') as HTMLSelectElement).value = family;
  const fontSize = editor.getAttributes('textStyle').fontSize;
  if (fontSize) ($('#font-size') as HTMLSelectElement).value = fontSize;
}

document.querySelectorAll<HTMLElement>('[data-command]').forEach(button => {
  button.addEventListener('mousedown', e => e.preventDefault());
  button.addEventListener('click', () => {
    const chain = editor.chain().focus();
    const name = button.dataset.command;
    if (name === 'undo') chain.undo().run();
    else if (name === 'redo') chain.redo().run();
    else if (name === 'bold') chain.toggleBold().run();
    else if (name === 'italic') chain.toggleItalic().run();
    else if (name === 'underline') chain.toggleUnderline().run();
    else if (name === 'strike') chain.toggleStrike().run();
    else if (name === 'highlight') chain.toggleHighlight({ color: '#fff09b' }).run();
    else if (name === 'bulletList') chain.toggleBulletList().run();
    else if (name === 'orderedList') chain.toggleOrderedList().run();
    else if (name === 'clear') chain.unsetAllMarks().clearNodes().run();
  });
});
document.querySelectorAll<HTMLElement>('[data-align]').forEach(button => {
  button.addEventListener('mousedown', e => e.preventDefault());
  button.addEventListener('click', () => editor.chain().focus().setTextAlign(button.dataset.align!).run());
});
$('#font-family').addEventListener('change', e => editor.chain().focus().setFontFamily((e.target as HTMLSelectElement).value).run());
$('#font-size').addEventListener('change', e => editor.chain().focus().setFontSize((e.target as HTMLSelectElement).value).run());
$('#text-color').addEventListener('input', e => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run());
$('#line-height').addEventListener('change', e => editor.chain().focus().setLineHeight((e.target as HTMLSelectElement).value).run());
$('#toggle-highlights').addEventListener('click', () => { $('.paper').classList.toggle('hide-highlights'); $('#toggle-highlights').classList.toggle('active'); });
$('#toggle-inspector').addEventListener('click', () => $('.inspector').classList.toggle('open'));
$('#toggle-modules').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#module-search').addEventListener('input', renderModules);
$('#field-search').addEventListener('input', renderFields);
$('#module-list').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('[data-module]'); if (button) toggleModule(button.dataset.module!); });
$('#field-list').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('[data-field]'); if (button) selectField(button.dataset.field!); });
$('#field-panel').addEventListener('click', e => {
  const target = e.target as HTMLElement;
  if (target.closest('#first-field') || target.closest('#next-field')) nextField();
  const quick = target.closest<HTMLElement>('[data-quick]');
  if (quick) { updateField(quick.dataset.quick!); ($('#field-value') as HTMLTextAreaElement).value = quick.dataset.quick!; }
  if (target.closest('#delete-field')) {
    let position: number | undefined;
    editor.state.doc.descendants((n, p) => { if (n.type.name === 'reportField' && n.attrs.id === selectedField) position = p; });
    if (position !== undefined) editor.commands.deleteRange({ from: position, to: position + 1 });
    selectedField = ''; renderFieldPanel(); renderFields();
  }
});
document.querySelectorAll<HTMLElement>('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filterMode = button.dataset.filter!;
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach(b => b.classList.toggle('active', b === button));
  renderFields();
}));
$('#add-finding').addEventListener('click', addFinding);

function showDialog(title: string, body: string, footer = '') {
  closeDialog();
  const overlay = document.createElement('div'); overlay.className = 'dialog-overlay';
  overlay.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-header"><h2 id="dialog-title">${escape(title)}</h2><button class="tool" data-close aria-label="Закрыть">${icon('x')}</button></header><div class="dialog-body">${body}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}</section>`;
  document.body.append(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay || (e.target as HTMLElement).closest('[data-close]')) closeDialog(); });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const nodes = [...overlay.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex="0"]')].filter(n => !n.hasAttribute('disabled'));
    if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); }
  });
  refreshIcons();
  setTimeout(() => overlay.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 0);
  return overlay;
}
function closeDialog() { $('.dialog-overlay')?.remove(); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDialog(); $('.sidebar').classList.remove('open'); $('.inspector').classList.remove('open'); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(); }
});

function newReportDialog() {
  const overlay = showDialog('Новое исследование', `<p>Выберите область. Текущее описание можно сохранить отдельным файлом и открыть позже.</p>${documentChanged ? '<div class="welcome-note">Перед созданием нового описания сохраните нужный черновик кнопкой «Сохранить».</div>' : ''}<div class="profile-grid">${profiles.map(p => `<button class="profile-option" data-profile="${p.id}">${icon(p.id === 'custom' ? 'plus' : 'activity')}${escape(p.title)}</button>`).join('')}</div>`, `<button class="btn" id="save-before-new">${icon('save')} Сохранить текущее</button><button class="btn" data-close>Отмена</button>`);
  overlay.querySelector('#save-before-new')?.addEventListener('click', saveDraft);
  overlay.querySelectorAll<HTMLElement>('[data-profile]').forEach(button => button.addEventListener('click', () => {
    profile = button.dataset.profile!;
    Object.keys(cache).forEach(k => delete cache[k]);
    selectedField = '';
    restoreContent(makeDocument(profile, allModules()));
    renderFieldPanel(); closeDialog();
    documentChanged = false;
    toast('Создано новое описание');
  }));
}
$('#new-report').addEventListener('click', newReportDialog);
$('#change-profile').addEventListener('click', newReportDialog);

function filename(suffix: string) {
  const patient = collectFields(documentJSON()).find(f => f.id === 'base.1')?.value.trim();
  const base = (patient || 'МРТ_описание').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90);
  return `${base}_${new Date().toLocaleDateString('ru-RU').replaceAll('.', '-')}${suffix}`;
}
function download(text: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function saveDraft() { saveLocal(); download(JSON.stringify(draftData(), null, 2), filename('.mri.json')); }
$('#save-draft').addEventListener('click', saveDraft);
$('#open-draft').addEventListener('click', () => ($('#draft-file') as HTMLInputElement).click());
$('#draft-file').addEventListener('change', async e => {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('Файл описания слишком большой (максимум 5 МБ).');
    const result = validateDraft(JSON.parse(await file.text()));
    // Validate against the editor schema before replacing the existing document.
    editor.schema.nodeFromJSON(result.doc).check();
    const open = () => {
      profile = result.profile;
      for (const m of result.customModules) if (!customModules.some(x => x.id === m.id)) customModules.push(m);
      Object.keys(cache).forEach(k => delete cache[k]);
      restoreContent(result.doc); saveLibrary(); closeDialog(); toast('Описание открыто');
    };
    if (documentChanged) {
      const overlay = showDialog('Открыть другое описание?', '<p>Текущее описание будет заменено. Если оно нужно, сначала сохраните его отдельным файлом.</p>', '<button class="btn" id="save-current">Сохранить текущее</button><button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-open">Открыть</button>');
      overlay.querySelector('#save-current')?.addEventListener('click', saveDraft);
      overlay.querySelector('#confirm-open')?.addEventListener('click', open);
    } else open();
  } catch (error) { toast((error as Error).message || 'Не удалось открыть описание.', true); }
});

async function copyReport() {
  const container = document.createElement('div');
  container.innerHTML = DOMPurify.sanitize(editor.getHTML());
  container.querySelectorAll<HTMLElement>('[data-report-field]').forEach(field => {
    field.style.backgroundColor = field.classList.contains('is-empty') ? '#fff0a4' : 'transparent';
    field.style.whiteSpace = 'pre-wrap';
  });
  const html = container.innerHTML;
  const text = editor.getText();
  const styled = `<html><body><style>body{font-family:Arial,sans-serif;font-size:10.5pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:5px}h1{font-size:16pt;color:#233f5b}h2{font-size:12pt;color:#244d76}h3{font-size:11pt}</style>${html}</body></html>`;
  try {
    if (window.desktop) await window.desktop.copyReport(styled, text);
    else if (navigator.clipboard?.write) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([styled], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    else {
      const element = document.createElement('div'); element.contentEditable = 'true'; element.innerHTML = styled;
      element.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.append(element);
      const selection = getSelection(); const range = document.createRange(); range.selectNodeContents(element); selection?.removeAllRanges(); selection?.addRange(range);
      const ok = document.execCommand('copy'); element.remove(); selection?.removeAllRanges();
      if (!ok) throw new Error('Clipboard unavailable');
    }
    toast('Описание скопировано с форматированием. Его можно вставить в Word.');
  } catch { toast('Не удалось обратиться к буферу обмена. Выделите текст в редакторе и скопируйте вручную.', true); }
}
$('#copy-report').addEventListener('click', copyReport);

async function exportPDF() {
  closeDialog();
  const button = $('#export-pdf') as HTMLButtonElement;
  button.disabled = true;
  // Give the layout a frame to remove the dialog before printing.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    if (window.desktop) {
      const result = await window.desktop.exportPDF(filename('.pdf'));
      if (!result.canceled) toast('PDF сохранён');
    } else {
      const oldTitle = document.title; document.title = filename('');
      window.print(); document.title = oldTitle;
    }
  } catch (error) { toast(`Не удалось сохранить PDF: ${(error as Error).message}`, true); }
  finally { button.disabled = false; }
}
$('#export-pdf').addEventListener('click', () => {
  const count = collectFields(documentJSON()).filter(f => !f.value.trim()).length;
  if (!count) { void exportPDF(); return; }
  const overlay = showDialog('Проверьте незаполненные поля', `<div class="danger-note">В описании осталось незаполненных полей: <strong>${count}</strong>. Они попадут в PDF как выделенные подсказки.</div><p style="margin-top:14px">Заполните или удалите необязательные поля. При необходимости можно выгрузить текущий вариант.</p>`, '<button class="btn" data-close>Вернуться к описанию</button><button class="btn primary" id="confirm-pdf">Выгрузить текущий вариант</button>');
  overlay.querySelector('#confirm-pdf')?.addEventListener('click', () => void exportPDF());
});

$('#table-tools').addEventListener('click', () => {
  const inTable = editor.isActive('table');
  const overlay = showDialog('Таблица', inTable ? '<p>Выберите действие для таблицы, в которой находится курсор.</p><div class="library-tools"><button class="btn" data-table="row">Добавить строку</button><button class="btn" data-table="col">Добавить столбец</button><button class="btn" data-table="delete-row">Удалить строку</button><button class="btn danger" data-table="delete">Удалить таблицу</button></div>' : '<div class="form-row"><label for="table-rows">Строк</label><input type="number" id="table-rows" value="3" min="1" max="30"></div><div class="form-row"><label for="table-cols">Столбцов</label><input type="number" id="table-cols" value="2" min="1" max="8"></div>', inTable ? '<button class="btn" data-close>Закрыть</button>' : '<button class="btn" data-close>Отмена</button><button class="btn primary" id="insert-table">Вставить таблицу</button>');
  overlay.querySelector('#insert-table')?.addEventListener('click', () => {
    const rows = Math.min(30, Math.max(1, Number(($('#table-rows') as HTMLInputElement).value) || 3));
    const cols = Math.min(8, Math.max(1, Number(($('#table-cols') as HTMLInputElement).value) || 2));
    closeDialog(); editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  });
  overlay.querySelectorAll<HTMLElement>('[data-table]').forEach(b => b.addEventListener('click', () => {
    const chain = editor.chain().focus();
    if (b.dataset.table === 'row') chain.addRowAfter().run();
    if (b.dataset.table === 'col') chain.addColumnAfter().run();
    if (b.dataset.table === 'delete-row') chain.deleteRow().run();
    if (b.dataset.table === 'delete') chain.deleteTable().run();
    closeDialog();
  }));
});

function saveLibrary() {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(customModules)); }
  catch { toast('Не удалось сохранить библиотеку локально. Выгрузите её файлом.', true); }
}
function libraryDialog() {
  const overlay = showDialog('Библиотека модулей', `<p>Встроенные блоки собраны из ваших 15 шаблонов. Добавляйте свои описания и другие области исследований.</p><div class="library-tools"><button class="btn primary" id="create-module">${icon('plus')} Новый модуль</button><button class="btn" id="import-library">${icon('upload')} Импорт</button><button class="btn" id="export-library">${icon('download')} Выгрузить библиотеку</button></div><div>${allModules().map(m => `<div class="library-row"><div>${escape(m.title)}<small>${m.custom ? 'Свой модуль' : 'Встроенный блок'} · ${escape(m.id)}</small></div>${m.custom ? `<button class="tool" data-remove-custom="${escape(m.id)}" title="Удалить из библиотеки">${icon('trash-2')}</button>` : ''}</div>`).join('')}</div>`, '<button class="btn" data-close>Закрыть</button>');
  overlay.querySelector('#create-module')?.addEventListener('click', createModuleDialog);
  overlay.querySelector('#import-library')?.addEventListener('click', () => ($('#library-file') as HTMLInputElement).click());
  overlay.querySelector('#export-library')?.addEventListener('click', () => download(JSON.stringify({ version: 1, modules: allModules() }, null, 2), 'Библиотека_МРТ.json'));
  overlay.querySelectorAll<HTMLElement>('[data-remove-custom]').forEach(b => b.addEventListener('click', () => {
    customModules = customModules.filter(m => m.id !== b.dataset.removeCustom);
    saveLibrary(); changed(); renderModules(); libraryDialog();
  }));
}
function createModuleDialog() {
  const overlay = showDialog('Новый модуль', '<div class="form-row"><label for="module-name">Название</label><input id="module-name" type="text" maxlength="150" placeholder="Например, височно-нижнечелюстные суставы"></div><div class="form-row"><label for="module-text">Текст описания</label><textarea id="module-text" rows="9" placeholder="Суставные головки: [[форма, положение, структура]].&#10;Суставные диски: [[описание]]."></textarea><small>Каждая строка — отдельный абзац. Переменные поля заключайте в двойные квадратные скобки: [[описание]].</small></div>', '<button class="btn" data-close>Отмена</button><button class="btn primary" id="save-module">Добавить в библиотеку</button>');
  overlay.querySelector('#save-module')?.addEventListener('click', () => {
    const title = ($('#module-name') as HTMLInputElement).value.trim();
    const text = ($('#module-text') as HTMLTextAreaElement).value.trim();
    if (!title || !text) { toast('Введите название и текст модуля.', true); return; }
    try {
      const module = validateLibrary([{ id: `custom_${crypto.randomUUID().slice(0, 8)}`, title, sections: [{ heading: 'ОПИСАНИЕ', paragraphs: text.split(/\n+/).filter(Boolean) }] }])[0];
      customModules.push(module); saveLibrary(); changed(); renderModules(); closeDialog(); toggleModule(module.id);
    } catch (error) { toast((error as Error).message, true); }
  });
}
$('#library').addEventListener('click', libraryDialog);
$('#library-file').addEventListener('change', async e => {
  const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Максимальный размер библиотеки — 2 МБ.');
    const rows = validateLibrary(JSON.parse(await file.text()));
    let added = 0;
    for (const m of rows) { if (!allModules().some(x => x.id === m.id)) { customModules.push(m); added++; } }
    saveLibrary(); changed(); renderModules(); libraryDialog(); toast(`Добавлено модулей: ${added}. Уже существующие блоки сохранены.`);
  } catch (error) { toast((error as Error).message, true); }
});

renderModules(); renderFields(); refreshIcons();
if (recoveryError) toast('Сохранённый черновик не удалось восстановить. Можно открыть ранее выгруженный файл описания.', true);
window.addEventListener('beforeunload', () => { if (documentChanged) saveLocal(); });
