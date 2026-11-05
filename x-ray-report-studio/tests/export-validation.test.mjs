import test from 'node:test';
import assert from 'node:assert/strict';
import { hasYellowFields } from '../src/export-validation.ts';
test('exports reject yellow text and unfilled prompts but accept filled plain text',()=>{
 const doc=marks=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Текст',marks}]}]});
 assert.equal(hasYellowFields(doc([{type:'highlight',attrs:{color:'#ffff00'}}])),true);
 assert.equal(hasYellowFields(doc([{type:'templateField',attrs:{filled:false}}])),true);
 assert.equal(hasYellowFields(doc([{type:'templateField',attrs:{filled:true}}])),false);
 assert.equal(hasYellowFields(doc([{type:'highlight',attrs:{color:'#00ff00'}}])),false);
});
