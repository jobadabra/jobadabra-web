// The day a Central Scout board fact was read, checked before the site stores it as the fact's day (api/employers.js boardFactsOf).
/** The day a Scout fact was read (YYYY-MM-DD), checked against the publish date `date`: '' when the fact sent none (an older engine: the publish date is its day),
 *  null when it is no date, after `date` or older than `days` before it (that fact is refused, never the publish).
 *  Why (14 Nov 2026, zb for sa, jobadabra#4346): the publish date was every fact's day, so each publish moved a board's day forward: one read on 13 Nov was served
 *  dated 14 Nov, installs ordered it as fresh (src/ai/board_ideas.py) and it stayed until 30 days after the Scout stopped sending it, up to ~60 days after its read. */
export function readDayOf(raw, date, days) {
  if (raw === undefined || raw === null) return '';
  const value = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || value > date) return null;
  return value < new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10) ? null : value;
}
