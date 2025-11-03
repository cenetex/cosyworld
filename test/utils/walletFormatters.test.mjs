import { describe, it, expect } from 'vitest';
import { formatAddress, formatTokenAmount, formatLargeNumber } from '../../src/utils/walletFormatters.mjs';

describe('walletFormatters', () => {
  describe('formatAddress', () => {
    it('abbreviates long addresses', () => {
      expect(formatAddress('9xMQ7F2SeXmUwZd6aQhS1sLSsJmp5GnVbmskQwT9N1m4')).toEqual('9xMQ...N1m4');
    });

    it('returns short strings unchanged', () => {
      expect(formatAddress('short')).toEqual('short');
    });

    it('handles non-string input', () => {
      expect(formatAddress(null)).toBeNull();
      expect(formatAddress(undefined)).toBeUndefined();
    });
  });

  describe('formatTokenAmount', () => {
    it('converts lamports to UI amount with default decimals', () => {
      expect(formatTokenAmount(1_500_000_000n).replace(/,/g, '')).toEqual('1.5');
    });

    it('respects custom decimals', () => {
      expect(formatTokenAmount(123456789, 2)).toEqual('1,234,567.89');
    });

    it('returns "0" for non-numeric inputs', () => {
      expect(formatTokenAmount('not-a-number')).toEqual('0');
    });
  });

  describe('formatLargeNumber', () => {
    it('formats billions', () => {
      expect(formatLargeNumber(1_234_000_000)).toEqual('1.23B');
    });

    it('formats millions', () => {
      expect(formatLargeNumber(2_500_000)).toEqual('2.50M');
    });

    it('formats thousands', () => {
      expect(formatLargeNumber(12_345)).toEqual('12.35K');
    });

    it('falls back to two decimals for small numbers', () => {
      expect(formatLargeNumber(12.3)).toEqual('12.30');
    });

    it('handles non-numeric inputs', () => {
      expect(formatLargeNumber('NaN value')).toEqual('0');
    });
  });
});
