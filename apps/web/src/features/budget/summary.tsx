import { fromDisplay, toDisplay, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ExportButton } from '@/features/export/export-button'
import { budgetErrorText, DOC_TYPE_LABELS, fmtMoney, setEtc, type BudgetActual, type BudgetCommitment, type BudgetEtc, type BudgetForecast, type BudgetModel, type BudgetRow, type CbsItem, type Light } from './api'
import { Donut } from './donut'
import { explainOverrun, type Why, type WhyContext } from './explain'
import { itemLabel, money, pct, sectionSlices } from './lookahead-model'

const LIGHT: Record<Light, { dot: string; chip: string; label: string }> = {
  green: { dot: 'bg-green-500', chip: 'bg-green-500/10 text-green-700 dark:text-green-400', label: tr('В бюджете') },
  yellow: { dot: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', label: tr('Риск') },
  red: { dot: 'bg-red-500', chip: 'bg-red-500/10 text-red-700 dark:text-red-300', label: tr('Перерасход') },
  none: { dot: 'bg-muted-foreground/30', chip: 'bg-muted text-muted-foreground', label: '—' },
}

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: '2-digit' })
const fmtDay = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')

/**
 * Сводка бюджета. Сверху — ответ на главный вопрос «уложимся ли в бюджет» простыми словами и одной полосой, затем
 * резерв, статьи с риском, разделы с полосами. Полная таблица (исходный, изменения, договоры, остаток, прогноз,
 * отклонение) — свёрнута внизу, для эксперта.
 */
