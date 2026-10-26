import templates from './templates.json' with { type: 'json' };

export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: RichNode[];
};
export type Module = {
  id: string;
  title: string;
  use?: string;
  sources?: string[];
  sections: { heading?: string; paragraphs?: string[]; table?: string[][] }[];
  custom?: boolean;
};
export const builtinModules: Module[] = templates.modules;
export const profiles = [
  { id: 'brain', title: 'Головной мозг', reportTitle: 'МРТ головного мозга', modules: [], brain: true },
  { id: 'arteries', title: 'Артерии головного мозга', reportTitle: 'МР-ангиография артерий головного мозга', modules: ['M02'], brain: false },
  { id: 'veins', title: 'Вены и синусы', reportTitle: 'МР-венография головного мозга', modules: ['M03'], brain: false },
  { id: 'pituitary', title: 'Гипофиз', reportTitle: 'МРТ гипофиза', modules: ['M04'], brain: false },
  { id: 'orbits', title: 'Орбиты', reportTitle: 'МРТ орбит', modules: ['M11'], brain: false },
  { id: 'sinuses', title: 'Околоносовые пазухи', reportTitle: 'МРТ околоносовых пазух', modules: ['M12'], brain: false },
  { id: 'custom', title: 'Другая область', reportTitle: 'Протокол МРТ-исследования', modules: [], brain: false },
];

export function paragraph(text = '', attrs?: Record<string, any>): RichNode {
  return { type: 'paragraph', ...(attrs ? { attrs } : {}), content: text ? [{ type: 'text', text }] : [] };
}
export function heading(text: string, level = 2): RichNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}
export function section(id: string, title: string, content: RichNode[], moduleId = ''): RichNode {
  return { type: 'reportSection', attrs: { id, title, moduleId }, content };
}

export function compiler(prefix: string) {
  let count = 0;
  const compile = (text: string, attrs?: Record<string, any>): RichNode => {
    const content: RichNode[] = [];
    for (const part of text.split(/(\[\[.*?\]\])/g)) {
      if (!part) continue;
      if (part.startsWith('[[') && part.endsWith(']]')) {
        content.push({ type: 'reportField', attrs: {
          id: `${prefix}.${++count}`, hint: part.slice(2, -2), value: '',
        } });
      } else content.push({ type: 'text', text: part });
    }
    return { type: 'paragraph', ...(attrs ? { attrs } : {}), content };
  };
  return compile;
}

export function compileTable(rows: string[][], compile: ReturnType<typeof compiler>, header = false): RichNode {
  return { type: 'table', content: rows.map((row, index) => ({
    type: 'tableRow', content: row.map(cell => ({
      type: header && index === 0 ? 'tableHeader' : 'tableCell',
      content: [compile(cell)],
    })),
  })) };
}

export function moduleNode(module: Module, instance = module.id): { body: RichNode; conclusion?: RichNode } {
  const compile = compiler(instance);
  const body: RichNode[] = [heading(module.title)];
  let conclusion: RichNode | undefined;
  for (const s of module.sections) {
    if (s.heading === 'В ОБЩЕЕ ЗАКЛЮЧЕНИЕ') {
      conclusion = compile(`${module.title}: [[Вывод по разделу «${module.title}»]]`, { moduleRef: instance });
      continue;
    }
    if (s.heading) body.push(heading(s.heading[0] + s.heading.slice(1).toLowerCase(), 3));
    if (s.table) body.push(compileTable(s.table, compile, true));
    for (const text of s.paragraphs ?? []) body.push(compile(text));
  }
  if (module.custom && !conclusion) {
    conclusion = compile(`${module.title}: [[Вывод по разделу «${module.title}»]]`, { moduleRef: instance });
  }
  return { body: section(instance, module.title, body, module.id), conclusion };
}

export function makeDocument(profileId = 'brain', library = builtinModules): RichNode {
  const profile = profiles.find(p => p.id === profileId) ?? profiles[0];
  const compile = compiler('base');
  const content: RichNode[] = [];
  const metaRows = templates.core[0].sections[0].table!.map(row => [...row]);
  metaRows[3][1] = profile.reportTitle;
  content.push(section('header', 'Данные исследования', [heading(profile.reportTitle, 1), compileTable(metaRows, compile)]));
  const methodTexts = profile.brain
    ? templates.core[0].sections[1].paragraphs!
    : [
      'Томограф: [[модель]], напряжённость поля [[значение]] Тл. Область сканирования: [[область и границы]].',
      'Получены серии: [[фактически выполненные последовательности, плоскости, толщина среза]].',
      'Контрастирование: [[не проводилось / проведено — указать препарат и объём]]. Качество: [[достаточное / ограничения и их влияние]].',
    ];
  content.push(section('method', 'Методика', [heading('Методика'), ...methodTexts.map(t => compile(t.replace('проведено — заполнить M01', 'проведено — указать препарат и объём')))]));
  if (profile.brain) {
    const brain = templates.core[0].sections[2].paragraphs!.map(t => t.replace('; при необходимости блок F01', ''));
    content.push(section('brain', 'Головной мозг', [heading('Описание'), ...brain.map(t => compile(t))]));
    content.push(section('ventricles', 'Желудочковая система', [heading('Желудочковая система'), ...templates.core[0].sections[3].paragraphs!.map(t => compile(t))]));
    content.push(section('adjacent', 'Ликворные пространства и смежные структуры', [heading('Ликворные пространства и смежные структуры'), ...templates.core[1].sections[0].paragraphs!.map(t => compile(t))]));
  }
  const conclusions: RichNode[] = [heading('Заключение'), compile('[[Основные МР-находки и их интерпретация с учётом клинического вопроса]]')];
  for (const id of profile.modules) {
    const module = library.find(m => m.id === id);
    if (!module) continue;
    const result = moduleNode(module);
    content.push(result.body);
    if (result.conclusion) conclusions.push(result.conclusion);
  }
  conclusions.push(compile('[[Динамика относительно предыдущего исследования / сравнение недоступно / удалить строку]]'));
  content.push(section('conclusion', 'Заключение', conclusions));
  content.push(section('signature', 'Рекомендации и подпись', [
    compile('Рекомендации: [[при наличии показаний / не требуются]].'),
    compile('Врач: [[Ф.И.О.]]    Дата: [[дд.мм.гггг]]'),
  ]));
  return { type: 'doc', content };
}

