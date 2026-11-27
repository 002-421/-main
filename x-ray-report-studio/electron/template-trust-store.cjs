'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const p=require('./template-protocol.cjs');
const {atomic,boundedRead}=require('./template-catalog-store.cjs');
function verifyChain(anchor,envelopes,{now=Date.now(),fresh=false}={}){
 p.validateRoot(anchor,now,false);p.check(Array.isArray(envelopes)&&envelopes.length<=64,'ROOT_CHAIN_LIMIT');
 let root=anchor;const roots=[anchor];
 for(const auth of envelopes){if(auth?.signed?.version<=anchor.version){if(auth.signed.version===anchor.version)p.check(p.canonical(auth.signed)===p.canonical(anchor),'ROOT_ANCHOR');continue;}p.check(auth?.signed?.version===root.version+1,'ROOT_SEQUENCE');
  // Old intermediates may expire after a valid later rotation. Every transition
  // still needs both old and new root thresholds; freshness applies to the tip.
  const at=Math.min(now,Date.parse(auth.signed.expiresAt)-1);p.check(Number.isFinite(at),'ROOT');
  root=p.rotateRoot(root,auth,at);roots.push(root);
 }
 p.validateRoot(root,now,fresh);return {root,roots};
}
class TemplateTrustStore{
 constructor({directory,anchor,now=()=>Date.now()}){this.directory=directory;this.anchor=anchor;this.now=now;this.envelopes=[];this.roots=anchor?[anchor]:[];this.root=anchor;this.queue=Promise.resolve();}
 async load(){p.check(this.anchor,'TRUST_NOT_CONFIGURED');let envelopes=[];try{const saved=p.parse(await boundedRead(path.join(this.directory,'root-chain.json'),p.LIMITS.json));p.keys(saved,['schemaVersion','anchorSha256','envelopes']);p.check(saved.schemaVersion===1&&saved.anchorSha256===p.sha256(p.bytes(this.anchor)),'ROOT_ANCHOR');envelopes=saved.envelopes;}catch(error){if(error.code!=='ENOENT')throw error;}
  const checked=verifyChain(this.anchor,envelopes,{now:this.now()});Object.assign(this,checked,{envelopes});return this.root;
 }
 update(raw){const snapshot=Buffer.from(raw);const pending=this.queue.then(()=>this.updateSerialized(snapshot));this.queue=pending.catch(()=>{});return pending;}
 async updateSerialized(raw){const data=p.parse(raw);p.keys(data,['schemaVersion','type','envelopes']);p.check(data.schemaVersion===1&&data.type==='xrs-template-root-chain','ROOT_CHAIN');
  const checked=verifyChain(this.anchor,data.envelopes,{now:this.now(),fresh:true});p.check(checked.root.version>=this.root.version,'ROOT_REPLAY');
  p.check(data.envelopes.length>=this.envelopes.length&&this.envelopes.every((old,i)=>p.canonical(old)===p.canonical(data.envelopes[i])),'ROOT_EQUIVOCATION');
  await fs.mkdir(this.directory,{recursive:true});await atomic(path.join(this.directory,'root-chain.json'),p.bytes({schemaVersion:1,anchorSha256:p.sha256(p.bytes(this.anchor)),envelopes:data.envelopes}));
  Object.assign(this,checked,{envelopes:data.envelopes});return this.root;
 }
 historical(auth,role){for(const root of [...this.roots].reverse()){try{p.verify(auth,root,role);return root;}catch(error){if(error.code!=='SIGNATURE')throw error;}}p.fail('SIGNATURE');}
}
module.exports={TemplateTrustStore,verifyChain};
