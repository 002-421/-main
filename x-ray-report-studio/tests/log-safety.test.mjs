import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {sanitizeUpdateLogEvent,sanitizeStartupLogEvent}=require('../electron/log-safety.cjs');

test('update and startup logs retain safe failure phase and OS cause but remove messages, document text, names and paths',()=>{
 const privateText='SYNTHETIC PATIENT REPORT MUST NOT BE LOGGED';
 const update=sanitizeUpdateLogEvent({event:'install-error',targetVersion:'0.4.55',phase:'create-extraction-temp',code:'EACCES',syscall:'mkdtemp',backupRelativePath:'profile/Local Storage/leveldb/LOCK',message:privateText,stack:privateText,url:'C:\\Users\\Doctor\\Desktop\\report.docx',patientName:privateText});
 assert.deepEqual(update,{event:'install-error',targetVersion:'0.4.55',phase:'create-extraction-temp',code:'EACCES',syscall:'mkdtemp',reason:'Access denied'});
 const startup=sanitizeStartupLogEvent({event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200,documentText:privateText,patientName:privateText},url:privateText,logFile:privateText});
 assert.deepEqual(startup,{event:'renderer-ready',details:{appRoot:true,templateCount:55,textLength:3200}});
});

test('update logs do not invent an OS cause when an error code is absent',()=>{
 assert.deepEqual(sanitizeUpdateLogEvent({event:'update-error',phase:'validate-package',message:'private text',stack:'private text'}),{event:'update-error',phase:'validate-package'});
});
