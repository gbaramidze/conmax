import { Link } from '@tanstack/react-router'
import { ClipboardCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { addDays, addMonths, dayTitle, firstOfMonth, mondayOf } from '@/features/calendar/dates'
import type { InspectionRow } from '@/features/inspections/api'
import { ReportStatusBadge, ResultBadge } from '@/features/inspections/badges'
import { PeriodPicker, type PeriodPreset } from '@/features/inspections/period-picker'
import { inRange, lastDays, type DateRange } from '@/features/inspections/stats'
import { locationLabel, type LocationRow } from '@/features/locations/api'
import { tr } from '@/lib/tr'

const PAGE = 40

export const monthRangeOf = (today: string): DateRange => ({ from: firstOfMonth(today), to: addDays(addMonths(firstOfMonth(today), 1), -1) })

const presets = (today: string): PeriodPreset[] => {
  const prev = addMonths(firstOfMonth(today), -1)
  return [
    { id: 'week', label: tr('Эта неделя'), range: { from: mondayOf(today), to: addDays(mondayOf(today), 6) } },
    { id: 'month', label: tr('Этот месяц'), range: monthRangeOf(today) },
    { id: 'prev', label: tr('Прошлый месяц'), range: { from: prev, to: addDays(firstOfMonth(today), -1) } },
    { id: '30', label: tr('30 дней'), range: lastDays(today, 30) },
  ]
}

/** «Что сделано за период»: выбираете даты «с» и «по» и видите, какие инспекции проводились, по дням. */
export function RangeReport({
  code,
  today,
  range,
  onRange,
  reports,
  locations,
}: {
  code: string
  today: string
  range: DateRange
  onRange: (r: DateRange) => void
  reports: InspectionRow[]
  locations: LocationRow[]
}) {
  const [issuedOnly, setIssuedOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const list = useMemo(() => inRange(reports, range).filter((r) => !issuedOnly || r.status === 'issued'), [reports, range, issuedOnly])

  const sum = useMemo(() => {
    const issued = list.filter((r) => r.status === 'issued')
    return {
      total: list.length,
      issued: issued.length,
      drafts: list.length - issued.length,
      a: issued.filter((r) => r.result === 'A' || !r.result).length,
      c: issued.filter((r) => r.result === 'C').length,
      r: issued.filter((r) => r.result === 'R').length,
      places: new Set(list.map((r) => r.location_id).filter(Boolean)).size,
    }
  }, [list])

  const days = useMemo(() => {
    const map = new Map<string, InspectionRow[]>()
    for (const r of list.slice(0, limit)) map.set(r.inspection_date, [...(map.get(r.inspection_date) ?? []), r])
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [list, limit])

  return (
    <section aria-label={tr('Инспекции за период')} className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-soft sm:p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold">{tr('Инспекции за период')}</h3>
        <div className="sm:ml-auto">
          <PeriodPicker value={range} onChange={(r) => { setLimit(PAGE); onRange(r) }} presets={presets(today)} label={tr('Период')} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-semibold tabular-nums">{sum.total}</span> {tr('инспекций')} · {tr('мест')} <span className="font-semibold tabular-nums">{sum.places}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span>{tr('выдано {{n}}', { n: sum.issued })}</span>
          <span>{tr('принято: {{n}}', { n: sum.a })}</span>
          <span>{tr('с замечаниями: {{n}}', { n: sum.c })}</span>
          <span className={sum.r > 0 ? 'font-semibold text-red-700 dark:text-red-300' : ''}>{tr('не принято: {{n}}', { n: sum.r })}</span>
          <span>{tr('черновиков {{n}}', { n: sum.drafts })}</span>
        </span>
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={issuedOnly} onChange={(e) => { setIssuedOnly(e.target.checked); setLimit(PAGE) }} />
          {tr('Только выданные')}
        </label>
      </div>

      {list.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          <ClipboardCheck className="size-4" aria-hidden /> {tr('За этот период инспекций не было.')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {days.map(([date, rows]) => (
            <div key={date} className="flex flex-col gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">
                {dayTitle(date)} · {rows.length}
              </h4>
              <ul className="divide-y overflow-hidden rounded-md border">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link
                      to="/projects/$code/inspection/$id"
                      params={{ code, id: r.id }}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 flex-1 basis-56 flex-col">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="ident text-xs text-muted-foreground">{r.key}</span>
                          <span className="text-sm font-medium">{r.title}</span>
                        </span>
                        <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {r.location && <span>{locationLabel(r.location.path, locations)}</span>}
                          {r.contractor && <span>{r.contractor.name}</span>}
                          {r.author && <span>{r.author.full_name}</span>}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {(r.result || r.status === 'issued') && <ResultBadge result={r.result} />}
                        <ReportStatusBadge status={r.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {list.length > limit && (
            <Button type="button" variant="outline" className="self-start" onClick={() => setLimit((n) => n + PAGE)}>
              {tr('Показать ещё')} ({list.length - limit})
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
