import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ChevronDown, ChevronUp, FileSpreadsheet, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VERSION_STATUS_LABELS, versionsQuery } from '@/features/documents/api'
import { compareTextQuery, compareVersionQuery, fileKind, sheetsQuery, type CompareFile, type CompareVersion } from '@/features/documents/compare/api'
import { compareFileName, exportTextDiff, exportWorkbookDiff, STATUS_LABEL, type SideInfo } from '@/features/documents/compare/export'
import { fmtCell, fmtNumber, fmtPercent, fmtSigned, trend } from '@/features/documents/compare/format'
import type { DiffRow, RawSheet, RowStatus, TableDiff } from '@/features/documents/compare/table-diff'
import { compareTexts, type TextBlock } from '@/features/documents/compare/text-diff'
import {
  applyOverrides,
  autoMatchSheets,
  compareWorkbooks,
  sheetCounts,
  sheetHasChanges,
  sheetTitle,
  workbookCounts,
  workbookTotals,
  type SheetMatch,
  type SheetResult,
  type SheetSettings,
} from '@/features/documents/compare/workbook-diff'

const PAGE = 200
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

const ROW_TINT: Record<RowStatus, string> = {
  added: 'bg-green-500/10',
  removed: 'bg-red-500/10',
  changed: 'bg-amber-500/10',
  same: '',
}
const BADGE: Record<RowStatus, string> = {
  added: 'bg-green-500/15 text-green-800 dark:text-green-300',
  removed: 'bg-red-500/15 text-red-800 dark:text-red-300',
  changed: 'bg-amber-500/20 text-amber-900 dark:text-amber-300',
  same: 'bg-muted text-muted-foreground',
}

type Filter = 'diff' | RowStatus

const sideInfo = (v: CompareVersion): SideInfo => ({ title: v.document.title, revision: v.revision || `№${v.version_no}`, fileName: v.file?.name ?? '' })

// ---------------------------------------------------------------------------
// Экран
// ---------------------------------------------------------------------------

/** Сравнение двух версий: выбор версий сверху, результат ниже. a — «было», b — «стало». */
export function CompareScreen({ a, b, onChange }: { a: string; b: string; onChange: (a: string, b: string) => void }) {
  const qa = useQuery(compareVersionQuery(a))
  const qb = useQuery(compareVersionQuery(b))

  if (qa.isPending || qb.isPending) return <p className="text-sm text-muted-foreground">{tr('Загружаем версии…')}</p>
  if (!qa.data || !qb.data) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-soft">
        <p className="font-medium">{tr('Версия не найдена')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{tr('Возможно, она удалена или у вас нет к ней доступа: внешним участникам доступны только действующие версии.')}</p>
      </div>
    )
  }
  const va = qa.data
  const vb = qb.data

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
        <SidePicker label={tr('Было')} version={va} onPick={(id) => onChange(id, b)} />
        <div className="flex items-center justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(b, a)} title={tr('Поменять «было» и «стало» местами')}>
            <ArrowLeftRight />{tr('Поменять')}</Button>
        </div>
        <SidePicker label={tr('Стало')} version={vb} onPick={(id) => onChange(a, id)} />
      </div>

      {va.id === vb.id ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-soft">{tr('Выбрана одна и та же версия. Выберите другую справа или слева, чтобы увидеть, что изменилось.')}</p>
      ) : (
        <CompareBody va={va} vb={vb} />
      )}
    </div>
  )
}

