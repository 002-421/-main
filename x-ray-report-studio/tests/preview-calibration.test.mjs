import test from 'node:test';
import assert from 'node:assert/strict';
import {DoctorFormats,DOCTOR_FORMAT_KEY} from '../src/doctor-format.ts';
import {PreviewCalibrations,PREVIEW_CALIBRATION_KEY,capacity,calibratedCapacity} from '../src/preview-calibration.ts';
const storage=()=>{const map=new Map();return{map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
test('calibration uses existing doctor UUIDs, preserves legacy formatting, and survives restart independently',()=>{
 const s=storage(),doctors=new DoctorFormats(s,['Врач А','Врач Б'],'Врач А'),a=doctors.get('Врач А').id,b=doctors.get('Врач Б').id,old=s.getItem(DOCTOR_FORMAT_KEY),c=new PreviewCalibrations(s);
 assert.deepEqual(c.get(a),{version:1,enabled:false,offset:0,lastTarget:null});assert.equal(s.getItem(PREVIEW_CALIBRATION_KEY),null);
 c.save(a,{version:1,enabled:true,offset:-3,lastTarget:47});c.save(b,{version:1,enabled:true,offset:-1,lastTarget:51});
 const restarted=new PreviewCalibrations(s);assert.equal(restarted.get(a).lastTarget,47);assert.equal(restarted.get(b).lastTarget,51);assert.equal(s.getItem(DOCTOR_FORMAT_KEY),old);
 restarted.save(a,{version:1,enabled:false,offset:0,lastTarget:50});assert.equal(restarted.get(b).offset,-1);
});
test('deleted/recreated and newly named physicians never inherit another UUID calibration',()=>{
 const s=storage(),d=new DoctorFormats(s,['А','Б'],'А'),c=new PreviewCalibrations(s),aid=d.get('А').id,bid=d.get('Б').id;
 c.save(aid,{version:1,enabled:true,offset:-7,lastTarget:40});d.remove('А');const recreated=d.save('А',11,true);assert.notEqual(recreated.id,aid);assert.equal(c.get(recreated.id).offset,0);assert.equal(d.get('Б').id,bid);
 const renamed=d.save('Новое ФИО',11,true);assert.notEqual(renamed.id,bid);assert.equal(c.get(renamed.id).offset,0);assert.equal(c.get(aid).offset,-7,'an orphaned record is not reassigned');
});
test('corrupt storage is preserved; failed writes cannot change the previous calibration',()=>{
 const s=storage();s.setItem(PREVIEW_CALIBRATION_KEY,'synthetic invalid settings');const c=new PreviewCalibrations(s);assert.ok([...s.map].some(([k,v])=>k.startsWith(PREVIEW_CALIBRATION_KEY+'.recovery.')&&v==='synthetic invalid settings'));
 c.save('existing-id',{version:1,enabled:true,offset:-2,lastTarget:48});const old=s.getItem(PREVIEW_CALIBRATION_KEY);s.setItem=()=>{throw new Error('synthetic quota');};assert.throws(()=>c.save('existing-id',{version:1,enabled:false,offset:0,lastTarget:50}));assert.equal(s.getItem(PREVIEW_CALIBRATION_KEY),old);assert.equal(c.get('existing-id').offset,-2);
});
test('line-equivalent adjustment changes height by one standard line, never by DOM line count',()=>{
 const base=capacity(1000,1040,20),on={version:1,enabled:true,offset:-1,lastTarget:49};assert.equal(base.baseLines,50);assert.equal(calibratedCapacity(base,on).height,980);assert.equal(calibratedCapacity(base,{...on,offset:1}).height,1020);
 assert.equal(calibratedCapacity(base,{...on,enabled:false}).height,1000);assert.equal(on.offset,-1);assert.equal(calibratedCapacity(base,{...on,offset:15}).height,1040);assert.equal(base.maximumOffset,2);assert.equal(base.minimumOffset,-15);
 const full=capacity(1000,1005,20);assert.equal(full.maximumOffset,0);assert.equal(calibratedCapacity(full,{...on,offset:1}).limited,true);
});
test('all seven physician sizes derive capacity dynamically and keep strictly positive safe heights',()=>{
 const values=[];for(const pt of [10,10.5,11,11.5,12,13,14]){const line=pt*96/72*1.05,base=capacity(850,860,line);values.push(base.baseLines);for(const offset of [-15,-1,0,1,15]){const x=calibratedCapacity(base,{version:1,enabled:true,offset,lastTarget:null});assert.ok(x.height>0&&x.height<=860);assert.ok(Math.abs(x.height-base.baseHeight-x.offset*line)<1e-9);}}
 assert.ok(new Set(values).size>1,'no hard-coded 50-line norm');assert.throws(()=>capacity(0,10,1));assert.throws(()=>capacity(10,9,1));
});

test('horizontal calibration reads old records and follows its own measured dimension', async()=>{
 const {widthCapacity,calibratedWidth}=await import('../src/preview-calibration.ts');
 const s=storage(),c=new PreviewCalibrations(s),base={version:1,enabled:true,offset:-3,lastTarget:47};
 c.save('doctor',base);
 const width=widthCapacity(650,690,6.5);
 assert.equal(calibratedWidth(width,c.get('doctor')).width,650);
 c.save('doctor',{...base,characterOffset:-4});
 assert.deepEqual(new PreviewCalibrations(s).get('doctor'),{...base,characterOffset:-4});
 assert.equal(calibratedWidth(width,{...base,enabled:false,characterOffset:-4}).width,624);
 assert.equal(calibratedWidth(width,{...base,characterOffset:20}).width,689);
 assert.throws(()=>c.save('doctor',{...base,characterOffset:21}));
});
