export const TEMPLATE_VERSION_STORAGE_KEY = 'mri-alliance.template-versions.v1';
export const TEMPLATE_SELECTION_STORAGE_KEY = 'mri-alliance.template-selections.v1';
export const INITIAL_TEMPLATE_VERSION = '0.0.1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function readTemplateVersions(storage: StorageLike): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(TEMPLATE_VERSION_STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, version]) => id.length <= 200 && typeof version === 'string' && VERSION.test(version)) as [string, string][]);
  } catch { return {}; }
}

export function templateVersion(storage: StorageLike, id: string, fallback = INITIAL_TEMPLATE_VERSION): string {
  const version = readTemplateVersions(storage)[id];
  return version && VERSION.test(version) ? version : VERSION.test(fallback) ? fallback : INITIAL_TEMPLATE_VERSION;
}

export function nextTemplateVersion(version: string): string {
  const match = VERSION.exec(version);
  if (!match) throw new Error('Некорректная версия шаблона.');
  const [, major, minor, patch] = match;
  const next = Number(patch) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Достигнут предел версии шаблона.');
  return `${major}.${minor}.${next}`;
}

export function writeTemplateVersion(storage: StorageLike, id: string, version: string): Record<string, string> {
  if (!id || id.length > 200 || !VERSION.test(version)) throw new Error('Некорректные метаданные версии шаблона.');
  const next = { ...readTemplateVersions(storage), [id]: version };
  const serialized = JSON.stringify(next);
  storage.setItem(TEMPLATE_VERSION_STORAGE_KEY, serialized);
  if (storage.getItem(TEMPLATE_VERSION_STORAGE_KEY) !== serialized) throw new Error('Не удалось проверить сохранение версии шаблона.');
  let selections:Record<string,string>={};try{const parsed=JSON.parse(storage.getItem(TEMPLATE_SELECTION_STORAGE_KEY)??'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))selections=parsed;}catch{}
  storage.setItem(TEMPLATE_SELECTION_STORAGE_KEY,JSON.stringify({...selections,[id]:'personal'}));
  return next;
}
