import { tr } from '@/lib/tr'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CircleHelp, Camera } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBudget } from '@/features/budget/use-budget'
import { IndexTrend, SCurve } from '@/features/evm/charts'
import {
  createSnapshot,
  eacLight,
  evmQuery,
  evmSeriesQuery,
  fmtIndex,
  fmtMoney,
  indexLight,
  LIGHT_DOT,
  LIGHT_LABEL,
  LIGHT_STYLES,
  snapshotsQuery,
  type Evm,
  type Light,
} from '@/features/evm/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { fmtDate } from '@/features/schedule/model'

// Паттерн «Аналитика / Отчёт»: освоенный объём, индексы, прогнозы, S-кривая и тренды по снимкам
export const Route = createFileRoute('/_app/projects/$code/evm')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await queryClient.ensureQueryData(myPermissionsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем показатели…')}</p>,
  component: EvmPage,
})

const todayIso = () => new Date().toLocaleDateString('sv')

function EvmPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Считаем показатели…')}</p>}>
      <Evm projectId={p.id} code={code} canSnapshot={permissions.includes('snapshot.create')} />
    </Suspense>
  )
}

interface Why {
  title: string
  formula: string
  rows: [string, string][]
  note?: string
}

function whyOf(key: string, m: Evm, eac4: number | null): Why | null {
  const money = fmtMoney
  switch (key) {
    case 'bac':
      return { title: tr('Бюджет работ (BAC)'), formula: tr('Сумма долей бюджета, закреплённых за работами графика'), rows: [[tr('Работ с бюджетом'), String(m.works)], ['BAC', money(m.bac)], [tr('Весь бюджет проекта'), money(m.total_budget)], [tr('Охват'), m.coverage === null ? '—' : `${Math.round(m.coverage * 100)}%`]], note: tr('Работы без закреплённой доли бюджета в расчёт не входят. Распределите бюджет на вкладке «Бюджет → По работам».') }
    case 'pv':
      return { title: tr('Плановая стоимость (PV)'), formula: tr('Σ (доля бюджета работы × плановый % на дату по базовому плану)'), rows: [[tr('На дату'), fmtDate(m.date)], ['PV', money(m.pv)], [tr('Базовый план'), m.baseline ? tr('есть') : tr('нет — взяты текущие даты работ')]], note: tr('Плановый процент растёт равномерно по календарным дням между датами начала и конца работы в базовом плане.') }
    case 'ev':
      return { title: tr('Освоенный объём (EV)'), formula: tr('Σ (доля бюджета работы × подтверждённый фактический %)'), rows: [['EV', money(m.ev)], [tr('Ожидают подтверждения'), tr('{{pending_progress}} записей факта', { pending_progress: m.pending_progress })]], note: tr('Записи, не подтверждённые ПТО или прорабом, в EV не входят.') }
    case 'ac':
      return { title: tr('Факт затрат (AC)'), formula: tr('Σ актов, счетов и списаний по статьям бюджета, к которым привязаны работы, на дату'), rows: [['AC', money(m.ac)]] }
    case 'spi':
      return { title: tr('Индекс сроков (SPI)'), formula: 'SPI = EV / PV', rows: [['EV', money(m.ev)], ['PV', money(m.pv)], ['SPI', fmtIndex(m.spi)], [tr('Отклонение по срокам (SV = EV − PV)'), money(m.sv)]], note: tr('Меньше 1 — отстаём от базового плана. Допуск: зелёный от 0,95, жёлтый 0,85–0,95.') }
    case 'cpi':
      return { title: tr('Индекс стоимости (CPI)'), formula: 'CPI = EV / AC', rows: [['EV', money(m.ev)], ['AC', money(m.ac)], ['CPI', fmtIndex(m.cpi)], [tr('Отклонение по стоимости (CV = EV − AC)'), money(m.cv)]], note: tr('Меньше 1 — перерасход. Допуск: зелёный от 0,97, жёлтый 0,90–0,97.') }
    case 'spit':
      return { title: tr('Индекс сроков по времени, SPI(t)'), formula: 'SPI(t) = ES / AT', rows: [[tr('ES — когда по плану было достигнуто нынешнее EV'), m.es_days === null ? '—' : tr('{{es_days}} дн. от старта', { es_days: m.es_days })], [tr('AT — прошло от старта'), m.elapsed_days === null ? '—' : tr('{{elapsed_days}} дн.', { elapsed_days: m.elapsed_days })], ['SPI(t)', fmtIndex(m.spit)]], note: tr('В отличие от SPI не «залипает» к 1 в конце проекта.') }
    case 'eac':
      return { title: tr('Прогноз стоимости при завершении (EAC)'), formula: tr('EAC(1) = BAC / CPI — основной; остальные методы показаны для диапазона'), rows: [[tr('EAC(1) — тренд затрат сохранится'), money(m.eac1)], [tr('EAC(2) — отклонения разовые: AC + (BAC − EV)'), money(m.eac2)], [tr('EAC(3) — влияют и сроки: AC + (BAC − EV) / (CPI × SPI)'), money(m.eac3)], [tr('EAC(4) — по статьям от экономиста'), eac4 === null ? '—' : money(eac4)], ['BAC', money(m.bac)]] }
    case 'tcpi':
      return { title: tr('Требуемая эффективность (TCPI)'), formula: 'TCPI = (BAC − EV) / (BAC − AC)', rows: [['TCPI', fmtIndex(m.tcpi)]], note: tr('Какой CPI нужно держать на остаток, чтобы уложиться в бюджет. Выше 1,1 — уложиться нереалистично.') }
    case 'forecast':
      return { title: tr('Прогноз окончания'), formula: tr('Плановая длительность / SPI(t)'), rows: [[tr('Плановая длительность'), m.planned_days === null ? '—' : tr('{{planned_days}} дн.', { planned_days: m.planned_days })], [tr('Прогноз длительности'), m.forecast_days === null ? '—' : tr('{{forecast_days}} дн.', { forecast_days: m.forecast_days })], [tr('Плановое окончание'), fmtDate(m.finish)], [tr('Прогнозное окончание'), fmtDate(m.forecast_finish)]], note: tr('Сроки нужно смотреть и по критическому пути графика: освоение некритичных работ может скрывать отставание критических.') }
    default:
      return null
  }
}

