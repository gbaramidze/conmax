import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { fetchAll } from '@/lib/fetch-all'
import { supabase } from '@/lib/supabase'
import { locationLabel, type LocationRow } from '@/features/locations/api'

export interface NoteFile {
  id: string
  name: string
  mime: string
  size_bytes: number
  storage_key: string
  status: string
}

/** Заметка с площадки: комментарий к месту + адресат, статус и связь с задачей (таблица field_notes). */
export interface NoteRow {
  comment_id: string
  status: 'open' | 'done'
  created_at: string
  resolved_at: string | null
  location_id: string
  task_id: string | null
  author_id: string
  addressee_user_id: string | null
  addressee_org_id: string | null
  comment: { body_text: string; visibility: 'internal' | 'external'; attachments: { file: NoteFile | null }[] } | null
  author: { id: string; full_name: string } | null
  addressee: { id: string; full_name: string } | null
  org: { id: string; name: string } | null
  task: { key: string } | null
}

const NOTE_COLUMNS =
  'comment_id, status, created_at, resolved_at, location_id, task_id, author_id, addressee_user_id, addressee_org_id, ' +
  'comment:comments!comment_id(body_text, visibility, attachments(file:files(id, name, mime, size_bytes, storage_key, status))), ' +
  'author:users!author_id(id, full_name), addressee:users!addressee_user_id(id, full_name), org:organizations!addressee_org_id(id, name), task:tasks!task_id(key)'

/** Все заметки проекта, новые сверху. Фильтры и статистика считаются на странице: их сотни, а не десятки тысяч. */
export const notesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['notes', projectId],
    queryFn: async () =>
      (
        await fetchAll<NoteRow>((from, to) =>
          supabase.from('field_notes').select(NOTE_COLUMNS).eq('project_id', projectId).order('created_at', { ascending: false }).range(from, to),
        )
      ).filter((n) => n.comment),
  })

/** Кому адресована заметка: сотруднику либо подрядчику (организации), либо никому. Пустая строка — вид выбран, человек ещё нет. */
export interface Addressee {
  user: string | null
  org: string | null
}
export const NO_ADDRESSEE: Addressee = { user: null, org: null }

/** Адресат выбран полностью (вид «никому» тоже полный; «сотруднику» без человека — нет). */
export const addresseeReady = (a: Addressee) => a.user !== '' && a.org !== ''

/** Значение для RPC: пустой выбор превращается в «никому». */
export const addresseeIds = (a: Addressee): { user: string | null; org: string | null } => ({ user: a.user || null, org: a.org || null })

export function notePhotos(n: NoteRow): NoteFile[] {
  return (n.comment?.attachments ?? []).map((a) => a.file).filter((f): f is NoteFile => !!f && f.mime.startsWith('image/') && f.status === 'ready')
}

/** Адресат, как его показывать: «Иванов И.» или «ООО Подряд». Пусто — заметка ни для кого. */
export function noteAddresseeName(n: NoteRow): string | null {
  return n.addressee?.full_name ?? n.org?.name ?? null
}

