// Приглашение на встречу обычным письмом: iCalendar (RFC 5545, METHOD:REQUEST / CANCEL) внутри письма MIME.
// Outlook, Gmail, Apple и другие почтовые программы показывают такое письмо как приглашение с кнопками «Принять / Отклонить»
// и сами кладут встречу в календарь получателя. Доступ к календарю отправителя для этого не нужен — только отправка почты.

export interface Person {
  name: string
  address: string
}

export interface InviteInput {
  /** постоянный идентификатор встречи: по нему календари получателей находят её при обновлении и отмене */
  uid: string
  /** версия приглашения: растёт при каждом изменении */
  seq: number
  method: 'REQUEST' | 'CANCEL'
  title: string
  description: string
  place: string
  /** день и время по часовому поясу организатора; без времени — на весь день */
  date: string
  start: string | null
  end: string | null
  timezone: string
  lang: 'ru' | 'ka' | 'en'
  organizer: Person
  /** все участники встречи (в календаре) */
  attendees: Person[]
  /** кому уходит это письмо (при отмене для убранных из списка — только им) */
  to: Person[]
}

// ---------------------------------------------------------------------------
// Время: местное время организатора → UTC (в iCalendar пишем UTC, без описания часового пояса)
// ---------------------------------------------------------------------------
function tzOffsetMs(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs
}

export function localToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let t: number
  try {
    t = guess - tzOffsetMs(guess, tz)
    t = guess - tzOffsetMs(t, tz) // второй проход — на случай перехода на летнее время
  } catch {
    t = guess // неизвестный пояс — считаем UTC
  }
  return new Date(t)
}

const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsDay = (iso: string) => iso.replace(/-/g, '')
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const param = (s: string) => s.replace(/["\r\n]/g, '').slice(0, 200)

/** Строки iCalendar не длиннее 75 байт: перенос — CRLF и пробел. */
function fold(line: string): string {
  const enc = new TextEncoder()
  let out = ''
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (bytes + b > 74) {
      out += `${cur}\r\n `
      cur = ''
      bytes = 1
    }
    cur += ch
    bytes += b
  }
  return out + cur
}

export function buildIcs(i: InviteInput, now = new Date()): string {
  const timed = !!i.start
  const startUtc = timed ? localToUtc(i.date, i.start!, i.timezone) : null
  const endUtc = timed
    ? i.end && i.end > i.start!
      ? localToUtc(i.date, i.end, i.timezone)
      : new Date(startUtc!.getTime() + 30 * 60_000)
    : null
  const people = i.method === 'CANCEL' ? i.to : i.attendees
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//CONMAX//Calendar//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${i.method}`,
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `SEQUENCE:${i.seq}`,
    `DTSTAMP:${icsUtc(now)}`,
    timed ? `DTSTART:${icsUtc(startUtc!)}` : `DTSTART;VALUE=DATE:${icsDay(i.date)}`,
    timed ? `DTEND:${icsUtc(endUtc!)}` : `DTEND;VALUE=DATE:${icsDay(nextDay(i.date))}`,
    `SUMMARY:${esc(i.title)}`,
    ...(i.place ? [`LOCATION:${esc(i.place)}`] : []),
    ...(i.description ? [`DESCRIPTION:${esc(i.description)}`] : []),
    `ORGANIZER;CN="${param(i.organizer.name || i.organizer.address)}":mailto:${i.organizer.address}`,
    ...people.map((a) => `ATTENDEE;CN="${param(a.name || a.address)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.address}`),
    `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(i.method === 'REQUEST' && timed ? ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}

// ---------------------------------------------------------------------------
// Письмо: текст и HTML для людей, text/calendar для календарей, плюс вложение invite.ics
// ---------------------------------------------------------------------------
const L = {
  ru: { invite: 'Приглашение', update: 'Обновлено', cancel: 'Отменено', when: 'Когда', where: 'Где', organizer: 'Организатор', allDay: 'весь день', hintInvite: 'Ответьте «Принять» или «Отклонить» в своей почте или календаре.', hintCancel: 'Встреча отменена.' },
  ka: { invite: 'მოწვევა', update: 'განახლდა', cancel: 'გაუქმდა', when: 'როდის', where: 'სად', organizer: 'ორგანიზატორი', allDay: 'მთელი დღე', hintInvite: 'უპასუხეთ „მიღება“ ან „უარყოფა“ თქვენს ფოსტაში ან კალენდარში.', hintCancel: 'შეხვედრა გაუქმდა.' },
  en: { invite: 'Invitation', update: 'Updated', cancel: 'Canceled', when: 'When', where: 'Where', organizer: 'Organizer', allDay: 'all day', hintInvite: 'Reply Accept or Decline in your mail or calendar.', hintCancel: 'The meeting has been canceled.' },
}

function b64(s: string | Uint8Array): string {
  const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const wrap = (s: string) => s.replace(/.{1,76}/g, '$&\r\n')
/** Заголовок не-ASCII: закодированные слова не длиннее 75 символов (RFC 2047), по границам символов, через перенос. */
function header(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s
  const enc = new TextEncoder()
  const words: string[] = []
  let cur = ''
  for (const ch of s) {
    if (enc.encode(cur + ch).length > 42) {
      words.push(cur)
      cur = ''
    }
    cur += ch
  }
  if (cur) words.push(cur)
  return words.map((w) => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ')
}
const mailbox = (p: Person) => {
  const name = p.name.replace(/["\\\r\n]/g, '').trim()
  if (!name) return p.address
  return /^[\x20-\x7e]*$/.test(name) ? `"${name}" <${p.address}>` : `${header(name)} <${p.address}>`
}
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function whenText(i: InviteInput): string {
  const locale = i.lang === 'ka' ? 'ka-GE' : i.lang === 'en' ? 'en-GB' : 'ru-RU'
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${i.date}T12:00:00Z`))
  if (!i.start) return `${day}, ${L[i.lang].allDay}`
  return `${day}, ${i.start}${i.end ? `–${i.end}` : ''} (${i.timezone})`
}

