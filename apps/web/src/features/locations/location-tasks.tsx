import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, ListChecks } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-provider'
import { DEFAULT_TASK_SEARCH, PRIORITY_LABELS, type Priority } from '@/features/tasks/api'
import { currentLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

interface PlaceTask {
  id: string
  key: string
  title: string
  priority: Priority
  description: unknown
  due_date: string | null
  assignee_id: string | null
  status: { name: string } | null
  assignee: { full_name: string } | null
}

export const locationTasksQuery = (projectId: string, path: string) => ({
  queryKey: ['location-tasks', projectId, path],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, key, title, priority, description, due_date, assignee_id, status:workflow_statuses!status_id(name), assignee:users!assignee_id(full_name)')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .not('status_category', 'in', '(done,cancelled)')
      .or(`location_path.eq.${path},location_path.like.${path}.*`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(200)
    if (error) throw error
    return data as unknown as PlaceTask[]
  },
})

/** Текст из описания задачи (редактор хранит документ Tiptap): первые слова для краткого превью. */
function plainText(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const n = node as { text?: string; content?: unknown[] }
  if (typeof n.text === 'string') out.push(n.text)
  if (Array.isArray(n.content)) for (const c of n.content) plainText(c, out)
  return out
}
const preview = (doc: unknown, max = 110) => {
  const t = plainText(doc).join(' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const DAY = 86_400_000
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)

/** Срочность по сроку: просрочено — красный, 0–2 дня — оранжевый, до недели — жёлтый, дальше — спокойный. */
function urgency(due: string | null, today: string): { label: string; badge: string; edge: string } {
  if (!due) return { label: tr('без срока'), badge: 'text-muted-foreground', edge: 'border-l-transparent' }
  const d = daysUntil(due, today)
  if (d < 0) return { label: tr('просрочено на {{n}} дн.', { n: -d }), badge: 'bg-red-500/10 font-medium text-red-700 dark:text-red-300', edge: 'border-l-red-500' }
  if (d === 0) return { label: tr('сегодня'), badge: 'bg-orange-500/15 font-medium text-orange-800 dark:text-orange-300', edge: 'border-l-orange-500' }
  if (d === 1) return { label: tr('завтра'), badge: 'bg-orange-500/15 font-medium text-orange-800 dark:text-orange-300', edge: 'border-l-orange-500' }
  if (d <= 2) return { label: tr('через {{n}} дн.', { n: d }), badge: 'bg-orange-500/15 font-medium text-orange-800 dark:text-orange-300', edge: 'border-l-orange-500' }
  if (d <= 7) return { label: tr('через {{n}} дн.', { n: d }), badge: 'bg-amber-400/20 text-amber-900 dark:text-amber-300', edge: 'border-l-amber-400' }
  return { label: tr('через {{n}} дн.', { n: d }), badge: 'text-muted-foreground', edge: 'border-l-transparent' }
}

const dayFmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' })

/** Задачи места: сначала назначенные на вас, ниже остальные открытые; нажатие открывает задачу. */
export function LocationTasks({ projectId, code, path }: { projectId: string; code: string; path: string }) {
  const { session } = useAuth()
  const me = session?.user.id
  const { data: tasks, isPending } = useQuery(locationTasksQuery(projectId, path))
  const today = new Date().toISOString().slice(0, 10)

  if (isPending) return <p className="text-sm text-muted-foreground">{tr('Загружаем задачи…')}</p>
  const byDue = (a: PlaceTask, b: PlaceTask) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.key.localeCompare(b.key, undefined, { numeric: true })
  const mine = (tasks ?? []).filter((t) => t.assignee_id === me).sort(byDue)
  const others = (tasks ?? []).filter((t) => t.assignee_id !== me).sort(byDue)

  const row = (t: PlaceTask) => {
    const u = urgency(t.due_date, today)
    const text = preview(t.description)
    return (
      <li key={t.id} className={`border-l-4 ${u.edge}`}>
        <Link to="/projects/$code/task/$key" params={{ code, key: t.key }} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted/40">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{t.title}</span>
            {text && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{text}</span>}
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="ident">{t.key}</span>
              {t.status && <span>{t.status.name}</span>}
              {(t.priority === 'high' || t.priority === 'critical') && <span className="font-medium text-red-700 dark:text-red-300">{PRIORITY_LABELS[t.priority]}</span>}
              {t.assignee_id !== me && t.assignee && <span>{t.assignee.full_name}</span>}
            </span>
          </span>
          <span className={`flex shrink-0 flex-col items-end gap-0.5 rounded-md px-2 py-1 text-xs ${u.badge}`}>
            <span className="flex items-center gap-1 whitespace-nowrap">
              {t.due_date && daysUntil(t.due_date, today) < 0 && <AlertTriangle className="size-3.5" aria-hidden />}
              {u.label}
            </span>
            {t.due_date && <span className="tabular-nums opacity-80">{dayFmt(t.due_date)}</span>}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </li>
    )
  }

  return (
    <section className="flex flex-col gap-4" aria-label={tr('Задачи места')}>
      {(tasks ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{tr('Открытых задач в этом месте нет.')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {tr('Назначены на вас')}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{mine.length}</span>
            </h3>
            {mine.length === 0 ? <p className="text-sm text-muted-foreground">{tr('На вас здесь задач нет.')}</p> : <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">{mine.map(row)}</ul>}
          </div>
          {others.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {tr('Остальные открытые')}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{others.length}</span>
              </h3>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-soft">{others.slice(0, 30).map(row)}</ul>
              {others.length > 30 && <p className="text-xs text-muted-foreground">{tr('Показаны первые 30. Остальные — в общем списке задач.')}</p>}
            </div>
          )}
        </>
      )}
      <Link
        to="/projects/$code/tasks"
        params={{ code }}
        search={{ ...DEFAULT_TASK_SEARCH, location: path }}
        className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted/50"
      >
        <ListChecks className="size-4 text-muted-foreground" aria-hidden /> {tr('Все задачи этого места')}
        <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  )
}
