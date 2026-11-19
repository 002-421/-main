import type { RichNode } from './model';
export const DOCTOR_FORMAT_KEY='xrs.doctor-format.v1';
export const TEMPLATE_FONT_SIZES=[10,10.5,11,11.5,12,13,14] as const;
export type DoctorFormat={id:string;name:string;fontSize:number;optimize:boolean};
type Registry={version:1;activeId:string;profiles:Record<string,DoctorFormat>};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const normalized=(name:string)=>name.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
export class DoctorFormats {
 private state:Registry;
 private storage:StorageLike;
 constructor(storage:StorageLike,names:string[],activeName:string){
  this.storage=storage;
  const raw=storage.getItem(DOCTOR_FORMAT_KEY);
  let parsed:Registry|undefined;
  if(raw){try{const value=JSON.parse(raw);if(value.version!==1||!value.profiles||typeof value.profiles!=='object'||Array.isArray(value.profiles))throw new Error();for(const [id,p] of Object.entries(value.profiles) as [string,DoctorFormat][]){if(p.id!==id||typeof p.name!=='string'||!TEMPLATE_FONT_SIZES.includes(p.fontSize as any)||typeof p.optimize!=='boolean')throw new Error();}parsed=value;}catch{const backup=DOCTOR_FORMAT_KEY+'.recovery.'+crypto.randomUUID();storage.setItem(backup,raw);if(storage.getItem(backup)!==raw)throw new Error('Не удалось сохранить резервную копию настроек оформления');}}
  this.state=parsed??{version:1,activeId:'',profiles:{}};
  for(const name of [...names,activeName])this.ensure(name);
  this.state.activeId=this.ensure(activeName).id;if(raw!==JSON.stringify(this.state))this.write(this.state);
 }
 private ensure(name:string){let profile=Object.values(this.state.profiles).find(p=>normalized(p.name)===normalized(name));if(!profile){profile={id:crypto.randomUUID(),name:name.trim(),fontSize:11,optimize:true};this.state.profiles[profile.id]=profile;}return profile;}
 get(name:string):DoctorFormat|undefined {const p=Object.values(this.state.profiles).find(p=>normalized(p.name)===normalized(name));return p?{...p}:undefined;}
 private write(next:Registry){const value=JSON.stringify(next),previous=this.storage.getItem(DOCTOR_FORMAT_KEY);try{this.storage.setItem(DOCTOR_FORMAT_KEY,value);if(this.storage.getItem(DOCTOR_FORMAT_KEY)!==value)throw new Error('Не удалось проверить настройки оформления');}catch(error){if(previous!==null)try{this.storage.setItem(DOCTOR_FORMAT_KEY,previous);}catch{}throw error;}}
 save(name:string,fontSize:number,optimize:boolean){if(!TEMPLATE_FONT_SIZES.includes(fontSize as any))throw new Error('Недопустимый размер шрифта');const old=structuredClone(this.state);try{const p=this.ensure(name);p.fontSize=fontSize;p.optimize=optimize;this.state.activeId=p.id;this.write(this.state);return{...p};}catch(error){this.state=old;throw error;}}
 remove(name:string){const profile=this.get(name);if(!profile)return;const old=structuredClone(this.state);try{delete this.state.profiles[profile.id];if(this.state.activeId===profile.id)this.state.activeId=this.ensure('').id;this.write(this.state);}catch(error){this.state=old;throw error;}}

}
/** Only a freshly created built-in protocol passes through this transform. */
export function newProtocolFont(input:RichNode,fontSize:number):RichNode {
 if(!TEMPLATE_FONT_SIZES.includes(fontSize as any))throw new Error('Недопустимый размер шрифта');
 const doc=structuredClone(input);doc.attrs={...doc.attrs,fontFamily:'Arial',fontSizePt:fontSize};
 const visit=(n:RichNode)=>{if(['paragraph','heading'].includes(n.type))n.attrs={...n.attrs,fontFamily:'Arial',fontSizePt:fontSize};for(const m of n.marks??[])if(m.type==='textStyle')m.attrs={...m.attrs,fontFamily:'Arial',fontSize:`${fontSize*4/3}px`};n.content?.forEach(visit);};visit(doc);return doc;
}
