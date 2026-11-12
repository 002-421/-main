import { reportTemplates, makeTemplateDocument } from '../src/catalog.ts';
import { confirmedAlternativeGroups } from '../src/template-alternatives.ts';

const anchors = [
  ['печень', /печен/iu], ['гипофиз', /гипофиз/iu], ['пазухи', /пазух/iu],
  ['матка', /матк/iu], ['хрящ', /хрящ/iu], ['мениски', /мениск/iu],
];
const visible = node => node.text ?? (node.type === 'reportField' ? node.attrs?.hint ?? '' : (node.content ?? []).map(visible).join(''));
const marked = node => (node.marks ?? []).filter(mark => mark.type === 'highlight' && mark.attrs?.color === '#ffff00').length + (node.content ?? []).reduce((sum, child) => sum + marked(child), 0);
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const excerpt = value => escape(value.length > 160 ? `${value.slice(0, 157)}…` : value);
const inspected = reportTemplates.map(template => {
  const doc = makeTemplateDocument(template.id), paragraphs = (doc.content ?? []).filter(node => node.type === 'paragraph').map(visible);
  const groups = confirmedAlternativeGroups(doc, template.id);
  const uncertain = anchors.filter(([, pattern]) => paragraphs.filter(text => pattern.test(text)).length >= 3 && !/^head-gm(?:-|$)/.test(template.id)).map(([name]) => name);
  if (/^head-gm(?:-|$)/.test(template.id) && paragraphs.some(text => /^Базальные цистерны не расширены/i.test(text)) && paragraphs.some(text => /^Определяется расширение нижней ретроцеребеллярной и основной цистерн/i.test(text))) uncertain.push('базальные/ретроцеребеллярная цистерны');
  return { template, doc, groups, uncertain };
});
const groups = inspected.flatMap(item => item.groups), paragraphCount = groups.reduce((sum, group) => sum + group.indices.length, 0);
console.log('# XRS-07D — аудит альтернатив в шаблонах МРТ и КТ\n');
console.log('Автоматический аудит встроенной библиотеки. Решение о медицински спорных формулировках принимает врач. Текст, порядок абзацев и ID полей не менялись.\n');
console.log(`Проверено шаблонов: **${inspected.length}** (МРТ: **${inspected.filter(item => !item.template.id.startsWith('ct-')).length}**, КТ: **${inspected.filter(item => item.template.id.startsWith('ct-')).length}**). Подтверждено групп выбора: **${groups.length}** в **${inspected.filter(item => item.groups.length).length}** шаблонах; полностью выделено жёлтым **${paragraphCount}** абзацев. Остальные существующие поля выбора и измерения сохраняют прежнюю подсветку.\n`);
console.log('## Подтверждённые группы\n');
console.log('| Шаблон | Структура | Найденные варианты (начала абзацев) | Причина | Уверенность |');
console.log('|---|---|---|---|---|');
for (const item of inspected) for (const group of item.groups) console.log(`| ${escape(item.template.title)} (${item.template.id}) | ${escape(group.structure)} | ${group.indices.map(index => excerpt(visible(item.doc.content[index]))).join('<br>')} | ${escape(group.reason)} | Высокая |`);
console.log('\n## Случаи для врача\n');
console.log('Повторное упоминание структуры само по себе не доказывает взаимоисключение. Эти кандидаты не были изменены автоматически.\n');
console.log('| Шаблон | Структура | Найденные формулировки (начала абзацев) | Причина для ручной проверки | Уверенность |');
console.log('|---|---|---|---|---|');
for (const item of inspected) for (const structure of item.uncertain) {
  const examples = structure.startsWith('базальные/')
    ? (item.doc.content ?? []).map(visible).filter(text => /^Базальные цистерны не расширены|^Определяется расширение нижней ретроцеребеллярной и основной цистерн/i.test(text))
    : (item.doc.content ?? []).filter(node => node.type === 'paragraph').map(visible).filter(text => anchors.find(([name]) => name === structure)?.[1].test(text)).slice(0, 3);
  const reason = structure.startsWith('базальные/') ? 'Базальные и ретроцеребеллярная цистерны не тождественны; требуется решение врача.' : 'Несколько абзацев упоминают структуру; возможны независимые находки.';
  console.log(`| ${escape(item.template.title)} (${item.template.id}) | ${structure} | ${examples.map(excerpt).join('<br>')} | ${reason} | Низкая |`);
}
console.log('\n## Охват библиотеки\n');
console.log('| Шаблон | ID | Модальность | Подтверждённые группы | Жёлтые фрагменты в итоговом шаблоне | Кандидаты для врача |');
console.log('|---|---|---|---:|---:|---|');
for (const item of inspected) console.log(`| ${escape(item.template.title)} | ${item.template.id} | ${item.template.id.startsWith('ct-') ? 'КТ' : 'МРТ'} | ${item.groups.length} | ${marked(item.doc)} | ${item.uncertain.join(', ') || '—'} |`);
