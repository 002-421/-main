import test from 'node:test';import assert from 'node:assert/strict';import {normalizeDateInput} from '../src/date-input.ts';
test('date commas become dots without modifying decimal measurements',()=>{
 assert.equal(normalizeDateInput('Дата рождения: 20,01,2026'),'Дата рождения: 20.01.2026');
 assert.equal(normalizeDateInput('1,2 см; 20,01.2026; 05.11,2026'),'1,2 см; 20.01.2026; 05.11.2026');
 assert.equal(normalizeDateInput('0,25 см, 50,20,2026'),'0,25 см, 50,20,2026');
});
