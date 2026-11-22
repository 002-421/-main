import test from 'node:test';import assert from 'node:assert/strict';
import {printVariants,choosePrintLayout,PrintLayoutError} from '../src/print-layout.ts';
import {preparePrintDocument} from '../src/print-document.ts';
import {exportDocx} from '../src/docx.ts';
import {unzipSync,strFromU8} from 'fflate';
const doc={type:'doc',attrs:{fontFamily:'Arial',fontSizePt:11},content:[{type:'paragraph',attrs:{fontSizePt:11,spaceBeforePt:12,spaceAfterPt:12,lineHeight:1.2},content:[{type:'text',text:'Синтетическое описание справа 6 мм.',marks:[{type:'textStyle',attrs:{fontFamily:'Arial',fontSize:'14.66667px'}}]}]}]};
test('candidates stay within ±1 pt; minimum is 9 pt for a 10 pt base; disabling optimization leaves formatting untouched',()=>{
 const original=structuredClone(doc),variants=printVariants(doc,true);assert.deepEqual(variants.filter(v=>v.delta).map(v=>v.delta),[-.5,-1,.5,1]);assert.ok(variants.every(v=>Math.abs(v.document.attrs.fontSizePt-11)<=1));assert.deepEqual(printVariants(doc,false).map(v=>v.document),[doc]);assert.deepEqual(doc,original);
 const small=structuredClone(doc);small.attrs.fontSizePt=10;small.content[0].attrs.fontSizePt=10;small.content[0].content[0].marks[0].attrs.fontSize='13.333333px';assert.ok(printVariants(small,true).every(v=>v.document.attrs.fontSizePt>=9));assert.ok(printVariants(small,true).some(v=>v.document.attrs.fontSizePt===9));
});
test('selection minimizes pages and then favors original readable formatting; enlargement cannot add a page',()=>{
 const render=d=>({html:'synthetic',metrics:{safe:true,pages:d.attrs.fontSizePt<=10.5?1:2,descriptionOnConclusion:true}});const best=choosePrintLayout(doc,true,render);assert.equal(best.delta,-.5);assert.equal(best.metrics.pages,1);
 const same=choosePrintLayout(doc,true,()=>({html:'synthetic',metrics:{pages:2,safe:true,descriptionOnConclusion:true}}));assert.equal(same.name,'original');
 const enlarged=choosePrintLayout(doc,true,d=>({html:'synthetic',metrics:{pages:2,safe:true,descriptionOnConclusion:d.attrs.fontSizePt===12}}));assert.equal(enlarged.delta,1);assert.equal(enlarged.metrics.pages,2);
});
test('manual run fonts and sizes exclude font resizing; impossible layouts return a diagnostic without altering the report',()=>{
 const custom=structuredClone(doc);custom.content[0].content[0].marks[0].attrs={fontFamily:'Times New Roman',fontSize:'18.6667px'};assert.ok(printVariants(custom,true).every(v=>v.delta===0));const before=structuredClone(custom);assert.throws(()=>choosePrintLayout(custom,true,()=>{throw new Error('Synthetic oversized row');}),PrintLayoutError);assert.deepEqual(custom,before);
});
test('the last description and conclusion share a real page before page count breaks ties',()=>{
 const variant=choosePrintLayout(doc,true,d=>({html:'synthetic',metrics:{safe:true,pages:d.attrs.fontSizePt<11?3:2,descriptionOnConclusion:d.attrs.fontSizePt<11}}));
 assert.equal(variant.delta,-.5);
 assert.equal(variant.metrics.descriptionOnConclusion,true);
 const baseline=choosePrintLayout(doc,false,()=>({html:'synthetic',metrics:{safe:true,pages:2,descriptionOnConclusion:false}}));
 assert.equal(baseline.name,'original','disabled optimization never changes user formatting');
});
test('an optimized 11 to 10 pt report changes body size but preserves the 10.5 pt page number and measured margin',async()=>{
 const plan=choosePrintLayout(doc,true,d=>({html:'synthetic',metrics:{safe:true,pages:d.attrs.fontSizePt===10?1:2,descriptionOnConclusion:true}}));
 assert.equal(plan.delta,-1);assert.equal(plan.document.content[0].attrs.fontSizePt,10);
 assert.ok(Math.abs(parseFloat(plan.document.content[0].content[0].marks[0].attrs.fontSize)*.75-10)<.01);
 const blob=await exportDocx(plan.document,{templateId:'head-gm',printBox:{width:850,height:899}});
 const parts=unzipSync(new Uint8Array(await blob.arrayBuffer()));
 const xml=strFromU8(parts['word/document.xml']);
 const footer=strFromU8(parts['word/footer1.xml']);
 assert.match(xml,/<w:sz w:val="20"\s*\/>/,'actual DOCX uses 10 pt for the optimized text run');
 assert.match(footer,/<w:sz w:val="21"\/><w:szCs w:val="21"\/><\/w:rPr><w:fldChar/,'page number remains 10.5 pt in the DOCX footer');
 const bottom=Number(xml.match(/<w:pgMar\b[^>]*w:bottom="(\d+)"/)?.[1]);
 assert.equal(bottom,915,'the bottom margin remains the existing printBox-derived value');
});
test('oversized graphic objects fit the printable area proportionally without scaling medical text',()=>{
 const input=structuredClone(doc);input.content.push({type:'image',attrs:{src:'synthetic',width:1700,height:2000}});const before=structuredClone(input),printed=preparePrintDocument(input),image=printed.content.at(-1);assert.ok(image.attrs.width<1700);assert.ok(Math.abs(image.attrs.width/image.attrs.height-1700/2000)<1e-12);assert.deepEqual(input,before);assert.equal(printed.content[0].content[0].marks[0].attrs.fontSize,'14.66667px');
});
