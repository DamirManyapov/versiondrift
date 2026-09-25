// ISO weeks, for the weekly digests the feed keeps (v1/week/<isoYear>-W<ww>.json).
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7),
  };
}

/** Ids of the `count` most recent ISO weeks, newest first: ["2026-W39", "2026-W38", …]. */
export function recentWeeks(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const { year, week } = isoWeek(new Date(now.getTime() - i * 7 * 86_400_000));
    return `${year}-W${String(week).padStart(2, '0')}`;
  });
}
