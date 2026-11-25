'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const p=require('./lib/template-protocol.cjs'),{fetchBytes}=require('./lib/template-transport.cjs');
const REPO='002-421/XRS-Templates',PREFIX=`https://github.com/${REPO}/releases/download/`;
const gh=args=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:4*1024*1024});
async function main(){const meta=p.parse(await fs.readFile('out/publication.json'));p.check(/^(?:test-)?catalog-v\d+\.\d+\.\d+$/.test(meta.tag),'TAG');
 // An existing tag or Release is never moved, overwritten or reused.
 const refs=JSON.parse(gh(['api',`repos/${REPO}/git/matching-refs/tags/${meta.tag}`]));p.check(!refs.some(r=>r.ref===`refs/tags/${meta.tag}`),'IMMUTABLE_TAG_EXISTS');
 const head=process.env.GITHUB_SHA;p.check(/^[a-f0-9]{40}$/.test(head),'PUBLICATION_SHA');
 gh(['api','--method','POST',`repos/${REPO}/git/refs`,'-f',`ref=refs/tags/${meta.tag}`,'-f',`sha=${head}`]);
 const files=(await fs.readdir('out')).filter(f=>f!=='publication.json').sort();p.check(files.length>=2,'FILES');
 const args=['release','create',meta.tag,'--repo',REPO,'--verify-tag','--draft','--title',`XRS templates ${meta.catalogVersion} (${meta.channel})`,'--notes',`Approved template data. Updated: ${meta.updated}; added: ${meta.added}. Medical approval is required separately from technical validation.`,...files.map(f=>path.join('out',f))];if(meta.channel==='test')args.push('--prerelease');gh(args);
 const release=JSON.parse(gh(['api',`repos/${REPO}/releases/tags/${meta.tag}`]));p.check(release.draft&&release.assets.length===files.length,'RELEASE_ASSETS');
 // GitHub-provided digest is checked before making the draft public.
 for(const file of files){const expected='sha256:'+p.sha256(await fs.readFile(path.join('out',file)));const asset=release.assets.find(a=>a.name===file);p.check(asset&&asset.digest===expected,'UPLOADED_ASSET_HASH');}
 gh(['release','edit',meta.tag,'--repo',REPO,'--draft=false',meta.channel==='stable'?'--latest=true':'--latest=false']);
 for(const file of files){const expected=await fs.readFile(path.join('out',file));const downloaded=await fetchBytes(PREFIX+meta.tag+'/'+file,Math.max(expected.length,1),{allowedPrefixes:[PREFIX]});p.check(p.sha256(downloaded)===p.sha256(expected),'PUBLIC_HASH');}
 const verified=JSON.parse(gh(['api',`repos/${REPO}/releases/tags/${meta.tag}`]));p.check(!verified.draft&&verified.prerelease===(meta.channel==='test'),'RELEASE_STATUS');console.log(`PUBLISHED ${meta.channel} ${meta.catalogVersion}: verified public hashes.`);
}
main().catch(e=>{console.error(e.code??'RELEASE_FAILED');console.error('STOP. If a public Release already exists, publication may be partial. Do not retag or retry automatically.');process.exitCode=1;});
