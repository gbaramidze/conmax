// Воркер исходящей почты: забирает письма из очереди (claim_emails), отправляет по SMTP, отмечает итог.
// Вызывается раз в минуту из БД (pg_cron → pg_net) с секретом в заголовке x-worker-secret.
// Локально SMTP — Mailpit (http://127.0.0.1:54324), настройки в supabase/functions/.env.
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

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
  entity_key: string | null
  project_code: string | null
  actor_name: string | null
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
}
interface QueueItem {
  id: string
  kind: 'instant' | 'digest'
  to: string
  name: string | null
  attempts: number
  notification?: Notification
  task?: TaskInfo | null
  items?: DigestItem[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CATEGORY: Record<string, string> = {
  assigned: 'Назначено вам',
  mentioned: 'Упоминание',
  watching: 'Наблюдаете',
  escalation: 'Эскалация',
  digest: 'Дайджест',
  system: 'Система',
}

function link(n: { entity_type: string | null; entity_key: string | null; project_code: string | null }): string {
  if (!n.project_code) return APP_URL
  if (n.entity_type === 'task' && n.entity_key) return `${APP_URL}/projects/${n.project_code}/task/${n.entity_key}`
  return `${APP_URL}/projects/${n.project_code}`
}

function layout(heading: string, inner: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f2f3f1;font-family:Arial,Helvetica,sans-serif;color:#14181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dcdedb;border-radius:8px">
<tr><td style="background:#14181b;color:#ffc20e;padding:14px 20px;font-weight:bold;border-radius:8px 8px 0 0">CONMAX</td></tr>
<tr><td style="padding:20px"><h1 style="font-size:18px;margin:0 0 12px">${esc(heading)}</h1>${inner}</td></tr>
<tr><td style="padding:12px 20px;font-size:12px;color:#6b716d;border-top:1px solid #eceeeb">Настроить уведомления: <a href="${APP_URL}/settings/notifications" style="color:#6b716d">${APP_URL}/settings/notifications</a></td></tr>
</table></td></tr></table></body></html>`
}

const button = (url: string, label: string) =>
  `<p style="margin:16px 0 0"><a href="${url}" style="background:#ffc20e;color:#14181b;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:6px;display:inline-block">${esc(label)}</a></p>`

/** Событие «срок» для календаря: весь день, без привязки к часовому поясу. */
function ics(task: TaskInfo, url: string): string | null {
  if (!task.due_date) return null
  const d = task.due_date.replaceAll('-', '')
  const next = new Date(`${task.due_date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const end = next.toISOString().slice(0, 10).replaceAll('-', '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const t = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
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
    `SUMMARY:${t(`Срок: ${task.key} ${task.title}`)}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

function composeInstant(q: QueueItem) {
  const n = q.notification!
  const url = link(n)
  const subject = `${n.title}${n.body ? ` — ${n.body}` : ''}`.slice(0, 150)
  const html = layout(
    n.title,
    `<p style="margin:0 0 4px;color:#6b716d;font-size:12px">${esc(CATEGORY[n.category] ?? n.category)}</p>
     <p style="margin:0;font-size:15px;line-height:1.5">${esc(n.body ?? '')}</p>${button(url, 'Открыть в CONMAX')}`,
  )
  const text = `${n.title}\n${n.body ?? ''}\n\nОткрыть: ${url}\n\nНастройки уведомлений: ${APP_URL}/settings/notifications`
  const wantsCalendar = q.task && q.task.due_date && /^task\.(assigned|overdue|due_changed)/.test(n.event_type)
  return { subject, html, text, icalEvent: wantsCalendar ? ics(q.task!, url) : null }
}

function composeDigest(q: QueueItem) {
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
      inner += `<li style="margin:0 0 6px"><a href="${url}" style="color:#14181b;font-weight:bold">${esc(i.title)}</a><br><span style="color:#6b716d;font-size:13px">${esc(i.body ?? '')}</span></li>`
      text += ` • ${i.title}${i.body ? ` — ${i.body}` : ''}\n   ${url}\n`
    }
    inner += '</ul>'
  }
  const subject = `Сводка CONMAX: ${items.length} ${items.length === 1 ? 'событие' : 'событий'}`
  return { subject, html: layout(`За сутки накопилось: ${items.length}`, inner), text: `${subject}\n${text}`, icalEvent: null }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('claim_emails', { p_limit: 20 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const queue = (data ?? []) as QueueItem[]
  if (queue.length === 0) return Response.json({ sent: 0, failed: 0 })

  const user = Deno.env.get('SMTP_USER')
  const transport = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'supabase_inbucket_buildos',
    port: Number(Deno.env.get('SMTP_PORT') ?? 1025),
    secure: Deno.env.get('SMTP_SECURE') === 'true',
    auth: user ? { user, pass: Deno.env.get('SMTP_PASS') ?? '' } : undefined,
  })

  let sent = 0
  let failed = 0
  for (const q of queue) {
    try {
      const mail = q.kind === 'instant' ? composeInstant(q) : composeDigest(q)
      await transport.sendMail({
        from: FROM,
        to: q.name ? `"${q.name.replace(/"/g, '')}" <${q.to}>` : q.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
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
  return Response.json({ sent, failed })
})
