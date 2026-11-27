import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
export const archiveName='XRS_Test_Update_0.4.87.zip';
export const localManifest=sha256=>({version:'0.4.87',url:archiveName,sha256});
export function safeUpdateEvents(events){
 const result=[];for(const row of events){const safe={};for(const key of ['event','phase','errorCode','errorType','operation','recoveryAction'])if(typeof row[key]==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(row[key]))safe[key]=row[key];for(const key of ['expected','actual'])if(typeof row[key]==='string'&&/^[a-f0-9]{64}$/i.test(row[key]))safe[key]=row[key];for(const key of ['currentVersion','targetVersion'])if(typeof row[key]==='string'&&/^\d+\.\d+\.\d+$/.test(row[key]))safe[key]=row[key];if(Number.isSafeInteger(row.bytes)&&row.bytes>=0)safe.bytes=row.bytes;if(safe.event)result.push(safe);}return result;
}
export async function readUpdateEvents(directory){const files=(await readdir(directory)).filter(n=>/^update-.*\.log$/.test(n)).sort();const events=[];for(const name of files){for(const line of (await readFile(path.join(directory,name),'utf8')).split(/\r?\n/).filter(Boolean))events.push(JSON.parse(line));}return safeUpdateEvents(events);}