export function collectFields(doc: RichNode) {
  const fields: { id: string; hint: string; value: string; section: string }[] = [];
  function walk(node: RichNode, label: string) {
    if (node.type === 'reportSection') label = node.attrs?.title ?? label;
    if (node.type === 'reportField') fields.push({
      id: node.attrs?.id ?? '', hint: node.attrs?.hint ?? '', value: node.attrs?.value ?? '', section: label,
    });
    node.content?.forEach(child => walk(child, label));
  }
  walk(doc, 'Описание');
  return fields;
}

export function insertModule(doc: RichNode, body: RichNode, conclusion?: RichNode): RichNode {
  const next = structuredClone(doc);
  const nodes = next.content ??= [];
  const index = nodes.findIndex(n => n.attrs?.id === 'conclusion');
  nodes.splice(index < 0 ? nodes.length : index, 0, structuredClone(body));
  if (conclusion) {
    const target = nodes.find(n => n.attrs?.id === 'conclusion');
    target?.content?.push(structuredClone(conclusion));
  }
  return next;
}

export function removeModule(doc: RichNode, instance: string) {
  const next = structuredClone(doc);
  const body = next.content?.find(n => n.attrs?.id === instance);
  const summary = next.content?.find(n => n.attrs?.id === 'conclusion');
  const conclusion = summary?.content?.find(n => n.attrs?.moduleRef === instance);
  next.content = next.content?.filter(n => n.attrs?.id !== instance);
  if (summary) summary.content = summary.content?.filter(n => n.attrs?.moduleRef !== instance);
  return { doc: next, body, conclusion };
}

export function validateLibrary(input: unknown): Module[] {
  const candidate = input as { modules?: unknown };
  const rows = Array.isArray(input) ? input : candidate?.modules;
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('Библиотека должна содержать список не более 100 модулей.');
  const ids = new Set<string>();
  return rows.map((raw: any) => {
    if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(raw.id) || ids.has(raw.id)) throw new Error('У модулей должны быть уникальные ID из букв, цифр, «-» и «_».');
    ids.add(raw.id);
    if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 150 || !Array.isArray(raw.sections) || raw.sections.length > 50) throw new Error('Проверьте название и разделы модуля.');
    const sections = raw.sections.map((s: any) => {
      if (!s || (s.heading !== undefined && typeof s.heading !== 'string') || (s.paragraphs !== undefined && (!Array.isArray(s.paragraphs) || s.paragraphs.some((t: any) => typeof t !== 'string' || t.length > 10000))) || (s.table !== undefined && (!Array.isArray(s.table) || s.table.length > 100 || s.table.some((row: any) => !Array.isArray(row) || row.length > 15 || row.some((c: any) => typeof c !== 'string' || c.length > 5000))))) throw new Error('Некорректное содержимое модуля.');
      return { ...(s.heading ? { heading: s.heading.slice(0, 150) } : {}), ...(s.paragraphs ? { paragraphs: [...s.paragraphs] } : {}), ...(s.table ? { table: s.table.map((r: string[]) => [...r]) } : {}) };
    });
    return { id: raw.id, title: raw.title.trim(), sections, custom: true };
  });
}

export const draftVersion = 1;
export function validateDraft(input: any): { doc: RichNode; profile: string; customModules: Module[]; cache: Record<string, any> } {
  if (!input || input.format !== 'mri-report-studio' || input.version !== draftVersion || input.doc?.type !== 'doc' || !Array.isArray(input.doc.content)) throw new Error('Это не поддерживаемый файл описания МРТ.');
  let count = 0;
  const ids = new Set<string>();
  function check(n: any, depth = 0) {
    if (++count > 20000 || depth > 30 || !n || typeof n.type !== 'string') throw new Error('Некорректная структура документа.');
    if (n.type === 'reportField') {
      if (typeof n.attrs?.id !== 'string' || ids.has(n.attrs.id) || typeof n.attrs?.hint !== 'string' || typeof n.attrs?.value !== 'string') throw new Error('Некорректные поля документа.');
      ids.add(n.attrs.id);
    }
    if (n.content !== undefined && !Array.isArray(n.content)) throw new Error('Некорректное содержимое документа.');
    n.content?.forEach((c: any) => check(c, depth + 1));
  }
  check(input.doc);
  return { doc: input.doc, profile: profiles.some(p => p.id === input.profile) ? input.profile : 'brain', customModules: validateLibrary(input.customModules ?? []), cache: {} };
}
