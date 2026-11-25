import {generateKeyPairSync} from 'node:crypto';
import p from '../../electron/template-protocol.cjs';
export function fixture(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),pub=publicKey.export({type:'spki',format:'pem'}),key=privateKey.export({type:'pkcs8',format:'pem'}),id=p.keyId(pub);
 const root={schemaVersion:1,type:'xrs-template-root',version:1,expiresAt:'2035-01-01T00:00:00.000Z',keys:{[id]:pub},roles:Object.fromEntries(['root','stable','test'].map(role=>[role,{keyIds:[id],threshold:1}])),revoked:[]};
 const field=(id,hint)=>({type:'paragraph',content:[{type:'text',text:hint,marks:[{type:'templateField',attrs:{id,hint,original:hint,filled:false}}]}]});
 const section=(id,content)=>({type:'reportSection',attrs:{id,title:id,moduleId:''},content});
 const template=(id='synthetic-spine',revision='0.0.1',text='Синтетический пример. Размер 0,0 и 0,0 см.')=>({id,title:'Синтетический тест — не для клинического применения',areaId:'synthetic',areaTitle:'Тестовая группа',modality:'MRI',templateVersion:revision,minimumXrsVersion:'0.4.84',doc:{type:'doc',attrs:{editableHighlightsVersion:1},content:[section('header',[field(id+'.number','номер исследования'),field(id+'.patient','Ф.И.О.'),field(id+'.birthdate','дд.мм.гггг')]),section('description',[{type:'paragraph',content:[{type:'text',text}]}]),section('conclusion',[{type:'paragraph',content:[{type:'text',text:'ЗАКЛЮЧЕНИЕ: синтетический пример'}]}]),section('signature',[field('HEAD.BASE.2.FIELD.0043','Ф.И.О. врача'),field(id+'.reportdate','дд.мм.гггг')])]}});
 const files=new Map();
 const manifest=(templates,sequence=1,channel='test',actions={})=>{
 const packages=templates.map(t=>{const action=actions[t.id]??'update',raw=p.makePackage(t,[key],action),url=`https://example.invalid/releases/catalog-${sequence}/${t.id}.xrszip`;files.set(url,raw);return {templateId:t.id,templateVersion:t.templateVersion,action,url,sha256:p.sha256(raw),size:raw.length,summary:'Синтетическая проверка'};});
 const m={schemaVersion:1,type:'xrs-template-catalog',catalogId:'synthetic-test',catalogVersion:`1.0.${sequence}`,sequence,channel,minimumXrsVersion:'0.4.84',publishedAt:'2026-11-25T00:00:00.000Z',expiresAt:'2030-01-01T00:00:00.000Z',publisher:{name:'Синтетический издатель',keyId:id},packages};return p.bytes(p.envelope(m,[key]));};
 return {key,pub,id,root,template,manifest,files,now:()=>Date.parse('2026-11-25T12:00:00.000Z')};
}
