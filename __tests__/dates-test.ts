import { dateRangeFor, formatDisplayDate, isValidISODate, recentMonths, toISODate } from '../src/domain/dates';

describe('isValidISODate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidISODate('2026-10-22')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
  });

  it('rejects other formats', () => {
    for (const value of ['', '22-10-2026', '2026/10/22', '2026-1-2', '2026-10-22T00:00', ' 2026-10-22']) {
      expect(isValidISODate(value)).toBe(false);
    }
  });
});

describe('date helpers', () => {
  it('formats local dates without timezone shifts', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDisplayDate('2026-10-22')).toBe('22 Oct 2026');
  });

  it('builds inclusive ranges for each filter', () => {
    const today = new Date(2026, 9, 22);
    expect(dateRangeFor('all', today)).toBeNull();
    expect(dateRangeFor('month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(dateRangeFor('quarter', today)).toEqual({ from: '2026-07-22', to: '2026-10-22' });
    expect(dateRangeFor('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('clamps "last 3 months" at the end of shorter months', () => {
    expect(dateRangeFor('quarter', new Date(2026, 4, 31))?.from).toBe('2026-02-28');
  });

  it('lists recent months across a year boundary', () => {
    expect(recentMonths(new Date(2026, 1, 10))).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
