// Calendar dates are stored as local `YYYY-MM-DD` strings, which sort and
// compare correctly as plain text in SQLite.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// "2026-10-22" -> "22 Oct 2026". Avoids Intl so it behaves the same on every device.
export function formatDisplayDate(value: string): string {
  if (!isValidISODate(value)) {
    return value;
  }
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

// "2026-10" -> "Oct 2026"
export function formatDisplayMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ISO timestamp -> "14:05" today, otherwise "22 Oct 2026, 14:05" (local time).
export function formatSavedAt(timestamp: string, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = toISODate(date);
  return day === toISODate(now) ? time : `${formatDisplayDate(day)}, ${time}`;
}

export type DateFilter = 'all' | 'month' | 'quarter' | 'year';

export interface DateRange {
  from: string;
  to: string;
}

// Inclusive surgery-date range for a filter, relative to `today`.
export function dateRangeFor(filter: DateFilter, today: Date): DateRange | null {
  const year = today.getFullYear();
  const month = today.getMonth();
  switch (filter) {
    case 'all':
      return null;
    case 'month':
      return { from: toISODate(new Date(year, month, 1)), to: toISODate(new Date(year, month + 1, 0)) };
    case 'quarter': {
      // Clamp the day so e.g. 31 May minus three months is 28/29 Feb, not early March.
      const lastDayThreeMonthsAgo = new Date(year, month - 2, 0).getDate();
      const from = new Date(year, month - 3, Math.min(today.getDate(), lastDayThreeMonthsAgo));
      return { from: toISODate(from), to: toISODate(today) };
    }
    case 'year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}

// The current month and the five before it, oldest first, as "YYYY-MM".
export function recentMonths(today: Date, count = 6): string[] {
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    months.push(toISODate(new Date(today.getFullYear(), today.getMonth() - offset, 1)).slice(0, 7));
  }
  return months;
}
