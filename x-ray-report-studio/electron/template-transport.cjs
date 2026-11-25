'use strict';
const p=require('./template-protocol.cjs');
// The caller supplies a reviewed source configuration, never a renderer URL.
// The same signed data can be served by an approved HTTPS clinic mirror.
async function fetchBytes(input,limit,{allowedPrefixes,fetchImpl=fetch,timeoutMs=30000}={}){
 p.check(Number.isSafeInteger(limit)&&limit>0&&limit<=p.LIMITS.archive,'SIZE');const original=p.httpsUrl(input);p.check(Array.isArray(allowedPrefixes)&&allowedPrefixes.some(prefix=>original.href.startsWith(p.httpsUrl(prefix).href)&&original.origin===p.httpsUrl(prefix).origin),'SOURCE_NOT_TRUSTED');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let url=original;
 try{for(let redirects=0;redirects<=4;redirects++){
 const response=await fetchImpl(url.href,{redirect:'manual',signal:controller.signal,headers:{Accept:'application/octet-stream','Cache-Control':'no-cache'}});
 if([301,302,303,307,308].includes(response.status)){
 const location=response.headers.get('location');await response.body?.cancel();p.check(location,'REDIRECT');const next=p.httpsUrl(new URL(location,url).href);
 const githubAsset=original.hostname==='github.com'&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname);
 p.check((next.origin===original.origin&&allowedPrefixes.some(prefix=>next.href.startsWith(prefix)))||githubAsset,'REDIRECT_NOT_TRUSTED');url=next;continue;
 }
 if(!response.ok){await response.body?.cancel();p.fail(response.status===404?'SOURCE_NOT_FOUND':'NETWORK_STATUS');}const size=Number(response.headers.get('content-length'));p.check(!size||Number.isSafeInteger(size)&&size>=0&&size<=limit,'NETWORK_SIZE');
 let total=0;const chunks=[];p.check(response.body,'NETWORK_BODY');for await(const chunk of response.body){total+=chunk.length;if(total>limit){controller.abort();p.fail('NETWORK_SIZE');}chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
 }p.fail('TOO_MANY_REDIRECTS');
 }catch(e){if(e.name==='TemplateProtocolError')throw e;p.fail(controller.signal.aborted?'NETWORK_TIMEOUT':'NETWORK_UNAVAILABLE');}finally{clearTimeout(timer);}
}
module.exports={fetchBytes};