function SidePicker({ label, version, onPick }: { label: string; version: CompareVersion; onPick: (id: string) => void }) {
  const { data: versions } = useQuery(versionsQuery(version.document.id))
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3.5 shadow-soft" aria-label={label}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="min-w-0">
        <p className="truncate font-medium">{version.document.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {version.document.code && <span className="ident">{version.document.code} · </span>}
          {version.file?.name ?? tr('файл недоступен')}
        </p>
      </div>
      <Select value={version.id} onValueChange={onPick}>
        <SelectTrigger size="sm" aria-label={tr('Версия: {{label}}', { label })} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(versions ?? [{ id: version.id, revision: version.revision, version_no: version.version_no, status: version.status, created_at: version.created_at }]).map((v) => (
            <SelectItem key={v.id} value={v.id}>
              <span className="ident font-medium">{v.revision || `№${v.version_no}`}</span> · {VERSION_STATUS_LABELS[v.status]} · {dateFmt.format(new Date(v.created_at))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-soft">{children}</div>
}

function CompareBody({ va, vb }: { va: CompareVersion; vb: CompareVersion }) {
  if (!va.file || !vb.file) return <Note>{tr('У одной из версий нет файла, сверять нечего.')}</Note>
  const ka = fileKind(va.file.name)
  const kb = fileKind(vb.file.name)
  if (ka === 'unsupported' || kb === 'unsupported') {
    const bad = ka === 'unsupported' ? va.file.name : vb.file.name
    return (
      <Note>{tr('Файл «')}{bad}{tr('» сверить по содержимому нельзя: чертежи DWG, картинки и старые файлы .xls не читаются. Загрузите версию в PDF с текстовым слоем, Word или Excel (.xlsx) — тогда сверка заработает.')}</Note>
    )
  }
  if (ka === 'table' && kb === 'table') return <TableCompare va={va} vb={vb} fa={va.file} fb={vb.file} />
  return <TextCompare va={va} vb={vb} fa={va.file} fb={vb.file} mixed={ka !== kb} />
}

// ---------------------------------------------------------------------------
// Общие части
// ---------------------------------------------------------------------------

function Stat({ label, value, tone, active, onClick }: { label: string; value: number; tone: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col gap-0.5 rounded-lg border bg-card px-3.5 py-3 text-left shadow-soft outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring ${active ? 'ring-2 ring-primary/60' : ''}`}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
    </button>
  )
}

function Summary({ counts, filter, setFilter }: { counts: Record<RowStatus, number>; filter: Filter; setFilter: (f: Filter) => void }) {
  const toggle = (f: Filter) => setFilter(filter === f ? 'diff' : f)
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={tr('Добавлено')} value={counts.added} tone="text-green-700 dark:text-green-300" active={filter === 'added'} onClick={() => toggle('added')} />
      <Stat label={tr('Удалено')} value={counts.removed} tone="text-red-700 dark:text-red-300" active={filter === 'removed'} onClick={() => toggle('removed')} />
      <Stat label={tr('Изменено')} value={counts.changed} tone="text-amber-700 dark:text-amber-300" active={filter === 'changed'} onClick={() => toggle('changed')} />
      <Stat label={tr('Без изменений')} value={counts.same} tone="text-muted-foreground" active={filter === 'same'} onClick={() => toggle('same')} />
    </div>
  )
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'diff', label: tr('Все различия') },
  { value: 'added', label: tr('Добавлено') },
  { value: 'removed', label: tr('Удалено') },
  { value: 'changed', label: tr('Изменено') },
  { value: 'same', label: tr('Без изменений') },
]

function FilterBar({ filter, setFilter, children }: { filter: Filter; setFilter: (f: Filter) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={tr('Фильтр по типу изменения')} className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button key={f.value} type="button" size="sm" variant={filter === f.value ? 'secondary' : 'ghost'} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Button>
        ))}
      </div>
      {children}
    </div>
  )
}

function ExcelButton({ onExport, disabled, label = tr('Выгрузить в Excel') }: { onExport: () => Promise<void>; disabled?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || busy}
      title={tr('Выгрузить в Excel то, что показано на экране, и итоги')}
      onClick={async () => {
        setBusy(true)
        await onExport()
        setBusy(false)
      }}
    >
      <FileSpreadsheet /> {label}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Таблицы (Excel, CSV): книга целиком, лист за листом
// ---------------------------------------------------------------------------

function TableCompare({ va, vb, fa, fb }: { va: CompareVersion; vb: CompareVersion; fa: CompareFile; fb: CompareFile }) {
  const qa = useQuery(sheetsQuery(fa))
  const qb = useQuery(sheetsQuery(fb))
  if (qa.isPending || qb.isPending) return <p className="text-sm text-muted-foreground">{tr('Читаем таблицы…')}</p>
  if (qa.isError || qb.isError || !qa.data || !qb.data) {
    return <Note>{tr('Не удалось прочитать файл. Проверьте, что это обычная таблица Excel (.xlsx) или CSV, и попробуйте ещё раз.')}</Note>
  }
  if (qa.data.length === 0 || qb.data.length === 0) return <Note>{tr('В одном из файлов нет листов с данными.')}</Note>
  return <WorkbookCompare va={va} vb={vb} sheetsA={qa.data} sheetsB={qb.data} />
}

const MATCHED_BY: Record<SheetMatch['by'], string> = { name: tr('по названию'), order: tr('по порядку'), manual: tr('вручную') }

function WorkbookCompare({ va, vb, sheetsA, sheetsB }: { va: CompareVersion; vb: CompareVersion; sheetsA: RawSheet[]; sheetsB: RawSheet[] }) {
  const [overrides, setOverrides] = useState<Record<number, number | null>>({})
  const [settings, setSettings] = useState<Record<string, SheetSettings>>({})
  const [filter, setFilter] = useState<Filter>('diff')
  const [selected, setSelected] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)

  const auto = useMemo(() => autoMatchSheets(sheetsA, sheetsB), [sheetsA, sheetsB])
  const matches = useMemo(() => applyOverrides(auto, sheetsB, overrides), [auto, sheetsB, overrides])
  const results = useMemo(() => compareWorkbooks(sheetsA, sheetsB, matches, settings), [sheetsA, sheetsB, matches, settings])
  const counts = useMemo(() => workbookCounts(results), [results])
  const totals = useMemo(() => workbookTotals(results), [results])
  const info = { a: sideInfo(va), b: sideInfo(vb) }

  const current =
    results.find((r) => r.id === selected) ??
    results.find((r) => r.kind === 'compared' && sheetHasChanges(r)) ??
    results.find((r) => r.kind === 'compared' || r.kind === 'unmatched') ??
    results[0]
  const multi = results.length > 1
  const count = (k: SheetResult['kind']) => results.filter((r) => r.kind === k).length
  const patch = (id: string, p: SheetSettings) => setSettings((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  const setF = (f: Filter) => setFilter(f)

  return (
    <div className="flex flex-col gap-4">
      <Summary counts={counts} filter={filter} setFilter={setF} />
      {multi && (
        <p className="text-sm text-muted-foreground">{tr('Сводка по всей книге: листов в «было»')}{' '}{sheetsA.length}{tr(', в «стало»')}{' '}{sheetsB.length}{tr('. Сопоставлено')}{' '}{count('compared') + count('unmatched')}
          {count('added') > 0 && tr(', новых {{v1}}', { v1: count('added') })}
          {count('removed') > 0 && tr(', удалено {{v1}}', { v1: count('removed') })}{tr('. Строки новых листов считаются добавленными, удалённых — удалёнными.')}</p>
      )}
      <TotalsTable title={multi ? tr('Итоги по колонкам всей книги') : tr('Итоги по колонкам')} totals={totals} />

      <div className="flex flex-wrap items-center gap-2">
        {multi && <h2 className="text-base font-semibold">{tr('Листы')}</h2>}
        <div className="ml-auto flex gap-2">
          {(sheetsA.length > 1 || sheetsB.length > 1) && (
            <Button type="button" variant="ghost" size="sm" aria-expanded={matching} onClick={() => setMatching((v) => !v)}>
              <Settings2 />{tr('Сопоставление листов')}{' '}{matching ? <ChevronUp /> : <ChevronDown />}
            </Button>
          )}
          <ExcelButton label={tr('Выгрузить в Excel (все листы)')} onExport={() => exportWorkbookDiff(compareFileName(info.a, info.b), results, info.a, info.b)} />
        </div>
      </div>

      {matching && (
        <MatchingPanel
          sheetsA={sheetsA}
          sheetsB={sheetsB}
          matches={matches}
          onPick={(a, b) => setOverrides((prev) => ({ ...prev, [a]: b }))}
          manual={Object.keys(overrides).length > 0}
          onReset={() => setOverrides({})}
        />
      )}

      {multi && <SheetList results={results} currentId={current.id} onSelect={setSelected} />}
      {current && <SheetDetail key={current.id} result={current} multi={multi} filter={filter} setFilter={setF} onSettings={(p) => patch(current.id, p)} settings={settings[current.id] ?? {}} />}
    </div>
  )
}

/** Состояние листа одним словом и цветом. */
function sheetBadge(r: SheetResult): { label: string; cls: string } {
  switch (r.kind) {
    case 'added':
      return { label: tr('Новый лист'), cls: BADGE.added }
    case 'removed':
      return { label: tr('Лист удалён'), cls: BADGE.removed }
    case 'unmatched':
      return { label: tr('Не сопоставлен'), cls: BADGE.changed }
    default:
      return sheetHasChanges(r) ? { label: tr('Есть изменения'), cls: BADGE.changed } : { label: tr('Без изменений'), cls: BADGE.same }
  }
}

function SheetList({ results, currentId, onSelect }: { results: SheetResult[]; currentId: string; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={tr('Листы книги')}>
      {results.map((r) => {
        const c = sheetCounts(r)
        const b = sheetBadge(r)
        const active = r.id === currentId
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={active}
              className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? 'bg-muted/50' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{sheetTitle(r)}</span>
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
              {r.kind === 'compared' || r.kind === 'unmatched' ? (
                r.by !== 'name' && <span className="text-xs text-muted-foreground">{tr('сопоставлен')}{' '}{MATCHED_BY[r.by]}</span>
              ) : (
                <span className="text-xs text-muted-foreground">{tr('строк:')}{' '}{r.rows}</span>
              )}
              {r.kind === 'compared' && (
                <span className="flex gap-2 text-xs tabular-nums">
                  <span className={c.added ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}>+{c.added}</span>
                  <span className={c.removed ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}>−{c.removed}</span>
                  <span className={c.changed ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>~{c.changed}</span>
                </span>
              )}
              <span className="text-xs text-muted-foreground">{active ? tr('открыт ниже') : tr('показать различия')}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function MatchingPanel({
  sheetsA,
  sheetsB,
  matches,
  onPick,
  manual,
  onReset,
}: {
  sheetsA: RawSheet[]
  sheetsB: RawSheet[]
  matches: SheetMatch[]
  onPick: (a: number, b: number | null) => void
  manual: boolean
  onReset: () => void
}) {
  const NONE = '__none__'
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm shadow-soft">
      <p className="text-xs text-muted-foreground">{tr('Листы сопоставляются по названию. Если лист переименовали, выберите для него пару вручную; лист без пары считается удалённым, а лишний лист «стало» — новым.')}</p>
      <ul className="flex flex-col gap-2">
        {sheetsA.map((s, a) => {
          const m = matches.find((x) => x.a === a)
          return (
            <li key={a} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <span className="truncate font-medium">{tr('Было:')}{' '}{s.name}</span>
              <span className="hidden text-muted-foreground sm:block">→</span>
              <Select value={m?.b === null || m?.b === undefined ? NONE : String(m.b)} onValueChange={(v) => onPick(a, v === NONE ? null : Number(v))}>
                <SelectTrigger size="sm" aria-label={tr('Пара для листа «{{name}}»', { name: s.name })} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{tr('Нет пары — лист удалён')}</SelectItem>
                  {sheetsB.map((t, b) => (
                    <SelectItem key={b} value={String(b)}>{tr('Стало:')}{' '}{t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>
      {manual && (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={onReset}>{tr('Сопоставить автоматически')}</Button>
      )}
    </div>
  )
}

function SheetDetail({
  result,
  multi,
  filter,
  setFilter,
  settings,
  onSettings,
}: {
  result: SheetResult
  multi: boolean
  filter: Filter
  setFilter: (f: Filter) => void
  settings: SheetSettings
  onSettings: (p: SheetSettings) => void
}) {
  const [query, setQuery] = useState('')
  const [allColumns, setAllColumns] = useState(false)
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const diff = result.kind === 'compared' ? result.diff : null
  const rows = useMemo(() => {
    if (!diff) return []
    const q = query.trim().toLowerCase()
    return diff.rows.filter((r) => (filter === 'diff' ? r.status !== 'same' : r.status === filter) && (!q || r.key.toLowerCase().includes(q)))
  }, [diff, filter, query])

  if (result.kind === 'added' || result.kind === 'removed') {
    const added = result.kind === 'added'
    return (
      <Note>{tr('Лист «')}{result.nameA ?? result.nameB}» {added ? tr('есть только в «стало» — это новый лист') : tr('есть только в «было» — в новой версии его нет')}{tr('. Строк на нём:')}{' '}{result.rows}
        {added ? tr(', все они учтены как добавленные.') : tr(', все они учтены как удалённые.')}
        {tr(' Если лист просто переименовали, свяжите его с парой в «Сопоставлении листов».')}
      </Note>
    )
  }

  const settingsPanel = open && <SheetSettingsPanel result={result} settings={settings} onSettings={onSettings} />

  if (result.kind === 'unmatched') {
    return (
      <div className="flex flex-col gap-2">
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">{tr('Лист «')}{sheetTitle(result)}{tr('» не удалось сверить')}</p>
          <p className="mt-1 text-muted-foreground">{tr('В таблицах нет колонок с одинаковыми названиями, поэтому строки сопоставить нельзя. В «было»:')}{' '}{result.ta.headers.slice(0, 8).join(', ') || '—'}{tr('; в «стало»:')}{' '}{result.tb.headers.slice(0, 8).join(', ') || '—'}{tr('. Если заголовки лежат не в первой строке или лист не тот, поправьте это в настройках.')}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Settings2 />{tr('Настройки листа')}{' '}{open ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
        {settingsPanel}
      </div>
    )
  }

  const d = result.diff
  // по умолчанию: числа, всё, что менялось, и первая текстовая колонка (наименование) — чтобы строка читалась
  const nameCol = d.columns.findIndex((c) => !c.isKey && !c.isNumbering && !c.numeric)
  const shownCols = d.columns.map((c, i) => ({ c, i })).filter(({ c, i }) => !c.isKey && (allColumns || c.numeric || c.hasChanges || i === nameCol))
  const keyNames = result.keys.map((k) => result.common.cols.find((c) => c.norm === k)?.name ?? k).join(' + ')

  return (
    <section className="flex flex-col gap-3" aria-label={tr('Различия: {{v1}}', { v1: sheetTitle(result) })}>
      {multi && <h2 className="text-base font-semibold">{tr('Лист «')}{sheetTitle(result)}»</h2>}
      {multi && <TotalsTable title={tr('Итоги по листу')} totals={d.totals} />}

      {(d.onlyA.length > 0 || d.onlyB.length > 0 || d.duplicateKeys > 0) && (
        <ul className="flex list-disc flex-col gap-1 rounded-lg border bg-card py-3 pl-8 pr-4 text-sm text-muted-foreground shadow-soft">
          {d.onlyA.length > 0 && <li>{tr('Колонки только в «было», в сверку не вошли:')}{' '}{d.onlyA.join(', ')}.</li>}
          {d.onlyB.length > 0 && <li>{tr('Колонки только в «стало», в сверку не вошли:')}{' '}{d.onlyB.join(', ')}.</li>}
          {d.duplicateKeys > 0 && (
            <li>{tr('У')}{' '}{d.duplicateKeys}{tr('строк ключ повторяется: они сопоставлены по порядку. Выберите в настройках другой ключ или несколько колонок, если это неверно.')}</li>
          )}
        </ul>
      )}

      <FilterBar
        filter={filter}
        setFilter={(f) => {
          setFilter(f)
          setLimit(PAGE)
        }}
      >
        <Input aria-label={tr('Найти по ключу')} placeholder={tr('Найти по ключу')} className="h-8 w-full sm:w-48" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />{tr('Все колонки')}</label>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Settings2 />{tr('Настройки листа')}{' '}{open ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </FilterBar>
      {settingsPanel}

      <p className="text-xs text-muted-foreground">{tr('Ключ сопоставления строк:')}{' '}<span className="font-medium text-foreground">{keyNames || '—'}</span>
        {settings.key === undefined && tr(' (определён автоматически)')}{tr('. Рост показан красным ▲, снижение — зелёным ▼.')}</p>

      {rows.length === 0 ? (
        <Note>{d.counts.added + d.counts.removed + d.counts.changed === 0 ? tr('Различий нет: листы совпадают.') : tr('По этим условиям строк нет.')}</Note>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-28">{tr('Что с ней')}</TableHead>
                <TableHead className="min-w-40">{d.columns.filter((c) => c.isKey).map((c) => c.name).join(' · ') || tr('Ключ')}</TableHead>
                {shownCols.map(({ c, i }) => (
                  <TableHead key={i} className={c.numeric ? 'text-right' : ''}>
                    {c.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((r, idx) => (
                <DiffTableRow key={idx} row={r} cols={shownCols} diff={d} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rows.length > limit && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">{tr('Показано')}{' '}{limit}{tr('из')}{' '}{rows.length}
          <Button type="button" size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>{tr('Показать ещё')}</Button>
        </div>
      )}
    </section>
  )
}

function SheetSettingsPanel({ result, settings, onSettings }: { result: Extract<SheetResult, { kind: 'compared' | 'unmatched' }>; settings: SheetSettings; onSettings: (p: SheetSettings) => void }) {
  const keys = result.kind === 'compared' ? result.keys : []
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-sm shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          [tr('Было'), result.nameA, settings.headerA ?? '', (v: string) => onSettings({ headerA: v }), result.ta.headerRow],
          [tr('Стало'), result.nameB, settings.headerB ?? '', (v: string) => onSettings({ headerB: v }), result.tb.headerRow],
        ] as const).map(([label, name, header, set, auto]) => (
          <label key={label} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {label}: {name}
            </span>
            <span className="text-muted-foreground">{tr('строка с заголовками')}</span>
            <Input inputMode="numeric" aria-label={tr('Строка с заголовками: {{label}}', { label })} className="h-8 w-20" placeholder={String(auto)} value={header} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} />
            {!header && <span className="text-xs text-muted-foreground">{tr('определена сама')}</span>}
          </label>
        ))}
      </div>

      {result.kind === 'compared' && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-medium">{tr('По каким колонкам считать строки одной и той же')}</legend>
          <p className="text-xs text-muted-foreground">{tr('Обычно это шифр, артикул или наименование. Можно отметить несколько колонок сразу. Ключ задаётся для каждого листа отдельно.')}</p>
          <div className="flex flex-wrap gap-1.5">
            {result.common.cols.map((c) => {
              const on = keys.includes(c.norm)
              return (
                <button
                  key={c.norm}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSettings({ key: on ? keys.filter((k) => k !== c.norm) : [...keys, c.norm] })}
                  className={`min-h-8 rounded-md border px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'border-primary bg-primary/10 font-medium' : 'bg-background hover:bg-muted/50'}`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
          {settings.key !== undefined && (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => onSettings({ key: undefined })}>{tr('Определить ключ автоматически')}</Button>
          )}
        </fieldset>
      )}
    </div>
  )
}

interface TotalRow {
  name: string
  mode: 'sum' | 'avg'
  before: number
  after: number
  delta: number
  pct: number | null
  fromAdded: number
  fromRemoved: number
  fromChanged: number
  up: number
  down: number
}

function TotalsTable({ title, totals }: { title: string; totals: TotalRow[] }) {
  if (totals.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>{tr('Колонка')}</TableHead>
              <TableHead className="text-right">{tr('Было')}</TableHead>
              <TableHead className="text-right">{tr('Стало')}</TableHead>
              <TableHead className="text-right">{tr('Разница')}</TableHead>
              <TableHead className="hidden text-right md:table-cell">{tr('Из чего сложилась')}</TableHead>
              <TableHead className="hidden text-right lg:table-cell">{tr('Значений')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totals.map((t) => {
              const tnd = trend(t.delta)
              return (
                <TableRow key={t.name}>
                  <TableCell className="font-medium">
                    {t.name}
                    {t.mode === 'avg' && <span className="font-normal text-muted-foreground">{tr('· среднее')}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNumber(t.before)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNumber(t.after)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${tnd.cls}`}>
                    {tnd.arrow} {fmtSigned(t.delta)} <span className="font-normal">({fmtPercent(t.pct)})</span>
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums md:table-cell">
                    {t.mode === 'avg'
                      ? tr('среднее по заполненным строкам')
                      : tr('новые {{v1}} · удалённые {{v2}} · изменения {{v3}}', { v1: fmtSigned(t.fromAdded), v2: fmtSigned(t.fromRemoved), v3: fmtSigned(t.fromChanged) })}
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums lg:table-cell">
                    <span className={t.up ? TREND_UP : ''}>▲ {t.up}</span> · <span className={t.down ? TREND_DOWN : ''}>▼ {t.down}</span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{tr('Суммы считаются по всем строкам, кроме строк «Итого». Для цен, ставок и процентов вместо суммы берётся среднее.')}</p>
    </section>
  )
}

const TREND_UP = trend(1).cls
const TREND_DOWN = trend(-1).cls

function DiffTableRow({ row, cols, diff }: { row: DiffRow; cols: { c: TableDiff['columns'][number]; i: number }[]; diff: TableDiff }) {
  return (
    <TableRow className={`${ROW_TINT[row.status]} ${row.status === 'removed' ? 'text-muted-foreground' : ''}`}>
      <TableCell className="align-top">
        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{tr('стр.')}{' '}{row.rowA ?? '—'} → {row.rowB ?? '—'}</span>
      </TableCell>
      <TableCell className={`whitespace-normal align-top font-medium ${row.status === 'removed' ? 'line-through' : ''}`}>{row.key || '—'}</TableCell>
      {cols.map(({ c, i }) => {
        const ch = row.changes.find((x) => x.col === i)
        const num = c.numeric
        const align = num ? 'text-right tabular-nums' : ''
        if (ch && ch.numeric && ch.delta !== null) {
          const tnd = trend(ch.delta)
          return (
            <TableCell key={i} className={`align-top ${align}`}>
              <span className="font-medium">{fmtCell(ch.after) || '—'}</span>
              <span className="block text-xs text-muted-foreground">{tr('было')}{' '}{fmtCell(ch.before) || '—'}</span>
              <span className={`block text-xs font-medium ${tnd.cls}`}>
                {tnd.arrow} {fmtSigned(ch.delta)} ({fmtPercent(ch.pct)})
              </span>
            </TableCell>
          )
        }
        if (ch) {
          return (
            <TableCell key={i} className={`whitespace-normal align-top ${align}`}>
              <span className="font-medium">{fmtCell(ch.after) || '—'}</span>
              <span className="block text-xs text-muted-foreground line-through">{fmtCell(ch.before) || '—'}</span>
            </TableCell>
          )
        }
        const v = (row.status === 'removed' ? row.a : row.b)?.[i]
        return (
          <TableCell key={i} className={`whitespace-normal align-top ${align} ${diff.columns[i].numeric ? '' : 'text-muted-foreground'}`}>
            {fmtCell(v) || ''}
          </TableCell>
        )
      })}
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Текст (PDF, Word, TXT)
// ---------------------------------------------------------------------------

function TextCompare({ va, vb, fa, fb, mixed }: { va: CompareVersion; vb: CompareVersion; fa: CompareFile; fb: CompareFile; mixed: boolean }) {
  const qa = useQuery(compareTextQuery(fa.id))
  const qb = useQuery(compareTextQuery(fb.id))
  if (qa.isPending || qb.isPending) return <p className="text-sm text-muted-foreground">{tr('Загружаем текст…')}</p>
  if (qa.isError || qb.isError) return <Note>{tr('Не удалось загрузить текст документов. Попробуйте ещё раз.')}</Note>

  const pending = [qa.data, qb.data].some((t) => t && (t.status === 'pending' || t.status === 'processing'))
  if (pending) return <Note>{tr('Текст одного из файлов ещё читается — обычно это занимает до минуты. Страница обновится сама.')}</Note>
  const unreadable = (t: { status: string; text: string | null } | undefined) => !t || t.status !== 'done' || !t.text?.trim()
  const bad = unreadable(qa.data) ? fa : unreadable(qb.data) ? fb : null
  if (bad) {
    return (
      <Note>{tr('Из файла «')}{bad.name}{tr('» не удалось достать текст: это скан или чертёж без текстового слоя либо файл не читается. Загрузите PDF с текстовым слоем, чтобы сверить документы.')}</Note>
    )
  }
  return <TextCompareReady va={va} vb={vb} a={qa.data!.text!} b={qb.data!.text!} mixed={mixed} />
}

function TextCompareReady({ va, vb, a, b, mixed }: { va: CompareVersion; vb: CompareVersion; a: string; b: string; mixed: boolean }) {
  const diff = useMemo(() => compareTexts(a, b), [a, b])
  const [filter, setFilter] = useState<Filter>('diff')
  const [limit, setLimit] = useState(PAGE)
  const blocks = useMemo(() => diff.blocks.filter((bl) => (filter === 'diff' ? bl.status !== 'same' : bl.status === filter)), [diff, filter])
  const info = { a: sideInfo(va), b: sideInfo(vb) }
  const words = diff.wordsAfter - diff.wordsBefore
  const setF = (f: Filter) => {
    setFilter(f)
    setLimit(PAGE)
  }

  return (
    <div className="flex flex-col gap-4">
      {mixed && <Note>{tr('Файлы разных форматов: сверяется извлечённый из них текст, без разбора таблиц.')}</Note>}
      {diff.coarse && <Note>{tr('Документы различаются слишком сильно, чтобы сопоставить абзацы по порядку: показаны все абзацы «было» как удалённые, «стало» — как добавленные.')}</Note>}
      <Summary counts={diff.counts} filter={filter} setFilter={setF} />
      <p className="text-sm text-muted-foreground">{tr('Слов было')}{' '}{fmtNumber(diff.wordsBefore)}{tr('→ стало')}{' '}{fmtNumber(diff.wordsAfter)}
        {words !== 0 && (
          <span className={`ml-1 font-medium ${trend(words).cls}`}>
            ({trend(words).arrow} {fmtSigned(words)})
          </span>
        )}{tr('. Сверка идёт по абзацам; в изменённых абзацах подсвечены слова.')}</p>
      <section className="flex flex-col gap-2" aria-label={tr('Различия')}>
        <FilterBar filter={filter} setFilter={setF}>
          <div className="ml-auto">
            <ExcelButton disabled={blocks.length === 0} onExport={() => exportTextDiff(compareFileName(info.a, info.b), diff, blocks, info.a, info.b)} />
          </div>
        </FilterBar>
        {blocks.length === 0 ? (
          <Note>{diff.counts.added + diff.counts.removed + diff.counts.changed === 0 ? tr('Различий нет: тексты совпадают.') : tr('По этим условиям абзацев нет.')}</Note>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
            {blocks.slice(0, limit).map((bl, i) => (
              <TextBlockRow key={i} block={bl} />
            ))}
          </ul>
        )}
        {blocks.length > limit && (
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">{tr('Показано')}{' '}{limit}{tr('из')}{' '}{blocks.length}
            <Button type="button" size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>{tr('Показать ещё')}</Button>
          </div>
        )}
      </section>
    </div>
  )
}

function TextBlockRow({ block }: { block: TextBlock }) {
  return (
    <li className={`flex gap-3 px-4 py-2.5 text-sm leading-relaxed ${ROW_TINT[block.status]}`}>
      <span className={`mt-0.5 h-fit shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${BADGE[block.status]}`}>{STATUS_LABEL[block.status]}</span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {block.status === 'changed' && block.parts ? (
          block.parts.map((p, i) =>
            p.kind === 'same' ? (
              <span key={i}>{p.text}</span>
            ) : p.kind === 'add' ? (
              <ins key={i} className="rounded bg-green-500/25 text-foreground no-underline">
                {p.text}
              </ins>
            ) : (
              <del key={i} className="rounded bg-red-500/20 text-muted-foreground">
                {p.text}
              </del>
            ),
          )
        ) : block.status === 'changed' ? (
          <>
            <del className="block text-muted-foreground">{block.before}</del>
            <span className="block">{block.after}</span>
          </>
        ) : block.status === 'removed' ? (
          <span className="text-muted-foreground line-through">{block.before}</span>
        ) : (
          (block.after ?? block.before)
        )}
      </p>
    </li>
  )
}
