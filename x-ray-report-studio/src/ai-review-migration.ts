import type { RichNode } from './model';

export type ManualBoundaries = { description: number; conclusion: number; signature: number };
export type MigrationPlan = { status: 'already-structured' | 'ready'; document: RichNode };
type Backup = { format: 'xrs-ai-review-migration-backup'; version: 1; tabId: string; templateId: string; doc: RichNode; sha256: string };
export type BackupStore = Pick<Storage, 'getItem' | 'setItem'>;
const prefix = 'xrs.ai-review.migration-backup.v1.';
const ids = ['header', 'description', 'conclusion', 'signature'];
const section = (id: string, content: RichNode[]): RichNode => ({ type: 'reportSection', attrs: { id, title: ({header:'Данные исследования',description:'Описание',conclusion:'Заключение',signature:'Рекомендации и подпись'} as Record<string,string>)[id], moduleId:'' }, content });

export function planManualMigration(input: RichNode, limits?: ManualBoundaries): MigrationPlan {
  if (input.type !== 'doc' || !Array.isArray(input.content)) throw new Error('Неизвестный формат документа');
  const nodes = input.content;
  if (nodes.slice(0,4).every((node,index)=>node?.type==='reportSection'&&node.attrs?.id===ids[index]) && nodes.slice(4).every(node=>node.type==='paragraph'&&!node.content?.length)) return { status:'already-structured', document:structuredClone(input) };
  if (nodes.some(node=>node.type==='reportSection')) throw new Error('Документ частично размечен; требуется ручная проверка');
  if (!limits || ![limits.description,limits.conclusion,limits.signature].every(Number.isInteger) || !(0<limits.description&&limits.description<limits.conclusion&&limits.conclusion<limits.signature&&limits.signature<nodes.length)) throw new Error('Не подтверждены четыре непустых блока');
  const next=structuredClone(input), items=next.content!;
  next.content=[section('header',items.slice(0,limits.description)),section('description',items.slice(limits.description,limits.conclusion)),section('conclusion',items.slice(limits.conclusion,limits.signature)),section('signature',items.slice(limits.signature))];
  if (JSON.stringify(next.content.flatMap(node=>node.content))!==JSON.stringify(items)) throw new Error('Миграция изменила содержимое');
  return {status:'ready',document:next};
}

async function digest(tabId: string, templateId: string, doc: RichNode): Promise<string> {
  const bytes=new TextEncoder().encode(JSON.stringify({tabId,templateId,doc}));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Write and read back the whole original before any editor mutation. */
export async function createMigrationBackup(store: BackupStore, tabId: string, templateId: string, doc: RichNode): Promise<string> {
  if (!tabId || !templateId || !crypto.subtle) throw new Error('Резервное копирование недоступно');
  const key=prefix+crypto.randomUUID();
  const record: Backup={format:'xrs-ai-review-migration-backup',version:1,tabId,templateId,doc:structuredClone(doc),sha256:await digest(tabId,templateId,doc)};
  const raw=JSON.stringify(record);
  store.setItem(key,raw);
  if(store.getItem(key)!==raw)throw new Error('Резервная копия не прошла проверку записи');
  await readMigrationBackup(store,key,tabId);
  return key;
}

export async function readMigrationBackup(store: Pick<Storage,'getItem'>, key: string, tabId?: string): Promise<{ tabId: string; templateId: string; doc: RichNode }> {
  if(!key.startsWith(prefix))throw new Error('Недопустимый ключ резервной копии');
  const raw=store.getItem(key);
  if(!raw)throw new Error('Резервная копия не найдена');
  let record: Backup;
  try{record=JSON.parse(raw);}catch{throw new Error('Резервная копия повреждена');}
  if(record.format!=='xrs-ai-review-migration-backup'||record.version!==1||typeof record.tabId!=='string'||typeof record.templateId!=='string'||record.doc?.type!=='doc'||!Array.isArray(record.doc.content)||typeof record.sha256!=='string'||(tabId&&record.tabId!==tabId)||await digest(record.tabId,record.templateId,record.doc)!==record.sha256)throw new Error('Резервная копия повреждена или относится к другой вкладке');
  return {tabId:record.tabId,templateId:record.templateId,doc:structuredClone(record.doc)};
}

export function migrationBackupKeys(store: Pick<Storage,'length'|'key'>): string[] {
  return Array.from({length:store.length},(_,index)=>store.key(index)).filter((key):key is string=>Boolean(key?.startsWith(prefix)));
}