export function BudgetSummary({
  projectId,
  projectCode,
  model,
  items,
  commitments,
  actuals,
  etc,
  forecast,
  closedThrough,
  canEdit,
}: {
  projectId: string
  projectCode: string
  model: BudgetModel
  items: CbsItem[]
  commitments: BudgetCommitment[]
  actuals: BudgetActual[]
  etc: BudgetEtc[]
  forecast: BudgetForecast[]
  closedThrough: string | null
  canEdit: boolean
}) {
  const [detail, setDetail] = useState<BudgetRow | null>(null)
  const [etcFor, setEtcFor] = useState<BudgetRow | null>(null)
  const [showTable, setShowTable] = useState(false)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const whyCtx: WhyContext = useMemo(() => ({ etc, forecast, closedThrough, rows: model.rows }), [etc, forecast, closedThrough, model.rows])
  const rowById = useMemo(() => new Map(model.rows.map((r) => [r.id, r])), [model.rows])

  if (model.rows.length === 0) {
    return <p className="max-w-prose rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tr('Бюджета пока нет. Откройте вкладку «Бюджет», загрузите статьи из Excel или создайте их вручную и утвердите исходный бюджет.')}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {model.basis?.status === 'draft' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <TriangleAlert className="size-5 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0 flex-1 basis-60">
            <span className="font-medium">{tr('Бюджет ещё не утверждён.')}</span> {tr('Цифры посчитаны по черновику «{{name}}». Утвердить его можно на вкладке «Бюджет».', { name: model.basis.name })}
          </p>
          {canEdit && (
            <Button asChild size="sm" variant="outline">
              <Link to="/projects/$code/budget" params={{ code: projectCode }} search={{ tab: 'budget' }}>
                {tr('Перейти к утверждению')}
              </Link>
            </Button>
          )}
        </div>
      )}

      <Verdict model={model} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Donut title={tr('Из чего состоит бюджет')} hint={tr('Доля каждого раздела в бюджете')} slices={sectionSlices(model.rows, byId, (id) => rowById.get(id)?.bac ?? 0)} totalLabel={tr('бюджет')} />
        <Donut title={tr('Куда уже ушли деньги')} hint={tr('Выполнено по актам, по разделам')} slices={sectionSlices(model.rows, byId, (id) => rowById.get(id)?.actual ?? 0)} totalLabel={tr('выполнено')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReserveCard model={model} />
        <RiskCard model={model} byId={byId} whyCtx={whyCtx} onOpen={setDetail} />
      </div>
      <Sections model={model} byId={byId} onOpen={setDetail} />

      <section className="rounded-xl border bg-card">
        <button type="button" aria-expanded={showTable} onClick={() => setShowTable(!showTable)} className="flex w-full items-center gap-2 px-5 py-4 text-left">
          {showTable ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="text-base font-semibold">{tr('Подробная таблица по статьям')}</span>
          <span className="text-xs text-muted-foreground">{tr('исходный бюджет, изменения, договоры, остаток, прогноз — для экономиста')}</span>
        </button>
        {showTable && <FullTable model={model} byId={byId} canEdit={canEdit} onOpen={setDetail} onEtc={setEtcFor} />}
      </section>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
          {detail && (
            <ItemDetail
              row={detail}
              item={byId.get(detail.id)}
              items={items}
              commitments={commitments}
              actuals={actuals}
              why={explainOverrun(detail, whyCtx)}
              onOpenItem={(code) => {
                const r = model.rows.find((x) => x.code === code)
                if (r) setDetail(rowById.get(r.id) ?? r)
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      {etcFor && <EtcDialog projectId={projectId} row={etcFor} onClose={() => setEtcFor(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// «Уложимся ли в бюджет?»
// ---------------------------------------------------------------------------
function Verdict({ model }: { model: BudgetModel }) {
  const t = model.total
  const over = t.eac - t.bac
  const light = t.light
  const scale = Math.max(t.bac, t.eac, 1)
  const answer =
    light === 'red' ? tr('Перерасход') : light === 'yellow' ? tr('Есть риск перерасхода') : tr('Укладываемся в бюджет')
  const Icon = light === 'red' ? CircleAlert : light === 'yellow' ? TriangleAlert : CheckCircle2
  return (
    <section aria-labelledby="sum-verdict" className="rounded-xl border bg-card p-5">
      <h2 id="sum-verdict" className="text-sm text-muted-foreground">
        {tr('Уложимся ли в бюджет?')}
      </h2>
      <p className={`mt-1 flex items-center gap-2 text-2xl font-semibold ${light === 'red' ? 'text-red-700 dark:text-red-300' : light === 'yellow' ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-400'}`}>
        <Icon className="size-6" aria-hidden /> {answer}
      </p>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {over > 0.5
          ? tr('По прогнозу проект обойдётся в {{eac}} — на {{diff}} больше бюджета {{bac}}.', { eac: money(t.eac), diff: money(over), bac: money(t.bac) })
          : tr('По прогнозу проект обойдётся в {{eac}} — на {{diff}} меньше бюджета {{bac}}.', { eac: money(t.eac), diff: money(-over), bac: money(t.bac) })}{' '}
        {tr('Прогноз = уже выполнено + сколько ещё осталось потратить.')}
      </p>

      <div className="relative mt-4">
        <div className="flex h-5 overflow-hidden rounded-full bg-muted" role="img" aria-label={tr('Выполнено {{a}}, осталось потратить {{b}}, бюджет {{c}}', { a: money(t.actual), b: money(t.etc), c: money(t.bac) })}>
          <div className="bg-blue-600" style={{ width: `${(t.actual / scale) * 100}%` }} />
          <div className="bg-blue-300 dark:bg-blue-800" style={{ width: `${(Math.min(t.etc, Math.max(t.bac - t.actual, 0)) / scale) * 100}%` }} />
          {over > 0.5 && <div className="bg-red-500" style={{ width: `${(over / scale) * 100}%` }} />}
        </div>
        <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-foreground" style={{ left: `calc(${(t.bac / scale) * 100}% - 1px)` }} aria-hidden />
      </div>
      <p className="mt-1 text-right text-xs text-muted-foreground" style={{ paddingRight: `${100 - (t.bac / scale) * 100}%` }}>
        {tr('бюджет')} {money(t.bac)}
      </p>

      <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
        <Metric swatch="bg-blue-600" label={tr('Уже выполнено')} value={money(t.actual)} hint={tr('{{pct}}% бюджета, по актам', { pct: pct(t.actual, t.bac) })} />
        <Metric swatch="bg-blue-300 dark:bg-blue-800" label={tr('Осталось потратить')} value={money(t.etc)} hint={tr('по плану на следующие месяцы')} />
        <Metric
          swatch={over > 0.5 ? 'bg-red-500' : 'bg-green-600'}
          label={over > 0.5 ? tr('Не хватит') : tr('Останется')}
          value={money(Math.abs(over))}
          hint={over > 0.5 ? tr('столько придётся найти или сократить') : tr('с учётом резерва, который пока не понадобился')}
          tone={over > 0.5 ? 'bad' : 'good'}
        />
      </dl>
      {t.commitments > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {tr('Заключено договоров на {{sum}} — {{pct}}% бюджета.', { sum: money(t.commitments), pct: pct(t.commitments, t.bac) })}
          {t.overCommitted ? ` ${tr('Договоров больше, чем бюджет!')}` : ''}
        </p>
      )}
    </section>
  )
}

function Metric({ swatch, label, value, hint, tone }: { swatch: string; label: string; value: string; hint: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex gap-2.5">
      <span className={`mt-1.5 size-3 shrink-0 rounded-sm ${swatch}`} aria-hidden />
      <div className="min-w-0">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className={`text-lg font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700 dark:text-red-300' : tone === 'good' ? 'text-green-700 dark:text-green-400' : ''}`}>{value}</dd>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Резерв
// ---------------------------------------------------------------------------
function ReserveCard({ model }: { model: BudgetModel }) {
  const r = model.reserve
  const used = Math.min(r.overrun, r.current)
  return (
    <section aria-labelledby="sum-reserve" className="rounded-xl border bg-card p-5">
      <h2 id="sum-reserve" className="text-base font-semibold">
        {tr('Резерв на непредвиденное')}
      </h2>
      {r.current === 0 && r.initial === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{tr('Резерв не заложен. Добавьте статью с типом «Резерв» — тогда здесь будет видно, хватает ли его на перерасход.')}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr('Запас в бюджете на случай, если статьи выйдут дороже. Сейчас перерасход статей забирает {{used}} из {{total}}.', { used: money(r.overrun), total: money(r.current) })}
          </p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-green-500/25">
            <div className="bg-amber-500" style={{ width: `${(used / Math.max(r.current, 1)) * 100}%` }} />
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline text-muted-foreground">{tr('Нужно на перерасход:')} </dt>
              <dd className="inline font-semibold tabular-nums">{money(r.overrun)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">{r.remaining < 0 ? tr('Не хватает:') : tr('Свободно:')} </dt>
              <dd className={`inline font-semibold tabular-nums ${r.remaining < 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-400'}`}>{money(Math.abs(r.remaining))}</dd>
            </div>
            {Math.abs(r.current - r.initial) > 0.5 && (
              <div className="text-muted-foreground">{tr('изначально было {{sum}}', { sum: money(r.initial) })}</div>
            )}
          </dl>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Где риск
// ---------------------------------------------------------------------------
function RiskCard({ model, byId, whyCtx, onOpen }: { model: BudgetModel; byId: Map<string, CbsItem>; whyCtx: WhyContext; onOpen: (r: BudgetRow) => void }) {
  const [all, setAll] = useState(false)
  const risky = useMemo(
    () =>
      model.rows
        .filter((r) => !r.hasChildren && (r.variance < -9.99 || r.overCommitted))
        .sort((a, b) => a.variance - b.variance),
    [model.rows],
  )
  const shown = all ? risky : risky.slice(0, 5)
  return (
    <section aria-labelledby="sum-risk" className="rounded-xl border bg-card p-5">
      <h2 id="sum-risk" className="text-base font-semibold">
        {tr('Где выходим за бюджет')}
      </h2>
      {risky.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4" /> {tr('Ни одна статья не выходит за свой бюджет.')}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y">
          {shown.map((r) => {
            const l = itemLabel(r, byId.get(r.id))
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r)} className="flex w-full items-start gap-3 py-2 text-left hover:bg-muted/50">
                  <CircleAlert className={`mt-0.5 size-4 shrink-0 ${r.light === 'red' ? 'text-red-600' : 'text-amber-600'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {l.main}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.variance < -9.99
                        ? tr('Выйдет на {{sum}} дороже бюджета ({{pct}}%)', { sum: money(-r.variance), pct: pct(-r.variance, r.bac) })
                        : tr('Договоров на {{c}} при бюджете {{b}}', { c: money(r.commitments), b: money(r.bac) })}
                    </span>
                    {r.variance < -9.99 && (
                      <span className="block text-xs text-red-700 dark:text-red-300">
                        {tr('Почему: {{why}}', { why: explainOverrun(r, whyCtx)?.short ?? '' })}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 self-center text-xs text-primary">{tr('Разобрать →')}</span>
                </button>
              </li>
            )
          })}
          {risky.length > 5 && (
            <li className="pt-2">
              <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setAll(!all)}>
                {all ? tr('Свернуть') : tr('Показать ещё {{count}}', { count: risky.length - 5 })}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Разделы
// ---------------------------------------------------------------------------
function Sections({ model, byId, onOpen }: { model: BudgetModel; byId: Map<string, CbsItem>; onOpen: (r: BudgetRow) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const visible = useMemo(() => {
    const out: BudgetRow[] = []
    let hide: number | null = null
    for (const r of model.rows) {
      if (hide !== null && r.depth > hide) continue
      hide = null
      out.push(r)
      if (r.hasChildren && !open.has(r.id)) hide = r.depth
    }
    return out
  }, [model.rows, open])
  return (
    <section aria-labelledby="sum-sections" className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 id="sum-sections" className="text-base font-semibold">
          {tr('Разделы бюджета')}
        </h2>
        <p className="text-xs text-muted-foreground">{tr('Тёмная часть полосы — выполнено, светлая — осталось потратить, красная — выходит за бюджет раздела. Нажмите на название — договоры и акты.')}</p>
      </div>
      <ul>
        {visible.map((r) => {
          const l = itemLabel(r, byId.get(r.id))
          const scale = Math.max(r.bac, r.eac, 1)
          const over = Math.max(r.eac - r.bac, 0)
          return (
            <li key={r.id} className="border-b last:border-b-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 pr-5 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_9rem]" style={{ paddingLeft: `${1.25 + r.depth * 1.25}rem` }}>
                <div className="flex min-w-0 items-start gap-2">
                  {r.hasChildren ? (
                    <button
                      type="button"
                      aria-expanded={open.has(r.id)}
                      aria-label={open.has(r.id) ? tr('Свернуть') : tr('Развернуть')}
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s)
                          if (n.has(r.id)) n.delete(r.id)
                          else n.add(r.id)
                          return n
                        })
                      }
                      className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted"
                    >
                      {open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  ) : (
                    <span className="inline-block size-6 shrink-0" />
                  )}
                  <button type="button" onClick={() => onOpen(r)} className="min-w-0 text-left hover:underline">
                    <span className={`block text-sm ${r.depth === 0 ? 'font-medium' : ''}`}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {l.main}
                    </span>
                    {l.sub && <span className="block truncate text-xs text-muted-foreground">{l.sub}</span>}
                  </button>
                </div>
                <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-blue-600" style={{ width: `${(r.actual / scale) * 100}%` }} />
                    <div className="bg-blue-300 dark:bg-blue-800" style={{ width: `${(Math.min(r.etc, Math.max(r.bac - r.actual, 0)) / scale) * 100}%` }} />
                    {over > 9.99 && <div className="bg-red-500" style={{ width: `${(over / scale) * 100}%` }} />}
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {tr('{{fact}} из {{bac}} · {{pct}}% выполнено', { fact: money(r.actual), bac: money(r.bac), pct: pct(r.actual, r.bac) })}
                  </p>
                </div>
                <div className="row-start-1 justify-self-end md:col-start-3">
                  {r.variance < -9.99 ? (
                    <button
                      type="button"
                      onClick={() => onOpen(r)}
                      title={tr('Нажмите — почему дороже и что сделать')}
                      className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium underline decoration-dotted underline-offset-2 hover:brightness-95 ${LIGHT[r.light].chip}`}
                    >
                      {tr('Дороже на {{sum}}', { sum: money(-r.variance) })} · {tr('почему?')}
                    </button>
                  ) : (
                    <span className={`inline-flex min-h-7 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${LIGHT[r.bac || r.eac ? 'green' : 'none'].chip}`}>{r.bac || r.eac ? tr('В бюджете') : '—'}</span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Подробная таблица (для эксперта)
// ---------------------------------------------------------------------------
function FullTable({ model, byId, canEdit, onOpen, onEtc }: { model: BudgetModel; byId: Map<string, CbsItem>; canEdit: boolean; onOpen: (r: BudgetRow) => void; onEtc: (r: BudgetRow) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const t = model.total
  const visible = useMemo(() => {
    const out: BudgetRow[] = []
    let hide: number | null = null
    for (const r of model.rows) {
      if (hide !== null && r.depth > hide) continue
      hide = null
      out.push(r)
      if (r.hasChildren && !open.has(r.id)) hide = r.depth
    }
    return out
  }, [model.rows, open])
  const cols = [
    [tr('Исходный бюджет'), tr('первая утверждённая версия')],
    [tr('Изменения'), tr('сколько добавили или убрали потом')],
    [tr('Бюджет сейчас'), tr('действующая версия (BAC)')],
    [tr('Договоры'), tr('заключено договоров')],
    [tr('Выполнено'), tr('факт по актам (AC)')],
    [tr('Осталось потратить'), tr('прогноз остатка (ETC)')],
    [tr('Прогноз на конец'), tr('выполнено + осталось (EAC)')],
    [tr('Отклонение'), tr('бюджет − прогноз; минус — перерасход')],
  ] as const
  return (
    <div className="border-t">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {tr('Нажмите на название статьи — договоры и акты по ней.')}
          {canEdit ? ` ${tr('Нажмите на «Осталось потратить», чтобы указать свою оценку.')}` : ''}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(open.size ? new Set() : new Set(model.rows.filter((r) => r.hasChildren).map((r) => r.id)))}>
            {open.size ? tr('Свернуть всё') : tr('Развернуть всё')}
          </Button>
          <ExportButton
            fileName={tr('Бюджет')}
            build={() => ({
              name: tr('Бюджет'),
              headers: [tr('Код'), tr('Статья'), ...cols.map(([h]) => h), tr('Статус')],
              rows: [...model.rows, t].map((r) => [r.code, r.name, r.initial, r.changes, r.bac, r.commitments, r.actual, r.etc, r.eac, r.variance, LIGHT[r.light].label]),
            })}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 min-w-64 bg-muted px-3 py-2 text-left font-medium">{tr('Статья')}</th>
              {cols.map(([h, hint]) => (
                <th key={h} className="px-3 py-2 text-right align-bottom font-medium" title={hint}>
                  {h}
                  <span className="block text-[10px] font-normal">{hint}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={`border-b ${r.hasChildren ? 'bg-muted/30 font-medium' : ''}`}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal" style={r.hasChildren ? { backgroundColor: 'var(--muted)' } : undefined}>
                  <div className="flex items-center gap-1" style={{ paddingLeft: r.depth * 16 }}>
                    {r.hasChildren ? (
                      <button
                        type="button"
                        aria-label={open.has(r.id) ? tr('Свернуть') : tr('Развернуть')}
                        aria-expanded={open.has(r.id)}
                        onClick={() =>
                          setOpen((s) => {
                            const n = new Set(s)
                            if (n.has(r.id)) n.delete(r.id)
                            else n.add(r.id)
                            return n
                          })
                        }
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-background"
                      >
                        {open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    ) : (
                      <span className="inline-block size-6 shrink-0" />
                    )}
                    <button type="button" className="min-w-0 text-left hover:underline" onClick={() => onOpen(r)}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {itemLabel(r, byId.get(r.id)).main}
                    </button>
                  </div>
                </th>
                <Money v={r.initial} />
                <Money v={r.changes} signed />
                <Money v={r.bac} />
                <Money v={r.commitments} warn={r.overCommitted} />
                <Money v={r.actual} />
                <td className="px-3 py-2 text-right tabular-nums">
                  {canEdit && !r.hasChildren ? (
                    <button
                      type="button"
                      title={r.manualEtc ? tr('Оценка введена вручную') : tr('Посчитано автоматически — нажмите, чтобы указать свою оценку')}
                      onClick={() => onEtc(r)}
                      className={`rounded px-1 hover:bg-muted ${r.manualEtc ? 'font-semibold underline decoration-dotted underline-offset-2' : ''}`}
                    >
                      {fmtMoney(r.etc)}
                    </button>
                  ) : (
                    fmtMoney(r.etc)
                  )}
                </td>
                <Money v={r.eac} />
                <Money v={r.variance} signed warn={r.variance < -9.99} />
              </tr>
            ))}
            <tr className="bg-muted/50 font-semibold">
              <th scope="row" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">
                {t.name}
              </th>
              <Money v={t.initial} />
              <Money v={t.changes} signed />
              <Money v={t.bac} />
              <Money v={t.commitments} warn={t.overCommitted} />
              <Money v={t.actual} />
              <Money v={t.etc} />
              <Money v={t.eac} />
              <Money v={t.variance} signed warn={t.variance < -9.99} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-muted-foreground">
        {tr('«Осталось потратить» берётся из раскладки по месяцам; если её нет — бюджет (или договоры, если они больше) минус выполненное. Оценка экономиста важнее расчёта. Резерв не считается потраченным.')}
      </p>
    </div>
  )
}

function Money({ v, signed, warn }: { v: number; signed?: boolean; warn?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${warn ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}>
      {Math.abs(v) < 0.005 ? <span className="text-muted-foreground/50">—</span> : `${signed && v > 0 ? '+' : ''}${fmtMoney(v)}`}
    </td>
  )
}

// ---------------------------------------------------------------------------
// Карточка статьи: договоры и акты
// ---------------------------------------------------------------------------
function WhyBlock({ why, onOpenItem }: { why: Why; onOpenItem: (code: string) => void }) {
  return (
    <section aria-labelledby="why-h" className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
      <h3 id="why-h" className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
        <CircleAlert className="size-4" aria-hidden /> {tr('Почему дороже')}
      </h3>
      <ol className="mt-2 flex flex-col text-sm">
        {why.steps.map((s, i) => (
          <li key={s.label} className={`flex justify-between gap-3 py-0.5 ${i === why.steps.length - 1 ? 'mt-1 border-t pt-1.5' : ''}`}>
            <span className="text-muted-foreground">{s.label}</span>
            <span className={`tabular-nums ${s.tone === 'bad' ? 'font-semibold text-red-700 dark:text-red-300' : 'font-medium'}`}>{s.value}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm">{why.reason}</p>
      {why.items && why.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {why.items.map((i) => (
            <li key={i.code}>
              <button type="button" onClick={() => onOpenItem(i.code)} className="flex w-full justify-between gap-3 rounded px-1 text-left text-sm hover:bg-red-500/10">
                <span>
                  <span className="ident mr-1.5 text-muted-foreground">{i.code}</span>
                  {i.name}
                </span>
                <span className="tabular-nums text-red-700 dark:text-red-300">+{money(i.over)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm">
        <span className="font-medium">{tr('Что сделать:')}</span> {why.fix}
      </p>
    </section>
  )
}

function ItemDetail({
  row,
  item,
  items,
  commitments,
  actuals,
  why,
  onOpenItem,
}: {
  row: BudgetRow
  item: CbsItem | undefined
  items: CbsItem[]
  commitments: BudgetCommitment[]
  actuals: BudgetActual[]
  why: Why | null
  onOpenItem: (code: string) => void
}) {
  // статья и все вложенные
  const ids = useMemo(() => {
    const set = new Set<string>([row.id])
    let grew = true
    while (grew) {
      grew = false
      for (const it of items)
        if (it.parent_id && set.has(it.parent_id) && !set.has(it.id)) {
          set.add(it.id)
          grew = true
        }
    }
    return set
  }, [row.id, items])
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.code])), [items])
  const cs = commitments.filter((c) => ids.has(c.item_id))
  const as = actuals.filter((a) => ids.has(a.item_id))
  const l = itemLabel(row, item)
  const over = row.eac - row.bac
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          <span className="ident text-muted-foreground">{row.code}</span> {l.main}
        </SheetTitle>
        <SheetDescription>{l.sub ?? ''}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {(
            [
              [tr('Бюджет'), money(row.bac)],
              [tr('Уже выполнено'), `${money(row.actual)} · ${pct(row.actual, row.bac)}%`],
              [tr('Осталось потратить'), money(row.etc)],
              [over > 9.99 ? tr('Выйдет дороже на') : tr('Прогноз на конец'), over > 9.99 ? money(over) : money(row.eac)],
            ] as const
          ).map(([k, v], i) => (
            <div key={k} className="rounded-md border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className={`font-semibold tabular-nums ${i === 3 && over > 9.99 ? 'text-red-700 dark:text-red-300' : ''}`}>{v}</dd>
            </div>
          ))}
        </dl>
        {why && <WhyBlock why={why} onOpenItem={onOpenItem} />}
        <section>
          <h3 className="mb-1.5 text-sm font-semibold">
            {tr('Договоры')} {cs.length > 0 && <span className="font-normal text-muted-foreground">{cs.length}</span>}
          </h3>
          {cs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Договоров по статье нет.')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {cs.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[c.counterparty, c.doc_number, fmtDay(c.signed_on), ids.size > 1 ? names.get(c.item_id) : null, c.status === 'cancelled' ? tr('расторгнут') : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{fmtMoney(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-sm font-semibold">
            {tr('Выполнено по актам')} {as.length > 0 && <span className="font-normal text-muted-foreground">{as.length}</span>}
          </h3>
          {as.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Затрат по статье пока нет.')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {as.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block">{a.note && !a.doc_number ? a.note : `${DOC_TYPE_LABELS[a.doc_type]} ${a.doc_number ?? ''}`}</span>
                    <span className="block text-xs text-muted-foreground">{[fmtDay(a.doc_date), a.counterparty, ids.size > 1 ? names.get(a.item_id) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{fmtMoney(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function EtcDialog({ projectId, row, onClose }: { projectId: string; row: BudgetRow; onClose: () => void }) {
  const { symbol: cur } = useDisplayCurrency()
  const qc = useQueryClient()
  const [value, setValue] = useState(String(Math.round(toDisplay(row.etc))))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (amount: number | null) => {
    setBusy(true)
    try {
      await setEtc(row.id, amount, note)
      await qc.invalidateQueries({ queryKey: ['budget', 'etc', projectId] })
      toast.success(amount === null ? tr('Возвращён расчёт системы') : tr('Оценка сохранена'))
      onClose()
    } catch (e) {
      toast.error(budgetErrorText(e, tr('Не удалось сохранить прогноз.')))
      setBusy(false)
    }
  }
  const amount = fromDisplay(Number(value.replace(/\s/g, '').replace(',', '.')))
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tr('Сколько ещё осталось потратить')}</DialogTitle>
          <DialogDescription>
            {row.code} {row.name}. {tr('Уже выполнено {{sum}}.', { sum: fmtMoney(row.actual) })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="etc-v">{tr('Осталось потратить, {{cur}}', { cur })}</Label>
            <Input id="etc-v" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">{tr('Прогноз на конец станет {{sum}}.', { sum: fmtMoney(row.actual + (Number.isFinite(amount) ? amount : 0)) })}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="etc-n">{tr('Основание')}</Label>
            <Input id="etc-n" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={tr('Например, по графику платежей')} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" disabled={busy || !row.manualEtc} onClick={() => save(null)}>
            {tr('Вернуть расчёт системы')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="button" disabled={busy || !Number.isFinite(amount) || amount < 0} onClick={() => save(amount)}>
              {tr('Сохранить')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
