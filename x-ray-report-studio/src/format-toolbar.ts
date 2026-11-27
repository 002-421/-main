import {FIRST_LINE_INDENTS, selectionIndent, setFirstLineIndent} from './document-typography.ts';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { insertReportLine } from './editor-format';
import { DEFAULT_RULE_THICKNESS, LEGACY_RULE_THICKNESS, MANUAL_FILL_COLORS, RULE_THICKNESSES, manualFillColor } from './report-format-options';

const lists = [['dash', '-'], ['asterisk', '*'], ['disc', '•'], ['ordered', '1.'], ['off', 'Без списка']];
const alignments = [['left', 'По левому краю'], ['center', 'По центру'], ['right', 'По правому краю'], ['justify', 'По ширине']];
const ruleChoices = RULE_THICKNESSES.map(value => [String(value), `${value.toFixed(1).replace('.', ',')} pt`]);
const fillKey = 'xrs.manual-fill-color';

function menu(name: string, title: string, choices: readonly (readonly string[])[], primary = '', compactLabel = '') {
  return `<div class="format-menu">${primary}<button type="button" data-format-toggle="${name}" aria-controls="format-${name}" aria-expanded="false" aria-label="${title}">${compactLabel || (primary ? '▾' : `${title} ▾`)}</button>
  <div class="format-options" id="format-${name}" role="group" aria-label="${title}" hidden>${choices.map(([value, text]) => `<button type="button" data-format="${name}" data-value="${value}" aria-pressed="false">${name === 'fill' && value !== 'off' ? `<i class="format-swatch" style="--swatch:${value}" aria-hidden="true"></i>` : ''}${text}</button>`).join('')}</div></div>`;
}

export const fillToolbar = menu('fill', 'Цвет заливки', [...MANUAL_FILL_COLORS, ['off', 'Без заливки']],
  '<button id="fill-text" type="button" aria-pressed="false"><i class="format-swatch" aria-hidden="true"></i>Заливка</button>');

export const paragraphToolbar = [
  menu('align', 'Выравнивание', alignments),
  menu('indent', 'Отступ первой строки', FIRST_LINE_INDENTS.map((points,index)=>[String(points),['Без отступа','0,5 см','Стандартный (≈ 0,625 см)','0,75 см','1,0 см','1,25 см'][index]]), '', '_А'),
  menu('rule', 'Толщина линии', ruleChoices, '<button id="insert-line" type="button" aria-label="Линия">― Линия</button>'),
  menu('list', 'Список', lists),
  '<button id="table-tools" title="Вставить или изменить таблицу" aria-label="Вставить или изменить таблицу"><svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1.5" y="1.5" width="15" height="15"/><path d="M6.5 1.5v15m5-15v15M1.5 6.5h15m-15 5h15"/></svg></button>',
].join('');

