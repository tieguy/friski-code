// Functional core: pure date formatting helpers for article/subject rendering.

/** Format a Date (or null/undefined) as YYYY-MM-DD using UTC to avoid tz drift. */
export function formatYmd(d: Date | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
