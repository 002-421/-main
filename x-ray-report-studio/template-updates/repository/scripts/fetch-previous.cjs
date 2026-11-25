'use strict';
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const p=require('./lib/template-protocol.cjs');
const {fetchBytes}=require('./lib/template-transport.cjs');
const PREFIX='https://github.com/002-421/XRS-Templates/releases/download/';
async function main(){const channel=process.env.CATALOG_CHANNEL;p.check(['stable','test'].includes(channel),'CHANNEL');
 // List all release pages via authenticated API. A network or permission failure
 // is NOT equivalent to a first release. Do not catch and ignore API failures.
 const releases=JSON.parse(execFileSync('gh',['api','--paginate','--slurp','repos/002-421/XRS-Templates/releases?per_page=100'],{encoding:'utf8',maxBuffer:4*1024*1024})).flat();
 const candidates=releases.filter(r=>!r.draft&&(channel==='test'?/^test-catalog-v/.test(r.tag_name):/^catalog-v/.test(r.tag_name)));
 candidates.sort((a,b)=>p.compare(b.tag_name.replace(/^(?:test-)?catalog-v/,''),a.tag_name.replace(/^(?:test-)?catalog-v/,'')));
 if(!candidates.length)return;const latest=candidates[0],asset=latest.assets.find(a=>a.name==='manifest.json');p.check(asset,'PREVIOUS_MANIFEST_MISSING');const data=await fetchBytes(asset.browser_download_url,p.LIMITS.json,{allowedPrefixes:[PREFIX]});await fs.writeFile('previous-manifest.json',data);
}
main().catch(e=>{console.error(e.code??'PREVIOUS_CATALOG_FETCH_FAILED');process.exitCode=1;});
