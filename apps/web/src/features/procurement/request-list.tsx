import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { symbolOf } from '@/features/projects/currency'
import { dueState, nowText, REQUEST_STATUSES, statusClass, type RequestRow } from './api'

const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 0 })
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
const day = (d: string) => dateFmt.format(new Date(`${d}T12:00:00`))

/** Список заявок: что, где, на каком шаге (фразой) и когда ждать. Красным — просроченное «нужно до» и опоздавшая поставка. */
export function RequestList({ rows, showProject, onOpen, empty }: { rows: RequestRow[]; showProject: boolean; onOpen: (id: string) => void; empty: string }) {
  const today = new Date().toLocaleDateString('sv')
  if (rows.length === 0) return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{empty}</div>
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const open = !['delivered', 'rejected', 'cancelled'].includes(r.status)
        const late = open && r.needed_by && r.needed_by < today
        const eta = (r.status === 'ordered' || r.status === 'shipped') && r.expected_at
        const etaLate = eta && r.expected_at! < today
        // срок текущего шага (п. 13.1) прошёл — кроме поставки, у неё своя отметка
        const stepLate = !eta && dueState(r.due_at) === 'late'
        const sum = r.amount !== null ? `${nf.format(r.amount)} ${symbolOf(r.currency ?? '')}` : r.estimate ? `≈ ${nf.format(r.estimate)}` : null
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className={cn('flex w-full flex-wrap items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring', r.my_approval && 'border-primary/60')}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="ident text-xs text-muted-foreground">{showProject ? `${r.project_code} · ${r.key}` : r.key}</span>
                  <span className={cn('font-medium', !open && r.status !== 'delivered' && 'text-muted-foreground line-through')}>{r.title}</span>
                  {r.urgent && open && <span className="rounded-full border border-amber-500/60 bg-amber-400/15 px-1.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">{tr('Срочно')}</span>}
                </span>
                <span className={cn('text-sm', r.my_approval ? 'font-medium text-primary' : 'text-muted-foreground')}>{r.my_approval ? tr('Ждёт вашего решения') : nowText(r)}</span>
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {sum && <span className="tabular-nums">{sum}</span>}
                  {r.requester_name && <span>{tr('инициатор: {{name}}', { name: r.requester_name })}</span>}
                  {eta && <span className={cn('tabular-nums', etaLate && 'font-medium text-red-700 dark:text-red-300')}>{etaLate ? tr('опаздывает: ждали {{d}}', { d: day(r.expected_at!) }) : tr('ожидается {{d}}', { d: day(r.expected_at!) })}</span>}
                  {r.needed_by && open && !eta && <span className={cn(late && 'font-medium text-red-700 dark:text-red-300')}>{tr('нужно до {{d}}', { d: day(r.needed_by) })}</span>}
                  {r.over_budget && open && <span className="font-medium text-amber-800 dark:text-amber-300">{tr('сверх бюджета')}</span>}
                  {stepLate && <span className="font-medium text-red-700 dark:text-red-300">{tr('срок шага прошёл')}</span>}
                  {r.receipt === 'partial' && open && <span className="font-medium text-amber-800 dark:text-amber-300">{tr('пришла часть')}</span>}
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', statusClass(r.status))}>{REQUEST_STATUSES[r.status]}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
