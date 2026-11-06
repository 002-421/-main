import test from 'node:test';
import assert from 'node:assert/strict';
import {morphologicalIssues} from '../src/morphological-grammar.ts';

test('whole-text morphology detects unseen agreement errors and preserves exact UTF-16 offsets',async()=>{
 const text='🧠 Суставная щели нерезко сужена. Высота остального межпозвонковых дисков не изменена. Большая окно открыто. Новые исследование завершены. Данные свидетельствует о динамике. Было выполнена томография. Согласно заключения врача.';
 const issues=await morphologicalIssues(text);
 for(const [word,correction] of [['щели','щель'],['остального','остальных'],['Большая','Большое'],['исследование','исследования'],['свидетельствует','свидетельствуют'],['Было','Была'],['заключения','заключению']]){
  const issue=issues.find(issue=>issue.text===word&&issue.suggestions.includes(correction));
  assert.ok(issue,`${word} → ${correction}`);
  assert.equal(text.slice(issue.start,issue.end),word);
 }
});
test('ambiguous cases, coordinated subjects, enumerations and participle objects do not create false warnings',async()=>{
 for(const text of [
  'Суставные щели нерезко сужены.','Почки не расширены.','В левой почке очаг.',
  'Высота остальных межпозвонковых дисков не изменена.',
  'Структура печени не изменена.','Мочеточник на уровне визуализации не расширен.',
  'Корковый и мозговой слои дифференцируются.',
  'Перекрест и супраселлярная область не изменены.',
  'В сагиттальной, аксиальной, корональной проекциях.',
  'С однородным содержимым размерами до двух сантиметров.',
  'Очаги, накапливающие контраст.','В остальном базальные цистерны не расширены.',
  'Исследование будет выполнено.','Исследования были выполнены.',
  'Большое окно открыто.','Новые исследования завершены.'
 ])assert.deepEqual(await morphologicalIssues(text),[],text);
});
