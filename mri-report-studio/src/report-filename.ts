export type FilenameFields = {
  number?: string;
  doctor?: string;
  patient?: string;
  template?: string;
  date?: string;
};

export function initials(value = ''): string {
  return value.trim().split(/[\s.]+/).filter(Boolean)
    .map(part => part[0]?.toLocaleUpperCase('ru') ?? '').join('');
}

export function shortPatientName(value = ''): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts.slice(1, 3).map(part => `${part[0]?.toLocaleUpperCase('ru') ?? ''}.`).join('')}`.trim();
}

export function buildReportFilename(fields: FilenameFields, suffix: '.docx' | '.pdf', fallbackDate: string): string {
  const parts = [fields.number, initials(fields.doctor), shortPatientName(fields.patient), fields.template, fields.date || fallbackDate]
    .map(value => value?.trim() ?? '').filter(Boolean);
  const base = (parts.length ? parts : ['МРТ_описание']).join(' ');
  return `${base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150)}${suffix}`;
}
