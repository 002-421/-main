/** Safe candidate generator. Never writes the catalog or a user profile. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectTemplateDocx} from '../src/template-docx.ts';
import {reportTemplates,makeTemplateDocument} from '../src/catalog.ts';
import {editableHighlightStructure} from '../src/template-highlights.ts';
const [input,reportPath,candidatePath]=process.argv.slice(2);
if(!input||!reportPath)throw Error('Usage: node scripts/inspect-template-integration.mjs approved.docx report.json [candidate.json]');
const bytes=new Uint8Array(await readFile(input));
const sourceSha256=createHash('sha256').update(bytes).digest('hex');
let report;
try{
 const row=await inspectTemplateDocx(bytes,reportTemplates.map(t=>({...t,doc:makeTemplateDocument(t.id)})));
 report={format:'xrs-template-integration-report',schemaVersion:1,status:row.status==='conflict'?'BLOCKED':'DONE',templateId:row.id,templateVersion:row.templateVersion,sourceSha256,baseSha256:row.baseSha256,currentSha256:row.currentSha256,structure:editableHighlightStructure(row.after),warnings:row.warnings,candidateWritten:false};
 if(candidatePath&&row.status==='changed'){await writeFile(candidatePath,JSON.stringify({templateId:row.id,sourceSha256,baseSha256:row.baseSha256,doc:row.after},null,2)+'\n');report.candidateWritten=true;}
}catch(error){report={format:'xrs-template-integration-report',schemaVersion:1,status:'BLOCKED',sourceSha256,error:String(error.message),candidateWritten:false};}
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(`${report.status}: integration report written; candidate written: ${report.candidateWritten}`);
if(report.status==='BLOCKED')process.exitCode=1;
