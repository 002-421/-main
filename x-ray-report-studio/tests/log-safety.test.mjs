import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {sanitizeUpdateLogEvent,sanitizeStartupLogEvent}=require('../electron/log-safety.cjs');

test('update and startup logs retain diagnostics but remove document text, names, messages and paths',()=>{
 const privateText='SYNTHETIC PATIENT REPORT MUST NOT BE LOGGED';
 const update=sanitizeUpdateLogEvent({event:'update-error',targetVersion:'0.4.57',errorCode:'EBUSY',phase:'user-data-backup',syscall:'copyfile',backupRelativePath:'profile/Local Storage/leveldb/LOCK',message:privateText,stack:privateText,url:'C:\\Users\\Doctor\\Desktop\\report.docx',patientName:privateText});
 assert.deepEqual(update,{event:'update-error',targetVersion:'0.4.57',errorCode:'EBUSY',phase:'user-data-backup',syscall:'copyfile',reason:'Resource busy'});
 const startup=sanitizeStartupLogEvent({event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200,documentText:privateText,patientName:privateText},url:privateText,logFile:privateText});
 assert.deepEqual(startup,{event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200}});
});

test('update file diagnostics retain a redacted relative profile path and operation state',()=>{
 const event=sanitizeUpdateLogEvent({event:'file-operation-error',phase:'user-data-backup',operation:'read-source-for-sha256',path:'profile/Local Storage/leveldb/Клиент Иванов/протокол.docx',errorCode:'EBUSY',syscall:'read',processState:'main-exited',attempt:3,patientName:'Иванов'});
 assert.deepEqual(event,{event:'file-operation-error',phase:'user-data-backup',operation:'read-source-for-sha256',path:'profile/Local Storage/leveldb/<redacted>/<redacted>',errorCode:'EBUSY',syscall:'read',processState:'main-exited',attempt:3,reason:'Resource busy'});
});

test('updater filesystem errors include a concise reason without passing raw paths or messages',()=>{
 const event=sanitizeUpdateLogEvent({event:'update-error',phase:'copy-electron-runtime',operation:'copy-electron-runtime',path:'C:\\Users\\Doctor\\Desktop\\XRS\\App_0.4.62\\X-ray Report Studio.exe',errorCode:'EBUSY',syscall:'copyfile',message:'SYNTHETIC PATIENT REPORT'});
 assert.deepEqual(event,{event:'update-error',phase:'copy-electron-runtime',operation:'copy-electron-runtime',path:'<redacted>/<redacted>/<redacted>/<redacted>',errorCode:'EBUSY',syscall:'copyfile',reason:'Resource busy'});
 assert.equal(JSON.stringify(event).includes('Doctor'),false);
 assert.equal(JSON.stringify(event).includes('SYNTHETIC PATIENT REPORT'),false);
});

test('pre-installer diagnostics retain safe error type and input availability only',()=>{
 const event=sanitizeUpdateLogEvent({event:'install-call-start',phase:'prepare-install',targetVersion:'0.4.68',currentRootAvailable:true,currentRootAbsolute:true,archiveAvailable:true,root:'C:\\Users\\Doctor\\App_0.4.66',message:'PRIVATE REPORT'});
 assert.deepEqual(event,{event:'install-call-start',phase:'prepare-install',targetVersion:'0.4.68',currentRootAvailable:true,currentRootAbsolute:true,archiveAvailable:true});
 const failure=sanitizeUpdateLogEvent({event:'update-error',phase:'prepare-install',operation:'invoke-install-update-archive',errorCode:'UPDATE_FAILED',errorType:'TypeError: PRIVATE REPORT',syscall:'readFile',message:'PRIVATE REPORT'});
 assert.deepEqual(failure,{event:'update-error',phase:'prepare-install',operation:'invoke-install-update-archive',errorCode:'UPDATE_FAILED',errorType:'Unknown',syscall:'readFile'});
 assert.equal(JSON.stringify(event).includes('Doctor'),false);
 assert.equal(JSON.stringify(failure).includes('PRIVATE REPORT'),false);
});

test('blocking process diagnostics retain only PID and type without profile paths or command lines',()=>{
 const event=sanitizeUpdateLogEvent({event:'update-worker-process-state',phase:'wait-for-profile-idle',processState:'other-process-running',processCount:1,waitedMs:5000,blockingProcesses:[{pid:123,parentPid:12,name:'X-ray Report Studio.exe',processType:'electron-renderer',matchesInstall:true,matchesProfile:true,matchesWorker:false,commandLine:'patient text',executablePath:'C:\\Users\\Doctor\\MRI Report Studio'}]});
 assert.deepEqual(event,{event:'update-worker-process-state',phase:'wait-for-profile-idle',processState:'other-process-running',processCount:1,waitedMs:5000,blockingProcesses:[{pid:123,parentPid:12,processType:'electron-renderer',matchesInstall:true,matchesProfile:true,matchesWorker:false}]});
 assert.equal(JSON.stringify(event).includes('Doctor'),false);
 assert.equal(JSON.stringify(event).includes('patient text'),false);
});

test('renderer diagnostic frames exclude messages, code text, paths and secrets',()=>{
 const value=sanitizeStartupLogEvent({event:'renderer-exception',errorType:'TypeError',frames:['12:34','SYNTHETIC PATIENT','file:///secret.ts:12:34'],message:'PRIVATE REPORT',stack:'PRIVATE REPORT'});
 assert.deepEqual(value,{event:'renderer-exception',errorType:'TypeError',frames:['12:34']});
});