/** Письмо целиком (MIME), закодированное в base64 — так его принимает Microsoft Graph `POST /me/sendMail`. */
export function buildInviteMime(i: InviteInput, update = false): string {
  const t = L[i.lang]
  const prefix = i.method === 'CANCEL' ? t.cancel : update ? t.update : t.invite
  const subject = `${prefix}: ${i.title}`
  const when = whenText(i)
  const hint = i.method === 'CANCEL' ? t.hintCancel : t.hintInvite
  const organizer = i.organizer.name ? `${i.organizer.name} <${i.organizer.address}>` : i.organizer.address

  const text = [subject, '', `${t.when}: ${when}`, ...(i.place ? [`${t.where}: ${i.place}`] : []), `${t.organizer}: ${organizer}`, ...(i.description ? ['', i.description] : []), '', hint].join('\r\n')
  const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${html(k)}</td><td style="padding:2px 0">${html(v)}</td></tr>`
  const htmlBody =
    `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000">` +
    `<p style="margin:0 0 8px;font-size:14pt;font-weight:bold${i.method === 'CANCEL' ? ';text-decoration:line-through' : ''}">${html(i.title)}</p>` +
    `<table style="border-collapse:collapse;font-size:11pt">${row(t.when, when)}${i.place ? row(t.where, i.place) : ''}${row(t.organizer, organizer)}</table>` +
    (i.description ? `<p style="margin:12px 0 0;white-space:pre-wrap">${html(i.description)}</p>` : '') +
    `<p style="margin:12px 0 0;color:#666">${html(hint)}</p></div>`
  const ics = buildIcs(i)

  const id = crypto.randomUUID().replace(/-/g, '')
  const mixed = `mix_${id}`
  const alt = `alt_${id}`
  const parts = [
    `From: ${mailbox(i.organizer)}`,
    `To: ${i.to.map(mailbox).join(', ')}`,
    `Subject: ${header(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(htmlBody)),
    `--${alt}`,
    `Content-Type: text/calendar; charset=UTF-8; method=${i.method}`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(ics)),
    `--${alt}--`,
    `--${mixed}`,
    `Content-Type: application/ics; name="invite.ics"`,
    `Content-Disposition: attachment; filename="invite.ics"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(ics)),
    `--${mixed}--`,
    '',
  ]
  return b64(parts.join('\r\n'))
}
