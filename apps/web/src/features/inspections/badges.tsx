import { INSPECTION_STATUSES, REPORT_STATUSES, STATUS_STYLE, type ItemStatus, type ReportStatus } from '@/features/inspections/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** Итог отчёта: буква и слово, чтобы смысл не держался на цвете. */
export function ResultBadge({ result, className }: { result: ItemStatus | null; className?: string }) {
  if (!result) return <span className={cn('rounded-full border px-2 py-0.5 text-xs text-muted-foreground', className)}>{tr('В работе')}</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', className)}>
      <span aria-hidden className={cn('grid size-5 place-items-center rounded-full text-[11px] font-semibold', STATUS_STYLE[result].on)}>
        {result}
      </span>
      {INSPECTION_STATUSES[result]}
    </span>
  )
}

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return <span className={cn('rounded-full border px-2 py-0.5 text-xs', status === 'issued' ? 'border-primary/40 bg-primary/10 font-medium' : 'text-muted-foreground')}>{REPORT_STATUSES[status]}</span>
}
