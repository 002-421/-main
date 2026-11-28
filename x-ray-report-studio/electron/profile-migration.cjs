'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root){const files=[];const walk=(dir)=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('PROFILE_SYMLINK');if(stat.isDirectory())walk(file);else if(stat.isFile())files.push({name:path.relative(root,file),size:stat.size,sha256:digest(fs.readFileSync(file))});else throw Error('PROFILE_FILE_TYPE');}};walk(root);return files;}
function migrateProfile(appData){const previous=path.join(appData,'MRI Report Studio'),target=path.join(appData,'XRS'),staging=path.join(appData,'XRS-migration-staging');
 if(fs.existsSync(target))return {directory:target,migrated:false};
 if(!fs.existsSync(previous))return {directory:target,migrated:false};
 // Keep any interrupted copy for recovery; never replace it silently.
 if(fs.existsSync(staging))return {directory:previous,migrated:false,error:'PROFILE_MIGRATION_INTERRUPTED'};
 try{const before=inventory(previous);fs.cpSync(previous,staging,{recursive:true,errorOnExist:true,force:false});const after=inventory(staging);if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(before)!==JSON.stringify(inventory(previous)))throw Error('PROFILE_CHANGED');fs.renameSync(staging,target);return {directory:target,migrated:true,files:before.length};}catch(error){return {directory:previous,migrated:false,error:error.code??error.message};}
}
module.exports={migrateProfile,inventory};
