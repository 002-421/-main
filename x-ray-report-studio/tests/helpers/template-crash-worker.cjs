'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const p=require('../../electron/template-protocol.cjs'),{TemplateCatalogStore}=require('../../electron/template-catalog-store.cjs');
(async()=>{const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const store=new TemplateCatalogStore({...config,directory:config.directory,fetchBytes:async url=>fs.readFile(path.join(config.fixtures,p.sha256(Buffer.from(url))+'.zip')),fault:async stage=>{if(stage===config.crashAt)process.exit(73);}});const plan=await store.check(await fs.readFile(config.manifest));await store.install(plan.planId,true);process.exitCode=74;})().catch(e=>{console.error(e.code??e.message);process.exitCode=75;});
