import { describe, it, expect } from 'vitest';
import {
  resolveAmountExpression, normalizeTransactions, normalizeTxAmounts, generatePin, MIN_PIN_LENGTH, formatClaimNo, fmtDate,
} from './utils';

describe('resolveAmountExpression', () => {
  it('leaves plain numbers alone', () => {
    expect(resolveAmountExpression('500')).toEqual({ value: '500', changed: false, invalid: false });
  });

  it('adds up a "+" expression, with or without brackets', () => {
    expect(resolveAmountExpression('(200+300+200)')).toEqual({ value: '700', changed: true, invalid: false });
    expect(resolveAmountExpression('10.5 + 4.25')).toEqual({ value: '14.75', changed: true, invalid: false });
  });

  it('flags malformed expressions instead of guessing', () => {
    expect(resolveAmountExpression('200+').invalid).toBe(true);
    expect(resolveAmountExpression('2*3').invalid).toBe(false); // not a sum expression: treated as plain text
    expect(resolveAmountExpression('alert(1)+2').invalid).toBe(true);
  });
});

describe('transaction normalisation', () => {
  it('turns string amounts into numbers so totals add up instead of concatenating', () => {
    const list = normalizeTransactions([{ id: '1', amount: '500' }, { id: '2', amount: 300 }]);
    expect(list.reduce((sum, tx) => sum + tx.amount, 0)).toBe(800);
  });

  it('coerces unparseable amounts to 0', () => {
    expect(normalizeTxAmounts([{ id: '1', amount: 'abc' }])[0].amount).toBe(0);
  });

  it('gives text ids a numeric creation-time id', () => {
    const [tx] = normalizeTransactions([{ id: 'abc', amount: 1, createdAt: 1700000000000 }]);
    expect(tx.id).toBe('1700000000000');
  });

  it('returns the very same array when nothing needs repairing', () => {
    const list = [{ id: '1', amount: 1 }];
    expect(normalizeTransactions(list)).toBe(list);
  });
});

describe('generatePin', () => {
  it('makes an 8-digit numeric PIN that meets the minimum length', () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{8}$/);
      expect(pin.length).toBeGreaterThanOrEqual(MIN_PIN_LENGTH);
    }
  });
});

describe('date helpers', () => {
  it('formats claim numbers and dates', () => {
    expect(formatClaimNo('2026-10')).toBe('10/2026');
    expect(fmtDate('2026-10-02')).toBe('02-10-2026');
  });
});
