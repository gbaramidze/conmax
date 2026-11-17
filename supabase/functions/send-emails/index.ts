// Воркер исходящей почты: забирает письма из очереди (claim_emails), отправляет по SMTP, отмечает итог.
// Вызывается раз в минуту из БД (pg_cron → pg_net) с секретом в заголовке x-worker-secret.
// Локально SMTP — Mailpit (http://127.0.0.1:54324), настройки в supabase/functions/.env.
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'
import { Buffer } from 'node:buffer'
import { asLang, trData, trTitle, type Lang } from '../_shared/i18n.ts'
import { inBackground } from '../_shared/background.ts'

const SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'
const APP_URL = (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')
const FROM = Deno.env.get('SMTP_FROM') ?? 'CONMAX <noreply@buildos.local>'

interface Notification {
  title: string
  body: string | null
  priority: string
  category: string
  event_type: string
  entity_type: string | null
  entity_id?: string | null
  entity_key: string | null
  project_code: string | null
  actor_name: string | null
  link?: string | null
}
interface TaskInfo {
  id: string
  key: string
  title: string
  due_date: string | null
}
interface DigestItem {
  title: string
  body: string | null
  category: string
  priority: string
  entity_key: string | null
  project_code: string | null
  entity_type: string | null
  entity_id?: string | null
  link?: string | null
}
interface QueueItem {
  id: string
  kind: 'instant' | 'digest'
  to: string
  name: string | null
  /** users.locale получателя: письмо собирается на его языке */
  locale?: string | null
  attempts: number
  notification?: Notification
  task?: TaskInfo | null
  items?: DigestItem[]
  /** файлы комментария, из-за которого пришло уведомление */
  attachments?: QueueFile[]
}
interface QueueFile {
  name: string
  mime: string
  size: number
  storage_key: string
}
interface LoadedFile extends QueueFile {
  content: Buffer
  cid?: string
}

// В письмо кладём не больше стольких файлов и стольких байт; остальное остаётся в приложении по ссылке
const MAX_FILES = 8
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const FILES_BUCKET = 'files'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Постоянные тексты письма на трёх языках; тексты самих уведомлений переводит trData по словарю сайта. */
const S = {
  assigned: { ru: 'Назначено вам', ka: 'მოგანიჭეს', en: 'Assigned to you' },
  mentioned: { ru: 'Упоминание', ka: 'ხსენება', en: 'Mention' },
  watching: { ru: 'Наблюдаете', ka: 'თვალს ადევნებთ', en: 'Following' },
  escalation: { ru: 'Эскалация', ka: 'ესკალაცია', en: 'Escalation' },
  digest: { ru: 'Дайджест', ka: 'დაიჯესტი', en: 'Digest' },
  system: { ru: 'Система', ka: 'სისტემა', en: 'System' },
  open: { ru: 'Открыть в CONMAX', ka: 'გახსნა CONMAX-ში', en: 'Open in CONMAX' },
  openPlain: { ru: 'Открыть', ka: 'გახსნა', en: 'Open' },
  settings: { ru: 'Настроить уведомления', ka: 'შეტყობინებების პარამეტრები', en: 'Notification settings' },
  due: { ru: 'Срок', ka: 'ვადა', en: 'Due' },
  digestSubject: { ru: 'Сводка CONMAX', ka: 'CONMAX-ის მიმოხილვა', en: 'CONMAX digest' },
  digestHeading: { ru: 'За сутки накопилось', ka: 'დღის განმავლობაში დაგროვდა', en: 'Over the last day' },
  events1: { ru: 'событие', ka: 'მოვლენა', en: 'event' },
  eventsN: { ru: 'событий', ka: 'მოვლენა', en: 'events' },
  files: { ru: 'Вложения', ka: 'დანართები', en: 'Attachments' },
  moreFiles: { ru: 'Ещё файлов: {n} — откройте в приложении', ka: 'კიდევ ფაილი: {n} — გახსენით აპლიკაციაში', en: 'More files: {n} — open them in the app' },
} as const
const t = (key: keyof typeof S, lang: Lang) => S[key][lang]
const CATEGORIES = ['assigned', 'mentioned', 'watching', 'escalation', 'digest', 'system']

function link(n: { entity_type: string | null; entity_id?: string | null; entity_key: string | null; project_code: string | null; link?: string | null }): string {
  // у уведомления есть своя ссылка (заметка с площадки, инспекция…) — ведём туда; только внутренние пути приложения
  if (n.link && n.link.startsWith('/') && !n.link.startsWith('//')) return `${APP_URL}${n.link}`
  if (!n.project_code) return APP_URL
  if (n.entity_type === 'task' && n.entity_key) return `${APP_URL}/projects/${n.project_code}/task/${n.entity_key}`
  if (n.entity_type === 'document' && n.entity_id) return `${APP_URL}/projects/${n.project_code}/document/${n.entity_id}`
  if (n.entity_type === 'meeting' && n.entity_id) return `${APP_URL}/projects/${n.project_code}/meeting/${n.entity_id}`
  if (n.entity_type === 'field_note' && n.entity_id) return `${APP_URL}/projects/${n.project_code}/note/${n.entity_id}`
  if (n.entity_type === 'location' && n.entity_key) return `${APP_URL}/projects/${n.project_code}/locations/${n.entity_key}`
  return `${APP_URL}/projects/${n.project_code}`
}

function layout(heading: string, inner: string, lang: Lang): string {
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f2f3f1;font-family:Arial,Helvetica,sans-serif;color:#14181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dcdedb;border-radius:8px">
<tr><td style="background:#14181b;color:#ffc20e;padding:14px 20px;font-weight:bold;border-radius:8px 8px 0 0">CONMAX</td></tr>
<tr><td style="padding:20px"><h1 style="font-size:18px;margin:0 0 12px">${esc(heading)}</h1>${inner}</td></tr>
<tr><td style="padding:12px 20px;font-size:12px;color:#6b716d;border-top:1px solid #eceeeb">${esc(t('settings', lang))}: <a href="${APP_URL}/settings/notifications" style="color:#6b716d">${APP_URL}/settings/notifications</a></td></tr>
</table></td></tr></table></body></html>`
}

const button = (url: string, label: string) =>
  `<p style="margin:16px 0 0"><a href="${url}" style="background:#ffc20e;color:#14181b;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:6px;display:inline-block">${esc(label)}</a></p>`

/** Событие «срок» для календаря: весь день, без привязки к часовому поясу. */
function ics(task: TaskInfo, url: string, lang: Lang): string | null {
  if (!task.due_date) return null
  const d = task.due_date.replaceAll('-', '')
  const next = new Date(`${task.due_date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const end = next.toISOString().slice(0, 10).replaceAll('-', '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc2 = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CONMAX//RU',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:task-${task.id}@buildos`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${esc2(`${S.due[lang]}: ${task.key} ${task.title}`)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

const fileSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/** Скачивает файлы комментария из хранилища (службной ролью) в пределах лимитов; возвращает загруженные и число оставшихся в приложении. */
async function loadFiles(supabase: ReturnType<typeof createClient>, list: QueueFile[]): Promise<{ files: LoadedFile[]; skipped: number }> {
  const files: LoadedFile[] = []
  let total = 0
  let skipped = 0
  for (const f of list) {
    if (files.length >= MAX_FILES || total + f.size > MAX_TOTAL_BYTES) {
      skipped++
      continue
    }
    const { data, error } = await supabase.storage.from(FILES_BUCKET).download(f.storage_key)
    if (error || !data) {
      skipped++
      continue
    }
    const content = Buffer.from(await data.arrayBuffer())
    total += content.length
    files.push({ ...f, content, cid: f.mime.startsWith('image/') ? `att${files.length}@conmax` : undefined })
  }
  return { files, skipped }
}

function composeInstant(q: QueueItem, loaded: { files: LoadedFile[]; skipped: number }) {
  const lang = asLang(q.locale)
  const n = q.notification!
  const url = link(n)
  const title = trTitle(n.title, lang)
  const body = trData(n.body, lang)
  const subject = `${title}${body ? ` — ${body}` : ''}`.slice(0, 150)
  const category = CATEGORIES.includes(n.category) ? t(n.category as keyof typeof S, lang) : n.category

  // файлы: фото показываем прямо в письме (и прикладываем), остальные — списком; всё прикреплено к письму
  const images = loaded.files.filter((f) => f.cid)
  const others = loaded.files.filter((f) => !f.cid)
  const more = loaded.skipped > 0 ? t('moreFiles', lang).replace('{n}', String(loaded.skipped)) : ''
  const filesHtml =
    loaded.files.length + loaded.skipped > 0
      ? `<div style="margin:14px 0 0">${images.map((f) => `<img src="cid:${f.cid}" alt="${esc(f.name)}" style="display:block;max-width:100%;max-height:320px;border-radius:6px;margin:0 0 8px;border:1px solid #dcdedb">`).join('')}${
          others.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:#6b716d">${esc(t('files', lang))}: ${others.map((f) => `${esc(f.name)} (${fileSize(f.size)})`).join(', ')}</p>` : ''
        }${more ? `<p style="margin:8px 0 0;font-size:13px;color:#6b716d">${esc(more)}</p>` : ''}</div>`
      : ''
  const html = layout(
    title,
    `<p style="margin:0 0 4px;color:#6b716d;font-size:12px">${esc(category)}</p>
     <p style="margin:0;font-size:15px;line-height:1.5">${esc(body)}</p>${filesHtml}${button(url, t('open', lang))}`,
    lang,
  )
  const filesText = loaded.files.length > 0 ? `\n\n${t('files', lang)}: ${loaded.files.map((f) => f.name).join(', ')}${more ? `\n${more}` : ''}` : more ? `\n\n${more}` : ''
  const text = `${title}\n${body}${filesText}\n\n${t('openPlain', lang)}: ${url}\n\n${t('settings', lang)}: ${APP_URL}/settings/notifications`
  const wantsCalendar = q.task && q.task.due_date && /^task\.(assigned|overdue|due_changed)/.test(n.event_type)
  const attachments = loaded.files.map((f) => ({ filename: f.name, content: f.content, contentType: f.mime, ...(f.cid ? { cid: f.cid, contentDisposition: 'inline' as const } : {}) }))
  return { subject, html, text, icalEvent: wantsCalendar ? ics(q.task!, url, lang) : null, attachments }
}

function composeDigest(q: QueueItem) {
  const lang = asLang(q.locale)
  const items = q.items ?? []
  const byProject = new Map<string, DigestItem[]>()
  for (const i of items) byProject.set(i.project_code ?? '—', [...(byProject.get(i.project_code ?? '—') ?? []), i])
  const rank = (i: DigestItem) => (i.priority === 'critical' ? 0 : i.priority === 'high' ? 1 : 2)

  let inner = ''
  let text = ''
  for (const [code, list] of byProject) {
    list.sort((a, b) => rank(a) - rank(b))
    inner += `<h2 style="font-size:14px;margin:18px 0 6px">${esc(code)}</h2><ul style="padding-left:18px;margin:0">`
    text += `\n${code}\n`
    for (const i of list) {
      const url = link(i)
      const title = trTitle(i.title, lang)
      const body = trData(i.body, lang)
      inner += `<li style="margin:0 0 6px"><a href="${url}" style="color:#14181b;font-weight:bold">${esc(title)}</a><br><span style="color:#6b716d;font-size:13px">${esc(body)}</span></li>`
      text += ` • ${title}${body ? ` — ${body}` : ''}\n   ${url}\n`
    }
    inner += '</ul>'
  }
  const events = items.length === 1 ? t('events1', lang) : t('eventsN', lang)
  const subject = `${t('digestSubject', lang)}: ${items.length} ${events}`
  return { subject, html: layout(`${t('digestHeading', lang)}: ${items.length}`, inner, lang), text: `${subject}\n${text}`, icalEvent: null, attachments: [] }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })

  // Без адреса SMTP письмо уходило «на себя» (ECONNREFUSED 127.0.0.1:587) и копилось как failed: говорим прямо и ничего не забираем из очереди.
  // Локально (APP_URL — localhost) по умолчанию почтовый ящик разработки Mailpit.
  const smtpHost = Deno.env.get('SMTP_HOST') || (APP_URL.includes('localhost') || APP_URL.includes('192.168.') ? 'supabase_inbucket_buildos' : '')
  if (!smtpHost) return Response.json({ error: 'SMTP не настроен: задайте SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM в .env.functions' }, { status: 500 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('claim_emails', { p_limit: 20 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const queue = (data ?? []) as QueueItem[]
  if (queue.length === 0) return Response.json({ sent: 0, failed: 0 })

  const user = Deno.env.get('SMTP_USER')
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: Number(Deno.env.get('SMTP_PORT') || 1025),
    secure: Deno.env.get('SMTP_SECURE') === 'true',
    auth: user ? { user, pass: Deno.env.get('SMTP_PASS') ?? '' } : undefined,
  })

  // отправка по SMTP занимает секунды на письмо — в фоне, чтобы не задерживать другие запросы базы (push) в pg_net
  return inBackground('send-emails', async () => {
  let sent = 0
  let failed = 0
  for (const q of queue) {
    try {
      const mail = q.kind === 'instant' ? composeInstant(q, await loadFiles(supabase, q.attachments ?? [])) : composeDigest(q)
      await transport.sendMail({
        from: FROM,
        to: q.name ? `"${q.name.replace(/"/g, '')}" <${q.to}>` : q.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
        icalEvent: mail.icalEvent ? { method: 'PUBLISH', content: mail.icalEvent } : undefined,
        headers: { 'List-Unsubscribe': `<${APP_URL}/settings/notifications>` },
      })
      await supabase.rpc('finish_email', { p_id: q.id, p_ok: true })
      sent++
    } catch (e) {
      await supabase.rpc('finish_email', { p_id: q.id, p_ok: false, p_error: String(e instanceof Error ? e.message : e) })
      failed++
    }
  }
  return { sent, failed }
  })
})
