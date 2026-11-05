export type FilenameFields = {
  number?: string;
  doctor?: string;
  patient?: string;
  template?: string;
  date?: string;
};

export function extractFilenameFields(text: string): Pick<FilenameFields, 'number'|'patient'|'doctor'|'date'> {
  const row = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? '';
  const number = row(/Протокол\s+МРТ[- ]исследования\s*№\s*([^\r\n]+)/i)
    .replace(/\s+(?:Ф\.\s*И\.\s*О\.|Дата\s+рождения|Вид\s+исследования)\s*:.*/i,'').trim();
  const patient = row(/Ф\.\s*И\.\s*О\.?\s*пациент(?:а|ки)\s*:\s*([^\r\n]+)/i)
    .replace(/\s+(?:Дата\s+рождения|Вид\s+исследования)\s*:.*/i,'').trim();
  const doctor = row(/Врач\s*:\s*([^\r\n]+)/i).replace(/\s+дата\s*:.*/i,'').trim();
  const date = row(/дата\s*:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
  return {
    number: /^номер исследования$/i.test(number) ? '' : number,
    patient: /^(?:Ф\.\s*И\.\s*О\.?|дд\.мм\.гггг)$/i.test(patient) ? '' : patient,
    doctor, date,
  };
}

export function initials(value = ''): string {
  return value.trim().split(/[\s.]+/).filter(Boolean)
    .map(part => part[0]?.toLocaleUpperCase('ru') ?? '').join('');
}

export function shortPatientName(value = ''): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const initials = parts.slice(1, 3).flatMap(part => {
    if (/^(?:[А-ЯЁA-Z]\.\s*){1,3}$/iu.test(part)) return [...part.matchAll(/[А-ЯЁA-Z]/giu)].map(match => match[0].toLocaleUpperCase('ru'));
    return [part[0]?.toLocaleUpperCase('ru') ?? ''];
  });
  return `${parts[0]} ${initials.map(initial => `${initial}.`).join('')}`.trim();
}

export function patientSurname(value = ''): string {
  const surname = value.trim().split(/\s+/).filter(Boolean)[0]?.replace(/[.,:;]+$/g, '') ?? '';
  return /^(?:Ф\.?И\.?О\.?|дд\.мм\.гггг)$/i.test(surname) ? '' : surname;
}

export function buildReportFilename(fields: FilenameFields, suffix: '.docx' | '.pdf', fallbackDate: string): string {
  const parts = [fields.number, initials(fields.doctor), shortPatientName(fields.patient), fields.template, fields.date || fallbackDate]
    .map(value => value?.trim() ?? '').filter(Boolean);
  const base = (parts.length ? parts : ['МРТ_описание']).join(' ');
  return `${base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150)}${suffix}`;
}
