import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {sanitizeUpdateLogEvent,sanitizeStartupLogEvent}=require('../electron/log-safety.cjs');

test('update and startup logs retain diagnostics but remove document text, names, messages and paths',()=>{
 const privateText='SYNTHETIC PATIENT REPORT MUST NOT BE LOGGED';
 const update=sanitizeUpdateLogEvent({event:'update-error',targetVersion:'0.4.57',errorCode:'EBUSY',phase:'user-data-backup',syscall:'copyfile',backupRelativePath:'profile/Local Storage/leveldb/LOCK',message:privateText,stack:privateText,url:'C:\\Users\\Doctor\\Desktop\\report.docx',patientName:privateText});
 assert.deepEqual(update,{event:'update-error',targetVersion:'0.4.57',errorCode:'EBUSY',phase:'user-data-backup',syscall:'copyfile'});
 const startup=sanitizeStartupLogEvent({event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200,documentText:privateText,patientName:privateText},url:privateText,logFile:privateText});
 assert.deepEqual(startup,{event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200}});
});

test('update file diagnostics retain a redacted relative profile path and operation state',()=>{
 const event=sanitizeUpdateLogEvent({event:'file-operation-error',phase:'user-data-backup',operation:'read-source-for-sha256',path:'profile/Local Storage/leveldb/Клиент Иванов/протокол.docx',errorCode:'EBUSY',syscall:'read',processState:'main-exited',attempt:3,patientName:'Иванов'});
 assert.deepEqual(event,{event:'file-operation-error',phase:'user-data-backup',operation:'read-source-for-sha256',path:'profile/Local Storage/leveldb/<redacted>/<redacted>',errorCode:'EBUSY',syscall:'read',processState:'main-exited',attempt:3});
});
