import { describe, it, expect } from 'vitest';
import { escapeCsvValue } from '@/lib/volatilityScans';

describe('escapeCsvValue', () => {
  it('returns an empty string for null/undefined', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('leaves a plain negative number untouched (not a formula-injection risk)', () => {
    // drop_pct/change_pct are routinely negative numbers, not free text -
    // Excel/Sheets already parses "-6.32" as a number, so prefixing it
    // with a leading apostrophe would wrongly turn it into text.
    expect(escapeCsvValue(-6.32)).toBe('-6.32');
  });

  it('leaves a plain positive number untouched', () => {
    expect(escapeCsvValue(42)).toBe('42');
  });

  it('prefixes a leading apostrophe on a string starting with =, +, -, or @', () => {
    expect(escapeCsvValue('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsvValue('+1234')).toBe("'+1234");
    expect(escapeCsvValue('-Acme AG')).toBe("'-Acme AG");
    expect(escapeCsvValue('@Acme')).toBe("'@Acme");
  });

  it('quotes a formula-like string that also needs comma/quote escaping', () => {
    // The apostrophe prefix is applied first, then the result is
    // comma/quote-escaped like any other value: '=A1,"B1"' becomes
    // '=A1,"B1"' (prefixed), then every " is doubled and the whole
    // thing is wrapped in an outer pair of quotes.
    const prefixed = `'=A1,"B1"`;
    const expected = `"${prefixed.replace(/"/g, '""')}"`;
    expect(escapeCsvValue('=A1,"B1"')).toBe(expected);
  });

  it('leaves an ordinary string untouched', () => {
    expect(escapeCsvValue('Nestle')).toBe('Nestle');
  });

  it('still escapes commas, quotes, and newlines as before', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('a"b')).toBe('"a""b"');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
  });
});
