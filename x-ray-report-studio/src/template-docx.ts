import { exportDocx, importOwnDocx, type EmbeddedDocxFont } from './docx.ts';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { validateTemplate, type RichNode } from './model.ts';
import { sanitizeTemplateForExport } from './template-sanitizer.ts';
import { INITIAL_TEMPLATE_VERSION, nextTemplateVersion, readTemplateVersions, TEMPLATE_VERSION_STORAGE_KEY } from './template-versioning.ts';

export type TemplateDocxItem = { id: string; title: string; areaId: string; group?: string; templateVersion?: string; doc: RichNode };
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const VERSION = /^\d+\.\d+\.\d+$/;

export async function sha256Doc(doc: RichNode) {
  const bytes = new TextEncoder().encode(canonical(validateTemplate(doc)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function escaped(value: string) { return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'template'; }
function decodeXmlText(value: string) { return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function wordComments(xml: string) {
  return [...xml.matchAll(/<w:comment\b[^>]*>([\s\S]*?)<\/w:comment>/g)].slice(0, 30)
    .map(([, body]) => [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(([, text]) => decodeXmlText(text)).join('').slice(0, 1000)).filter(Boolean);
}

export async function exportTemplateDocx(item: TemplateDocxItem, appVersion: string, fonts?: EmbeddedDocxFont[]) {
  const doc = validateTemplate(sanitizeTemplateForExport(item.doc));
  const templateVersion = VERSION.test(item.templateVersion ?? '') ? item.templateVersion! : INITIAL_TEMPLATE_VERSION;
  const hash = await sha256Doc(doc);
  return exportDocx(doc, {
    kind: 'template', templateId: item.id, title: item.title,
    profile: item.areaId === 'head' ? 'brain' : 'custom', fonts,
    templateReview: { format: 2, templateId: item.id, areaId: item.areaId, baseSha256: hash, appVersion, templateVersion },
  });
}

export async function exportTemplateDocxGroup(items: TemplateDocxItem[], appVersion: string, fonts?: EmbeddedDocxFont[]) {
  if (!items.length || items.length > 150) throw Error('Пустая или слишком большая группа.');
  if (items.length === 1) return exportTemplateDocx(items[0], appVersion, fonts);
  const files: Record<string, Uint8Array> = {}, manifest = [];
  for (const item of items) {
    const blob = await exportTemplateDocx(item, appVersion, fonts), name = `${escaped(item.title)}-${item.id}.docx`;
    const sanitized = validateTemplate(sanitizeTemplateForExport(item.doc));
    files[name] = new Uint8Array(await blob.arrayBuffer());
    manifest.push({ id: item.id, title: item.title, areaId: item.areaId,
      templateVersion: VERSION.test(item.templateVersion ?? '') ? item.templateVersion : INITIAL_TEMPLATE_VERSION,
      sha256: await sha256Doc(sanitized), file: name });
  }
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'xrs-template-docx-group', schemaVersion: 2, appVersion, templates: manifest }, null, 2));
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export async function inspectTemplateDocx(input: Uint8Array | ArrayBuffer | Blob, library: TemplateDocxItem[]) {
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (bytes.length > 32 * 1024 * 1024) throw Error('DOCX больше 32 МБ.');
  let expanded = 0, oversized = false;
  const files = unzipSync(bytes, { filter: entry => {
    const include = entry.name === 'word/document.xml' || entry.name.startsWith('word/') && entry.name.endsWith('.xml') || entry.name === 'customXml/mri-report-studio.xml';
    if (!include) return false;
    expanded += entry.originalSize;
    if (entry.originalSize > 16 * 1024 * 1024 || expanded > 32 * 1024 * 1024) { oversized = true; return false; }
    return true;
  } });
  if (oversized) throw Error('Содержимое DOCX превышает безопасный размер.');
  for (const [name, data] of Object.entries(files)) {
    if (/^word\/.*\.xml$/.test(name) && /<w:(?:ins|del)(?:\s|>)/.test(strFromU8(data)))
      throw Error('В DOCX остались неразрешённые исправления Word. Примите или отклоните их в Word, сохраните файл и загрузите снова.');
  }
  const imported = await importOwnDocx(bytes);
  if (!imported || imported.kind !== 'template' || !imported.templateReview) throw Error('Нет служебных данных XRS-шаблона. Экспортируйте шаблон из XRS.');
  const meta = imported.templateReview;
  if (![1, 2].includes(meta.format) || meta.templateId !== imported.templateId || typeof meta.areaId !== 'string'
    || !/^[a-f0-9]{64}$/.test(meta.baseSha256) || !/^\d+\.\d+\.\d+$/.test(meta.appVersion)
    || meta.format === 2 && !VERSION.test(meta.templateVersion ?? '')) throw Error('Повреждены метаданные ревизии шаблона.');
  const current = library.find(item => item.id === meta.templateId);
  if (!current) throw Error('Неизвестный ID шаблона.');
  if (current.areaId !== meta.areaId) throw Error('Шаблон перемещён в другую зону после экспорта. Экспортируйте его заново.');
  const currentVersion = VERSION.test(current.templateVersion ?? '') ? current.templateVersion! : INITIAL_TEMPLATE_VERSION;
  const baseHash = await sha256Doc(sanitizeTemplateForExport(current.doc)), after = validateTemplate(imported.doc);
  const comments = wordComments(strFromU8(files['word/comments.xml'] ?? new Uint8Array()));
  const warnings = [...(imported.importWarnings ?? [])];
  if (comments.length) warnings.push(`Комментарии Word не сохраняются в шаблоне; учтите их перед подтверждением импорта: ${comments.map(value => `«${value}»`).join('; ')}`);
  const versionConflict = Boolean(meta.templateVersion && meta.templateVersion !== currentVersion);
  return {
    id: meta.templateId, title: current.title, areaId: current.areaId, appVersion: meta.appVersion,
    templateVersion: currentVersion, exportedTemplateVersion: meta.templateVersion,
    baseSha256: meta.baseSha256, currentSha256: baseHash, before: current.doc, after,
    status: baseHash !== meta.baseSha256 || versionConflict ? 'conflict' as const : !imported.editedInWord ? 'unchanged' as const : 'changed' as const,
    warnings,
  };
}

export const templateDocxKeys = {
  backup: 'xrs.template-docx-backup.v1', journal: 'xrs.template-docx-journal.v1', report: 'xrs.template-docx-report.v1',
};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function put(storage: Store, key: string, value: string) {
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw Error('Не удалось проверить резервную запись.');
}
function restoreRaw(storage: Store, key: string, value: string | null) {
  if (value === null) storage.removeItem(key); else put(storage, key, value);
}

export async function applyTemplateDocx(storage: Store, row: Awaited<ReturnType<typeof inspectTemplateDocx>>, accepted: boolean) {
  if (!accepted || row.status !== 'changed') throw Error('Изменение не подтверждено или исходная версия конфликтует.');
  const key = 'mri-alliance.templates.v4', previous = storage.getItem(key), previousVersions = storage.getItem(TEMPLATE_VERSION_STORAGE_KEY);
  const all = JSON.parse(previous ?? '{}'), old = all[row.id];
  if (old && await sha256Doc(old) !== await sha256Doc(row.before)) throw Error('Шаблон изменился после предпросмотра.');
  const versions = readTemplateVersions(storage), currentVersion = versions[row.id] ?? row.templateVersion ?? INITIAL_TEMPLATE_VERSION;
  const nextVersion = nextTemplateVersion(currentVersion), createdAt = new Date().toISOString();
  const record = JSON.stringify({ format: 2, previous, previousVersions, ids: [row.id], versionsBefore: { [row.id]: currentVersion }, createdAt });
  put(storage, templateDocxKeys.backup, record);
  put(storage, templateDocxKeys.journal, record);
  try {
    all[row.id] = row.after;
    put(storage, key, JSON.stringify(all));
    put(storage, TEMPLATE_VERSION_STORAGE_KEY, JSON.stringify({ ...versions, [row.id]: nextVersion }));
    put(storage, templateDocxKeys.report, JSON.stringify({ templateId: row.id, templateVersion: nextVersion, createdAt }));
    storage.removeItem(templateDocxKeys.journal);
  } catch (error) {
    recover(storage);
    throw error;
  }
}

export function recover(storage: Store) {
  const raw = storage.getItem(templateDocxKeys.journal);
  if (!raw) return;
  const journal = JSON.parse(raw);
  if (![1, 2].includes(journal.format) || typeof journal.previous !== 'string' && journal.previous !== null
    || journal.previousVersions !== undefined && typeof journal.previousVersions !== 'string' && journal.previousVersions !== null)
    throw Error('Повреждён журнал импорта.');
  restoreRaw(storage, 'mri-alliance.templates.v4', journal.previous);
  if (journal.previousVersions !== undefined) restoreRaw(storage, TEMPLATE_VERSION_STORAGE_KEY, journal.previousVersions);
  storage.removeItem(templateDocxKeys.journal);
}

export function rollback(storage: Store) {
  const raw = storage.getItem(templateDocxKeys.backup);
  if (!raw) throw Error('Нет резервной копии.');
  const backup = JSON.parse(raw), currentRaw = storage.getItem('mri-alliance.templates.v4');
  const current = JSON.parse(currentRaw ?? '{}'), old = JSON.parse(backup.previous ?? '{}');
  for (const id of backup.ids) { if (Object.hasOwn(old, id)) current[id] = old[id]; else delete current[id]; }
  const previousVersions = storage.getItem(TEMPLATE_VERSION_STORAGE_KEY), nextVersions = readTemplateVersions(storage);
  for (const id of backup.ids) nextVersions[id] = nextTemplateVersion(nextVersions[id] ?? backup.versionsBefore?.[id] ?? INITIAL_TEMPLATE_VERSION);
  const journal = JSON.stringify({ format: 2, previous: currentRaw, previousVersions, ids: backup.ids });
  put(storage, templateDocxKeys.journal, journal);
  try {
    put(storage, 'mri-alliance.templates.v4', JSON.stringify(current));
    put(storage, TEMPLATE_VERSION_STORAGE_KEY, JSON.stringify(nextVersions));
    storage.removeItem(templateDocxKeys.journal);
  } catch (error) { recover(storage); throw error; }
}

export function templateDocxFilename(item: TemplateDocxItem) { return `${escaped(item.title)}-${item.id}.docx`; }
