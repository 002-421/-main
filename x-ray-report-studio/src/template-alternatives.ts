import type { RichNode } from './model';

export type AlternativeGroup = { structure: string; reason: string; indices: number[] };

const yellow = { type: 'highlight', attrs: { color: '#ffff00' } };
const textOf = (node: RichNode): string => node.type === 'text' ? node.text ?? '' : node.type === 'reportField' ? String(node.attrs?.hint ?? '') : (node.content ?? []).map(textOf).join('');

/** Only groups with a verified shared anatomical subject and incompatible wording. */
export function brainAlternativeGroups(doc: RichNode, templateId: string): AlternativeGroup[] {
  if (!/^head-gm(?:-|$)/.test(templateId)) return [];
  const paragraphs = (doc.content ?? []).map((node, index) => ({ node, index, text: textOf(node).trim() })).filter(item => item.node.type === 'paragraph');
  const groups: Array<{ structure: string; reason: string; patterns: RegExp[] }> = [
    { structure: 'очаги в веществе мозга', reason: 'Отсутствие очагов противоречит их описанию.', patterns: [/^Изменений очагового характера в веществе мозга не выявлено\./i, /^В белом веществе лобных и теменных долей определяются множественные точечные очаги/i, /^В белом веществе правой\/левой лобной доли, определяется единичный точечный очаг/i] },
    { structure: 'боковые желудочки', reason: 'Нормальные и расширенные желудочки — варианты одного описания.', patterns: [/^Боковые желудочки мозга.*не расширены/i, /^Боковые желудочки мозга.*умеренно расширены/i] },
    { structure: 'эпифиз', reason: 'Норма и варианты кистозных изменений эпифиза требуют выбора.', patterns: [/^Эпифиз без особенностей\./i, /^Определяется единичное жидкостное включение эпифиза/i, /^Эпифиз в пределах нормометрии.*микрокисты/i] },
    { structure: 'базальные цистерны', reason: 'Нормальная и расширенная цистерны описаны как альтернативы.', patterns: [/^Базальные цистерны не расширены/i, /^Определяется расширение нижней ретроцеребеллярной и основной цистерн/i] },
    { structure: 'конвекситальные субарахноидальные пространства', reason: 'Три соседних абзаца описывают разные степени расширения одной структуры.', patterns: [/^Субарахноидальные конвекситальные пространства и борозды не расширены/i, /^Субарахноидальные конвекситальные пространства нерезко неравномерно расширены.*борозды не расширены/i, /^Субарахноидальные конвекситальные пространства и борозды нерезко неравномерно расширены/i] },
    { structure: 'очаговые изменения в заключении', reason: 'Отрицательное заключение и варианты очаговых изменений взаимоисключаются.', patterns: [/^МР-данных о наличии изменений очагового характера в веществе мозга не выявлено/i, /^МР-картина единичных очагов глиоза в белом веществе лобных долей/i, /^МР-картина единичных очагов глиоза в белом веществе лобных и теменных долей/i, /^МР-картина многочисленных очагов микроангиопатии в белом веществе/i] },
  ];
  return groups.flatMap(group => {
    const indices = group.patterns.map(pattern => paragraphs.find(item => pattern.test(item.text))?.index);
    return indices.every((index): index is number => index !== undefined) ? [{ structure: group.structure, reason: group.reason, indices }] : [];
  });
}

export function confirmedAlternativeGroups(doc: RichNode, templateId: string): AlternativeGroup[] {
  const brain = brainAlternativeGroups(doc, templateId);
  if (templateId !== 'joints-ks') return brain;
  const paragraphs = (doc.content ?? []).map((node, index) => ({ node, index, text: textOf(node).trim() })).filter(item => item.node.type === 'paragraph');
  const patterns = [
    /^Определяется линейный участок повышения МР сигнала в структуре заднего рога медиального мениска с нарушением целостности/i,
    /^Определяется линейный участок повышения МР сигнала в структуре заднего рога медиального мениска без нарушения целостности/i,
  ];
  const indices = patterns.map(pattern => paragraphs.find(item => pattern.test(item.text))?.index);
  return indices.every((index): index is number => index !== undefined)
    ? [...brain, { structure: 'задний рог медиального мениска', reason: 'IIIа степень с нарушением поверхности и II степень без нарушения поверхности — варианты одного очага.', indices }]
    : brain;
}

export function highlightBrainAlternatives(input: RichNode, templateId: string): RichNode {
  const doc = structuredClone(input);
  const chosen = new Set(confirmedAlternativeGroups(doc, templateId).flatMap(group => group.indices));
  const mark = (node: RichNode) => {
    if (node.type === 'text' || node.type === 'reportField') {
      const marks = node.marks ??= [];
      if (!marks.some(item => item.type === 'highlight' && item.attrs?.color === '#ffff00')) marks.push(structuredClone(yellow));
    }
    node.content?.forEach(mark);
  };
  for (const index of chosen) mark(doc.content![index]);
  return doc;
}
