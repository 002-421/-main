const patientLabel = /(?:Ф\s*\.?\s*И\s*\.?\s*О\.?\s*(?:пациент(?:а|ки)\s*)?|Фамилия\s+имя\s+отчество\s*)[:：][ \t\u00a0]*/iu;
const nextField = /(?:[\r\n;]|\s+(?:Дата\s+рождения|Вид\s+исследования|Область\s+и\s+вид\s+исследования|Контрастный\s+препарат|Врач|Дата|Описание|Заключение|Протокол)\s*[:：])/iu;

export function isPatientField(attrs: {id?: unknown; hint?: unknown} | null | undefined): boolean {
  if (!attrs) return false;
  return /(?:^|[._-])patient(?:$|[._-])|^(?:base\.1|HEAD\.BASE\.1\.FIELD\.0001)$/iu.test(String(attrs.id ?? '')) ||
    /Ф\s*\.?\s*И\s*\.?\s*О\.?\s*пациент|Фамилия\s+имя\s+отчество|^\s*(?:Введите\s+)?Ф\s*\.?\s*И\s*\.?\s*О\.?\s*$/iu.test(String(attrs.hint ?? ''));
}

export function patientValueRange(text: string): {from: number; to: number} | undefined {
  const label = patientLabel.exec(text);
  if (!label) return;
  const from = label.index + label[0].length;
  const rest = text.slice(from);
  const boundary = nextField.exec(rest)?.index;
  const value = rest.slice(0, boundary ?? rest.length).trimEnd();
  if (value) return {from, to: from + value.length};
}

/** Keep UTF-16 offsets identical across fragmented formatting and raw label lines. */
// A non-word sentinel avoids generating a false "repeated spaces" finding
// around the redacted name. One code unit preserves the original positions.
export const patientMask = '\u2063';
export function maskPatientValue(text: string): string {
  const range = patientValueRange(text);
  return range ? text.slice(0,range.from) + patientMask.repeat(range.to-range.from) + text.slice(range.to) : text;
}
