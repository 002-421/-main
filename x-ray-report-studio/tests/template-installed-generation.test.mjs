import test from 'node:test';import assert from 'node:assert/strict';
import {applyTemplateCatalog,makeTemplateDocument,reportTemplates,networkTemplateSource} from '../src/catalog.ts';
test('rollback controls new report content while administrator can inspect latest approved source',()=>{
 const id=reportTemplates[0].id,doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
 const base={id,areaId:'synthetic',areaTitle:'Synthetic only',title:'Synthetic only',description:'',templateVersion:'0.0.1',doc:doc('Installed prior approved content')};
 const latest={...base,templateVersion:'0.0.2',doc:doc('Latest approved content')};
 try{
  applyTemplateCatalog([base],[latest]);
  assert.deepEqual(makeTemplateDocument(id),base.doc,'new report uses installed generation after rollback');
  assert.equal(reportTemplates.find(row=>row.id===id).templateVersion,'0.0.1');
  assert.deepEqual(networkTemplateSource(id),latest,'publication source remains latest approved version');
  const edited=makeTemplateDocument(id);edited.content[0].content[0].text='Synthetic report edit';assert.deepEqual(makeTemplateDocument(id),base.doc);
 }finally{applyTemplateCatalog([]);}
});
