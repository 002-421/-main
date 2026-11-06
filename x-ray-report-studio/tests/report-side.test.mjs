import test from 'node:test';import assert from 'node:assert/strict';
import {titleWithStudySide,studyTitleText} from '../src/report-side.ts';
import {reportTemplates} from '../src/catalog.ts';
const doc=(heading,body='')=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Вид исследования: '+heading}]},{type:'paragraph',content:[{type:'text',text:body}]}]});
test('selected heading side suffix ignores body and unresolved or bilateral choices',()=>{
 const template=doc('МРТ правого / левого голеностопного сустава');
 assert.equal(titleWithStudySide('ГС',template,doc('МРТ левого голеностопного сустава','Правого сустава без изменений')),'ГС лев');
 assert.equal(titleWithStudySide('ГС',template,doc('МРТ правого голеностопного сустава')),'ГС пр');
 assert.equal(titleWithStudySide('ГС',template,template),'ГС');
 assert.equal(titleWithStudySide('ГС',template,doc('МРТ обоих суставов')),'ГС');
 assert.equal(titleWithStudySide('ГС',doc('МРТ левого сустава'),doc('МРТ левого сустава')),'ГС');
});
test('all catalog templates with side alternatives support both selected sides',()=>{
 let count=0;
 for(const template of reportTemplates){const heading=studyTitleText(template.doc);if(!/правого\s*\/\s*левого/i.test(heading))continue;count++;
  const left=doc(heading.replace(/^(?:Область и вид исследования|Вид исследования)\s*:/i,'').replace(/правого\s*\/\s*левого/gi,'левого'));
  const right=doc(heading.replace(/^(?:Область и вид исследования|Вид исследования)\s*:/i,'').replace(/правого\s*\/\s*левого/gi,'правого'));
  assert.equal(titleWithStudySide(template.title,template.doc,left),template.title+' лев',template.id);
  assert.equal(titleWithStudySide(template.title,template.doc,right),template.title+' пр',template.id);
 }
 assert.ok(count>0);
});
