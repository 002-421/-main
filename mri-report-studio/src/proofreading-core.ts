import nspell from 'nspell';

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
const normalize = (word: string) => word.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const abbreviation = (word: string) => word.length <= 6 && word === word.toLocaleUpperCase('ru-RU');

// Additional radiology vocabulary, separate from the unmodified Hunspell
// dictionary. These are exact word forms, not permissive prefix exceptions.
const medicalAdjectives = `гиперинтенсивный гипоинтенсивный изоинтенсивный
перивентрикулярный паравентрикулярный субкортикальный юкстакортикальный
субарахноидальный арахноидальный конвекситальный интракраниальный
субдуральный эпидуральный экстрааксиальный интрааксиальный
супратенториальный субтенториальный инфратенториальный
интраселлярный супраселлярный параселлярный хиазмальный
ретроцеребеллярный ликворный ликвородинамический периневральный
перифокальный лептоменингеальный пахименингеальный
нейродегенеративный демиелинизирующий дисциркуляторный
диффузионный перфузионный трабекулярный фораминальный
интрамедуллярный экстрамедуллярный интраканальный
гиперваскулярный гиповаскулярный интраорбитальный ретробульбарный
интравентрикулярный перивентрикулярный дуральный
постконтрастный преконтрастный субэпендимальный
апикальный петрокливальный парасагиттальный парафальцинный
клиновидный пинеальный ретроселлярный холестеатомный
желудочковый мозжечковый корковый подкорковый мосто-мозжечковый
хиазмально-селлярный краниовертебральный околоносовый переднезадний
нейроваскулярный невральный аксиальный корональный сагиттальный`.split(/\s+/);

