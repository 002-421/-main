'use strict';
// The token never crosses renderer IPC. safeStorage uses Windows DPAPI.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const fail=code=>{throw Object.assign(Error(code),{code});};
async function jsonResponse(fetchImpl,url,options={}){
 let r;try{r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});}catch{fail('GITHUB_UNAVAILABLE');}
 if(!r.ok)throw Object.assign(Error('GitHub request failed'),{code:r.status===401?'GITHUB_UNAUTHORIZED':r.status===403?'GITHUB_FORBIDDEN':r.status===404?'SOURCE_NOT_FOUND':r.status===422?'VERSION_CONFLICT':r.status===409?'GITHUB_CONFLICT':r.status===429?'GITHUB_RATE_LIMIT':r.status>=500?'GITHUB_SERVER_ERROR':'GITHUB_UNAVAILABLE',httpStatus:r.status,requestId:r.headers.get('x-github-request-id')?.replace(/[^A-Za-z0-9:-]/g,'').slice(0,100),oauthScopes:r.headers.get('x-oauth-scopes')?.split(',').map(s=>s.trim()).filter(s=>/^[a-z_:]+$/.test(s)).slice(0,30)});
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>16*1024*1024)fail('GITHUB_RESPONSE_INVALID');chunks.push(Buffer.from(chunk));}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value&&typeof value==='object')Object.defineProperty(value,'$transport',{value:{scopes:(r.headers.get('x-oauth-scopes')??'').split(',').map(s=>s.trim()).filter(s=>/^[a-z_:]+$/.test(s)).slice(0,30)},enumerable:false});return value;}catch{fail('GITHUB_RESPONSE_INVALID');}
}
function createDesktopAuth({directory,clientId,safeStorage,openExternal,fetchImpl=fetch,platform=process.platform,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const file=path.join(directory,'github-authorization.dat');let pending=null,polling=false;
 const secure=()=>{if(platform!=='win32'||!safeStorage.isEncryptionAvailable())fail('SECURE_STORAGE_UNAVAILABLE');};
 const request=(url,body)=>jsonResponse(fetchImpl,url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});
 async function token(){secure();try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('GITHUB_LOGIN_REQUIRED');const value=safeStorage.decryptString(await fs.readFile(file));if(!value||value.length>8192)fail('GITHUB_LOGIN_REQUIRED');return value;}catch{fail('GITHUB_LOGIN_REQUIRED');}}
 async function api(method,route,body){
  if(!['GET','POST','PATCH'].includes(method)||!/^\/(?:user$|repos\/002-421\/XRS-Templates(?:\/|$))/.test(route)||/[#\\]|\.\./.test(route))fail('GITHUB_ENDPOINT');
  if(method==='PATCH'&&!/^\/repos\/002-421\/XRS-Templates\/releases\/\d+$/.test(route))fail('GITHUB_ENDPOINT');
  return jsonResponse(fetchImpl,'https://api.github.com'+route,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+await token(),'X-GitHub-Api-Version':'2022-11-28',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 }
 async function identity(){const user=await api('GET','/user');if(user.login!=='002-421'||user.id!==210672295||user.type!=='User')fail('PUBLISHER_IDENTITY');const repo=await api('GET','/repos/002-421/XRS-Templates');if(repo.full_name!=='002-421/XRS-Templates'||repo.permissions?.push!==true)fail('PUBLISHER_PERMISSION');return user;}
 return {
  async status(){try{const user=await identity();return {connected:true,configured:Boolean(clientId),scopes:user.$transport?.scopes??[]};}catch(error){if(!['GITHUB_LOGIN_REQUIRED','GITHUB_UNAUTHORIZED','PUBLISHER_IDENTITY','SECURE_STORAGE_UNAVAILABLE'].includes(error.code))throw error;return {connected:false,configured:Boolean(clientId)};}},
  async begin(){secure();if(!/^[A-Za-z0-9]{16,64}$/.test(clientId??''))fail('GITHUB_OAUTH_NOT_CONFIGURED');if(pending||polling)fail('GITHUB_AUTH_BUSY');
   const data=await request('https://github.com/login/device/code',{client_id:clientId,scope:'public_repo'});
   if(typeof data.device_code!=='string'||!data.device_code||data.verification_uri!=='https://github.com/login/device'||!/^[-A-Z0-9]{4,20}$/.test(data.user_code??'')||!Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>1800)fail('GITHUB_RESPONSE_INVALID');
   const id=crypto.randomUUID();pending={id,code:data.device_code,expires:now()+data.expires_in*1000,interval:Math.max(5,Math.min(60,data.interval??5))*1000};
   try{await openExternal('https://github.com/login/device');}catch{pending=null;fail('GITHUB_BROWSER_FAILED');}return {id,userCode:data.user_code,expiresIn:data.expires_in};
  },
  cancel(){pending=null;},
  async complete(id){if(!pending||pending.id!==id||polling)fail('GITHUB_AUTH_EXPIRED');const current=pending;polling=true;
   try{while(pending===current&&now()<current.expires){await wait(current.interval);if(pending!==current)break;const data=await request('https://github.com/login/oauth/access_token',{client_id:clientId,device_code:current.code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});
    if(data.error==='authorization_pending')continue;if(data.error==='slow_down'){current.interval+=5000;continue;}if(data.error)fail(data.error==='access_denied'?'GITHUB_AUTH_DENIED':'GITHUB_AUTH_EXPIRED');
    if(typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||data.access_token.length>8192)fail('GITHUB_RESPONSE_INVALID');
    // Validate the identity before persisting the credential; do not store an unintended account.
    const user=await jsonResponse(fetchImpl,'https://api.github.com/user',{headers:{Authorization:'Bearer '+data.access_token,Accept:'application/vnd.github+json'}});
    if(user.login!=='002-421'||user.id!==210672295||user.type!=='User')fail('PUBLISHER_IDENTITY');
    if(pending!==current||now()>=current.expires)fail('GITHUB_AUTH_EXPIRED');const encrypted=safeStorage.encryptString(data.access_token);await fs.mkdir(directory,{recursive:true});const temp=file+'.'+crypto.randomUUID();try{await fs.writeFile(temp,encrypted,{mode:0o600,flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}await identity();return {connected:true,login:user.login};
   }fail('GITHUB_AUTH_EXPIRED');}finally{pending=null;polling=false;}
  },
  transport:{authorize:identity,api,async upload(tag,filePath,knownRelease){if(!/^xrs-templates-v\d+\.\d+\.\d+$/.test(tag))fail('TAG');const name=path.basename(filePath);if(!['catalog.xrszip','catalog-manifest.json'].includes(name))fail('GITHUB_ENDPOINT');const stat=await fs.lstat(filePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)fail('SIZE');if(!knownRelease?.id)fail('RELEASE_ID_REQUIRED');const release=await api('GET','/repos/002-421/XRS-Templates/releases/'+knownRelease.id);if(!release.draft||!Number.isSafeInteger(release.id))fail('RELEASE_STATE');const uploadUrl=new URL(release.upload_url?.replace(/\{.*$/, '')??`https://uploads.github.com/repos/002-421/XRS-Templates/releases/${release.id}/assets`);if(uploadUrl.origin!=='https://uploads.github.com'||uploadUrl.pathname!==`/repos/002-421/XRS-Templates/releases/${release.id}/assets`)fail('GITHUB_ENDPOINT');uploadUrl.searchParams.set('name',name);return jsonResponse(fetchImpl,uploadUrl.href,{method:'POST',headers:{Authorization:'Bearer '+await token(),Accept:'application/vnd.github+json','Content-Type':'application/octet-stream','Content-Length':String(stat.size)},body:await fs.readFile(filePath)});}}
 };
}
module.exports={createDesktopAuth};
