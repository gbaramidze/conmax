import { currentLocale } from '@/lib/i18n'
/**
 * Время совещаний всегда показывается и вводится по часовому поясу проекта (площадки),
 * а не по поясу браузера: иначе «пн 11:00» у руководителя и у прораба будет разным временем.
 */

const pad = (n: number) => String(n).padStart(2, '0')

function zonedParts(t: number, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t))
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]))
}

/** Смещение пояса от UTC в миллисекундах на момент t. */
function offsetMs(t: number, tz: string): number {
  const p = zonedParts(t, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000
}

/** «2026-10-26T11:00» в поясе tz → момент времени в ISO. */
export function zonedToIso(local: string, tz: string): string {
  const [d, t] = local.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, day, h, mi)
  let utc = guess - offsetMs(guess, tz)
  utc = guess - offsetMs(utc, tz) // второй проход — на случай перехода на летнее время
  return new Date(utc).toISOString()
}

/** Момент времени → «YYYY-MM-DDTHH:mm» в поясе tz (формат поля datetime-local). */
export function isoToZoned(iso: string, tz: string): string {
  const p = zonedParts(new Date(iso).getTime(), tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** День недели (1 — понедельник … 7 — воскресенье) для строки «YYYY-MM-DD…». */
export function isoDow(local: string): number {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? 7 : dow
}

/** Завтра в 10:00 по времени проекта — значение по умолчанию для нового совещания. */
export function defaultStart(tz: string): string {
  return isoToZoned(new Date(Date.now() + 24 * 3600_000).toISOString(), tz).slice(0, 11) + '10:00'
}

export function formatIn(iso: string, tz: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone: tz }).format(new Date(iso))
}
