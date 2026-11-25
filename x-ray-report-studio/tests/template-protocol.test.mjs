import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {generateKeyPairSync} from 'node:crypto';
import {fixture} from './helpers/template-fixture.mjs';
import p from '../electron/template-protocol.cjs';
const code=(fn,value)=>assert.throws(fn,e=>e.code===value);
test('canonical UTF-8 and deterministic stored ZIP preserve exact data and reject ambiguous JSON',()=>{
 const files={'package.json':p.bytes({b:'Тест',a:1}),'template.json':p.bytes({safe:true})};assert.deepEqual(p.zip(files),p.zip(files));assert.deepEqual({...p.unzip(p.zip(files))},files);
 code(()=>p.parse(Buffer.from('{"b":2,"a":1}')),'NONCANONICAL_JSON');code(()=>p.parse(Buffer.from('{"a":1,"a":2}')),'NONCANONICAL_JSON');code(()=>p.canonical({value:NaN}),'NUMBER');code(()=>p.parse(Buffer.from([0xff])),'JSON');code(()=>p.canonical(JSON.parse('{"__proto__":{}}')),'KEYS');
});
test('Ed25519 authenticates payload, binds key identity, counts distinct signatures, and rejects unsigned data',()=>{
 const f=fixture(),payload={safe:1},signed=p.envelope(payload,[f.key]);assert.deepEqual(p.verify(signed,f.root,'test'),payload);signed.signed.safe=2;code(()=>p.verify(signed,f.root,'test'),'SIGNATURE');code(()=>p.verify({signed:payload,signatures:[]},f.root,'test'),'SIGNATURE');const wrong=fixture();code(()=>p.verify(p.envelope(payload,[wrong.key]),f.root,'test'),'SIGNATURE');
 const root=structuredClone(f.root);root.roles.test.threshold=2;root.roles.test.keyIds.push(wrong.id);root.keys[wrong.id]=wrong.pub;const repeated=p.envelope(payload,[f.key,f.key]);code(()=>p.verify(repeated,root,'test'),'SIGNATURE');assert.equal(p.verify(p.envelope(payload,[f.key,wrong.key]),root,'test').safe,1);
});
test('root rotation requires sequential version and old and new authorization; revoked online keys stop working',()=>{
 const old=fixture(),next=fixture(),root={...next.root,version:2};assert.deepEqual(p.rotateRoot(old.root,p.envelope(root,[old.key,next.key]),old.now()),root);
 code(()=>p.rotateRoot(old.root,p.envelope(root,[next.key]),old.now()),'SIGNATURE');code(()=>p.rotateRoot(old.root,p.envelope(root,[old.key]),old.now()),'SIGNATURE');code(()=>p.rotateRoot(old.root,p.envelope({...root,version:3},[old.key,next.key]),old.now()),'ROOT_SEQUENCE');
 const revoked={...old.root,revoked:[old.id]};code(()=>p.verify(p.envelope({safe:true},[old.key]),revoked,'test'),'SIGNATURE');
});
test('unsupported schema, wrong channel, incompatible app, invalid dates, replay-window expiry fail closed',()=>{
 const f=fixture(),m=p.parse(f.manifest([f.template()])).signed;assert.equal(p.validateManifest(m,{channel:'test',appVersion:'0.4.84',now:f.now()}),m);
 for(const [change,error]of [[{schemaVersion:2},'SCHEMA'],[{channel:'stable'},'CHANNEL'],[{minimumXrsVersion:'0.5.0'},'XRS_VERSION_REQUIRED'],[{expiresAt:'2026-11-25T01:00:00.000Z'},'EXPIRED'],[{sequence:0},'SEQUENCE']])code(()=>p.validateManifest({...m,...change},{channel:'test',appVersion:'0.4.84',now:f.now()}),error);
 const duplicate={...m,packages:[m.packages[0],m.packages[0]]};code(()=>p.validateManifest(duplicate),'DUPLICATE_ID');for(const url of ['http://example.invalid/a','https://u:p@example.invalid/a','file:///tmp/a','javascript:alert(1)'])code(()=>p.validateManifest({...m,packages:[{...m.packages[0],url}]}),'URL');
});
test('signed package binds archive hash, length, document hash, ID/version and action',()=>{
 const f=fixture(),t=f.template(),m=p.parse(f.manifest([t])).signed,e=m.packages[0],raw=f.files.get(e.url);assert.deepEqual(p.readPackage(raw,e,f.root,{appVersion:'0.4.84',channel:'test'}),t);
 code(()=>p.readPackage(raw,{...e,size:1},f.root,{appVersion:'0.4.84',channel:'test'}),'PACKAGE_HASH');const changed=Buffer.from(raw);changed[60]^=1;code(()=>p.readPackage(changed,e,f.root,{appVersion:'0.4.84',channel:'test'}),'PACKAGE_HASH');
 code(()=>p.readPackage(raw,{...e,templateVersion:'0.0.2'},f.root,{appVersion:'0.4.84',channel:'test'}),'PACKAGE_BINDING');
 const files=p.unzip(raw);files['template.json']=p.bytes({...t,title:'Изменённый заголовок'});const forged=p.zip(files);code(()=>p.readPackage(forged,{...e,size:forged.length,sha256:p.sha256(forged)},f.root,{appVersion:'0.4.84',channel:'test'}),'PACKAGE_BINDING');
});
test('ZIP rejects traversal, duplicate hidden entries, compression, descriptors, corruption, oversized and trailing data',()=>{
 const valid=p.zip({'package.json':p.bytes({ok:true})});const bad=Buffer.from(valid);bad[35]^=1;code(()=>p.unzip(bad),'ZIP_STRUCTURE');
 for(const name of ['../template.json','/template.json','C:\\template.json','folder/../../a','script.js'])code(()=>p.zip({[name]:Buffer.from('x')}),'ZIP_PATH');
 const compressed=zipSync({'package.json':strToU8('x'.repeat(1000))});code(()=>p.unzip(compressed),'ZIP_STRUCTURE');code(()=>p.unzip(Buffer.concat([valid,Buffer.from('trailer')])),'ZIP_STRUCTURE');code(()=>p.unzip(Buffer.alloc(p.LIMITS.archive+1)),'ZIP_SIZE');
 const corrupt=Buffer.from(valid);corrupt[30+'package.json'.length]^=1;code(()=>p.unzip(corrupt),'ZIP_CRC');
 const symlink=Buffer.from(valid),central=symlink.readUInt32LE(symlink.length-6);symlink.writeUInt32LE(0xa1ff0000,central+38);code(()=>p.unzip(symlink),'ZIP_STRUCTURE');
});
test('document contract rejects executable nodes, styles, external images, filled service fields and lost native IDs',()=>{
 const f=fixture(),t=f.template();assert.doesNotThrow(()=>p.validateTemplate(t));
 const malicious=structuredClone(t);malicious.doc.content.push({type:'script',text:'x'});code(()=>p.validateTemplate(malicious),'NODE_STRUCTURE');
 const changed=structuredClone(t);changed.doc.content[0].content[0].content[0].marks[0].attrs.filled=true;code(()=>p.validateTemplate(changed),'FILLED_FIELD');
 const image=structuredClone(t);image.doc.content.push({type:'image',attrs:{src:'https://outside.invalid/patient.png'}});code(()=>p.validateTemplate(image),'IMAGE_NOT_APPROVED');
 const field=structuredClone(t);field.doc.content[0].content[0].content[0].marks[0].attrs.id='other';code(()=>p.continuity(t,field),'FIELD_CONTINUITY');
 const style=structuredClone(t);style.doc.content[1].content[0].content[0].marks=[{type:'textStyle',attrs:{backgroundColor:'url(https://x.invalid)'}}];code(()=>p.validateTemplate(style),'STYLE');
});

test('future packages cannot flatten independent numeric prompts into a single paragraph color',()=>{
 const f=fixture(),t=f.template(),paragraph=t.doc.content[1].content[0];paragraph.attrs={editableHighlight:{id:'synthetic.prompt',original:paragraph.content[0].text,edited:false}};paragraph.content[0].marks=[{type:'templateHighlight',attrs:{id:'synthetic.prompt'}}];code(()=>p.validateTemplate(t),'UNSTRUCTURED_SIZE');
});
