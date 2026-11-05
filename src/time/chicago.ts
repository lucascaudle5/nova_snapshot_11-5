// Lucas's home time zone and local-day arithmetic. SQLite has no time zone database, so the Worker computes each
// local day's UTC bounds here and passes them to the views (docs/PREFERENCES.md: America/Chicago, midnight start).
export const HOME_ZONE = 'America/Chicago'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HOME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
})

function parts(ms: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const out: Record<string, number> = {}
  for (const part of formatter.formatToParts(new Date(ms))) if (part.type !== 'literal') out[part.type] = Number(part.value)
  return { year: out.year ?? 0, month: out.month ?? 0, day: out.day ?? 0, hour: out.hour ?? 0, minute: out.minute ?? 0, second: out.second ?? 0 }
}

/** Offset of the home zone from UTC at an instant, in milliseconds (negative for Chicago). */
function offsetMs(ms: number): number {
  const p = parts(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The local calendar date (YYYY-MM-DD) in the home zone for an instant. */
export function localDateOf(instant: Date): string {
  const p = parts(instant.getTime())
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

/** UTC instant (ms) of local midnight at the start of a local date. */
function startOfLocalDate(year: number, month: number, day: number): number {
  const guess = Date.UTC(year, month - 1, day)
  let start = guess - offsetMs(guess)
  start = guess - offsetMs(start) // re-evaluate once so a day that begins across a DST change is exact
  return start
}

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = datePattern.exec(localDate)
  if (!match) throw new RangeError('local date must be YYYY-MM-DD')
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new RangeError('local date does not exist')
  return { year, month, day }
}

/** UTC start (inclusive) and end (exclusive) instants of a local day in the home zone, as ISO strings with milliseconds. */
export function localDayBounds(localDate: string): { start_utc: string; end_utc: string } {
  const { year, month, day } = parseLocalDate(localDate)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const start = startOfLocalDate(year, month, day)
  const end = startOfLocalDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
  return { start_utc: new Date(start).toISOString(), end_utc: new Date(end).toISOString() }
}
