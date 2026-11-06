import { Link } from '@tanstack/react-router'
import { AlertTriangle, CalendarClock, CheckCheck, ClipboardList, Clock3, MapPinned } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { InspectionRow, InspectionSchedule, TaskStats } from '@/features/inspections/api'
import { PeriodPicker, type PeriodPreset } from '@/features/inspections/period-picker'
import { computeOverview, DRAFT_DAYS, lastDays, STALE_DAYS, type DateRange, type PlaceInfo } from '@/features/inspections/stats'
import { locationLabel, type LocationRow } from '@/features/locations/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const periodPresets = (today: string): PeriodPreset[] => [
  { id: 'all', label: tr('Всё время'), range: lastDays(today, null) },
  { id: '7', label: tr('7 дней'), range: lastDays(today, 7) },
  { id: '30', label: tr('30 дней'), range: lastDays(today, 30) },
  { id: '90', label: tr('90 дней'), range: lastDays(today, 90) },
]

/** Цвета состояний: тот же смысл, что у букв A / C / R; рядом всегда подпись и число. */
const COLOR = {
  A: 'bg-emerald-600',
  C: 'bg-amber-400',
  R: 'bg-red-600',
  draft: 'bg-sky-500',
  none: 'bg-muted-foreground/30',
} as const

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

const shortFmt = () => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
const fmt = (f: Intl.DateTimeFormat, iso: string) => f.format(new Date(`${iso}T12:00:00`))

interface Props {
  code: string
  reports: InspectionRow[]
  places: PlaceInfo[]
  locations: LocationRow[]
  stats: Map<string, TaskStats> | undefined
  schedules: InspectionSchedule[]
  today: string
  /** переход на другую вкладку страницы */
  onTab: (tab: 'calendar' | 'list' | 'schedule') => void
  /** список отчётов, у которых все задачи выполнены и ждут проверки */
  onShowReady: () => void
}