function Evm({ projectId, code, canSnapshot }: { projectId: string; code: string; canSnapshot: boolean }) {
  const qc = useQueryClient()
  const { data: m } = useSuspenseQuery(evmQuery(projectId))
  const { data: snaps = [] } = useQuery(snapshotsQuery(projectId))
  const { data: curve = [] } = useQuery(evmSeriesQuery(projectId, m.start, m.finish))
  const budget = useBudget(projectId)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  // EAC(4): прогноз экономиста по статьям, к которым привязаны работы (тот же объём, что у остальных показателей)
  const eac4 = useMemo(() => {
    if (budget.model.rows.length === 0) return null
    const ids = new Set(m.by_item.map((r) => r.item_id))
    return budget.model.rows.filter((r) => ids.has(r.id)).reduce((s, r) => s + r.eac, 0)
  }, [budget.model.rows, m.by_item])

  const lights = {
    spi: indexLight(m.spi, 0.95, 0.85),
    cpi: indexLight(m.cpi, 0.97, 0.9),
    spit: indexLight(m.spit, 0.95, 0.85),
    eac: eacLight(m.bac, m.eac1),
    tcpi: (m.tcpi === null ? 'none' : m.tcpi <= 1.05 ? 'green' : m.tcpi <= 1.1 ? 'yellow' : 'red') as Light,
  }

  // снимки: освоенный объём и факт; последняя точка — сегодняшний расчёт
  const series = useMemo(() => {
    const byDay = new Map<string, Evm>()
    for (const s of snaps) byDay.set(s.status_date, s.metrics)
    byDay.set(m.date, m)
    const days = [...byDay.keys()].sort()
    return {
      ev: days.map((d) => ({ day: d, value: byDay.get(d)!.ev })),
      ac: days.map((d) => ({ day: d, value: byDay.get(d)!.ac })),
      spi: days.filter((d) => byDay.get(d)!.spi !== null).map((d) => ({ day: d, value: byDay.get(d)!.spi! })),
      cpi: days.filter((d) => byDay.get(d)!.cpi !== null).map((d) => ({ day: d, value: byDay.get(d)!.cpi! })),
    }
  }, [snaps, m])

  if (m.works === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Показатели освоенного объёма считаются по работам графика, у которых есть доля бюджета. Пока таких нет: утвердите бюджет и распределите статьи по работам.')}</p>
        <Button asChild>
          <Link to="/projects/$code/budget" params={{ code }} search={{ tab: 'works' }}>{tr('Распределить бюджет по работам')}</Link>
        </Button>
      </div>
    )
  }

  const card = (key: string, label: string, value: string, light: Light, hint?: string) => (
    <div className="flex flex-col rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <button type="button" onClick={() => setWhy(key)} aria-label={tr('Почему такая цифра: {{label}}', { label })} title={tr('Почему?')} className="-m-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <CircleHelp className="size-4" />
        </button>
      </div>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${LIGHT_STYLES[light]}`}>{value}</dd>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {light !== 'none' && <span className={`size-2 rounded-full ${LIGHT_DOT[light]}`} aria-hidden />}
        {hint ?? (light === 'none' ? '' : LIGHT_LABEL[light])}
      </p>
    </div>
  )

  const eacRange = [m.eac1, m.eac2, m.eac3, eac4].filter((v): v is number => v !== null)
  const whyData = why ? whyOf(why, m, eac4) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('На')}{' '}{fmtDate(m.date)}{tr('. Охват: работ с бюджетом')}{' '}{m.works}
          {m.coverage !== null && tr(', {{v1}}% бюджета проекта', { v1: Math.round(m.coverage * 100) })}{tr('. Снимки делаются автоматически по пятницам, нажмите «Снимок», чтобы зафиксировать состояние сейчас.')}</p>
        {canSnapshot && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await createSnapshot(projectId, '')
                await qc.invalidateQueries({ queryKey: ['evm'] })
                toast.success(tr('Снимок создан'))
              } catch {
                toast.error(tr('Не удалось создать снимок.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            <Camera />{tr('Снимок')}</Button>
        )}
      </div>

      {m.coverage !== null && m.coverage < 0.95 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Расчёт охватывает')}{' '}{Math.round(m.coverage * 100)}{tr('% бюджета: у остальных статей работы графика не закреплены.')}{' '}
          <Link to="/projects/$code/budget" params={{ code }} search={{ tab: 'works' }} className="font-medium underline underline-offset-2">{tr('Распределить')}</Link>
        </p>
      )}
      {!m.baseline && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Базового плана нет: плановая стоимость считается по текущим датам. Создайте базовый план на экране «График».')}</p>}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        {card('bac', tr('Бюджет работ (BAC)'), fmtMoney(m.bac), 'none')}
        {card('pv', tr('План (PV)'), fmtMoney(m.pv), 'none')}
        {card('ev', tr('Освоено (EV)'), fmtMoney(m.ev), 'none', m.pending_progress > 0 ? tr('ждут подтверждения: {{pending_progress}}', { pending_progress: m.pending_progress }) : undefined)}
        {card('ac', tr('Факт (AC)'), fmtMoney(m.ac), 'none')}
        {card('eac', tr('Прогноз (EAC)'), fmtMoney(m.eac1), lights.eac, eacRange.length > 1 ? tr('диапазон {{v1}} – {{v2}}', { v1: fmtMoney(Math.min(...eacRange)), v2: fmtMoney(Math.max(...eacRange)) }) : undefined)}
        {card('spi', tr('Сроки (SPI)'), fmtIndex(m.spi), lights.spi)}
        {card('cpi', tr('Стоимость (CPI)'), fmtIndex(m.cpi), lights.cpi)}
        {card('spit', tr('Сроки по времени SPI(t)'), fmtIndex(m.spit), lights.spit)}
        {card('tcpi', tr('Требуемый CPI (TCPI)'), fmtIndex(m.tcpi), lights.tcpi)}
        {card('forecast', tr('Прогноз окончания'), m.forecast_finish ? fmtDate(m.forecast_finish) : '—', 'none', m.finish ? tr('по плану {{v1}}', { v1: fmtDate(m.finish) }) : undefined)}
      </dl>

      <section aria-labelledby="scurve" className="rounded-lg border bg-card p-4">
        <h3 id="scurve" className="mb-2 text-sm font-semibold">{tr('S-кривая')}</h3>
        <SCurve pv={curve.map((c) => ({ day: c.day, value: c.pv }))} ev={series.ev} ac={series.ac} today={today} bac={m.bac} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="trend" className="rounded-lg border bg-card p-4">
          <h3 id="trend" className="mb-2 text-sm font-semibold">{tr('Тренд по снимкам')}</h3>
          {series.spi.length < 2 ? (
            <p className="text-sm text-muted-foreground">{tr('Тренд появится, когда будет хотя бы два снимка.')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <IndexTrend title={tr('SPI — сроки')} points={series.spi} green={0.95} />
              <IndexTrend title={tr('CPI — стоимость')} points={series.cpi} green={0.97} />
            </div>
          )}
        </section>
        <section aria-labelledby="lag" className="rounded-lg border bg-card p-4">
          <h3 id="lag" className="mb-2 text-sm font-semibold">{tr('Что тянет сроки вниз')}</h3>
          {m.lagging.filter((l) => l.gap > 0.5).length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Отставаний от базового плана нет.')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {m.lagging
                .filter((l) => l.gap > 0.5)
                .map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.name}</span>
                      <span className="block text-xs text-muted-foreground">{tr('по плану')}{' '}{Math.round(l.planned_percent)}{tr('%, фактически')}{' '}{Math.round(l.percent)}%
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-red-700 dark:text-red-300">−{fmtMoney(l.gap)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="items" className="rounded-lg border bg-card">
        <h3 id="items" className="border-b p-4 text-sm font-semibold">{tr('По статьям бюджета')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">{tr('Статья')}</th>
                {['BAC', 'PV', 'EV', 'AC', 'SPI', 'CPI'].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.by_item.map((r) => {
                const spi = r.pv > 0 ? r.ev / r.pv : null
                const cpi = r.ac > 0 ? r.ev / r.ac : null
                return (
                  <tr key={r.item_id} className="border-b">
                    <td className="px-3 py-2">
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {r.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.bac)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.pv)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.ev)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.ac)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${LIGHT_STYLES[indexLight(spi, 0.95, 0.85)]}`}>{fmtIndex(spi)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${LIGHT_STYLES[indexLight(cpi, 0.97, 0.9)]}`}>{fmtIndex(cpi)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Count label={tr('PPC за 4 недели')} value={m.ppc4 === null ? '—' : `${m.ppc4}%`} />
        <Count label={tr('Открытых задач')} value={String(m.open_tasks)} />
        <Count label={tr('Просроченных задач')} value={String(m.overdue_tasks)} warn={m.overdue_tasks > 0} />
        <Count label={tr('Открытых ограничений')} value={String(m.open_constraints)} warn={m.open_constraints > 0} />
      </dl>

      {whyData && (
        <Dialog open onOpenChange={(o) => !o && setWhy(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{whyData.title}</DialogTitle>
              <DialogDescription className="font-mono text-xs">{whyData.formula}</DialogDescription>
            </DialogHeader>
            <dl className="flex flex-col divide-y rounded-lg border text-sm">
              {whyData.rows.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 px-3 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="shrink-0 font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {whyData.note && <p className="text-sm text-muted-foreground">{whyData.note}</p>}
            <DialogFooter>
              <Button onClick={() => setWhy(null)}>{tr('Понятно')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Count({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${warn ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</dd>
    </div>
  )
}
