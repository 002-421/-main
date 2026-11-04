import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, formatCalculatorResult, parseCalculatorDisplay } from '../src/calculator.ts';

test('calculator parses and displays decimal commas', () => {
  assert.equal(parseCalculatorDisplay('12,5'), 12.5);
  assert.equal(formatCalculatorResult(0.1 + 0.2), '0,3');
});

test('calculator performs the four basic operations', () => {
  assert.equal(calculate(12.5, 2.5, '+'), 15);
  assert.equal(calculate(12.5, 2.5, '−'), 10);
  assert.equal(calculate(12.5, 2.5, '×'), 31.25);
  assert.equal(calculate(12.5, 2.5, '÷'), 5);
});

test('calculator reports invalid input and division by zero', () => {
  assert.throws(() => parseCalculatorDisplay('не число'), /Некорректное число/);
  assert.throws(() => calculate(10, 0, '÷'), /Деление на ноль/);
  assert.throws(() => calculate(Number.MAX_VALUE, 2, '×'), /конечным числом/);
});