export function bindFormatToolbar(editor: Editor, toolbar: HTMLElement) {
  let fill = manualFillColor(localStorage.getItem(fillKey)) ?? MANUAL_FILL_COLORS[0][0];
  let thickness = DEFAULT_RULE_THICKNESS;
  const toggles = [...toolbar.querySelectorAll<HTMLButtonElement>('[data-format-toggle]')];
  const choices = [...toolbar.querySelectorAll<HTMLButtonElement>('[data-format]')];
  const fillButton = toolbar.querySelector<HTMLButtonElement>('#fill-text')!;
  const lineButton = toolbar.querySelector<HTMLButtonElement>('#insert-line')!;
  lineButton.onmousedown = event => event.preventDefault();
  lineButton.onclick = () => { insertReportLine(editor, thickness); close(); };
  const panel = (toggle: HTMLButtonElement) => document.getElementById(toggle.getAttribute('aria-controls')!)!;
  function close() {
    for (const toggle of toggles) {
      toggle.setAttribute('aria-expanded', 'false');
      panel(toggle).hidden = true;
    }
  }
  function applyFill(value: string | null) {
    const {from, to} = editor.state.selection;
    if (from === to) return;
    const chain = editor.chain().focus();
    if (value) chain.setBackgroundColor(value).run();
    else chain.unsetBackgroundColor().run();
  }
  function selectionFill() {
    const {selection, storedMarks, doc} = editor.state;
    const background = (marks: typeof selection.$from.parent.marks) =>
      manualFillColor(marks.find(mark => mark.type.name === 'textStyle')?.attrs.backgroundColor) ?? String(marks.find(mark => mark.type.name === 'textStyle')?.attrs.backgroundColor ?? '').toLowerCase();
    const colors = new Set<string>();
    if (selection.empty) colors.add(background(storedMarks ?? selection.$from.marks()));
    else for (const range of selection.ranges) {
      doc.nodesBetween(range.$from.pos, range.$to.pos, node => {
        if (node.isText) colors.add(background(node.marks));
      });
    }
    if (colors.size > 1) return {state:'mixed'};
    const color = colors.values().next().value;
    return {state:!color ? 'none' : color === fill ? 'current' : 'other', color};
  }
  function activeAlignment() {
    const {from, to, $from} = editor.state.selection;
    const selected = new Set<string>();
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && (from === to || pos + 1 < to)) selected.add(node.attrs.textAlign ?? 'left');
    });
    if (!selected.size && $from.parent.isTextblock) selected.add($from.parent.attrs.textAlign ?? 'left');
    return selected.size > 1 ? 'mixed' : [...selected][0];
  }
  function update() {
    const bullet = editor.isActive('bulletList'), ordered = editor.isActive('orderedList');
    const list = ordered && !bullet ? 'ordered' : bullet && !ordered ? editor.getAttributes('bulletList').bulletStyle ?? 'disc' : '';
    const align = activeAlignment();
    const selection = editor.state.selection;
    const rule = selection instanceof NodeSelection && selection.node.type.name === 'horizontalRule' ?
      selection.node.attrs.thicknessPt ?? LEGACY_RULE_THICKNESS : thickness;
    const {state,color} = selectionFill();
    const indent=selectionIndent(editor.state);
    const active: Record<string, unknown> = {indent:indent==='mixed'?null:String(FIRST_LINE_INDENTS.find(p=>Math.abs(p-indent)<.001)??indent),list, align, rule: String(rule), fill:state==='none'?'off':state==='mixed'?null:color};
    for (const choice of choices) {
      const pressed = active[choice.dataset.format!] === choice.dataset.value;
      choice.setAttribute('aria-pressed', String(pressed));
    }
    const indentToggle=toggles.find(button=>button.dataset.formatToggle==='indent')!;indentToggle.title=indent==='mixed'?'Смешанные отступы':`Отступ первой строки: ${(indent*2.54/72).toFixed(2)} см`;indentToggle.dataset.indentState=indent==='mixed'?'mixed':String(indent);
    const listToggle = toggles.find(button => button.dataset.formatToggle === 'list')!;
    listToggle.textContent = list ? `Список: ${lists.find(([key]) => key === list)?.[1] ?? ''} ▾` : 'Список ▾';
    const alignToggle = toggles.find(button => button.dataset.formatToggle === 'align')!;
    const alignment = alignments.find(([key]) => key === align)?.[1];
    alignToggle.title = align === 'mixed' ? 'Смешанное выравнивание' : alignment ?? 'Выравнивание';
    alignToggle.textContent = align === 'mixed' ? 'Смешанное ▾' : `${alignment ?? 'Выравнивание'} ▾`;
    fillButton.querySelector<HTMLElement>('.format-swatch')!.style.setProperty('--swatch', fill);
    const description = {none:'нет ручной заливки',current:'текущий цвет',other:'другой цвет',mixed:'смешанная заливка'}[state];
    fillButton.dataset.fillState = state;
    fillButton.style.setProperty('--fill-selection-color', color || 'var(--mint)');
    fillButton.title = `Заливка: ${MANUAL_FILL_COLORS.find(([choice]) => choice === fill)![1]}. Выделение: ${description}.`;
    fillButton.setAttribute('aria-pressed', state === 'mixed' ? 'mixed' : String(state !== 'none'));
  }
  for (const toggle of toggles) {
    toggle.onmousedown = event => event.preventDefault();
    toggle.onclick = event => {
      const open = panel(toggle).hidden;
      close();
      panel(toggle).hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open && event.detail === 0) panel(toggle).querySelector('button')?.focus();
    };
    toggle.parentElement!.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel(toggle).hidden) {
        event.stopPropagation();
        close();
        toggle.focus();
      }
    });
  }
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.format-menu')) close();
  });
  fillButton.onmousedown = event => event.preventDefault();
  fillButton.onclick = () => { applyFill(selectionFill().state === 'current' ? null : fill); close(); update(); };
  for (const choice of choices) {
    choice.onmousedown = event => event.preventDefault();
    choice.onclick = () => {
      const {format, value} = choice.dataset;
      if (format === 'indent') setFirstLineIndent(editor,Number(value));
      if (format === 'align') editor.chain().focus().setTextAlign(value!).run();
      if (format === 'rule') {
        thickness = Number(value);
        insertReportLine(editor, thickness);
      }
      if (format === 'list') {
        const chain = editor.chain().focus();
        if (value === 'off') chain.liftListItem('listItem').run();
        else if (value === 'ordered') {
          if (!editor.isActive('orderedList')) chain.toggleOrderedList().run();
        } else {
          if (!editor.isActive('bulletList')) chain.toggleBulletList();
          chain.updateAttributes('bulletList', {bulletStyle:value}).run();
        }
      }
      if (format === 'fill') {
        const color = manualFillColor(value);
        if (color) {
          fill = color;
          try { localStorage.setItem(fillKey, fill); } catch {}
        }
        applyFill(color ?? null);
      }
      close();
      update();
    };
  }
  editor.on('transaction', ({transaction}) => {
    if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) update();
  });
  update();
}
