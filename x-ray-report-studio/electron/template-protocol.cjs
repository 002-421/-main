'use strict';
// Shared, data-only protocol. No evaluation, extraction, dynamic imports or external dependencies.
const crypto = require('node:crypto');
const {TextDecoder} = require('node:util');
const LIMITS = Object.freeze({archive:8*1024*1024, json:2*1024*1024, entries:4, templates:500, nodes:20000, depth:30});
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const VERSION=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const HASH=/^[a-f0-9]{64}$/;
function fail(code){const e=new Error(code);e.code=code;e.name='TemplateProtocolError';throw e;}
function check(value,code){if(!value)fail(code);}
function object(value){check(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT');return value;}
function keys(value,allowed,required=allowed){object(value);check(Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'KEYS');}
function string(value,max=2000){check(typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),'STRING');return value;}
function version(value){check(typeof value==='string'&&VERSION.test(value),'VERSION');return value;}
function compare(a,b){version(a);version(b);const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
function canonical(value,depth=0){
 check(depth<=64,'JSON_DEPTH');
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string'){check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),'UNICODE');return JSON.stringify(value);}
 if(typeof value==='number'){check(Number.isFinite(value),'NUMBER');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 object(value);check(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null,'OBJECT');
 const names=Object.keys(value).sort();check(!names.some(k=>['__proto__','constructor','prototype'].includes(k)),'KEYS');
 return '{'+names.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
const bytes=value=>Buffer.from(canonical(value),'utf8');
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
function parse(data,max=LIMITS.json){check(data.length<=max,'SIZE');let value;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(data);value=JSON.parse(text);check(bytes(value).equals(Buffer.from(data)),'NONCANONICAL_JSON');}catch(e){if(e.name==='TemplateProtocolError')throw e;fail('JSON');}return value;}
function publicKey(pem){let key;try{key=crypto.createPublicKey(pem);}catch{fail('KEY');}check(key.asymmetricKeyType==='ed25519','KEY');return key;}
function keyId(pem){return sha256(publicKey(pem).export({type:'spki',format:'der'}));}
function sign(payload,privateKey){const key=crypto.createPrivateKey(privateKey);check(key.asymmetricKeyType==='ed25519','KEY');const pem=crypto.createPublicKey(key).export({type:'spki',format:'pem'});return {keyId:keyId(pem),sig:crypto.sign(null,bytes(payload),key).toString('base64')};}
function envelope(payload,privateKeys){return {signed:structuredClone(payload),signatures:privateKeys.map(k=>sign(payload,k))};}
function verify(envelope,root,role){
 keys(envelope,['signed','signatures']);check(Array.isArray(envelope.signatures)&&envelope.signatures.length<=10,'SIGNATURE');
 const rule=root.roles?.[role];check(rule&&Number.isInteger(rule.threshold)&&rule.threshold>0&&rule.threshold<=rule.keyIds.length,'TRUST');
 const valid=new Set();for(const signature of envelope.signatures){keys(signature,['keyId','sig']);if(!rule.keyIds.includes(signature.keyId)||root.revoked.includes(signature.keyId))continue;
 const pem=root.keys[signature.keyId];if(!pem||keyId(pem)!==signature.keyId)continue;
 check(typeof signature.sig==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(signature.sig),'SIGNATURE');
 if(crypto.verify(null,bytes(envelope.signed),publicKey(pem),Buffer.from(signature.sig,'base64')))valid.add(signature.keyId);
 }check(valid.size>=rule.threshold,'SIGNATURE');return envelope.signed;
}
function validateRoot(root,now=Date.now(),expiry=true){
 keys(root,['schemaVersion','type','version','expiresAt','keys','roles','revoked']);
 check(root.schemaVersion===1&&root.type==='xrs-template-root'&&Number.isSafeInteger(root.version)&&root.version>=1,'ROOT');date(root.expiresAt);if(expiry)check(Date.parse(root.expiresAt)>now,'ROOT_EXPIRED');
 object(root.keys);check(Object.keys(root.keys).length>0&&Object.keys(root.keys).length<=10,'TRUST');for(const [id,pem] of Object.entries(root.keys))check(keyId(pem)===id,'KEY');
 check(Array.isArray(root.revoked)&&root.revoked.every(id=>HASH.test(id)),'TRUST');
 keys(root.roles,['root','stable','test']);for(const rule of Object.values(root.roles)){keys(rule,['keyIds','threshold']);check(Array.isArray(rule.keyIds)&&new Set(rule.keyIds).size===rule.keyIds.length&&rule.keyIds.length<=10&&rule.keyIds.every(id=>Object.hasOwn(root.keys,id)&&!root.revoked.includes(id))&&Number.isInteger(rule.threshold)&&rule.threshold>=1&&rule.threshold<=rule.keyIds.length,'TRUST');}
 return root;
}
function rotateRoot(previous,nextEnvelope,now=Date.now()){
 validateRoot(previous,now,false);const next=verify(nextEnvelope,previous,'root');validateRoot(next,now);
 check(next.version===previous.version+1,'ROOT_SEQUENCE');verify(nextEnvelope,next,'root');return next;
}
function date(value){check(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'DATE');}
function httpsUrl(value){let url;try{url=new URL(value);}catch{fail('URL');}check(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'URL');return url;}
function validateManifest(manifest,{channel,appVersion,now=Date.now(),expiry=true}={}){
 const names=['schemaVersion','type','catalogId','catalogVersion','sequence','channel','minimumXrsVersion','publishedAt','expiresAt','publisher','packages'];if(manifest.schemaVersion===2)names.push('revisions');keys(manifest,names);
 check([1,2].includes(manifest.schemaVersion)&&manifest.type==='xrs-template-catalog','SCHEMA');check(ID.test(manifest.catalogId),'ID');version(manifest.catalogVersion);
 check(Number.isSafeInteger(manifest.sequence)&&manifest.sequence>0,'SEQUENCE');check(['stable','test'].includes(manifest.channel)&&(!channel||manifest.channel===channel),'CHANNEL');
 version(manifest.minimumXrsVersion);if(appVersion)check(compare(appVersion,manifest.minimumXrsVersion)>=0,'XRS_VERSION_REQUIRED');
 date(manifest.publishedAt);date(manifest.expiresAt);check(Date.parse(manifest.expiresAt)>Date.parse(manifest.publishedAt),'DATE');
 if(expiry){check(Date.parse(manifest.publishedAt)<=now+300000,'FUTURE');check(Date.parse(manifest.expiresAt)>now,'EXPIRED');}
 keys(manifest.publisher,['name','keyId']);string(manifest.publisher.name,200);check(HASH.test(manifest.publisher.keyId),'KEY');
 check(Array.isArray(manifest.packages)&&manifest.packages.length<=LIMITS.templates,'COUNT');const ids=new Set();
 for(const entry of manifest.packages){keys(entry,['templateId','templateVersion','action','url','sha256','size','summary']);check(ID.test(entry.templateId)&&!ids.has(entry.templateId),'DUPLICATE_ID');ids.add(entry.templateId);version(entry.templateVersion);check(['add','update','remove'].includes(entry.action),'ACTION');httpsUrl(entry.url);check(HASH.test(entry.sha256)&&Number.isSafeInteger(entry.size)&&entry.size>0&&entry.size<=LIMITS.archive,'SIZE');string(entry.summary,2000);}
 if(manifest.schemaVersion===2){
 check(Array.isArray(manifest.revisions)&&manifest.revisions.length<=2000,'REVISION_COUNT');const versions=new Set(),active=new Map();
 for(const r of manifest.revisions){keys(r,['templateId','templateVersion','action','url','sha256','size','summary','status','publishedAt','approvedBy']);check(ID.test(r.templateId)&&!versions.has(r.templateId+'@'+r.templateVersion),'DUPLICATE_REVISION');versions.add(r.templateId+'@'+r.templateVersion);version(r.templateVersion);check(['Active','Archived','Revoked'].includes(r.status),'REVISION_STATUS');check(['add','update','remove'].includes(r.action),'ACTION');httpsUrl(r.url);check(HASH.test(r.sha256)&&Number.isSafeInteger(r.size)&&r.size>0&&r.size<=LIMITS.archive,'SIZE');string(r.summary,2000);date(r.publishedAt);string(r.approvedBy,200);check(r.approvedBy.length>0,'APPROVAL');if(r.status==='Active'){check(!active.has(r.templateId)&&r.action!=='remove','MULTIPLE_ACTIVE');active.set(r.templateId,r);}}
 for(const entry of manifest.packages){const r=manifest.revisions.find(r=>r.templateId===entry.templateId&&r.templateVersion===entry.templateVersion);check(r&&r.status===(entry.action==='remove'?'Revoked':'Active'),'ACTIVE_BINDING');const {status,publishedAt,approvedBy,...payload}=r;check(canonical(payload)===canonical(entry),'ACTIVE_BINDING');}
 check([...active.values()].every(r=>manifest.packages.some(e=>e.templateId===r.templateId&&e.templateVersion===r.templateVersion)),'ACTIVE_BINDING');
 }
 return manifest;
}
// ZIP_STORED only: deterministic, bounded, uncompressed data. Reject all extra fields,
// descriptors, comments, symlinks, duplicate entries, unsafe paths and hidden trailing data.
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function filename(name){check(typeof name==='string'&&/^(?:package\.json|template\.json)$/.test(name),'ZIP_PATH');}
function zip(files){
 const locals=[],central=[];let offset=0;const names=Object.keys(files).sort();check(names.length>0&&names.length<=LIMITS.entries,'COUNT');
 for(const name of names){filename(name);const data=Buffer.from(files[name]);check(data.length<=LIMITS.json,'SIZE');const n=Buffer.from(name),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
 const head=Buffer.alloc(46);head.writeUInt32LE(0x02014b50);head.writeUInt16LE(20,4);local.copy(head,6,4,28);head.writeUInt32LE(offset,42);central.push(head,n);locals.push(local,n,data);offset+=local.length+n.length+data.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);const result=Buffer.concat([...locals,directory,end]);check(result.length<=LIMITS.archive,'SIZE');return result;
}
function unzip(raw){
 const b=Buffer.from(raw);check(b.length>=22&&b.length<=LIMITS.archive,'ZIP_SIZE');const end=b.length-22;check(b.readUInt32LE(end)===0x06054b50&&b.readUInt16LE(end+4)===0&&b.readUInt16LE(end+6)===0&&b.readUInt16LE(end+20)===0,'ZIP_STRUCTURE');
 const count=b.readUInt16LE(end+10),start=b.readUInt32LE(end+16);check(count>0&&count<=LIMITS.entries&&count===b.readUInt16LE(end+8)&&start+b.readUInt32LE(end+12)===end,'ZIP_STRUCTURE');let p=start,next=0;const files=Object.create(null);
 for(let i=0;i<count;i++){
 check(p+46<=end&&b.readUInt32LE(p)===0x02014b50,'ZIP_STRUCTURE');const size=b.readUInt32LE(p+24),length=b.readUInt16LE(p+28),at=b.readUInt32LE(p+42),crc=b.readUInt32LE(p+16);
 check(size<=LIMITS.json&&b.readUInt32LE(p+20)===size&&b.readUInt16LE(p+8)===0x800&&b.readUInt16LE(p+10)===0&&b.readUInt16LE(p+30)===0&&b.readUInt16LE(p+32)===0&&b.readUInt16LE(p+34)===0&&b.readUInt32LE(p+38)===0&&p+46+length<=end,'ZIP_STRUCTURE');
 const name=b.toString('utf8',p+46,p+46+length);filename(name);check(!Object.hasOwn(files,name)&&at===next&&at+30+length+size<=start,'ZIP_STRUCTURE');
 check(b.readUInt32LE(at)===0x04034b50&&b.subarray(at+4,at+28).equals(b.subarray(p+6,p+30))&&b.readUInt16LE(at+28)===0&&b.subarray(at+30,at+30+length).equals(Buffer.from(name)),'ZIP_STRUCTURE');
 const data=b.subarray(at+30+length,at+30+length+size);check(crc32(data)===crc,'ZIP_CRC');files[name]=Buffer.from(data);next=at+30+length+size;p+=46+length;
 }check(p===end&&next===start,'ZIP_STRUCTURE');return files;
}
const nodeAttrs={doc:['sourceFormat','pageWidthMm','pageHeightMm','marginTopMm','marginBottomMm','marginLeftMm','marginRightMm','fontFamily','fontSizePt','lineHeight','spaceAfterPt','spaceBeforePt','templateId','editableHighlightsVersion'],paragraph:['fontFamily','fontSizePt','textAlign','lineHeight','spaceAfterPt','spaceBeforePt','templateOriginal','firstLineIndentPt','leftIndentPt','rightIndentPt','keepNext','pageBreakBefore','editableHighlight','spacingReference','moduleRef','sourceStyle'],heading:['level','fontFamily','fontSizePt','textAlign','lineHeight','spaceAfterPt','spaceBeforePt','templateOriginal','firstLineIndentPt','leftIndentPt','rightIndentPt','keepNext','pageBreakBefore','editableHighlight','spacingReference','sourceStyle'],text:[],horizontalRule:['manual','thicknessPt'],hardBreak:[],table:[],tableRow:[],tableCell:['colspan','rowspan','colwidth','align'],tableHeader:['colspan','rowspan','colwidth','align'],image:['src','alt','width','height'],reportField:['id','hint','value'],reportSection:['id','title','moduleId'],blockquote:[],bulletList:['bulletStyle'],orderedList:['start'],listItem:[]};
const markAttrs={bold:[],italic:[],underline:[],strike:[],subscript:[],superscript:[],textStyle:['fontSize','fontFamily','color','backgroundColor','lineHeight'],templateField:['id','hint','original','filled'],templateHighlight:['id'],templateSize:['id','original','filled'],highlight:['color']};
const textOf=n=>n.type==='text'?n.text:n.type==='reportField'?n.attrs.hint:(n.content??[]).map(textOf).join('');
function structure(doc){const fields=new Map(),paragraphs=new Map(),sizes=new Map(),sections=[];function walk(n){if(n.type==='reportField')fields.set(n.attrs.id,n.attrs.hint);if(n.type==='reportSection')sections.push(n.attrs.id);if(n.attrs?.editableHighlight){const a=n.attrs.editableHighlight;check(!paragraphs.has(a.id),'DUPLICATE_FIELD');paragraphs.set(a.id,a.original);}for(const m of n.marks??[]){if(m.type==='templateField'){check(!fields.has(m.attrs.id)||fields.get(m.attrs.id)===m.attrs.hint,'FIELD_CONFLICT');fields.set(m.attrs.id,m.attrs.hint);}if(m.type==='templateSize'){check(!sizes.has(m.attrs.id)||sizes.get(m.attrs.id)===m.attrs.original,'FIELD_CONFLICT');sizes.set(m.attrs.id,m.attrs.original);}}n.content?.forEach(walk);}walk(doc);return {fields:[...fields].map(([id,hint])=>({id,hint})),paragraphs:[...paragraphs.keys()],sizes:[...sizes].map(([id,original])=>({id,original})),sections};}
function validateDocument(doc,{allowedImages=[]}={}){
 let count=0;const prompts=new Set(),promptMarks=new Set(),measurements=new Map(),fieldRuns=new Map(),atomicFields=new Set(),sections=new Set();
 function walk(n,depth=0,parent){check(depth<=LIMITS.depth&&++count<=LIMITS.nodes,'DOCUMENT_LIMIT');keys(n,['type','attrs','content','text','marks'],['type']);check(Object.hasOwn(nodeAttrs,n.type),'NODE');
 const a=n.attrs??{};keys(a,nodeAttrs[n.type],[]);for(const [k,v]of Object.entries(a)){if(['editableHighlight','spacingReference','colwidth'].includes(k))continue;if(typeof v==='number')check(Number.isFinite(v)&&v>=0&&v<=((k==='width'||k==='height')?2000:1000),'FORMAT');else if(typeof v==='string'){string(v,k==='src'?LIMITS.json:100000);if(/(?:fontFamily|textAlign|sourceStyle|sourceFormat|color)$/i.test(k))check(!/[;{}<>\\]/.test(v),'FORMAT');}else check(typeof v==='boolean','FORMAT');if(k==='fontSizePt')check(v>=6&&v<=96,'FORMAT');if(k==='lineHeight')check(v>=0.5&&v<=4,'FORMAT');}
 if(n.type==='doc')check(parent===undefined&&a.editableHighlightsVersion===1,'STRUCTURE_VERSION');else check(parent,'NODE');
 if(n.type==='text'){string(n.text,100000);check(n.text.length>0&&!n.content,'NODE');}else check(n.text===undefined,'NODE');
 if(n.content!==undefined){check(Array.isArray(n.content),'NODE');const allowed=n.type==='doc'||n.type==='reportSection'||n.type==='blockquote'||n.type==='listItem'?['paragraph','heading','horizontalRule','table','reportSection','blockquote','bulletList','orderedList','image']:['paragraph','heading'].includes(n.type)?['text','hardBreak','reportField']:n.type==='table'?['tableRow']:n.type==='tableRow'?['tableCell','tableHeader']:['tableCell','tableHeader'].includes(n.type)?['paragraph','heading','table']:['bulletList','orderedList'].includes(n.type)?['listItem']:[];
 check(n.content.every(c=>allowed.includes(c.type)),'NODE_STRUCTURE');}
 if(a.editableHighlight){const ranges=[];let offset=0;for(const child of n.content??[]){const length=textOf(child).length;ranges.push({node:child,from:offset,to:offset+length});offset+=length;}for(const match of textOf(n).matchAll(/(?<![\d,])0,0+(?![\d,])/g)){const overlaps=ranges.filter(r=>r.from<match.index+match[0].length&&r.to>match.index);if(overlaps.length&&overlaps.every(r=>r.node.type==='text'&&r.node.marks?.some(m=>m.type==='templateHighlight')&&!r.node.marks?.some(m=>m.type==='templateField')))check(overlaps.every(r=>r.node.marks?.some(m=>m.type==='templateSize'&&m.attrs.original===match[0])),'UNSTRUCTURED_SIZE');}}
 if(a.colwidth!==undefined)check(Array.isArray(a.colwidth)&&a.colwidth.length<=50&&a.colwidth.every(w=>Number.isFinite(w)&&w>0&&w<=5000),'FORMAT');
 if(a.spacingReference){keys(a.spacingReference,['lineHeight','beforePt','afterPt']);check(Object.values(a.spacingReference).every(v=>Number.isFinite(v)&&v>=0&&v<=1000),'FORMAT');}
 if(a.editableHighlight){keys(a.editableHighlight,['id','original','edited']);check(ID.test(a.editableHighlight.id)&&a.editableHighlight.edited===false&&!prompts.has(a.editableHighlight.id),'PROMPT');string(a.editableHighlight.original,100000);check(a.editableHighlight.original===textOf(n),'PROMPT_ORIGINAL');prompts.add(a.editableHighlight.id);}
 if(n.type==='reportSection'){check(ID.test(a.id)&&!sections.has(a.id),'DUPLICATE_SECTION');sections.add(a.id);string(a.title,300);}
 if(n.type==='reportField'){check(ID.test(a.id)&&a.value===''&&!atomicFields.has(a.id),'FILLED_FIELD');atomicFields.add(a.id);string(a.hint,2000);}
 if(n.type==='image')check(allowedImages.includes(sha256(Buffer.from(a.src??''))),'IMAGE_NOT_APPROVED');
 if(n.marks!==undefined){check(n.type==='text'&&Array.isArray(n.marks)&&n.marks.length<=12,'MARK');const seen=new Set();for(const m of n.marks){keys(m,['type','attrs'],['type']);check(Object.hasOwn(markAttrs,m.type)&&!seen.has(m.type),'MARK');seen.add(m.type);const ma=m.attrs??{};keys(ma,markAttrs[m.type],[]);
 if(['templateField','templateSize','templateHighlight'].includes(m.type)){check(ID.test(ma.id),'FIELD');if(m.type!=='templateHighlight'){check(ma.filled===false,'FILLED_FIELD');string(ma.original,100000);}if(m.type==='templateField'){string(ma.hint,2000);const f=fieldRuns.get(ma.id)??{hint:ma.hint,text:''};check(f.hint===ma.hint&&ma.original===ma.hint,'FIELD');f.text+=n.text;fieldRuns.set(ma.id,f);}if(m.type==='templateSize'){check(/^0,0+$/.test(ma.original),'SIZE_FIELD');const size=measurements.get(ma.id)??{original:ma.original,text:''};check(size.original===ma.original,'FIELD_CONFLICT');size.text+=n.text;measurements.set(ma.id,size);}if(m.type==='templateHighlight'){check(parent?.attrs?.editableHighlight?.id===ma.id,'PROMPT_PARENT');promptMarks.add(ma.id);}}
 else for(const [k,v]of Object.entries(ma)){string(v,200);check(k==='color'||k==='backgroundColor'?/^(#[a-f\d]{3,8}|[a-z]{1,24}|rgba?\([\d.,%\s]+\))$/i.test(v):k==='fontFamily'?/^[\p{L}\d\s,'"_-]+$/u.test(v):/^\d{1,3}(?:\.\d{1,5})?(?:px|pt)?$/.test(v)&&Number.parseFloat(v)>0&&Number.parseFloat(v)<=999,'STYLE');}
 // Legacy yellow must have structural meaning. Manual yellow uses textStyle.backgroundColor.
 if(m.type==='highlight'&&/^(#ffff00|yellow)$/i.test(ma.color))check(n.marks.some(m=>m.type==='templateField'),'UNSTRUCTURED_YELLOW');
 }}
 n.content?.forEach(c=>walk(c,depth+1,n));
 }walk(doc);check([...prompts].every(id=>promptMarks.has(id)),'ORPHAN_PROMPT');for(const f of fieldRuns.values())check(f.text===f.hint,'FILLED_FIELD');for(const s of measurements.values())check(s.text===s.original,'FILLED_SIZE');return structure(doc);
}
function validateTemplate(t,options){
 keys(t,['id','title','areaId','areaTitle','modality','templateVersion','minimumXrsVersion','doc','retired'],['id','title','areaId','areaTitle','modality','templateVersion','minimumXrsVersion','doc']);if(t.retired!==undefined)check(typeof t.retired==='boolean','TEMPLATE_STATUS');check(ID.test(t.id)&&ID.test(t.areaId),'ID');string(t.title,200);string(t.areaTitle,200);check(['MRI','CT'].includes(t.modality),'MODALITY');check((t.modality==='CT')===t.id.startsWith('ct-')&&(t.modality==='CT')===t.areaId.startsWith('ct-'),'MODALITY');version(t.templateVersion);version(t.minimumXrsVersion);validateDocument(t.doc,options);check(canonical((t.doc.content??[]).map(n=>n.type==='reportSection'?n.attrs.id:null))===canonical(['header','description','conclusion','signature']),'SERVICE_SECTIONS');const fields=structure(t.doc).fields;check(['.number','.patient','.birthdate','.reportdate'].every(s=>fields.some(f=>f.id.endsWith(s)))&&fields.some(f=>f.id==='HEAD.BASE.2.FIELD.0043'),'SERVICE_FIELDS');return t;
}
function continuity(before,after){const old=before.contract??structure(before.doc),next=structure(after.doc);check(canonical(old.fields)===canonical(next.fields)&&canonical(old.sections)===canonical(next.sections),'FIELD_CONTINUITY');
 // Paragraph and size prompts can be deliberately added/removed by an editor,
 // but surviving IDs must retain meaning. Native field IDs are never replaced.
 const sizes=new Map(old.sizes.map(s=>[s.id,s.original]));check(next.sizes.every(s=>!sizes.has(s.id)||sizes.get(s.id)===s.original),'SIZE_CONTINUITY');check(before.id===after.id&&before.modality===after.modality,'ID_CONTINUITY');}
function makePackage(t,privateKeys,action='update'){check(['add','update','remove'].includes(action)&&((action==='remove')===(t.retired===true)),'ACTION');const data=bytes(t),payload={schemaVersion:1,type:'xrs-template-package',templateId:t.id,templateVersion:t.templateVersion,minimumXrsVersion:t.minimumXrsVersion,action,documentSha256:sha256(data)};return zip({'package.json':bytes(envelope(payload,privateKeys)),'template.json':data});}
function readPackage(raw,entry,root,{appVersion,allowedImages=[],channel='stable'}={}){
 check(raw.length===entry.size&&sha256(raw)===entry.sha256,'PACKAGE_HASH');const files=unzip(raw);check(Object.keys(files).length===2&&files['package.json']&&files['template.json'],'PACKAGE_FILES');const auth=parse(files['package.json']),p=verify(auth,root,channel);keys(p,['schemaVersion','type','templateId','templateVersion','minimumXrsVersion','action','documentSha256']);check(p.schemaVersion===1&&p.type==='xrs-template-package','SCHEMA');check(p.templateId===entry.templateId&&p.templateVersion===entry.templateVersion&&p.action===entry.action&&sha256(files['template.json'])===p.documentSha256,'PACKAGE_BINDING');check(compare(appVersion,p.minimumXrsVersion)>=0,'XRS_VERSION_REQUIRED');const t=parse(files['template.json']);validateTemplate(t,{allowedImages});check(t.id===p.templateId&&t.templateVersion===p.templateVersion&&t.minimumXrsVersion===p.minimumXrsVersion&&((p.action==='remove')===(t.retired===true)),'PACKAGE_BINDING');return t;
}
module.exports={LIMITS,fail,check,keys,string,version,compare,canonical,bytes,sha256,parse,keyId,sign,envelope,verify,validateRoot,rotateRoot,httpsUrl,validateManifest,crc32,zip,unzip,textOf,structure,validateDocument,validateTemplate,continuity,makePackage,readPackage};
