import { Link } from '@tanstack/react-router'
import { CheckCheck, ListTodo, Undo2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STATUS_STYLE, type InspectionItem, type InspectionTask } from '@/features/inspections/api'
import { UserAvatar } from '@/features/profile/avatar'
import { CATEGORY_STYLES } from '@/features/tasks/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

export interface TrackedRemark {
  item: InspectionItem
  ref: string
}

const today = () => new Date().toLocaleDateString('sv')
const isOpen = (t: InspectionTask) => t.status_category !== 'done' && t.status_category !== 'cancelled'
const isOverdue = (t: InspectionTask) => !!t.due_date && t.due_date < today() && isOpen(t)

/** Что человеку делать с замечанием дальше: чем меньше число, тем выше в списке. */
function rank(r: TrackedRemark, t: InspectionTask | undefined): number {
  if (r.item.resolved_at) return 5
  if (t?.status_category === 'done' || t?.status_category === 'review') return 0
  if (t && isOverdue(t)) return 1
  if (!t) return 2
  return 3
}

/**
 * Отслеживание задач по замечаниям прямо в отчёте: сколько создано, выполнено, просрочено и подтверждено, и по каждому замечанию
 * задача с исполнителем и сроком. Выполненные задачи ждут подтверждения инспектора: «Устранено» ставится после проверки на месте
 * (у выданного отчёта это тоже можно). Обновляется само, о выполнении приходит уведомление.
 */
export function TaskTracker({
  code,
  remarks,
  tasks,
  canAssign,
  canConduct,
  busy,
  onAssign,
  onResolve,
}: {
  code: string
  remarks: TrackedRemark[]
  tasks: Map<string, InspectionTask>
  canAssign: boolean
  canConduct: boolean
  busy: boolean
  onAssign: (itemId: string | 'all') => void
  onResolve: (itemId: string, resolved: boolean) => void
}) {
  const withTask = remarks.filter((r) => r.item.task_id && tasks.has(r.item.task_id))
  const without = remarks.length - withTask.length
  if (remarks.length === 0 || (withTask.length === 0 && !canAssign)) return null

  const taskOf = (r: TrackedRemark) => (r.item.task_id ? tasks.get(r.item.task_id) : undefined)
  const done = withTask.filter((r) => taskOf(r)!.status_category === 'done').length
  const waiting = withTask.filter((r) => ['done', 'review'].includes(taskOf(r)!.status_category) && !r.item.resolved_at).length
  const overdue = withTask.filter((r) => isOverdue(taskOf(r)!)).length
  const resolved = remarks.filter((r) => r.item.resolved_at).length
  const sorted = [...remarks].sort((a, b) => rank(a, taskOf(a)) - rank(b, taskOf(b)) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  const pct = (n: number) => `${Math.round((n / remarks.length) * 100)}%`
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

  const chip = (label: string, n: number, tone?: string) =>
    n > 0 && (
      <span className={cn('rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums', tone)}>
        {label}: {n}
      </span>
    )

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft print:hidden" aria-label={tr('Задачи по замечаниям')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{tr('Задачи по замечаниям')}</h2>
        {canAssign && without > 0 && (
          <Button size="sm" className="max-sm:h-11 max-sm:w-full" onClick={() => onAssign('all')}>
            <ListTodo /> {tr('Раздать задачи: {{n}}', { n: without })}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-valuenow={resolved}
          aria-valuemin={0}
          aria-valuemax={remarks.length}
          aria-label={tr('Устранено {{n}} из {{total}}', { n: resolved, total: remarks.length })}
          className="relative flex h-2.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-emerald-600" style={{ width: pct(resolved) }} />
          <div className="h-full bg-emerald-600/35" style={{ width: pct(Math.max(0, done - resolved)) }} />
        </div>
        <p className="text-xs text-muted-foreground">{tr('Устранено {{n}} из {{total}}', { n: resolved, total: remarks.length })}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chip(tr('Задач'), withTask.length)}
        {chip(tr('Ждут подтверждения'), waiting, 'border-amber-500/50 bg-amber-500/10')}
        {chip(tr('Просрочено'), overdue, 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300')}
        {chip(tr('Без задачи'), without)}
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((r) => {
          const t = taskOf(r)
          const late = t ? isOverdue(t) : false
          const ready = !!t && ['done', 'review'].includes(t.status_category) && !r.item.resolved_at
          return (
            <li key={r.item.id} className={cn('flex flex-col gap-2 rounded-lg border p-3', ready && 'border-amber-500/50 bg-amber-500/5', r.item.resolved_at && 'opacity-70')}>
              <div className="flex items-start gap-2">
                <span className="ident pt-0.5 text-xs text-muted-foreground">{r.ref}</span>
                {r.item.status && <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold', STATUS_STYLE[r.item.status].on)}>{r.item.status}</span>}
                <span className="line-clamp-2 min-w-0 flex-1 text-sm">{r.item.comment || '—'}</span>
              </div>

              {t && (
                <Link
                  to="/projects/$code/task/$key"
                  params={{ code, key: t.key }}
                  className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="ident font-medium">{t.key}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', CATEGORY_STYLES[t.status_category])}>{t.status?.name ?? t.status_category}</span>
                  {t.assignee ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserAvatar name={t.assignee.full_name} path={t.assignee.avatar_path} className="size-6 text-[10px]" />
                      <span className="truncate">{t.assignee.full_name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{tr('Без исполнителя')}</span>
                  )}
                  {t.due_date && <span className={cn('ml-auto tabular-nums', late ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground')}>{late ? tr('просрочена · {{d}}', { d: dateFmt.format(new Date(`${t.due_date}T12:00:00`)) }) : dateFmt.format(new Date(`${t.due_date}T12:00:00`))}</span>}
                </Link>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!t && canAssign && (
                  <Button size="sm" variant="outline" className="max-sm:h-11" disabled={busy} onClick={() => onAssign(r.item.id)}>
                    <UserPlus /> {tr('Назначить')}
                  </Button>
                )}
                {ready && canConduct && (
                  <Button size="sm" className="max-sm:h-11" disabled={busy} onClick={() => onResolve(r.item.id, true)}>
                    <CheckCheck /> {tr('Подтвердить устранение')}
                  </Button>
                )}
                {r.item.resolved_at && (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium">
                      <CheckCheck className="size-3.5" aria-hidden /> {tr('Устранено')}
                    </span>
                    {canConduct && (
                      <Button size="sm" variant="ghost" className="max-sm:h-11" disabled={busy} onClick={() => onResolve(r.item.id, false)}>
                        <Undo2 /> {tr('Снять отметку')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
