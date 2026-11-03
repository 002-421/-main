export type CalculatorOperation = '+' | '−' | '×' | '÷';

export function parseCalculatorDisplay(value: string): number {
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number)) throw new TypeError('Некорректное число.');
  return number;
}

export function formatCalculatorResult(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Результат не является конечным числом.');
  return String(Number(value.toPrecision(12))).replace('.', ',');
}

export function calculate(left: number, right: number, operation: CalculatorOperation): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError('Операнды должны быть конечными числами.');
  let result: number;
  switch (operation) {
    case '+': result = left + right; break;
    case '−': result = left - right; break;
    case '×': result = left * right; break;
    case '÷':
      if (right === 0) throw new RangeError('Деление на ноль.');
      result = left / right;
      break;
  }
  if (!Number.isFinite(result)) throw new RangeError('Результат не является конечным числом.');
  return Number(result.toPrecision(12));
}
