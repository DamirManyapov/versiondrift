// ISO weeks for /week (the feed keeps week/<isoYear>-W<ww>.json for the last 12 weeks).
export interface IsoWeek {
  year: number;
  week: number;
  /** Monday 00:00 UTC. */
  monday: Date;
}

export function isoWeek(date: Date): IsoWeek {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: thursday.getUTCFullYear(), week, monday };
}

export const weekId = (w: { year: number; week: number }) => `${w.year}-W${String(w.week).padStart(2, '0')}`;

/** "2026-W39" → its Monday, or undefined if malformed. */
export function mondayOf(id: string): Date | undefined {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return undefined;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const monday = isoWeek(jan4).monday;
  monday.setUTCDate(monday.getUTCDate() + (Number(m[2]) - 1) * 7);
  return monday;
}

export function shiftWeek(id: string, weeks: number): string | undefined {
  const monday = mondayOf(id);
  if (!monday) return undefined;
  monday.setUTCDate(monday.getUTCDate() + weeks * 7);
  return weekId(isoWeek(monday));
}
