import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBytes} from '../electron/template-transport.cjs';
const prefix='https://example.invalid/releases/';
test('transport accepts bounded trusted HTTPS data and rejects arbitrary origins, credentials and oversized responses',async()=>{
 const config={allowedPrefixes:[prefix],fetchImpl:async()=>new Response('abc')};assert.equal((await fetchBytes(prefix+'package',3,config)).toString(),'abc');await assert.rejects(()=>fetchBytes('https://other.invalid/pkg',3,config),/SOURCE_NOT_TRUSTED/);await assert.rejects(()=>fetchBytes(prefix+'../../elsewhere',3,config),/SOURCE_NOT_TRUSTED/);await assert.rejects(()=>fetchBytes('https://u:p@example.invalid/releases/a',3,config),/URL/);await assert.rejects(()=>fetchBytes(prefix+'package',2,config),/NETWORK_SIZE/);
});
test('redirects never introduce an arbitrary host or insecure protocol; bounded GitHub asset redirects are supported',async()=>{
 const config={allowedPrefixes:[prefix],fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://example.invalid/releases/x'}})};await assert.rejects(()=>fetchBytes(prefix+'a',3,config),/URL/);
 await assert.rejects(()=>fetchBytes(prefix+'a',3,{...config,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://outside.invalid/x'}})}),/REDIRECT_NOT_TRUSTED/);
 let calls=0;const github='https://github.com/002-421/XRS-Templates/releases/';assert.equal((await fetchBytes(github+'download/tag/file',3,{allowedPrefixes:[github],fetchImpl:async()=>++calls===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/file?signature=synthetic'}}):new Response('abc')})).toString(),'abc');assert.equal(calls,2);
});
test('network failure and not-found are distinct safe codes, never response body/URL secrets',async()=>{
 await assert.rejects(()=>fetchBytes(prefix+'private',10,{allowedPrefixes:[prefix],fetchImpl:async()=>{throw Error('secret response body')}}),e=>e.code==='NETWORK_UNAVAILABLE'&&!e.message.includes('secret'));
 await assert.rejects(()=>fetchBytes(prefix+'missing',10,{allowedPrefixes:[prefix],fetchImpl:async()=>new Response(null,{status:404})}),e=>e.code==='SOURCE_NOT_FOUND');
});
