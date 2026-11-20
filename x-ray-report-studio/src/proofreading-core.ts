import nspell from 'nspell';
import { morphologicalIssues } from './morphological-grammar.ts';
import { loadMedicalWordRecognizer, trustedMedicalForms } from './medical-word-recognition.ts';
import { TEMPLATE_PERSONAL_WORDS } from './template-personal-words.ts';

// Trusted built-in forms stay separate from the editable personal dictionary.
const sourceMedicalForms = new Set([...TEMPLATE_PERSONAL_WORDS, 'микроангиопатия']);

export type ProofIssue = {
  id: string;
  start: number;
  end: number;
  text: string;
  kind: 'spelling' | 'grammar';
  message: string;
  suggestions: string[];
};

export const MAX_PROOF_ISSUES = 200;
const dictionaryForm = (word: string) => word.normalize('NFC').replace(/[\u0300\u0301]/gu, '');
const normalize = (word: string) => dictionaryForm(word).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const abbreviation = (word: string) => word.length <= 6 && word === word.toLocaleUpperCase('ru-RU');

function matchCase(original: string, replacement: string) {
  if (original === original.toLocaleUpperCase('ru-RU')) return replacement.toLocaleUpperCase('ru-RU');
  return /^[А-ЯЁ]/u.test(original) ? replacement[0].toLocaleUpperCase('ru-RU') + replacement.slice(1) : replacement;
}

function grammarIssues(text: string): ProofIssue[] {
  const issues: ProofIssue[] = [];
  const add = (rule: string, start: number, end: number, message: string, suggestions: string[]) => {
    if (issues.length >= MAX_PROOF_ISSUES || start >= end) return;
    issues.push({ id: `grammar.${rule}.${start}.${end}`, start, end, text: text.slice(start, end), kind: 'grammar', message, suggestions });
  };
  const runs = (pattern: RegExp, run: (m: RegExpMatchArray) => void) => {
    for (const match of text.matchAll(pattern)) run(match);
  };
  runs(/(?<![А-Яа-яЁё])([А-Яа-яЁё]{2,})([ \t]+)\1(?![А-Яа-яЁё])/giu, m => {
    add('repeat', m.index!, m.index! + m[0].length, 'Возможно, слово случайно повторено.', [m[1]]);
  });
  runs(/(?<=[\p{L}\p{N}])[ \u00a0]{2,}(?=[\p{L}\p{N}])/gu, m => {
    add('spaces', m.index!, m.index! + m[0].length, 'Несколько пробелов между словами.', [m[0].includes('\u00a0')?'\u00a0':' ']);
  });
  runs(/[ \u00a0]+[,;:.!?]/gu, m => {
    add('before-punctuation', m.index!, m.index! + m[0].length, 'Перед этим знаком препинания пробел обычно не нужен.', [m[0].trimStart()]);
  });
  runs(/\([ \u00a0]+/gu,m=>add('spaces',m.index!+1,m.index!+m[0].length,'Лишний пробел после открывающей скобки.',['']));
  runs(/[ \u00a0]+\)/gu,m=>add('spaces',m.index!,m.index!+m[0].length-1,'Лишний пробел перед закрывающей скобкой.',['']));
  runs(/[,;:.!?][ \u00a0]{2,}(?=\p{L})/gu,m=>add('spaces',m.index!+1,m.index!+m[0].length,'Повторные пробелы после знака препинания.',[m[0].includes('\u00a0')?'\u00a0':' ']));
  runs(/[,;:!?](?=[А-Яа-яЁё])/gu, m => {
    add('after-punctuation', m.index!, m.index! + 1, 'После знака препинания нужен пробел.', [m[0] + ' ']);
  });
  runs(/[,;:]{2,}/gu, m => {
    add('punctuation-repeat', m.index!, m.index! + m[0].length, 'Проверьте повторяющийся знак препинания.', [m[0][0]]);
  });
  runs(/(?<![А-Яа-яЁё])(?:может|могут|должен|должна|должно|должны|следует|необходимо|нужно|можно|нельзя|будет|будут|буду|будем|будете|будешь)[ \t]+(?:не[ \t]+)?([А-Яа-яЁё]+тся)(?![А-Яа-яЁё])/giu, m => {
    const word = m[1];
    const start = m.index! + m[0].lastIndexOf(word);
    add('infinitive', start, start + word.length, 'После этого слова обычно нужен инфинитив: «что делать?» / «что сделать?» — с «-ться».', [word.slice(0, -3) + 'ться']);
  });
  const phrases: [RegExp, string, string][] = [
    [/(?<![А-Яа-яЁё])в[ \t]+отличии[ \t]+от(?![А-Яа-яЁё])/giu, 'в отличие от', 'В сочетании «в отличие от» пишется окончание «-е».'],
    [/(?<![А-Яа-яЁё])в[ \t]+течении(?=[ \t]+(?:дня|дней|недели|недель|месяца|месяцев|года|лет|часа|часов|минуты|минут)(?![А-Яа-яЁё]))/giu, 'в течение', 'При обозначении времени: «в течение».'],
  ];
  for (const [pattern, suggestion, message] of phrases) runs(pattern, m => add('phrase', m.index!, m.index! + m[0].length, message, [matchCase(m[0], suggestion)]));
  return issues;
}

/**
 * Offline Russian spelling and a bounded set of grammar/punctuation rules.
 * This does not attempt full syntactic or medical interpretation. Offsets use
 * JavaScript UTF-16 indices, the same coordinate system as editor text offsets.
 */
