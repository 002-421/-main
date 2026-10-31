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

export function compiler(prefix: string, reservedIds: readonly number[] = []) {
  let count = 0;
  const compile = (text: string, attrs?: Record<string, any>): RichNode => {
    const content: RichNode[] = [];
    for (const part of text.split(/(\[\[.*?\]\])/g)) {
      if (!part) continue;
      if (part.startsWith('[[') && part.endsWith(']]')) {
        do { count++; } while (reservedIds.includes(count));
        content.push({ type: 'reportField', attrs: {
          id: `${prefix}.${count}`, hint: part.slice(2, -2), value: '',
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

export function makeDocument(profileId = 'brain', library = builtinModules, templateOverride?: RichNode): RichNode {
  if (templateOverride) return validateTemplate(templateOverride);
  const profile = profiles.find(p => p.id === profileId) ?? profiles[0];
  // Keep existing patient and study field identities when retiring age and clinical goal.
  const compile = compiler('base', [3, 6]);
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

/** Upgrade the two retired header entries without rebuilding an existing report. */
export function migrateLegacyHeader(doc: RichNode): RichNode {
  const next = structuredClone(doc);
  const header = next.content?.find(n => n.type === 'reportSection' && n.attrs?.id === 'header');
  if (!header) return next;
  const nodeText = (n: RichNode): string => n.text ?? n.content?.map(nodeText).join('') ?? '';
  const label = (n: RichNode) => nodeText(n).trim().toLowerCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ');
  function removeAge(node: RichNode) {
    if (!node.content) return;
    const kept: RichNode[] = [];
    for (const child of node.content) {
      if (child.type === 'reportField' && (child.attrs?.id === 'base.3' || child.attrs?.hint?.trim().toLowerCase() === 'полных лет')) {
        const separator = kept.at(-1);
        if (separator?.type === 'text' && /\/\s*$/.test(separator.text ?? '')) {
          separator.text = separator.text!.replace(/\s*\/\s*$/, '');
          if (!separator.text) kept.pop();
        }
        continue;
      }
      removeAge(child);
      kept.push(child);
    }
    node.content = kept;
  }
  function walk(node: RichNode) {
    if (node.type === 'table') {
      node.content = node.content?.filter(row => {
        const name = row.content?.[0] && label(row.content[0]);
        if (name === 'клинические сведения / цель') return false;
        if (name === 'дата рождения / возраст') {
          const cell = row.content![0];
          // The original label is one text run. Keep its formatting when changing it.
          let replaced = false;
          function rename(n: RichNode) {
            if (n.type === 'text') {
              n.text = replaced ? '' : 'Дата рождения';
              replaced = true;
            }
            n.content?.forEach(rename);
            if (n.content) n.content = n.content.filter(c => c.type !== 'text' || c.text);
          }
          rename(cell);
          row.content!.slice(1).forEach(removeAge);
        }
        return true;
      });
    }
    node.content?.forEach(walk);
  }
  walk(header);
  return next;
}

const blockTypes = new Set(['paragraph', 'heading', 'reportSection', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'table']);
const inlineTypes = new Set(['text', 'reportField', 'hardBreak']);
const simpleMarks = new Set(['bold', 'italic', 'underline', 'strike', 'code']);

/** Validate a reusable rich template and return a safe copy with every patient value cleared. */
export function validateTemplate(input: unknown): RichNode {
  let count = 0;
  let textSize = 0;
  const fieldIds = new Set<string>();
  const sectionIds = new Set<string>();
  const fail = (): never => { throw new Error('Некорректный шаблон: проверьте разделы, поля и форматирование.'); };
  function string(value: unknown, max: number): string {
    if (typeof value !== 'string' || value.length > max || (textSize += value.length) > 2_000_000) return fail();
    return value;
  }
  function id(value: unknown, ids?: Set<string>): string {
    const result = string(value, 120);
    if (!/^[A-Za-z0-9_.:-]+$/.test(result) || ids?.has(result)) return fail();
    ids?.add(result);
    return result;
  }
  function color(value: unknown): string | undefined {
    if (value == null) return undefined;
    const result = string(value, 100);
    return /^(#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i.test(result) ? result : undefined;
  }
  function marks(raw: unknown): RichNode['marks'] {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length > 20) return fail();
    const seen = new Set<string>();
    return raw.flatMap((mark: any): NonNullable<RichNode['marks']> => {
      if (!mark || typeof mark.type !== 'string' || seen.has(mark.type)) return fail();
      seen.add(mark.type);
      if (simpleMarks.has(mark.type)) return [{ type: mark.type }];
      const a = mark.attrs ?? {};
      if (!a || typeof a !== 'object' || Array.isArray(a)) return fail();
      if (mark.type === 'templateField') {
        return [{ type: mark.type, attrs: { id: id(a.id), hint: string(a.hint, 2000), original: string(a.original ?? a.hint, 100000), filled: a.filled === true } }];
      }
      if (mark.type === 'highlight') {
        const value = color(a.color);
        return [{ type: mark.type, ...(value ? { attrs: { color: value } } : {}) }];
      }
      if (mark.type === 'textStyle') {
        const attrs: Record<string, string> = {};
        for (const key of ['color', 'backgroundColor']) {
          const value = color(a[key]);
          if (value) attrs[key] = value;
        }
        if (a.fontFamily != null) {
          const value = string(a.fontFamily, 200);
          if (/^[\p{L}\d\s,'"_-]+$/u.test(value)) attrs.fontFamily = value;
        }
        for (const key of ['fontSize', 'lineHeight']) {
          if (a[key] == null) continue;
          const value = string(a[key], 30);
          if (/^\d{1,3}(?:\.\d{1,5})?(?:px|pt|em|rem|%)?$/.test(value)) attrs[key] = value;
        }
        return Object.keys(attrs).length ? [{ type: mark.type, attrs }] : [];
      }
      if (mark.type === 'link') {
        const href = string(a.href, 2000);
        if (!/^(https?:|mailto:|tel:|#|\/(?!\/)|\.{1,2}\/)/i.test(href) || /[\u0000-\u0020]/.test(href)) return [];
        return [{ type: mark.type, attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } }];
      }
      return fail();
    });
  }
  function node(raw: any, depth = 0): RichNode {
    if (++count > 20000 || depth > 30 || !raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.type !== 'string') return fail();
    const type = raw.type;
    if (!(type === 'doc' || blockTypes.has(type) || inlineTypes.has(type) || ['listItem', 'tableRow', 'tableHeader', 'tableCell'].includes(type))) return fail();
    const attrs: Record<string, any> = {};
    const a = raw.attrs ?? {};
    if (!a || typeof a !== 'object' || Array.isArray(a)) return fail();
    if (type === 'reportSection') {
      attrs.id = id(a.id, sectionIds);
      attrs.title = string(a.title, 300);
      attrs.moduleId = a.moduleId ? id(a.moduleId) : '';
    } else if (type === 'reportField') {
      attrs.id = id(a.id, fieldIds);
      attrs.hint = string(a.hint, 2000);
      string(a.value ?? '', 100000);
      attrs.value = '';
    } else if (type === 'heading') {
      if (![1, 2, 3].includes(a.level)) return fail();
      attrs.level = a.level;
    } else if (type === 'orderedList' && a.start !== undefined) {
      if (!Number.isInteger(a.start) || a.start < 1 || a.start > 100000) return fail();
      attrs.start = a.start;
    } else if (type === 'codeBlock' && a.language != null) {
      const language = string(a.language, 60);
      if (!/^[\w+-]*$/.test(language)) return fail();
      attrs.language = language;
    } else if (type === 'tableCell' || type === 'tableHeader') {
      for (const key of ['colspan', 'rowspan']) {
        if (a[key] === undefined) continue;
        if (!Number.isInteger(a[key]) || a[key] < 1 || a[key] > 100) return fail();
        attrs[key] = a[key];
      }
      if (a.colwidth != null) {
        if (!Array.isArray(a.colwidth) || a.colwidth.length > 100 || a.colwidth.some((v: any) => !Number.isFinite(v) || v < 0 || v > 10000)) return fail();
        attrs.colwidth = [...a.colwidth];
      }
      if (['left', 'center', 'right', 'justify'].includes(a.align)) attrs.align = a.align;
    }
    if (['paragraph', 'heading'].includes(type) && ['left', 'center', 'right', 'justify'].includes(a.textAlign)) attrs.textAlign = a.textAlign;
    if (type === 'paragraph' && a.moduleRef != null) attrs.moduleRef = id(a.moduleRef);
    if (['doc', 'paragraph', 'heading'].includes(type)) {
      if (a.fontFamily != null && /^[\p{L}\d\s,'"_-]+$/u.test(string(a.fontFamily, 200))) attrs.fontFamily = a.fontFamily;
      for (const key of ['fontSizePt', 'spaceBeforePt', 'spaceAfterPt', 'lineHeight', 'pageWidthMm', 'pageHeightMm', 'marginTopMm', 'marginBottomMm', 'marginLeftMm', 'marginRightMm']) {
        if (a[key] == null) continue;
        if (typeof a[key] !== 'number' || !Number.isFinite(a[key]) || a[key] < 0 || a[key] > 1000) return fail();
        attrs[key] = a[key];
      }
      for (const key of ['keepNext', 'pageBreakBefore']) if (typeof a[key] === 'boolean') attrs[key] = a[key];
      if (a.templateOriginal != null) attrs.templateOriginal = string(a.templateOriginal, 100000);
      if (a.sourceFormat === 'alliance-template') attrs.sourceFormat = a.sourceFormat;
      if (['Title', 'Subtitle', 'Normal', 'Heading1', 'Heading2', 'Heading3'].includes(a.sourceStyle)) attrs.sourceStyle = a.sourceStyle;
    }
    const result: RichNode = { type, ...(Object.keys(attrs).length ? { attrs } : {}) };
    if (type === 'text') {
      result.text = string(raw.text, 100000);
      if (!result.text) return fail();
    } else if (raw.text !== undefined) return fail();
    const nodeMarks = marks(raw.marks);
    if (nodeMarks?.length) {
      if (!inlineTypes.has(type)) return fail();
      result.marks = nodeMarks;
    }
    if (raw.content !== undefined && !Array.isArray(raw.content)) return fail();
    const children: RichNode[] = (raw.content ?? []).map((child: unknown) => node(child, depth + 1));
    const validChildren = (allowed: Set<string>) => children.every(child => allowed.has(child.type));
    if (inlineTypes.has(type) || type === 'horizontalRule') {
      if (children.length) return fail();
    } else {
      let valid = false;
      if (['doc', 'reportSection', 'blockquote', 'tableCell', 'tableHeader'].includes(type)) valid = children.length > 0 && validChildren(blockTypes);
      if (['paragraph', 'heading'].includes(type)) valid = validChildren(inlineTypes);
      if (type === 'codeBlock') valid = children.every(child => child.type === 'text');
      if (['bulletList', 'orderedList'].includes(type)) valid = children.length > 0 && children.every(child => child.type === 'listItem');
      if (type === 'listItem') valid = children[0]?.type === 'paragraph' && validChildren(blockTypes);
      if (type === 'table') valid = children.length > 0 && children.every(child => child.type === 'tableRow');
      if (type === 'tableRow') valid = children.length > 0 && children.every(child => ['tableCell', 'tableHeader'].includes(child.type));
      if (!valid) return fail();
      result.content = children;
    }
    return result;
  }
  const result = node(input);
  if (result.type !== 'doc') return fail();
  return result;
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
  return { doc: migrateLegacyHeader(input.doc), profile: profiles.some(p => p.id === input.profile) ? input.profile : 'brain', customModules: validateLibrary(input.customModules ?? []), cache: {} };
}
