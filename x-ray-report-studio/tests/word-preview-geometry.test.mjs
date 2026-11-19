import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {exportDocx} from '../src/docx.ts';
import {wordPreviewGeometry} from '../src/word-preview.ts';

test('Word preview section millimetres match actual exported OOXML including default margins and print box',async()=>{
 for(const attrs of [{},{marginLeftMm:25,marginRightMm:19.3,pageWidthMm:210,marginTopMm:45,fontSizePt:12}]){
  const doc={type:'doc',attrs:{sourceFormat:'alliance-template',...attrs},content:[{type:'paragraph',content:[{type:'text',text:'Synthetic geometry'}]}]};
  const box={width:640,height:840,imageHeight:800},snapshot=structuredClone(doc);
  const layout=wordPreviewGeometry(doc,box),blob=await exportDocx(doc,{templateId:'head-gm',printBox:box});
  const xml=strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']);
  const size=xml.match(/<w:pgSz\b[^>]*>/)[0],margins=xml.match(/<w:pgMar\b[^>]*>/)[0];
  const mm=(tag,key)=>Number(tag.match(new RegExp(`w:${key}="(\\d+)"`))[1])*25.4/1440;
  for(const [name,actual] of [['widthMm',mm(size,'w')],['heightMm',mm(size,'h')],['leftMm',mm(margins,'left')],['rightMm',mm(margins,'right')],['topMm',mm(margins,'top')],['bottomMm',mm(margins,'bottom')]])assert.ok(Math.abs(layout[name]-actual)<1e-9,`${name}: ${layout[name]} != ${actual}`);
  assert.deepEqual(doc,snapshot);
 }
});