/** Обзор инспекций: охват мест, итоги, устранение замечаний, динамика, подрядчики и то, что требует внимания. */
export function InspectionOverview({ code, reports, places, locations, stats, schedules, today, onTab, onShowReady }: Props) {
  const [range, setRange] = useState<DateRange>({ from: null, to: null })
  const presets = useMemo(() => periodPresets(today), [today])
  const o = useMemo(() => computeOverview(reports, places, stats, schedules, today, range), [reports, places, stats, schedules, today, range])
  const label = (path: string) => locationLabel(path, locations)

  const checked = o.places.a + o.places.c + o.places.r
  const remarksLeft = Math.max(0, o.remarks.total - o.remarks.resolved)
  const empty = reports.length === 0 && schedules.length === 0

  if (empty) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
        <ClipboardList className="size-5" aria-hidden />
        {tr('Пока нечего показывать. Проведите первую инспекцию — здесь появятся охват мест, итоги и динамика.')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{tr('Отчётные цифры — за выбранный период; состояние мест — на сегодня.')}</p>
        <div className="sm:ml-auto">
          <PeriodPicker value={range} onChange={setRange} presets={presets} label={tr('Период отчёта')} />
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {o.places.total > 0 && (
          <>
            <Tile
              label={tr('Проверено мест')}
              value={`${checked}`}
              sub={tr('из {{total}} · {{p}}%', { total: o.places.total, p: pct(checked, o.places.total) })}
              icon={<MapPinned className="size-4" aria-hidden />}
            />
            <Tile
              label={tr('Не проверено')}
              value={`${o.places.none}`}
              sub={o.places.none > 0 ? tr('мест без выданной инспекции') : tr('все места проверены')}
              tone={o.places.none > 0 ? 'warn' : 'good'}
            />
            <Tile label={tr('Принято')} value={`${o.places.a}`} sub={tr('мест · {{p}}% от проверенных', { p: pct(o.places.a, checked) })} badge="A" tone="good" />
            <Tile label={tr('С замечаниями')} value={`${o.places.c}`} sub={tr('мест · {{p}}% от проверенных', { p: pct(o.places.c, checked) })} badge="C" />
            <Tile label={tr('Не принято')} value={`${o.places.r}`} sub={tr('мест · {{p}}% от проверенных', { p: pct(o.places.r, checked) })} badge="R" tone={o.places.r > 0 ? 'bad' : undefined} />
          </>
        )}
        <Tile
          label={tr('Замечаний устранено')}
          value={o.remarks.total > 0 ? `${o.remarks.resolved}` : '—'}
          sub={o.remarks.total > 0 ? tr('из {{total}} · {{p}}%', { total: o.remarks.total, p: pct(o.remarks.resolved, o.remarks.total) }) : tr('замечаний C и R нет')}
          icon={<CheckCheck className="size-4" aria-hidden />}
          tone={o.remarks.total > 0 && remarksLeft === 0 ? 'good' : undefined}
        />
        <Tile
          label={tr('Отчётов')}
          value={`${o.reports.total}`}
          sub={tr('выдано {{issued}} · черновиков {{drafts}}', { issued: o.reports.issued, drafts: o.reports.drafts })}
          icon={<ClipboardList className="size-4" aria-hidden />}
        />
        <LastTile last={o.last} code={code} />
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        {o.places.total > 0 && (
          <Panel title={tr('Состояние мест')} hint={tr('по последней выданной инспекции места')}>
            <Segments
              label={tr('Состояние мест')}
              parts={[
                { key: 'A', n: o.places.a, label: tr('Принято') },
                { key: 'C', n: o.places.c, label: tr('С замечаниями') },
                { key: 'R', n: o.places.r, label: tr('Не принято') },
                { key: 'draft', n: o.places.draft, label: tr('Только черновик') },
                { key: 'none', n: o.places.none, label: tr('Не проверено') },
              ]}
            />
          </Panel>
        )}

        <Panel title={tr('Итоги инспекций')} hint={tr('выданные отчёты за период')}>
          <Segments
            label={tr('Итоги выданных отчётов')}
            parts={[
              { key: 'A', n: o.reports.a, label: tr('Принято') },
              { key: 'C', n: o.reports.c, label: tr('С замечаниями') },
              { key: 'R', n: o.reports.r, label: tr('Не принято') },
            ]}
          />
          <p className="mt-3 text-xs font-medium text-muted-foreground">{tr('Проверено пунктов')}</p>
          <Segments
            label={tr('Итоги по пунктам')}
            parts={[
              { key: 'A', n: o.items.a, label: tr('Принято') },
              { key: 'C', n: o.items.c, label: tr('С замечаниями') },
              { key: 'R', n: o.items.r, label: tr('Не принято') },
              { key: 'none', n: o.items.open, label: tr('Без статуса') },
            ]}
          />
        </Panel>

        <Panel title={tr('Устранение замечаний')} hint={tr('замечания C и R: от задачи до подтверждения')}>
          {o.remarks.total === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('За период замечаний C и R нет.')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <Meter label={tr('Всего замечаний')} n={o.remarks.total} total={o.remarks.total} className="bg-foreground/60" />
              <Meter label={tr('Передано задачами')} n={o.remarks.withTask} total={o.remarks.total} className="bg-sky-500" />
              <Meter label={tr('Задача выполнена')} n={o.remarks.done} total={o.remarks.total} className="bg-emerald-600/50" />
              <Meter label={tr('Устранено (подтверждено на месте)')} n={o.remarks.resolved} total={o.remarks.total} className="bg-emerald-600" />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span>{tr('в работе: {{n}}', { n: o.remarks.active + o.remarks.review })}</span>
                <span>{tr('осталось устранить: {{n}}', { n: remarksLeft })}</span>
                {o.remarks.overdue > 0 && <span className="font-semibold text-red-700 dark:text-red-300">{tr('просрочено: {{n}}', { n: o.remarks.overdue })}</span>}
              </p>
              {o.readyReports.length > 0 && (
                <button
                  type="button"
                  onClick={onShowReady}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CheckCheck className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
                  <span className="flex-1 font-medium">{tr('Всё выполнено, ждут проверки: {{n}}', { n: o.readyReports.length })}</span>
                  <span className="text-muted-foreground">{tr('Показать')}</span>
                </button>
              )}
            </div>
          )}
        </Panel>

        <Panel title={tr('Динамика по неделям')} hint={tr('отчётов по дате инспекции, 12 недель')}>
          <WeekChart weeks={o.weeks} />
        </Panel>
      </div>

      <Panel title={tr('Требуют внимания')}>
        <Attention code={code} o={o} label={label} onTab={onTab} />
      </Panel>

      {o.contractors.length > 0 && (
        <Panel title={tr('По подрядчикам')} hint={tr('отчёты за период')}>
          <div className="-mx-3 overflow-x-auto px-3">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">{tr('Подрядчик')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{tr('Отчётов')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{tr('Принято')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{tr('С замечаниями')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{tr('Не принято')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{tr('Не устранено')}</th>
                  <th className="py-1.5 pl-2 text-right font-medium">{tr('Последняя')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {o.contractors.map((c) => (
                  <tr key={c.key} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.name ?? <span className="font-normal text-muted-foreground">{tr('Подрядчик не указан')}</span>}</td>
                    <td className="px-2 py-2 text-right">{c.reports}</td>
                    <td className="px-2 py-2 text-right">{c.a}</td>
                    <td className="px-2 py-2 text-right">{c.c}</td>
                    <td className={cn('px-2 py-2 text-right', c.r > 0 && 'font-semibold text-red-700 dark:text-red-300')}>{c.r}</td>
                    <td className={cn('px-2 py-2 text-right', c.open > 0 && 'font-semibold')}>{c.open}</td>
                    <td className="py-2 pl-2 text-right text-muted-foreground">{c.lastDate ? fmt(shortFmt(), c.lastDate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 shadow-soft sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

const TONES = {
  good: 'border-emerald-600/40 bg-emerald-500/10',
  warn: 'border-amber-500/50 bg-amber-400/10',
  bad: 'border-red-600/40 bg-red-500/10',
} as const

function Tile({ label, value, sub, tone, badge, icon }: { label: string; value: string; sub?: string; tone?: keyof typeof TONES; badge?: 'A' | 'C' | 'R'; icon?: ReactNode }) {
  return (
    <li className={cn('flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 shadow-soft', tone && TONES[tone])}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {badge && (
          <span aria-hidden className={cn('grid size-5 place-items-center rounded-full text-[11px] font-semibold', badge === 'A' ? 'bg-emerald-600 text-white' : badge === 'C' ? 'bg-amber-400 text-amber-950' : 'bg-red-600 text-white')}>
            {badge}
          </span>
        )}
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-xs leading-snug text-muted-foreground">{sub}</span>}
    </li>
  )
}

function LastTile({ last, code }: { last: { date: string; daysAgo: number; id: string; key: string } | null; code: string }) {
  if (!last) return <Tile label={tr('Последняя инспекция')} value="—" sub={tr('выданных отчётов пока нет')} icon={<Clock3 className="size-4" aria-hidden />} />
  const stale = last.daysAgo > STALE_DAYS
  return (
    <li className={cn('flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 shadow-soft', stale && TONES.warn)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Clock3 className="size-4" aria-hidden />
        <span className="truncate">{tr('Последняя инспекция')}</span>
      </span>
      <span className="text-2xl font-semibold leading-tight">{fmt(shortFmt(), last.date)}</span>
      <span className="text-xs leading-snug text-muted-foreground">
        {last.daysAgo === 0 ? tr('сегодня') : tr('{{n}} дн. назад', { n: last.daysAgo })} ·{' '}
        <Link to="/projects/$code/inspection/$id" params={{ code, id: last.id }} className="ident rounded underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {last.key}
        </Link>
      </span>
    </li>
  )
}

/** Полоса из долей с легендой: каждая доля подписана словом и числом, цвет не единственный признак. */
function Segments({ parts, label }: { parts: { key: keyof typeof COLOR; n: number; label: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  const summary = parts.map((p) => `${p.label}: ${p.n}`).join(', ')
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={`${label}. ${summary}`} className="flex h-3 overflow-hidden rounded-full bg-muted">
        {total > 0 && parts.filter((p) => p.n > 0).map((p) => <span key={p.key} className={cn('h-full', COLOR[p.key])} style={{ width: `${(p.n / total) * 100}%` }} />)}
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', COLOR[p.key])} />
            <span className="min-w-0 flex-1 text-muted-foreground">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.n}</span>
            <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">{pct(p.n, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Meter({ label, n, total, className }: { label: string; n: number; total: number; className: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {n} <span className="font-normal text-muted-foreground">· {pct(n, total)}%</span>
        </span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuenow={n} aria-valuemin={0} aria-valuemax={total} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full', className)} style={{ width: `${pct(n, total)}%` }} />
      </div>
    </div>
  )
}

function WeekChart({ weeks }: { weeks: ReturnType<typeof computeOverview>['weeks'] }) {
  const max = Math.max(1, ...weeks.map((w) => w.a + w.c + w.r + w.draft))
  const f = shortFmt()
  const empty = weeks.every((w) => w.a + w.c + w.r + w.draft === 0)
  if (empty) return <p className="text-sm text-muted-foreground">{tr('За эти недели инспекций не было.')}</p>
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex h-36 items-end gap-1">
        {weeks.map((w, i) => {
          const total = w.a + w.c + w.r + w.draft
          const text = `${tr('Неделя с {{d}}', { d: fmt(f, w.start) })}: ${tr('принято')} ${w.a}, ${tr('с замечаниями')} ${w.c}, ${tr('не принято')} ${w.r}, ${tr('черновиков')} ${w.draft}`
          return (
            <li key={w.start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={text}>
              <span className="text-[11px] tabular-nums text-muted-foreground">{total > 0 ? total : ''}</span>
              <div role="img" aria-label={text} className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(total / max) * 100}%`, minHeight: total > 0 ? 4 : 0 }}>
                {w.a > 0 && <span className={COLOR.A} style={{ height: `${(w.a / total) * 100}%` }} />}
                {w.c > 0 && <span className={COLOR.C} style={{ height: `${(w.c / total) * 100}%` }} />}
                {w.r > 0 && <span className={COLOR.R} style={{ height: `${(w.r / total) * 100}%` }} />}
                {w.draft > 0 && <span className={COLOR.draft} style={{ height: `${(w.draft / total) * 100}%` }} />}
              </div>
              <span aria-hidden className="relative h-3 w-full text-[10px] leading-3 text-muted-foreground">
                {(weeks.length - 1 - i) % 3 === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{fmt(f, w.start)}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {([['A', tr('принято')], ['C', tr('с замечаниями')], ['R', tr('не принято')], ['draft', tr('черновик')]] as const).map(([k, text]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-full', COLOR[k])} />
            {text}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Attention({ code, o, label, onTab }: { code: string; o: ReturnType<typeof computeOverview>; label: (path: string) => string; onTab: Props['onTab'] }) {
  const rows: { key: string; icon: ReactNode; title: string; tone?: 'bad' | 'warn'; items: ReactNode[]; more: number; action?: { text: string; run: () => void } }[] = []

  if (o.overdueSchedules.length > 0)
    rows.push({
      key: 'schedules',
      icon: <CalendarClock className="size-4" aria-hidden />,
      title: tr('Просрочены инспекции по расписанию: {{n}}', { n: o.overdueSchedules.length }),
      tone: 'bad',
      items: o.overdueSchedules.slice(0, 5).map((s) => (
        <span key={s.id}>
          {s.title || (s.location ? label(s.location.path) : '')} <span className="text-muted-foreground">· {tr('срок {{d}}', { d: fmt(shortFmt(), s.next_due) })}</span>
        </span>
      )),
      more: o.overdueSchedules.length - 5,
      action: { text: tr('Расписание'), run: () => onTab('schedule') },
    })
  if (o.remarks.overdue > 0)
    rows.push({ key: 'tasks', icon: <AlertTriangle className="size-4" aria-hidden />, title: tr('Просрочены задачи по замечаниям: {{n}}', { n: o.remarks.overdue }), tone: 'bad', items: [], more: 0, action: { text: tr('Отчёты'), run: () => onTab('list') } })
  if (o.places.r > 0)
    rows.push({
      key: 'rejected',
      icon: <AlertTriangle className="size-4" aria-hidden />,
      title: tr('Не принято мест: {{n}}', { n: o.places.r }),
      tone: 'bad',
      items: o.rejected.slice(0, 5).map((p) => (
        <span key={p.id}>
          {label(p.path)} <span className="text-muted-foreground">· {p.lastDate ? fmt(shortFmt(), p.lastDate) : ''}</span>
        </span>
      )),
      more: o.rejected.length - 5,
    })
  if (o.oldDrafts.length > 0)
    rows.push({
      key: 'drafts',
      icon: <ClipboardList className="size-4" aria-hidden />,
      title: tr('Черновики старше {{d}} дн.: {{n}}', { d: DRAFT_DAYS, n: o.oldDrafts.length }),
      tone: 'warn',
      items: o.oldDrafts.slice(0, 5).map((r) => (
        <Link key={r.id} to="/projects/$code/inspection/$id" params={{ code, id: r.id }} className="rounded underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <span className="ident text-muted-foreground">{r.key}</span> {r.title}
        </Link>
      )),
      more: o.oldDrafts.length - 5,
    })
  if (o.stale.length > 0)
    rows.push({
      key: 'stale',
      icon: <Clock3 className="size-4" aria-hidden />,
      title: tr('Давно не проверялись: {{n}}', { n: o.stale.length }),
      tone: 'warn',
      items: o.stale.slice(0, 5).map((p) => (
        <span key={p.id}>
          {label(p.path)} <span className="text-muted-foreground">· {tr('{{n}} дн. назад', { n: p.daysAgo ?? 0 })}</span>
        </span>
      )),
      more: o.stale.length - 5,
    })
  if (o.untouched.length > 0)
    rows.push({
      key: 'untouched',
      icon: <MapPinned className="size-4" aria-hidden />,
      title: tr('Ещё не проверялись: {{n}}', { n: o.untouched.length }),
      items: o.untouched.slice(0, 5).map((p) => <span key={p.id}>{label(p.path)}</span>),
      more: o.untouched.length - 5,
    })

  if (rows.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCheck className="size-4" aria-hidden /> {tr('Всё в порядке: просрочек и забытых мест нет.')}
      </p>
    )

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className={cn('flex flex-col gap-1 rounded-lg border p-3', r.tone === 'bad' && TONES.bad, r.tone === 'warn' && TONES.warn)}>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {r.icon}
            <span className="min-w-0 flex-1">{r.title}</span>
            {r.action && (
              <Button type="button" size="sm" variant="outline" onClick={r.action.run}>
                {r.action.text}
              </Button>
            )}
          </div>
          {r.items.length > 0 && (
            <ul className="flex flex-col gap-0.5 pl-6 text-sm">
              {r.items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
              {r.more > 0 && <li className="text-xs text-muted-foreground">{tr('и ещё {{n}}', { n: r.more })}</li>}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