export function createRussianChecker(aff: string, dic: string, englishAff = '', englishDic = '') {
  const spell = nspell(aff, dic);
  const latinSpell = englishAff && englishDic ? nspell(englishAff, englishDic) : null;
  for (const word of trustedMedicalForms) spell.add(word);
  const spellingCache = new Map<string, { correct: boolean; suggestions: string[] }>();
  return async function checkRussian(text: string, personalWords: string[] = [], signal?: AbortSignal): Promise<ProofIssue[]> {
    signal?.throwIfAborted();
    const issues = [...grammarIssues(text), ...await morphologicalIssues(text, signal)];
    signal?.throwIfAborted();
    const recognized = await loadMedicalWordRecognizer();
    signal?.throwIfAborted();
    const personal = new Set(personalWords.filter(w => typeof w === 'string').map(normalize));
    let examined = 0;
    let suggested = 0;
    // Uppercase abbreviations, Latin sequence names, and numbers are not
    // interpreted as Russian spelling mistakes. Compound medical terms are
    // accepted when each component is a known word or an abbreviation.
    const correct = (word: string, english = false): boolean => {
      if (word.length < 3 || abbreviation(word)) return true;
      const dictionary = english ? latinSpell : spell;
      if (dictionary?.correct(word) || (!english && (spell.correct(word.replace(/ё/g, 'е').replace(/Ё/g, 'Е'))))) return true;
      const parts = word.split(/[-‑]/u);
      return parts.length > 1 && parts.every(part => correct(part, english));
    };
    // A copied Russian word can include combining stress or decomposed й/ё.
    // Normalize only the dictionary lookup; offsets and report text stay exact.
    for (const match of text.matchAll(/(?:[А-Яа-яЁё][\u0300\u0301\u0306\u0308]*)+(?:[-‑](?:[А-Яа-яЁё][\u0300\u0301\u0306\u0308]*)+)*/gu)) {
      if (issues.length >= MAX_PROOF_ISSUES) break;
      const word = dictionaryForm(match[0]);
      if (word.length < 3 || abbreviation(word) || personal.has(normalize(word)) || sourceMedicalForms.has(normalize(word))) continue;
      if (++examined % 24 === 0) { await pause(); signal?.throwIfAborted(); }
      let result = spellingCache.get(word);
      if (!result) {
        const isCorrect = correct(word) || recognized(word);
        // Expensive edit-distance suggestions are bounded per check. Unknown
        // names/long technical terms are still reported and can be allowed.
        const canSuggest = !isCorrect && word.length <= 28 && suggested < 40;
        if (canSuggest) suggested++;
        const splits:string[]=[];if(canSuggest&&word.length>=7)for(let split=3;split<=word.length-3;split++){const left=word.slice(0,split),right=word.slice(split);if((correct(left)||recognized(left))&&(correct(right)||recognized(right)))splits.push(`${left} ${right}`);}const suggestions = canSuggest ? [...new Set([...(splits.length===1?splits:[]),...spell.suggest(word)])].filter(x=>normalize(x)!==normalize(word)).slice(0,3) : [];
        result = { correct: isCorrect, suggestions };
        if (spellingCache.size > 10_000) spellingCache.clear();
        // A later check may suggest a word skipped by this run's work budget.
        if (isCorrect || canSuggest || word.length > 28) spellingCache.set(word, result);
      }
      if (result.correct) continue;
      const start = match.index!;
      const end = start + match[0].length;
      // An overlapping contextual grammar warning is more useful than a
      // second spelling warning for the same fragment.
      if (issues.some(issue => issue.start < end && issue.end > start)) continue;
      issues.push({ id: `spelling.${start}.${end}`, start, end, text: match[0], kind: 'spelling', message: 'Слово не найдено в русском словаре. Проверьте написание или добавьте свой термин в словарь.', suggestions: result.suggestions });
    }
    if (latinSpell) for (const match of text.matchAll(/[A-Za-z]+(?:[-‑][A-Za-z]+)*/gu)) {
      if (issues.length >= MAX_PROOF_ISSUES) break;
      const word = match[0];
      if (word.length < 3 || abbreviation(word) || personal.has(normalize(word)) || sourceMedicalForms.has(normalize(word))) continue;
      if (++examined % 24 === 0) { await pause(); signal?.throwIfAborted(); }
      let result = spellingCache.get(`en:${word}`);
      if (!result) {
        const isCorrect = correct(word, true);
        const canSuggest = !isCorrect && word.length <= 28 && suggested < 40;
        if (canSuggest) suggested++;
        result = { correct: isCorrect, suggestions: canSuggest ? latinSpell.suggest(word).slice(0, 3) : [] };
        if (spellingCache.size > 10_000) spellingCache.clear();
        if (isCorrect || canSuggest || word.length > 28) spellingCache.set(`en:${word}`, result);
      }
      if (result.correct) continue;
      const start = match.index!, end = start + word.length;
      if (issues.some(issue => issue.start < end && issue.end > start)) continue;
      issues.push({ id: `spelling.en.${start}.${end}`, start, end, text: word, kind: 'spelling', message: 'Слово не найдено в английском словаре. Проверьте написание или добавьте термин в личный словарь.', suggestions: result.suggestions });
    }
    signal?.throwIfAborted();
    return issues.sort((a, b) => a.start - b.start || a.end - b.end).slice(0, MAX_PROOF_ISSUES);
  };
}
