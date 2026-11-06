import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTemplateDocument,reportTemplates} from '../src/catalog.ts';
test('all MRI and CT templates justify the description including study title and conclusion',()=>{
 for(const template of reportTemplates){
  const doc=makeTemplateDocument(template.id);let boundary=0,paragraphs=0;
  for(const node of doc.content){
   if(node.type==='horizontalRule'){boundary++;continue;}
   if((boundary===1||/^(?:Область и вид исследования|Вид исследования|ЗАКЛЮЧЕНИЕ)\s*:/i.test(node.content?.map(n=>n.text??'').join('')??''))&&node.type==='paragraph'){assert.equal(node.attrs.textAlign,'justify',template.id);paragraphs++;}
  }
  assert.ok(paragraphs>0,template.id);
 }
});

test('protocol title, physician and date keep their own alignment',async()=>{
 const {justifyDescription}=await import('../src/description-alignment.ts');
 const p=(text,textAlign)=>({type:'paragraph',attrs:{textAlign},content:[{type:'text',text}]});
 const input={type:'doc',content:[p('Протокол МРТ','center'),p('Вид исследования: МРТ','left'),p('Описание','left'),p('ЗАКЛЮЧЕНИЕ: норма','left'),p('Рекомендована консультация','left'),p('Врач: Иванов','left'),p('Дата: 06.11.2026','left')]};
 const doc=justifyDescription(input);
 const paragraphs=doc.content.filter(n=>n.type==='paragraph');
 assert.deepEqual(paragraphs.map(n=>n.attrs.textAlign),['center','justify','justify','justify','justify','left','left']);
 assert.equal(input.content[2].attrs.textAlign,'left');
});
