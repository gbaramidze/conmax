import { fromDisplay, toDisplay, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ExportButton } from '@/features/export/export-button'
import { budgetErrorText, DOC_TYPE_LABELS, fmtMoney, setEtc, type BudgetActual, type BudgetCommitment, type BudgetModel, type BudgetRow, type CbsItem, type Light } from './api'

const LIGHT: Record<Light, { dot: string; label: string }> = {
  green: { dot: 'bg-green-500', label: tr('В бюджете') },
  yellow: { dot: 'bg-amber-500', label: tr('Риск') },
  red: { dot: 'bg-red-500', label: tr('Перерасход') },
  none: { dot: 'bg-muted-foreground/30', label: '—' },
}

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: '2-digit' })
const fmtDay = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')

export function LightBadge({ light }: { light: Light }) {
  const l = LIGHT[light]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span className={`size-2.5 rounded-full ${l.dot}`} aria-hidden /> {l.label}
    </span>
  )
}

/** Сводная таблица: исходный бюджет, изменения, BAC, обязательства, факт, ETC, EAC, отклонение, светофор. */
export function BudgetSummary({
  projectId,
  model,
  items,
  commitments,
  actuals,
  canEdit,
}: {
  projectId: string
  model: BudgetModel
  items: CbsItem[]
  commitments: BudgetCommitment[]
  actuals: BudgetActual[]
  canEdit: boolean
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<BudgetRow | null>(null)
  const [etcFor, setEtcFor] = useState<BudgetRow | null>(null)

  const visible = useMemo(() => {
    const hidden = new Set<string>()
    const byId = new Map(model.rows.map((r) => [r.id, r]))
    return model.rows.filter((r) => {
      let p = r.parent_id
      while (p) {
        if (collapsed.has(p)) return false
        p = byId.get(p)?.parent_id ?? null
      }
      return !hidden.has(r.id)
    })
  }, [model.rows, collapsed])

  const t = model.total
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (model.rows.length === 0) {
    return <p className="max-w-prose rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('Бюджета пока нет. Откройте вкладку «Бюджет», загрузите статьи из Excel или создайте их вручную и утвердите исходный бюджет.')}</p>
  }

  const reserve = model.reserve
  const closedPct = t.commitments > 0 ? Math.round((t.actual / t.commitments) * 100) : null

  return (
    <div className="flex flex-col gap-4">
      {model.basis?.status === 'draft' && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Утверждённого бюджета ещё нет: таблица считается по черновику «')}{model.basis.name}».</p>
      )}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label={tr('Бюджет (BAC)')} value={fmtMoney(t.bac)} hint={t.changes !== 0 ? tr('{{v1}}{{v2}} к исходному', { v1: t.changes > 0 ? '+' : '', v2: fmtMoney(t.changes) }) : undefined} />
        <Tile label={tr('Обязательства')} value={fmtMoney(t.commitments)} hint={t.bac > 0 ? tr('{{v1}}% бюджета', { v1: Math.round((t.commitments / t.bac) * 100) }) : undefined} warn={t.commitments > t.bac + 0.005} />
        <Tile label={tr('Факт (AC)')} value={fmtMoney(t.actual)} hint={closedPct === null ? undefined : tr('{{closedPct}}% договоров закрыто', { closedPct })} />
        <Tile label={tr('Прогноз (EAC)')} value={fmtMoney(t.eac)} hint={tr('осталось потратить {{v1}}', { v1: fmtMoney(t.etc) })} />
        <Tile label={tr('Отклонение')} value={`${t.variance > 0 ? '+' : ''}${fmtMoney(t.variance)}`} hint={LIGHT[t.light].label.toLowerCase()} warn={t.variance < 0} good={t.variance >= 0 && t.bac > 0} />
      </dl>

      <section aria-labelledby="reserve" className="rounded-lg border bg-card p-4">
        <h3 id="reserve" className="mb-2 text-sm font-semibold">{tr('Резерв на непредвиденные')}</h3>
        {reserve.current === 0 && reserve.initial === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('Резерв не заложен: добавьте статью с типом «Резерв», чтобы видеть, хватает ли его на ожидаемый перерасход.')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label={tr('Заложено изначально')} value={fmtMoney(reserve.initial)} />
              <Mini label={tr('Сейчас в бюджете')} value={fmtMoney(reserve.current)} />
              <Mini label={tr('Ожидаемый перерасход')} value={fmtMoney(reserve.overrun)} />
              <Mini label={tr('Остаток резерва')} value={fmtMoney(reserve.remaining)} bad={reserve.remaining < 0} />
            </dl>
            <p className={`text-sm ${reserve.remaining < 0 ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>
              {reserve.remaining < 0 ? tr('Резерва не хватает на {{v1}}: нужно сократить затраты или запросить изменение бюджета.', { v1: fmtMoney(-reserve.remaining) }) : tr('Ожидаемый перерасход по статьям укладывается в резерв.')}
            </p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{tr('Нажмите на название статьи — договоры и факт по ней')}{canEdit ? tr('; на ETC — внести свой прогноз') : ''}.</p>
        <ExportButton
          fileName={tr('Бюджет')}
          build={() => ({
            name: tr('Бюджет'),
            headers: [tr('Код'), tr('Статья'), tr('Исходный бюджет'), tr('Изменения'), tr('Бюджет (BAC)'), tr('Обязательства'), tr('Факт (AC)'), 'ETC', 'EAC', tr('Отклонение'), tr('Статус')],
            rows: [...model.rows, t].map((r) => [r.code, r.name, r.initial, r.changes, r.bac, r.commitments, r.actual, r.etc, r.eac, r.variance, LIGHT[r.light].label]),
          })}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 min-w-64 bg-muted px-3 py-2 text-left font-medium">{tr('Статья')}</th>
              {[tr('Исходный'), tr('Изменения'), tr('Бюджет (BAC)'), tr('Обязательства'), tr('% закр.'), tr('Факт (AC)'), 'ETC', 'EAC', tr('Отклонение')].map((h) => (
                <th key={h} className="px-3 py-2 text-right font-medium">
                  {h}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">{tr('Статус')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={`border-b ${r.hasChildren ? 'bg-muted/30 font-medium' : ''}`}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal" style={r.hasChildren ? { backgroundColor: 'var(--muted)' } : undefined}>
                  <div className="flex items-center gap-1" style={{ paddingLeft: r.depth * 16 }}>
                    {r.hasChildren ? (
                      <button type="button" aria-label={collapsed.has(r.id) ? tr('Развернуть') : tr('Свернуть')} aria-expanded={!collapsed.has(r.id)} onClick={() => toggle(r.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-background">
                        {collapsed.has(r.id) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                      </button>
                    ) : (
                      <span className="inline-block size-6 shrink-0" />
                    )}
                    <button type="button" className="min-w-0 text-left hover:underline" onClick={() => setDetail(r)}>
                      <span className="ident mr-1.5 text-muted-foreground">{r.code}</span>
                      {r.name}
                    </button>
                  </div>
                </th>
                <Money v={r.initial} />
                <Money v={r.changes} signed />
                <Money v={r.bac} />
                <Money v={r.commitments} warn={r.overCommitted} />
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.commitments > 0 ? `${Math.round((r.actual / r.commitments) * 100)}%` : '—'}</td>
                <Money v={r.actual} />
                <td className="px-3 py-2 text-right tabular-nums">
                  {canEdit && !r.hasChildren ? (
                    <button type="button" title={r.manualEtc ? tr('Прогноз введён вручную') : tr('Расчётный прогноз — нажмите, чтобы указать свой')} onClick={() => setEtcFor(r)} className={`rounded px-1 hover:bg-muted ${r.manualEtc ? 'font-semibold underline decoration-dotted underline-offset-2' : ''}`}>
                      {fmtMoney(r.etc)}
                    </button>
                  ) : (
                    fmtMoney(r.etc)
                  )}
                </td>
                <Money v={r.eac} />
                <Money v={r.variance} signed warn={r.variance < -0.005} />
                <td className="px-3 py-2">
                  <LightBadge light={r.light} />
                </td>
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
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{closedPct === null ? '—' : `${closedPct}%`}</td>
              <Money v={t.actual} />
              <Money v={t.etc} />
              <Money v={t.eac} />
              <Money v={t.variance} signed warn={t.variance < -0.005} />
              <td className="px-3 py-2">
                <LightBadge light={t.light} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{tr('Прогноз остатка (ETC) считается так: берётся большее из бюджета и обязательств по статье, из него вычитается факт. Если экономист ввёл свой прогноз — используется он. EAC = факт + ETC; отклонение = BAC − EAC. «Риск» — перерасход до 5%, «Перерасход» — больше.')}</p>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
          {detail && <ItemDetail row={detail} items={items} commitments={commitments} actuals={actuals} />}
        </SheetContent>
      </Sheet>
      {etcFor && <EtcDialog projectId={projectId} row={etcFor} onClose={() => setEtcFor(null)} />}
    </div>
  )
}

function Tile({ label, value, hint, warn, good }: { label: string; value: string; hint?: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${warn ? 'text-red-700 dark:text-red-300' : good ? 'text-green-700 dark:text-green-300' : ''}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
function Mini({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${bad ? 'text-red-700 dark:text-red-300' : ''}`}>{value}</dd>
    </div>
  )
}
function Money({ v, signed, warn }: { v: number; signed?: boolean; warn?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${warn ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}>
      {Math.abs(v) < 0.005 ? '—' : `${signed && v > 0 ? '+' : ''}${fmtMoney(v)}`}
    </td>
  )
}

function ItemDetail({ row, items, commitments, actuals }: { row: BudgetRow; items: CbsItem[]; commitments: BudgetCommitment[]; actuals: BudgetActual[] }) {
  // статья и все вложенные
  const ids = useMemo(() => {
    const set = new Set<string>([row.id])
    let grew = true
    while (grew) {
      grew = false
      for (const it of items) if (it.parent_id && set.has(it.parent_id) && !set.has(it.id)) (set.add(it.id), (grew = true))
    }
    return set
  }, [row.id, items])
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.code])), [items])
  const cs = commitments.filter((c) => ids.has(c.item_id))
  const as = actuals.filter((a) => ids.has(a.item_id))
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          <span className="ident text-muted-foreground">{row.code}</span> {row.name}
        </SheetTitle>
        <SheetDescription>{tr('Бюджет')}{' '}{fmtMoney(row.bac)}{tr('· обязательства')}{' '}{fmtMoney(row.commitments)}{tr('· факт')}{' '}{fmtMoney(row.actual)}{tr('· прогноз')}{' '}{fmtMoney(row.eac)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <section>
          <h3 className="mb-1.5 text-sm font-semibold">{tr('Договоры')}{' '}{cs.length > 0 && <span className="font-normal text-muted-foreground">{cs.length}</span>}</h3>
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
          <h3 className="mb-1.5 text-sm font-semibold">{tr('Факт затрат')}{' '}{as.length > 0 && <span className="font-normal text-muted-foreground">{as.length}</span>}</h3>
          {as.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('Затрат по статье пока нет.')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {as.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block">
                      {DOC_TYPE_LABELS[a.doc_type]} {a.doc_number ?? ''}
                    </span>
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
      toast.success(amount === null ? tr('Возвращён расчётный прогноз') : tr('Прогноз сохранён'))
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
          <DialogTitle>{tr('Прогноз остатка')}</DialogTitle>
          <DialogDescription>
            {row.code} {row.name}{tr('. Сколько ещё предстоит потратить по статье; факт уже')}{' '}{fmtMoney(row.actual)}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="etc-v">{`ETC, ${cur}`}</Label>
            <Input id="etc-v" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">{tr('Прогноз при завершении (EAC) станет')}{' '}{fmtMoney(row.actual + (Number.isFinite(amount) ? amount : 0))}.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="etc-n">{tr('Основание')}</Label>
            <Input id="etc-n" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={tr('Например, по графику платежей')} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" disabled={busy || !row.manualEtc} onClick={() => save(null)}>{tr('Вернуть расчётный')}</Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="button" disabled={busy || !Number.isFinite(amount) || amount < 0} onClick={() => save(amount)}>{tr('Сохранить')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