export async function registerNote(input: { commentId: string; userId: string | null; orgId: string | null; taskId?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('register_field_note', {
    p_comment: input.commentId,
    p_user: (input.userId ?? undefined) as never,
    p_org: (input.orgId ?? undefined) as never,
    p_task: (input.taskId ?? undefined) as never,
  })
  if (error) throw error
}

export async function setNoteStatus(commentId: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_field_note_status', { p_comment: commentId, p_done: done })
  if (error) throw error
}

export async function setNoteAddressee(commentId: string, userId: string | null, orgId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_field_note_addressee', {
    p_comment: commentId,
    p_user: (userId ?? undefined) as never,
    p_org: (orgId ?? undefined) as never,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Фильтры
// ---------------------------------------------------------------------------

export const NOTE_FILTERS = ['open', 'mine', 'reported', 'stale', 'done', 'all'] as const
export type NoteFilter = (typeof NOTE_FILTERS)[number]

export const NOTE_FILTER_LABELS: Record<NoteFilter, string> = {
  open: tr('Открытые'),
  mine: tr('Мне'),
  reported: tr('Мои'),
  stale: tr('Висят долго'),
  done: tr('Закрытые'),
  all: tr('Все'),
}

export const NOTE_PERIODS = ['all', '7', '30'] as const
export type NotePeriod = (typeof NOTE_PERIODS)[number]
export const NOTE_PERIOD_LABELS: Record<NotePeriod, string> = {
  all: tr('За всё время'),
  '7': tr('За 7 дней'),
  '30': tr('За 30 дней'),
}

/** Открытая заметка «висит долго», если ей больше этого числа дней. */
export const STALE_DAYS = 7

export interface NoteParams {
  filter: NoteFilter
  /** 'any' | 'none' (без адресата-организации) | id организации */
  org: string
  /** 'any' | 'none' | id сотрудника-адресата */
  who: string
  /** 'any' | id автора */
  author: string
  /** 'any' | id места: заметки этого места и всех вложенных */
  location: string
  period: NotePeriod
  photo: boolean
  q: string
}

export const DEFAULT_NOTE_PARAMS: NoteParams = { filter: 'open', org: 'any', who: 'any', author: 'any', location: 'any', period: 'all', photo: false, q: '' }

const DAY = 86_400_000

export interface NoteContext {
  me: string
  myOrg: string | null
  now: number
  locations: LocationRow[]
}

const underPath = (path: string, root: string) => path === root || path.startsWith(`${root}.`)

/** Условия фильтров, кроме статуса: на них опирается и статистика (она показывает и открытые, и закрытые). */
export function matchesScope(n: NoteRow, p: NoteParams, ctx: NoteContext): boolean {
  if (p.org === 'none' ? n.addressee_org_id !== null : p.org !== 'any' && n.addressee_org_id !== p.org) return false
  if (p.who === 'none' ? n.addressee_user_id !== null : p.who !== 'any' && n.addressee_user_id !== p.who) return false
  if (p.author !== 'any' && n.author_id !== p.author) return false
  if (p.period !== 'all' && ctx.now - new Date(n.created_at).getTime() > Number(p.period) * DAY) return false
  if (p.photo && notePhotos(n).length === 0) return false
  if (p.location !== 'any') {
    const root = ctx.locations.find((l) => l.id === p.location)
    const loc = ctx.locations.find((l) => l.id === n.location_id)
    if (!root || !loc || !underPath(loc.path, root.path)) return false
  }
  const q = p.q.trim().toLowerCase()
  if (q) {
    const hay = `${n.comment?.body_text ?? ''} ${noteAddresseeName(n) ?? ''} ${n.author?.full_name ?? ''} ${n.task?.key ?? ''} ${locationLabel(ctx.locations.find((l) => l.id === n.location_id)?.path, ctx.locations)}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function isStale(n: NoteRow, now: number): boolean {
  return n.status === 'open' && now - new Date(n.created_at).getTime() > STALE_DAYS * DAY
}

export function matchesStatus(n: NoteRow, filter: NoteFilter, ctx: NoteContext): boolean {
  switch (filter) {
    case 'open':
      return n.status === 'open'
    case 'done':
      return n.status === 'done'
    case 'reported':
      return n.author_id === ctx.me
    case 'mine':
      return n.status === 'open' && (n.addressee_user_id === ctx.me || (!!ctx.myOrg && n.addressee_org_id === ctx.myOrg))
    case 'stale':
      return isStale(n, ctx.now)
    default:
      return true
  }
}

/** Сколько условий кроме статуса включено: число на кнопке «Фильтры» на телефоне. */
export function activeScopeCount(p: NoteParams): number {
  return [p.org !== 'any', p.who !== 'any', p.author !== 'any', p.location !== 'any', p.period !== 'all', p.photo].filter(Boolean).length
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

export interface BarStat {
  key: string
  label: string
  open: number
  done: number
}

export interface NoteStats {
  total: number
  open: number
  done: number
  stale: number
  created7: number
  closed7: number
  withPhoto: number
  /** среднее время от создания до закрытия, часы; null — закрытых нет */
  avgCloseHours: number | null
  byAddressee: BarStat[]
  byFloor: BarStat[]
  byAuthor: BarStat[]
  /** последние 14 дней: сколько создано и закрыто в каждый день (от старых к новым) */
  byDay: { date: string; created: number; closed: number }[]
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function bump(map: Map<string, BarStat>, key: string, label: string, status: 'open' | 'done') {
  const row = map.get(key) ?? { key, label, open: 0, done: 0 }
  row[status] += 1
  map.set(key, row)
}

const byTotal = (a: BarStat, b: BarStat) => b.open + b.done - (a.open + a.done) || b.open - a.open || a.label.localeCompare(b.label)

/** Этаж, к которому относится место: само место, если это этаж, иначе ближайший этаж выше по дереву. */
export function floorOf(locationId: string, byId: Map<string, LocationRow>): LocationRow | null {
  let cur = byId.get(locationId) ?? null
  for (let i = 0; cur && i < 20; i++) {
    if (cur.kind === 'floor') return cur
    cur = cur.parent_id ? (byId.get(cur.parent_id) ?? null) : null
  }
  return null
}

export function computeNoteStats(notes: NoteRow[], ctx: NoteContext): NoteStats {
  const byId = new Map(ctx.locations.map((l) => [l.id, l]))
  const addressee = new Map<string, BarStat>()
  const floors = new Map<string, BarStat>()
  const authors = new Map<string, BarStat>()
  const days = new Map<string, { date: string; created: number; closed: number }>()
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(ctx.now - i * DAY)
    days.set(k, { date: k, created: 0, closed: 0 })
  }

  let open = 0
  let done = 0
  let stale = 0
  let created7 = 0
  let closed7 = 0
  let withPhoto = 0
  let closeMs = 0
  let closeCount = 0

  for (const n of notes) {
    const created = new Date(n.created_at).getTime()
    const resolved = n.resolved_at ? new Date(n.resolved_at).getTime() : null
    if (n.status === 'open') open += 1
    else done += 1
    if (isStale(n, ctx.now)) stale += 1
    if (ctx.now - created <= 7 * DAY) created7 += 1
    if (resolved !== null && ctx.now - resolved <= 7 * DAY) closed7 += 1
    if (notePhotos(n).length > 0) withPhoto += 1
    if (resolved !== null) {
      closeMs += Math.max(0, resolved - created)
      closeCount += 1
    }

    const who = n.org ? { key: `o:${n.org.id}`, label: n.org.name } : n.addressee ? { key: `u:${n.addressee.id}`, label: n.addressee.full_name } : { key: 'none', label: tr('Без адресата') }
    bump(addressee, who.key, who.label, n.status)
    const floor = floorOf(n.location_id, byId)
    bump(floors, floor?.id ?? 'none', floor ? locationLabel(floor.path, ctx.locations) : tr('Без этажа'), n.status)
    bump(authors, n.author_id, n.author?.full_name ?? '—', n.status)

    const c = days.get(dayKey(created))
    if (c) c.created += 1
    if (resolved !== null) {
      const r = days.get(dayKey(resolved))
      if (r) r.closed += 1
    }
  }

  return {
    total: notes.length,
    open,
    done,
    stale,
    created7,
    closed7,
    withPhoto,
    avgCloseHours: closeCount > 0 ? closeMs / closeCount / 3_600_000 : null,
    byAddressee: [...addressee.values()].sort(byTotal),
    byFloor: [...floors.values()].sort(byTotal),
    byAuthor: [...authors.values()].sort(byTotal),
    byDay: [...days.values()],
  }
}

/** «5 ч», «2,5 сут.» — как долго заметки в среднем ждут закрытия. */
export function fmtDuration(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return tr('меньше часа')
  if (hours < 48) return tr('{{n}} ч', { n: Math.round(hours) })
  return tr('{{n}} сут.', { n: (Math.round((hours / 24) * 10) / 10).toLocaleString() })
}

export interface NearbyNotes {
  /** этаж (или само место, если этажа над ним нет), по которому искали */
  scope: LocationRow
  /** открытые заметки: сначала к выбранному месту, затем остальные на этаже, новые выше */
  open: NoteRow[]
  closed: number
}

/** Похожие заметки рядом: все заметки того же этажа, что и выбранное место. Нужны, чтобы не плодить дубли. */
export function notesNearby(notes: NoteRow[], locations: LocationRow[], locationId: string | null): NearbyNotes | null {
  if (!locationId) return null
  const byId = new Map(locations.map((l) => [l.id, l]))
  const chosen = byId.get(locationId)
  if (!chosen) return null
  const scope = floorOf(locationId, byId) ?? chosen
  const here = (n: NoteRow) => {
    const loc = byId.get(n.location_id)
    return !!loc && underPath(loc.path, chosen.path)
  }
  const inScope = notes.filter((n) => {
    const loc = byId.get(n.location_id)
    return !!loc && underPath(loc.path, scope.path)
  })
  if (inScope.length === 0) return null
  const open = inScope
    .filter((n) => n.status === 'open')
    .sort((a, b) => Number(here(b)) - Number(here(a)) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return { scope, open, closed: inScope.length - open.length }
}
