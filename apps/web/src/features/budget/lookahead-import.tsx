import { otherCurrency, symbolOf } from '@/features/projects/currency'
import { useDisplayCurrency } from '@/features/projects/display-currency'
import { tr } from '@/lib/tr'
import { FileSpreadsheet, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { budgetErrorText, createDraft, fmtMoney, importLookahead, type BudgetVersion } from './api'
import { readSheets, type Sheet } from './read-sheets'
import { addMonths, monthLong, THIS_MONTH } from './months'
import { buildPayload, detectLayout, parseLookahead, type Layout } from './lookahead-parse'

const NONE = '__none__'

/** Загрузка файла раскладки: статьи с кодами, бюджет, факт прошедших месяцев и прогноз — в черновик версии. */
export function LookaheadImportDialog({
  projectId,
  draft,
  closedThrough,
  onClose,
  onDone,
}: {
  projectId: string
  draft: BudgetVersion | null
  closedThrough: string | null
  onClose: () => void
  onDone: () => Promise<unknown> | void
}) {
  const { base, rate } = useDisplayCurrency()
  const otherCode = otherCurrency(base)
  const [file, setFile] = useState<{ name: string; sheets: { sheet: Sheet; layout: Layout }[] } | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [closed, setClosed] = useState<string>(NONE)
  // валюта сумм в файле; если не основная — пересчёт по курсу проекта (лари за 1 доллар)
  const [fileCurrency, setFileCurrency] = useState(base)
  const factor = fileCurrency === base || !rate ? 1 : base === 'GEL' ? rate : 1 / rate
  const [versionName, setVersionName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current = file?.sheets[sheetIdx]
  const parsed = useMemo(() => (current ? parseLookahead(current.sheet.rows, current.layout) : null), [current])
  const lastClosable = addMonths(THIS_MONTH, -1)
  const closeOptions = useMemo(() => (current ? current.layout.months.map((m) => m.month).filter((m) => m <= lastClosable) : []), [current, lastClosable])
  const result = useMemo(() => (parsed ? buildPayload(parsed, closed === NONE ? null : closed, factor) : null), [parsed, closed, factor])

  async function pick(f: File) {
    setError(null)
    try {
      const sheets = (await readSheets(f)).flatMap((sheet) => {
        const layout = detectLayout(sheet.rows)
        return layout ? [{ sheet, layout }] : []
      })
      if (sheets.length === 0) {
        setFile(null)
        setError(tr('В файле не нашлось листа с раскладкой. Нужна строка заголовков с колонками «N» (код), «Grand Budget» (бюджет) и месяцами.'))
        return
      }
      setFile({ name: f.name, sheets })
      setSheetIdx(0)
      const p = parseLookahead(sheets[0].sheet.rows, sheets[0].layout)
      const auto = p.lastFactMonth && p.lastFactMonth <= lastClosable ? p.lastFactMonth : closedThrough ? closedThrough.slice(0, 7) : null
      setClosed(auto ?? NONE)
      // в шапке листа упомянута другая валюта (например, «USD») — скорее всего, суммы в ней
      const head = sheets[0].sheet.rows.slice(0, sheets[0].layout.header + 1).flat().map((c) => String(c ?? '')).join(' ')
      setFileCurrency(rate && new RegExp(`\\b${otherCode}\\b|${otherCode === 'USD' ? '\\$' : '₾'}`).test(head) ? otherCode : base)
      setVersionName(f.name.match(/\((V\d+)\)/i)?.[1]?.toUpperCase() ?? tr('Из Excel'))
    } catch {
      setError(tr('Не удалось прочитать файл. Подойдёт .xlsx.'))
    }
  }

  async function submit() {
    if (!result) return
    setBusy(true)
    try {
      const versionId = draft?.id ?? (await createDraft(projectId, versionName.trim() || undefined))
      const r = await importLookahead(versionId, result.payload)
      toast.success(
        tr('Загружено статей: {{items}}, записей факта: {{actuals}}, месяцев прогноза: {{forecast}}. Утвердите черновик на вкладке «Бюджет».', { items: r.rows, actuals: r.actuals, forecast: r.forecast }),
        { duration: 10000 },
      )
      await onDone()
      onClose()
    } catch (e) {
      setError(budgetErrorText(e, tr('Не удалось загрузить раскладку.')))
      await onDone()
    } finally {
      setBusy(false)
    }
  }

  const s = result?.summary
  const unallocated = s?.warnings.filter((w) => w.kind === 'unallocated') ?? []
  const other = s?.warnings.filter((w) => w.kind !== 'unallocated') ?? []

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Загрузить раскладку из Excel')}</DialogTitle>
          <DialogDescription>
            {tr('Статьи создаются по кодам, бюджет попадает в черновик версии, факт прошедших месяцев — в «Факт» строками «Перенесено из Excel», остальные месяцы — в прогноз. Повторная загрузка заменяет перенесённый факт и прогноз этих статей.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 hover:bg-muted/40">
            <FileSpreadsheet className="size-6 text-muted-foreground" />
            <span className="min-w-0 text-sm">
              {file ? <span className="font-medium break-all">{file.name}</span> : tr('Выберите файл .xlsx')}
              <span className="block text-xs text-muted-foreground">{tr('Подойдёт лист бюджета с кодами статей, бюджетом и месяцами.')}</span>
            </span>
            <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          </label>

          {file && current && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="la-sheet">{tr('Лист')}</Label>
                <Select value={String(sheetIdx)} onValueChange={(v) => setSheetIdx(Number(v))}>
                  <SelectTrigger id="la-sheet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {file.sheets.map((x, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {x.sheet.name.trim()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="la-closed">{tr('Факт по месяц включительно')}</Label>
                <Select value={closed} onValueChange={setClosed}>
                  <SelectTrigger id="la-closed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>{tr('Все месяцы — прогноз')}</SelectItem>
                    {closeOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {monthLong(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="la-currency">{tr('Валюта сумм в файле')}</Label>
                <Select value={fileCurrency} onValueChange={setFileCurrency}>
                  <SelectTrigger id="la-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={base}>{tr('{{cur}} — основная валюта проекта', { cur: symbolOf(base) })}</SelectItem>
                    {rate && (
                      <SelectItem value={otherCode}>{tr('{{cur}} — пересчитать по курсу проекта {{rate}}', { cur: symbolOf(otherCode), rate })}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!rate && <p className="text-xs text-muted-foreground">{tr('Чтобы загрузить суммы в другой валюте, укажите курс в карточке проекта.')}</p>}
              </div>
              {!draft && (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="la-version">{tr('Название новой версии бюджета')}</Label>
                  <Input id="la-version" value={versionName} maxLength={120} onChange={(e) => setVersionName(e.target.value)} />
                </div>
              )}
              {draft && <p className="text-sm text-muted-foreground sm:col-span-2">{tr('Бюджет загрузится в открытый черновик «{{name}}».', { name: draft.name })}</p>}
            </div>
          )}

          {s && parsed && (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label={tr('Статей')} value={String(parsed.items.length)} />
                <Stat label={tr('Бюджет')} value={fmtMoney(s.budget)} />
                <Stat label={tr('Факт')} value={fmtMoney(s.fact)} />
                <Stat label={tr('Прогноз')} value={fmtMoney(s.forecast)} hint={s.firstForecastMonth && s.lastForecastMonth ? `${monthLong(s.firstForecastMonth)} – ${monthLong(s.lastForecastMonth)}` : undefined} />
              </dl>

              {unallocated.length > 0 && (
                <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-red-800 dark:text-red-300">
                    <TriangleAlert className="size-4" /> {tr('Месяцы не сходятся с бюджетом')}
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                    {unallocated.map((w) => (
                      <li key={w.code}>
                        <span className="ident text-foreground">{w.code}</span> {w.name}:{' '}
                        {w.kind === 'unallocated' && (w.diff < 0 ? tr('по месяцам на {{sum}} больше бюджета', { sum: fmtMoney(-w.diff) }) : tr('не разложено {{sum}}', { sum: fmtMoney(w.diff) }))}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">{tr('Загрузится как есть — исправить можно потом в раскладке, колонка «Не распределено».')}</p>
                </div>
              )}

              {s.fixedCodes.length > 0 && (
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{tr('Исправлено кодов: {{count}}', { count: s.fixedCodes.length })}</summary>
                  <p className="mt-1 text-xs text-muted-foreground">{tr('В файле коды повторялись или не совпадали с разделом (например, 2.10 записано числом 2.1). Код из файла сохранится у статьи.')}</p>
                  <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                    {s.fixedCodes.map((it) => (
                      <li key={it.row} className="truncate">
                        <span className="ident text-muted-foreground line-through">{it.sourceCode}</span> → <span className="ident font-medium">{it.code}</span> {it.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {other.length > 0 && (
                <ul className="text-xs text-amber-800 dark:text-amber-300">
                  {other.map((w, i) => (
                    <li key={i}>
                      {w.kind === 'duplicate_code' ? tr('Код {{code}} повторяется: «{{name}}»', { code: w.code, name: w.name }) : tr('У группы {{code}} «{{name}}» сумма меньше суммы вложенных статей', { code: w.code, name: w.name })}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={busy || !result || result.payload.items.length === 0} onClick={() => void submit()}>
            {busy ? tr('Загружаем…') : tr('Загрузить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
