import { toDisplay, useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarRange, FileSpreadsheet, LayoutDashboard, Table2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/features/export/export-button'
import { budgetErrorText, closeMonth, reopenMonth, setForecast, spreadForecast, type BudgetActual, type BudgetForecast, type BudgetModel, type BudgetRow, type BudgetVersion, type CbsItem } from './api'
import { CloseMonthDialog, SpreadDialog } from './lookahead-dialogs'
import { LookaheadImportDialog } from './lookahead-import'
import { buildLookahead } from './lookahead-model'
import { MonthChart, SectionList, SummaryCard, TodoCard } from './lookahead-overview'
import { MonthTable } from './lookahead-table'
import { addMonths, monthLong, THIS_MONTH } from './months'

interface Props {
  projectId: string
  items: CbsItem[]
  model: BudgetModel
  versions: BudgetVersion[]
  actuals: BudgetActual[]
  forecast: BudgetForecast[]
  closedThrough: string | null
  canEdit: boolean
  canApprove: boolean
  canRecord: boolean
}

/**
 * Раскладка бюджета по месяцам. «Обзор» — для всех: итог одной фразой, что нужно сделать, график по месяцам, разделы.
 * «Таблица по месяцам» — для экономиста, как в Excel: закрытые месяцы — факт, открытые — план, правится по нажатию.
 */
export function LookaheadTab({ projectId, items, model, versions, actuals, forecast, closedThrough, canEdit, canApprove, canRecord }: Props) {
  const qc = useQueryClient()
  const { symbol: cur } = useDisplayCurrency()
  const data = useMemo(() => buildLookahead(items, model, forecast, actuals, closedThrough), [items, model, forecast, actuals, closedThrough])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const [view, setView] = useState<'overview' | 'table'>('overview')
  const [spreadFor, setSpreadFor] = useState<BudgetRow | null | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] })
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      await refresh()
      return true
    } catch (e) {
      toast.error(budgetErrorText(e, tr('Не удалось сохранить.')))
      return false
    } finally {
      setBusy(false)
    }
  }

  // следующий месяц к закрытию: после закрытого, а если закрытых нет — прошлый
  const nextToClose = data.closed ? addMonths(data.closed, 1) : addMonths(THIS_MONTH, -1)
  const draft = versions.find((v) => v.status === 'draft') ?? null
  const importDialog = importing && <LookaheadImportDialog projectId={projectId} draft={draft} closedThrough={closedThrough} onClose={() => setImporting(false)} onDone={refresh} />

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
        <h2 className="text-base font-semibold">{tr('Раскладки по месяцам пока нет')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          {tr('Загрузите файл бюджета с месяцами (например, «Budget 2026 — Look Ahead 2027–2028»): статьи с кодами, бюджет, факт прошедших месяцев и прогноз на следующие. Или заведите статьи на вкладке «Бюджет» и разложите их по месяцам здесь.')}
        </p>
        {canEdit && (
          <Button onClick={() => setImporting(true)}>
            <FileSpreadsheet className="size-4" /> {tr('Загрузить из Excel')}
          </Button>
        )}
        {importDialog}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={tr('Вид')} className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              ['overview', tr('Обзор'), LayoutDashboard],
              ['table', tr('Таблица по месяцам'), Table2],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm ${view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {canRecord && (
          <Button variant="outline" size="sm" onClick={() => setSpreadFor(null)}>
            <CalendarRange className="size-4" /> {tr('Разложить по месяцам')}
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileSpreadsheet className="size-4" /> {tr('Загрузить из Excel')}
          </Button>
        )}
        <ExportButton
          fileName={tr('Раскладка бюджета')}
          build={() => ({
            name: tr('Раскладка'),
            headers: [tr('Код'), tr('Статья'), tr('Бюджет'), ...data.allMonths.map((m) => `${m}${data.isClosed(m) ? ` (${tr('факт')})` : ''}`), tr('Не распределено')],
            rows: model.rows.map((r) => {
              const i = data.info.get(r.id)
              return [r.code, r.name, toDisplay(r.bac), ...data.allMonths.map((m) => toDisplay(i?.months.get(m) ?? 0)), toDisplay(i?.un ?? 0)]
            }),
          })}
        />
        {canApprove && data.closed && (
          <Button variant="ghost" size="sm" disabled={busy} title={tr('Если месяц закрыли по ошибке')} onClick={() => run(() => reopenMonth(projectId), tr('{{month}} снова открыт', { month: monthLong(data.closed!) }))}>
            <Undo2 className="size-4" /> {tr('Открыть {{month}}', { month: monthLong(data.closed) })}
          </Button>
        )}
      </div>

      {view === 'overview' ? (
        <>
          <SummaryCard data={data} bac={model.total.bac} versionName={model.basis?.name ?? null} />
          <TodoCard data={data} rows={model.rows} byId={byId} canEdit={canEdit && nextToClose < THIS_MONTH} canRecord={canRecord} nextToClose={nextToClose} onCloseMonth={() => setClosing(true)} onSpread={(r) => setSpreadFor(r)} />
          <MonthChart data={data} />
          <SectionList rows={model.rows} data={data} byId={byId} canRecord={canRecord} onSpread={(r) => setSpreadFor(r)} />
        </>
      ) : (
        <MonthTable rows={model.rows} data={data} byId={byId} canRecord={canRecord} cur={cur} onSave={(id, m, x) => run(() => setForecast(id, m, x))} onSpread={(r) => setSpreadFor(r)} />
      )}

      {spreadFor !== undefined && (
        <SpreadDialog
          rows={model.rows}
          initial={spreadFor}
          closedFact={(id) => data.info.get(id)?.fact ?? 0}
          firstOpen={data.firstOpen}
          busy={busy}
          onClose={() => setSpreadFor(undefined)}
          onSpread={async (v) => {
            const ok = await run(() => spreadForecast(v), tr('План разложен по месяцам'))
            if (ok) setSpreadFor(undefined)
          }}
        />
      )}
      {closing && (
        <CloseMonthDialog
          month={nextToClose}
          expected={data.grand.months.get(nextToClose) ?? 0}
          acts={data.grand.pending.get(nextToClose) ?? 0}
          busy={busy}
          onClose={() => setClosing(false)}
          onConfirm={async () => {
            const ok = await run(() => closeMonth(projectId, `${nextToClose}-01`), tr('{{month}} закрыт', { month: monthLong(nextToClose) }))
            if (ok) setClosing(false)
          }}
        />
      )}
      {importDialog}
    </div>
  )
}
