import nspell from 'nspell';
import { morphologicalIssues } from './morphological-grammar.ts';
import { loadMorphology, type MorphParse } from './morphology-loader.ts';
import { medicalLexicon } from './medical-lexicon.ts';

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
  интрамуральный субсерозный субмукозный субхондральный
  внутриматочный внутрисуставный эндометриоидный
  параовариальный периартикулярный параартикулярный
  дегенеративный компрессионный дискогенный
  фиброзный кистозный узловой железистый стромальный
  геморрагический дегенеративно-дистрофический остеоартрозный
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
нейроваскулярный невральный аксиальный корональный сагиттальный
гиподенсивный гиперденсивный межпозвонковый парапанкреатический
чашечно-лоханочный`.split(/\s+/);

function medicalWords(): { words: Set<string>; lemmaSources: Set<string> } {
  const words = new Set<string>();
  const lemmaSources = new Set<string>([...medicalAdjectives, ...medicalLexicon]);
  // Keep only curated lemmas here. Az below accepts inflections only when a
  // trusted lemma parse regenerates the exact original token.
  for (const adjective of medicalAdjectives) words.add(adjective);
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
    'аденомиоз': ['аденомиоза', 'аденомиозу', 'аденомиозом', 'аденомиозе'],
    'эндометриоз': ['эндометриоза', 'эндометриозом', 'эндометриозе'],
    'эндометрий': ['эндометрия', 'эндометрию', 'эндометрием', 'эндометрии'],
    'миометрий': ['миометрия', 'миометрию', 'миометрием', 'миометрии'],
    'лейомиома': ['лейомиомы', 'лейомиому', 'лейомиомой', 'лейомиоме'],
    'гидросальпинкс': ['гидросальпинкса', 'гидросальпинксом', 'гидросальпинксе'],
    'параметрий': ['параметрия', 'параметрию', 'параметрием', 'параметрии'],
    'аднекс': ['аднекса', 'аднексам', 'аднексами'],
    'цервикс': ['цервикса', 'цервиксом', 'цервиксе'],
    'кольпоскопия': ['кольпоскопии', 'кольпоскопию', 'кольпоскопией'],
    'пиометра': ['пиометры', 'пиометру', 'пиометрой'],
    'гематометра': ['гематометры', 'гематометру', 'гематометрой'],
    'цитостома': ['цитостомы', 'цитостому', 'цитостомой'],
    'фибромиома': ['фибромиомы', 'фибромиому', 'фибромиомой'],
    'остеофит': ['остеофита', 'остеофиты', 'остеофитами', 'остеофите'],
    'спондилолистез': ['спондилолистеза', 'спондилолистезом', 'спондилолистезе'],
    'спондилолиз': ['спондилолиза', 'спондилолизом', 'спондилолизе'],
    'хондромаляция': ['хондромаляции', 'хондромаляцию', 'хондромаляцией'],
    'энтезопатия': ['энтезопатии', 'энтезопатию', 'энтезопатией'],
    'синовит': ['синовита', 'синовитом', 'синовите'],
    'бурсит': ['бурсита', 'бурситом', 'бурсите'],
    'теносиновит': ['теносиновита', 'теносиновитом', 'теносиновите'],
    'хондрома': ['хондромы', 'хондрому', 'хондромой'],
    'остеохондрома': ['остеохондромы', 'остеохондрому', 'остеохондромой'],
    'хондросаркома': ['хондросаркомы', 'хондросаркому', 'хондросаркомой'],
    'параганглиома': ['параганглиомы', 'параганглиому', 'параганглиомой'],
    'гемангиобластома': ['гемангиобластомы', 'гемангиобластому', 'гемангиобластомой'],
    'миома': ['миомы', 'миому', 'миомой', 'миоме'],
    'аденомиома': ['аденомиомы', 'аденомиому', 'аденомиомой', 'аденомиоме'],
    'эндометриома': ['эндометриомы', 'эндометриому', 'эндометриомой', 'эндометриоме'],
    'параовариальная': ['параовариальной', 'параовариальную', 'параовариальные', 'параовариальных'],
    'эндометриоидный': ['эндометриоидная', 'эндометриоидное', 'эндометриоидные', 'эндометриоидного'],
    'миоматозный': ['миоматозная', 'миоматозное', 'миоматозные', 'миоматозных'],
    'мениск': ['мениска', 'мениску', 'мениском', 'мениске', 'мениски', 'менисков'],
    'хондропатия': ['хондропатии', 'хондропатию', 'хондропатией'],
    'остеонекроз': ['остеонекроза', 'остеонекрозом', 'остеонекрозе'],
    'дисцит': ['дисцита', 'дисцитом', 'дисците'],
    'миелопатия': ['миелопатии', 'миелопатию', 'миелопатией'],
    'радикулопатия': ['радикулопатии', 'радикулопатию', 'радикулопатией'],
    'нейропатия': ['нейропатии', 'нейропатию', 'нейропатией'],
    'дистрофия': ['дистрофии', 'дистрофию', 'дистрофией'],
    'склероз': ['склероза', 'склерозом', 'склерозе'],
    'кистоз': ['кистоза', 'кистозом', 'кистозе'],
    'остеолиз': ['остеолиза', 'остеолизом', 'остеолизе'],
    'остеосклероз': ['остеосклероза', 'остеосклерозом', 'остеосклерозе'],
    'протрузия': ['протрузии', 'протрузию', 'протрузией'],
    'экструзия': ['экструзии', 'экструзию', 'экструзией'],
    'секвестрация': ['секвестрации', 'секвестрацию', 'секвестрацией'],
    'спондилоартроз': ['спондилоартроза', 'спондилоартрозом', 'спондилоартрозе'],
    'остеоартроз': ['остеоартроза', 'остеоартрозом', 'остеоартрозе'],
    'гемартроз': ['гемартроза', 'гемартрозом', 'гемартрозе'],
    'тендиноз': ['тендиноза', 'тендинозом', 'тендинозе'],
    'мукоцеле': ['мукоцеле'],
    'дисплазия': ['дисплазии', 'дисплазию', 'дисплазией'],
    'атрофия': ['атрофии', 'атрофию', 'атрофией'],
    'гипертрофия': ['гипертрофии', 'гипертрофию', 'гипертрофией'],
    'полипоз': ['полипоза', 'полипозом', 'полипозе'],
    'гемосидероз': ['гемосидероза', 'гемосидерозом', 'гемосидерозе'],
    'цервикальный': ['цервикальная', 'цервикальное', 'цервикальные', 'цервикального'],
    'геморрагический': ['геморрагическая', 'геморрагическое', 'геморрагические', 'геморрагического', 'геморрагическим'],
    'дискогенный': ['дискогенная', 'дискогенное', 'дискогенные', 'дискогенного'],
    'параовариальный': ['параовариальная', 'параовариальное', 'параовариальные', 'параовариального'],
  };
  for (const [base, forms] of Object.entries(nouns)) {
    lemmaSources.add(base);
    words.add(base); forms.forEach(word => words.add(word));
  }
  for (const word of ['корково', 'перивентрикулярно', 'кортикально', 'юкстакортикально', 'инфратенториально', 'контрастирующийся', 'контрастирующаяся', 'контрастирующееся', 'контрастирующиеся', 'контрастирующегося', 'контрастирующейся', 'контрастирующихся', 'контрастирующемуся', 'контрастирующимися']) words.add(word);
  return { words, lemmaSources };
}

const medicalMorphologyPos = new Set(['NOUN', 'ADJF', 'ADJS', 'PRTF', 'PRTS']);
const medicalMorphologyParsers = new Set(['Dictionary', 'PrefixKnown', 'SuffixKnown', 'HyphenWords']);

function normalizedLemma(parse: MorphParse): string | null {
  const lemma = parse.normalize();
  if (!lemma) return null;
  return String(lemma).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function parseCanIdentifyLemma(parse: MorphParse, word: string, bestScore: number): boolean {
  if (!medicalMorphologyParsers.has(parse.parser)
    || !medicalMorphologyPos.has(String(parse.tag.POS ?? ''))
    || parse.score <= 0
    || parse.score < bestScore * 0.75) return false;
  const lemma = parse.normalize();
  if (!lemma) return false;
  const tags: Record<string, string> = { POS: String(parse.tag.POS) };
  for (const key of ['CAse', 'NMbr', 'GNdr', 'ANim', 'TEns', 'PErs', 'MOod', 'VOic', 'ASpc']) {
    const value = parse.tag[key];
    if (typeof value === 'string') tags[key] = value;
  }
  const regenerated = lemma.inflect(tags);
  return !!regenerated && normalize(String(regenerated)) === normalize(word);
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
  const medical = medicalWords();
  for (const word of medical.words) spell.add(word);
  for (const word of medicalLexicon) spell.add(word);
  const spellingCache = new Map<string, { correct: boolean; suggestions: string[] }>();
  const morphologyCache = new Map<string, boolean>();
  let approvedMedicalLemmas: Promise<Set<string>> | undefined;

  const getApprovedMedicalLemmas = (analyze: (word: string) => MorphParse[]) => approvedMedicalLemmas ??= Promise.resolve().then(() => {
    const lemmas = new Set<string>();
    for (const source of medical.lemmaSources) {
      const parses = analyze(normalize(source));
      const bestScore = Math.max(0, ...parses.map(parse => parse.score));
      for (const parse of parses) {
        if (!parseCanIdentifyLemma(parse, source, bestScore)) continue;
        const lemma = normalizedLemma(parse);
        if (lemma) lemmas.add(lemma);
      }
    }
    return lemmas;
  });

  const isKnownMedicalInflection = async (word: string, analyze: (word: string) => MorphParse[]) => {
    const key = normalize(word);
    const cached = morphologyCache.get(key);
    if (cached !== undefined) return cached;
    const parses = analyze(key);
    const bestScore = Math.max(0, ...parses.map(parse => parse.score));
    const approved = await getApprovedMedicalLemmas(analyze);
    const accepted = parses.some(parse => {
      if (!parseCanIdentifyLemma(parse, word, bestScore)) return false;
      const lemma = normalizedLemma(parse);
      return lemma !== null && approved.has(lemma);
    });
    morphologyCache.set(key, accepted);
    return accepted;
  };

  return async function checkRussian(text: string, personalWords: string[] = [], signal?: AbortSignal): Promise<ProofIssue[]> {
    signal?.throwIfAborted();
    const issues = [...grammarIssues(text), ...await morphologicalIssues(text, signal)];
    signal?.throwIfAborted();
    const analyze = await loadMorphology();
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
    for (const match of text.matchAll(/[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/gu)) {
      if (issues.length >= MAX_PROOF_ISSUES) break;
      const word = match[0];
      if (word.length < 3 || abbreviation(word) || personal.has(normalize(word))) continue;
      if (++examined % 24 === 0) { await pause(); signal?.throwIfAborted(); }
      let result = spellingCache.get(word);
      if (!result) {
        const isCorrect = correct(word) || await isKnownMedicalInflection(word, analyze);
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
