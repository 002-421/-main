import {validateTemplate,type RichNode} from './model.ts';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const LOCAL_TEMPLATE_KEYS={overrides:'mri-alliance.templates.v4',bases:'xrs.template-bases.v1',conflicts:'xrs.template-conflicts.v1',journal:'xrs.template-reconcile-journal.v1',backups:'xrs.template-reconcile-backups.v1'};
export type LocalConflict={id:string;base:RichNode|null;local:RichNode;incoming:RichNode;retired:boolean;reason:'overlap'|'untracked'|'removed'|'invalid';catalogVersion:string};
const canonical=(value:unknown):string=>value===undefined?'undefined':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function threeWayTemplate(base:RichNode,local:RichNode,incoming:RichNode):{doc:RichNode;conflict:boolean}{
 let conflict=false;
 const merge=(b:any,l:any,r:any,depth:number):any=>{
  if(same(l,r))return structuredClone(l);if(same(l,b))return structuredClone(r);if(same(r,b))return structuredClone(l);
  if(depth>30){conflict=true;return structuredClone(l);}
  if(Array.isArray(b)&&Array.isArray(l)&&Array.isArray(r)&&b.length===l.length&&b.length===r.length)return b.map((value,index)=>merge(value,l[index],r[index],depth+1));
  if(b&&l&&r&&typeof b==='object'&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(b)&&!Array.isArray(l)&&!Array.isArray(r)){
   if(b.type&&(b.type!==l.type||b.type!==r.type)){conflict=true;return structuredClone(l);}
   if(b.attrs?.id&&(b.attrs.id!==l.attrs?.id||b.attrs.id!==r.attrs?.id)){conflict=true;return structuredClone(l);}
   const next:Record<string,unknown>={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){if(['__proto__','constructor','prototype'].includes(key))throw Error('INVALID_TEMPLATE');const value=merge(b[key],l[key],r[key],depth+1);if(value!==undefined)next[key]=value;}return next;
  }
  conflict=true;return structuredClone(l);
 };
 const doc=validateTemplate(merge(base,local,incoming,0));return {doc,conflict};
}
function object<T>(storage:Store,key:string):Record<string,T>{const value=JSON.parse(storage.getItem(key)??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error('LOCAL_TEMPLATE_STORE_INVALID');return value;}
function write(storage:Store,key:string,value:unknown){const data=JSON.stringify(value);storage.setItem(key,data);if(storage.getItem(key)!==data)throw Error('LOCAL_TEMPLATE_WRITE_FAILED');}
export function recoverTemplateReconciliation(storage:Store){const raw=storage.getItem(LOCAL_TEMPLATE_KEYS.journal);if(!raw)return;const entry=JSON.parse(raw);if(entry?.schemaVersion!==1||!Array.isArray(entry.before)||entry.before.length!==3)throw Error('LOCAL_TEMPLATE_JOURNAL_INVALID');for(const [key,value]of entry.before){if(![LOCAL_TEMPLATE_KEYS.overrides,LOCAL_TEMPLATE_KEYS.bases,LOCAL_TEMPLATE_KEYS.conflicts].includes(key))throw Error('LOCAL_TEMPLATE_JOURNAL_INVALID');if(value===null)storage.removeItem(key);else if(typeof value==='string')storage.setItem(key,value);else throw Error('LOCAL_TEMPLATE_JOURNAL_INVALID');}storage.removeItem(LOCAL_TEMPLATE_KEYS.journal);}
function transaction(storage:Store,overrides:unknown,bases:unknown,conflicts:unknown){
 recoverTemplateReconciliation(storage);const keys=[LOCAL_TEMPLATE_KEYS.overrides,LOCAL_TEMPLATE_KEYS.bases,LOCAL_TEMPLATE_KEYS.conflicts],before=keys.map(key=>[key,storage.getItem(key)]);
 const old=JSON.parse(storage.getItem(LOCAL_TEMPLATE_KEYS.backups)??'[]');if(!Array.isArray(old))throw Error('LOCAL_TEMPLATE_STORE_INVALID');
 write(storage,LOCAL_TEMPLATE_KEYS.backups,[...old,{at:new Date().toISOString(),before}].slice(-20));
 write(storage,LOCAL_TEMPLATE_KEYS.journal,{schemaVersion:1,before});
 try{for(const [i,value]of [overrides,bases,conflicts].entries())write(storage,keys[i],value);storage.removeItem(LOCAL_TEMPLATE_KEYS.journal);}catch(error){recoverTemplateReconciliation(storage);throw error;}
}
export function rememberTemplateBase(storage:Store,id:string,doc:RichNode){const bases=object<RichNode>(storage,LOCAL_TEMPLATE_KEYS.bases);if(!bases[id]){bases[id]=validateTemplate(structuredClone(doc));write(storage,LOCAL_TEMPLATE_KEYS.bases,bases);}}
export function reconcileLocalTemplates(storage:Store,incoming:Record<string,{doc:RichNode;retired?:boolean}>,catalogVersion:string){
 recoverTemplateReconciliation(storage);const overrides=object<RichNode>(storage,LOCAL_TEMPLATE_KEYS.overrides),bases=object<RichNode>(storage,LOCAL_TEMPLATE_KEYS.bases),conflicts=object<LocalConflict>(storage,LOCAL_TEMPLATE_KEYS.conflicts);let changed=false;
 for(const [id,row]of Object.entries(incoming)){const local=overrides[id];if(!local)continue;const base=bases[id]??null;
  if(conflicts[id]&&same(conflicts[id].incoming,row.doc)&&conflicts[id].retired===Boolean(row.retired))continue;
  if(!row.retired&&same(local,row.doc)){delete conflicts[id];bases[id]=structuredClone(row.doc);changed=true;continue;}
  if(base&&!row.retired&&same(base,row.doc))continue;
  let merged:{doc:RichNode;conflict:boolean}|undefined;
  try{validateTemplate(local);validateTemplate(row.doc);if(base&&!row.retired)merged=threeWayTemplate(base,local,row.doc);}catch{merged=undefined;}
  if(merged&&!merged.conflict){overrides[id]=merged.doc;bases[id]=structuredClone(row.doc);delete conflicts[id];changed=true;}
  else{conflicts[id]={id,base,local:structuredClone(local),incoming:structuredClone(row.doc),retired:Boolean(row.retired),reason:row.retired?'removed':!base?'untracked':merged?'overlap':'invalid',catalogVersion};changed=true;}
 }
 if(changed)transaction(storage,overrides,bases,conflicts);return Object.values(conflicts);
}
export function localTemplateConflicts(storage:Store){recoverTemplateReconciliation(storage);return Object.values(object<LocalConflict>(storage,LOCAL_TEMPLATE_KEYS.conflicts));}
export function resolveLocalTemplateConflict(storage:Store,id:string,choice:'local'|'incoming'){
 const overrides=object<RichNode>(storage,LOCAL_TEMPLATE_KEYS.overrides),bases=object<RichNode>(storage,LOCAL_TEMPLATE_KEYS.bases),conflicts=object<LocalConflict>(storage,LOCAL_TEMPLATE_KEYS.conflicts),row=conflicts[id];if(!row)throw Error('LOCAL_TEMPLATE_CONFLICT_MISSING');
 if(!same(overrides[id],row.local))throw Error('LOCAL_TEMPLATE_CHANGED');
 if(choice==='incoming')delete overrides[id];else if(choice!=='local')throw Error('LOCAL_TEMPLATE_CHOICE');
 bases[id]=structuredClone(row.incoming);delete conflicts[id];transaction(storage,overrides,bases,conflicts);
}