function medicalWords(): Set<string> {
  const words = new Set<string>();
  const hard = ['ый', 'ая', 'ое', 'ые', 'ого', 'ому', 'ым', 'ом', 'ую', 'ой', 'ых', 'ыми'];
  const soft = ['ий', 'яя', 'ее', 'ие', 'его', 'ему', 'им', 'ем', 'юю', 'ей', 'их', 'ими'];
  for (const adjective of medicalAdjectives) {
    const stem = adjective.slice(0, -2);
    const endings = adjective.endsWith('ий') ? soft.map(e => /[щч]$/u.test(stem) ? e.replace('яя', 'ая').replace('юю', 'ую') : e) : hard;
    for (const ending of endings) words.add(stem + ending);
  }
  const nouns: Record<string, string[]> = {
    'ликвор': ['ликвора', 'ликвору', 'ликвором', 'ликворе'],
    'ликвородинамика': ['ликвородинамики', 'ликвородинамике', 'ликвородинамику', 'ликвородинамикой'],
    'перфузия': ['перфузии', 'перфузию', 'перфузией'],
    'трактография': ['трактографии', 'трактографию', 'трактографией'],
    'венография': ['венографии', 'венографию', 'венографией'],
    'ангиография': ['ангиографии', 'ангиографию', 'ангиографией'],
    'микроаденома': ['микроаденомы', 'микроаденому', 'микроаденом', 'микроаденоме', 'микроаденомой'],
    'макроаденома': ['макроаденомы', 'макроаденому', 'макроаденом', 'макроаденоме', 'макроаденомой'],
    'глиоз': ['глиоза', 'глиозу', 'глиозом', 'глиозе'],
    'микрогеморрагия': ['микрогеморрагии', 'микрогеморрагию', 'микрогеморрагий'],
    'гемосидерин': ['гемосидерина', 'гемосидерину', 'гемосидерином', 'гемосидерине'],
    'васкуляризация': ['васкуляризации', 'васкуляризацию', 'васкуляризацией'],
    'контрастирование': ['контрастирования', 'контрастированию', 'контрастированием', 'контрастировании'],
    'вентрикуломегалия': ['вентрикуломегалии', 'вентрикуломегалию'],
    'мальформация': ['мальформации', 'мальформацию', 'мальформаций', 'мальформацией'],
    'лейкоареоз': ['лейкоареоза', 'лейкоареозом', 'лейкоареозе'],
    'пневматизация': ['пневматизации', 'пневматизацию', 'пневматизацией'],
    'гипоплазия': ['гипоплазии', 'гипоплазию', 'гипоплазией'],
    'эпендима': ['эпендимы', 'эпендиме', 'эпендиму', 'эпендимой'],
    'эпендимома': ['эпендимомы', 'эпендимому', 'эпендимоме', 'эпендимомой'],
    'шваннома': ['шванномы', 'шванному', 'шванноме', 'шванномой'],
    'менингиома': ['менингиомы', 'менингиому', 'менингиоме', 'менингиомой'],
    'аденогипофиз': ['аденогипофиза', 'аденогипофизе', 'аденогипофизом'],
    'нейрогипофиз': ['нейрогипофиза', 'нейрогипофизе', 'нейрогипофизом'],
    'диссеминация': ['диссеминации', 'диссеминацию', 'диссеминацией'],
    'альцгеймер': ['альцгеймера'],
    'виллизиев': ['виллизиева', 'виллизиеву', 'виллизиевом'],
    'церебеллум': ['церебеллума'],
    'воксель': ['вокселя', 'вокселей', 'воксели', 'вокселе'],
  };
  for (const [base, forms] of Object.entries(nouns)) {
    words.add(base); forms.forEach(word => words.add(word));
  }
  for (const word of ['корково', 'перивентрикулярно', 'кортикально', 'юкстакортикально', 'инфратенториально', 'контрастирующийся', 'контрастирующаяся', 'контрастирующееся', 'контрастирующиеся', 'контрастирующегося', 'контрастирующейся', 'контрастирующихся', 'контрастирующемуся', 'контрастирующимися']) words.add(word);
  return words;
}

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
  runs(/(?<=[\p{L}\p{N}])[ \t]{2,}(?=[\p{L}\p{N}])/gu, m => {
    add('spaces', m.index!, m.index! + m[0].length, 'Несколько пробелов между словами.', [' ']);
  });
  runs(/[ \t]+[,;:.!?]/gu, m => {
    add('before-punctuation', m.index!, m.index! + m[0].length, 'Перед этим знаком препинания пробел обычно не нужен.', [m[0].trimStart()]);
  });
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
    [/(?<![А-Яа-яЁё])согласно[ \t]+заключения(?![А-Яа-яЁё])/giu, 'согласно заключению', 'Предлог «согласно» требует дательного падежа.'],
    [/(?<![А-Яа-яЁё])согласно[ \t]+протокола(?![А-Яа-яЁё])/giu, 'согласно протоколу', 'Предлог «согласно» требует дательного падежа.'],
    [/(?<![А-Яа-яЁё])согласно[ \t]+данных(?![А-Яа-яЁё])/giu, 'согласно данным', 'Предлог «согласно» требует дательного падежа.'],
    [/(?<![А-Яа-яЁё])согласно[ \t]+исследования(?![А-Яа-яЁё])/giu, 'согласно исследованию', 'Предлог «согласно» требует дательного падежа.'],
    [/(?<![А-Яа-яЁё])данные[ \t]+свидетельствует(?![А-Яа-яЁё])/giu, 'данные свидетельствуют', 'Проверьте согласование подлежащего и сказуемого во множественном числе.'],
    [/(?<![А-Яа-яЁё])очаговые[ \t]+изменение(?![А-Яа-яЁё])/giu, 'очаговые изменения', 'Проверьте согласование во множественном числе.'],
    [/(?<![А-Яа-яЁё])патологические[ \t]+изменение(?![А-Яа-яЁё])/giu, 'патологические изменения', 'Проверьте согласование во множественном числе.'],
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
  for (const word of medicalWords()) spell.add(word);
  const spellingCache = new Map<string, { correct: boolean; suggestions: string[] }>();
  return async function checkRussian(text: string, personalWords: string[] = []): Promise<ProofIssue[]> {
    const issues = grammarIssues(text);
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
    for (const match of text.matchAll(/[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/gu)) {
      if (issues.length >= MAX_PROOF_ISSUES) break;
      const word = match[0];
      if (word.length < 3 || abbreviation(word) || personal.has(normalize(word))) continue;
      if (++examined % 24 === 0) await pause();
      let result = spellingCache.get(word);
      if (!result) {
        const isCorrect = correct(word);
        // Expensive edit-distance suggestions are bounded per check. Unknown
        // names/long technical terms are still reported and can be allowed.
        const canSuggest = !isCorrect && word.length <= 28 && suggested < 40;
        if (canSuggest) suggested++;
        const suggestions = canSuggest ? spell.suggest(word).slice(0, 3) : [];
        result = { correct: isCorrect, suggestions };
        if (spellingCache.size > 10_000) spellingCache.clear();
        // A later check may suggest a word skipped by this run's work budget.
        if (isCorrect || canSuggest || word.length > 28) spellingCache.set(word, result);
      }
      if (result.correct) continue;
      const start = match.index!;
      const end = start + word.length;
      // An overlapping contextual grammar warning is more useful than a
      // second spelling warning for the same fragment.
      if (issues.some(issue => issue.start < end && issue.end > start)) continue;
      issues.push({ id: `spelling.${start}.${end}`, start, end, text: word, kind: 'spelling', message: 'Слово не найдено в русском словаре. Проверьте написание или добавьте свой термин в словарь.', suggestions: result.suggestions });
    }
    if (latinSpell) for (const match of text.matchAll(/[A-Za-z]+(?:[-‑][A-Za-z]+)*/gu)) {
      if (issues.length >= MAX_PROOF_ISSUES) break;
      const word = match[0];
      if (word.length < 3 || abbreviation(word) || personal.has(normalize(word))) continue;
      if (++examined % 24 === 0) await pause();
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
    return issues.sort((a, b) => a.start - b.start || a.end - b.end).slice(0, MAX_PROOF_ISSUES);
  };
}
