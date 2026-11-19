export const PREVIEW_CALIBRATION_KEY='xrs.preview-calibration.v1';
export const MAX_LINE_OFFSET=15;
export type PreviewCalibration={version:1;enabled:boolean;offset:number;lastTarget:number|null};
export type Capacity={baseHeight:number;maximumHeight:number;lineHeight:number;baseLines:number;minimumOffset:number;maximumOffset:number};
export type CalibrationResult=Capacity&{offset:number;height:number;target:number;limited:boolean};
const defaults=():PreviewCalibration=>({version:1,enabled:false,offset:0,lastTarget:null});
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
type Registry={version:1;profiles:Record<string,PreviewCalibration>};

/** Uses the existing DoctorFormats UUID. Never creates physician identities. */
export class PreviewCalibrations {
 private storage:StorageLike;
 private state:Registry;
 constructor(storage:StorageLike){
  this.storage=storage;this.state={version:1,profiles:{}};
  const raw=storage.getItem(PREVIEW_CALIBRATION_KEY);if(!raw)return;
  try{
   const value=JSON.parse(raw);if(value.version!==1||!value.profiles||typeof value.profiles!=='object'||Array.isArray(value.profiles))throw new Error();
   for(const v of Object.values(value.profiles) as PreviewCalibration[])if(v.version!==1||typeof v.enabled!=='boolean'||!Number.isInteger(v.offset)||Math.abs(v.offset)>MAX_LINE_OFFSET||v.lastTarget!==null&&(!Number.isInteger(v.lastTarget)||v.lastTarget<1||v.lastTarget>10000))throw new Error();
   this.state=value;
  }catch{
   const key=PREVIEW_CALIBRATION_KEY+'.recovery.'+crypto.randomUUID();storage.setItem(key,raw);
   if(storage.getItem(key)!==raw)throw new Error('Не удалось сохранить резервную копию калибровки.');
  }
 }
 get(doctorId:string):PreviewCalibration{return {...(this.state.profiles[doctorId]??defaults())};}
 save(doctorId:string,value:PreviewCalibration){
  if(!doctorId||doctorId==='unsaved')throw new Error('Сначала сохраните врача.');
  if(value.version!==1||typeof value.enabled!=='boolean'||!Number.isInteger(value.offset)||Math.abs(value.offset)>MAX_LINE_OFFSET||value.lastTarget!==null&&(!Number.isInteger(value.lastTarget)||value.lastTarget<1||value.lastTarget>10000))throw new Error('Недопустимое значение калибровки.');
  const next:Registry={version:1,profiles:{...this.state.profiles,[doctorId]:{...value}}},serialized=JSON.stringify(next),previous=this.storage.getItem(PREVIEW_CALIBRATION_KEY);
  try{this.storage.setItem(PREVIEW_CALIBRATION_KEY,serialized);if(this.storage.getItem(PREVIEW_CALIBRATION_KEY)!==serialized)throw new Error('Не удалось проверить сохранённую калибровку.');}
  catch(error){if(previous!==null)try{this.storage.setItem(PREVIEW_CALIBRATION_KEY,previous);}catch{}throw error;}
  this.state=next;
 }
}

/** A line-equivalent height adjustment, never a count of rendered DOM lines. */
export function capacity(baseHeight:number,maximumHeight:number,lineHeight:number):Capacity {
 if(![baseHeight,maximumHeight,lineHeight].every(v=>Number.isFinite(v)&&v>0)||maximumHeight<baseHeight||baseHeight<lineHeight)throw new Error('Недопустимая геометрия предпросмотра.');
 return{baseHeight,maximumHeight,lineHeight,baseLines:Math.floor(baseHeight/lineHeight),minimumOffset:Math.max(-MAX_LINE_OFFSET,Math.ceil((lineHeight-baseHeight)/lineHeight)),maximumOffset:Math.min(MAX_LINE_OFFSET,Math.floor((maximumHeight-baseHeight)/lineHeight))};
}
export function calibratedCapacity(base:Capacity,value:PreviewCalibration):CalibrationResult {
 const requested=value.enabled?value.offset:0,offset=Math.max(base.minimumOffset,Math.min(base.maximumOffset,requested));
 return{...base,offset,height:base.baseHeight+offset*base.lineHeight,target:base.baseLines+offset,limited:offset!==requested};
}
