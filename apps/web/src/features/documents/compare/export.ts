import { tr } from '@/lib/tr'
import { toast } from 'sonner'
import { trend } from '@/features/documents/compare/format'
import type { Cell, DiffRow, RowStatus, TableDiff } from '@/features/documents/compare/table-diff'
import type { TextBlock, TextDiff } from '@/features/documents/compare/text-diff'
import { sheetCounts, sheetHasChanges, sheetTitle, workbookCounts, workbookTotals, type SheetResult, type WorkbookTotal } from '@/features/documents/compare/workbook-diff'
import { safeName, saveBlob } from '@/features/export/xlsx'

export const STATUS_LABEL: Record<RowStatus, string> = { added: tr('Добавлено'), removed: tr('Удалено'), changed: tr('Изменено'), same: tr('Без изменений') }
const FILL: Record<RowStatus, string | undefined> = { added: '#dcfce7', removed: '#fee2e2', changed: '#fef3c7', same: undefined }
const WARN_FILL = '#fef3c7'

export interface SideInfo {
  title: string
  revision: string
  fileName: string
}

type XCell = {
  value?: string | number | Date | boolean
  fontWeight?: 'bold'
  backgroundColor?: string
  textColor?: string
  format?: string
  wrap?: boolean
} | null

interface OutSheet {
  sheet: string
  data: XCell[][]
  widths: number[]
  sticky?: number
}

const head = (value: string): XCell => ({ value, fontWeight: 'bold', backgroundColor: '#f2f3f1', wrap: true })
const bold = (value: string | number): XCell => ({ value, fontWeight: 'bold' })
const plain = (v: Cell): XCell => (v === null || v === undefined || v === '' ? null : v instanceof Date ? { value: v, format: 'dd.mm.yyyy' } : { value: v })
const withFill = (cell: XCell, fill: string | undefined): XCell => (cell && fill ? { ...cell, backgroundColor: fill } : cell)
const sideLine = (label: string, s: SideInfo): XCell[] => [bold(label), { value: tr('{{title}}, ревизия {{v2}}, файл {{fileName}}', { title: s.title, v2: s.revision || '—', fileName: s.fileName }) }]

async function write(fileName: string, sheets: OutSheet[]) {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const blob = await writeXlsxFile(
      sheets.map((s) => ({ sheet: s.sheet, data: s.data, columns: s.widths.map((width) => ({ width })), stickyRowsCount: s.sticky ?? 1 })) as never,
    ).toBlob()
    saveBlob(blob, fileName)
    toast.success(tr('Сверка выгружена в Excel'))
  } catch {
    toast.error(tr('Не удалось сформировать файл Excel. Попробуйте ещё раз.'))
  }
}

export const compareFileName = (a: SideInfo, b: SideInfo) =>
  safeName(a.title === b.title ? tr('Сверка {{title}} {{v2}} и {{v3}}', { title: a.title, v2: a.revision || '—', v3: b.revision || '—' }) : tr('Сверка {{title}} и {{v2}}', { title: a.title, v2: b.title }))

/** Имя листа Excel: до 31 символа, без : \ / ? * [ ], неповторяющееся. */
function sheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : ` ${n}`
    const name = base.slice(0, 31 - suffix.length) + suffix
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase())
      return name
    }
  }
}

/** Лист различий одной пары листов: все добавленные, удалённые и изменённые строки. */
function diffSheet(diff: TableDiff, rows: DiffRow[]): { data: XCell[][]; widths: number[] } {
  const showAll = rows.some((r) => r.status === 'added' || r.status === 'removed')
  const cols = diff.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.isKey && !c.isNumbering && (c.numeric || c.hasChanges || showAll))

  const header: XCell[] = [head(tr('Статус')), head(tr('Ключ')), head(tr('Строка «было»')), head(tr('Строка «стало»'))]
  for (const { c } of cols) {
    header.push(head(tr('{{name}}: было', { name: c.name })), head(tr('{{name}}: стало', { name: c.name })))
    if (c.numeric) header.push(head(tr('{{name}}: разница', { name: c.name })), head(`${c.name}: %`))
  }

  const data: XCell[][] = [header]
  for (const r of rows) {
    const line: XCell[] = [
      { value: STATUS_LABEL[r.status], backgroundColor: FILL[r.status] },
      { value: r.key || '—' },
      r.rowA ? { value: r.rowA } : null,
      r.rowB ? { value: r.rowB } : null,
    ]
    for (const { c, i } of cols) {
      const ch = r.changes.find((x) => x.col === i)
      const before = r.status === 'added' ? null : (r.a?.[i] ?? null)
      const after = r.status === 'removed' ? null : (r.b?.[i] ?? null)
      const mark = ch || r.status === 'added' || r.status === 'removed' ? FILL[r.status === 'changed' ? 'changed' : r.status] : undefined
      line.push(withFill(plain(before), mark), withFill(plain(after), mark))
      if (c.numeric) {
        const t = trend(ch?.delta ?? null)
        line.push(
          ch?.delta != null ? { value: ch.delta, textColor: t.excel, fontWeight: 'bold' } : null,
          ch?.pct != null ? { value: ch.pct / 100, format: '0.0%', textColor: t.excel } : null,
        )
      }
    }
    data.push(line)
  }
  return { data, widths: [16, 30, 12, 12, ...cols.flatMap(({ c }) => (c.numeric ? [14, 14, 14, 10] : [28, 28]))] }
}

const TOTALS_HEAD = [tr('Колонка'), tr('Было'), tr('Стало'), tr('Разница'), '%', tr('Новые строки'), tr('Удалённые строки'), tr('Изменения значений'), tr('Выросло значений'), tr('Снизилось значений')]

function totalsBlock(totals: WorkbookTotal[]): XCell[][] {
  return [
    TOTALS_HEAD.map(head),
    ...totals.map((t): XCell[] => {
      const tnd = trend(t.delta)
      return [
        bold(t.mode === 'avg' ? tr('{{name}} (среднее)', { name: t.name }) : t.name),
        { value: t.before },
        { value: t.after },
        { value: t.delta, textColor: tnd.excel, fontWeight: 'bold' },
        t.pct === null ? null : { value: t.pct / 100, format: '0.0%', textColor: tnd.excel },
        { value: t.fromAdded },
        { value: t.fromRemoved },
        { value: t.fromChanged },
        { value: t.up },
        { value: t.down },
      ]
    }),
  ]
}

function sheetStatus(r: SheetResult): { label: string; fill?: string } {
  switch (r.kind) {
    case 'added':
      return { label: tr('Новый лист'), fill: FILL.added }
    case 'removed':
      return { label: tr('Лист удалён'), fill: FILL.removed }
    case 'unmatched':
      return { label: tr('Не сопоставлен: нет общих колонок'), fill: WARN_FILL }
    default:
      return sheetHasChanges(r) ? { label: tr('Есть изменения'), fill: FILL.changed } : { label: tr('Без изменений') }
  }
}

/**
 * Выгрузка сверки книги: лист «Сводка» (итоги по книге, список листов, итоги по каждому листу)
 * и по листу различий на каждый сравниваемый лист; листы без изменений помечены в названии.
 */
export async function exportWorkbookDiff(fileName: string, results: SheetResult[], a: SideInfo, b: SideInfo) {
  const taken = new Set<string>([tr('сводка')])
  const counts = workbookCounts(results)

  const summary: XCell[][] = [
    sideLine(tr('Было'), a),
    sideLine(tr('Стало'), b),
    [],
    [bold(tr('Добавлено строк')), { value: counts.added }],
    [bold(tr('Удалено строк')), { value: counts.removed }],
    [bold(tr('Изменено строк')), { value: counts.changed }],
    [bold(tr('Без изменений')), { value: counts.same }],
    [],
    [tr('Лист'), tr('Состояние'), tr('Добавлено'), tr('Удалено'), tr('Изменено'), tr('Без изменений'), tr('Лист с различиями')].map(head),
  ]

  const detail: OutSheet[] = []
  for (const r of results) {
    const c = sheetCounts(r)
    const st = sheetStatus(r)
    let ref = ''
    if (r.kind === 'compared') {
      const rows = r.diff.rows.filter((x) => x.status !== 'same')
      const name = sheetName(`${rows.length > 0 ? tr('Разн.') : tr('Без изм.')} ${r.nameB ?? r.nameA}`, taken)
      ref = name
      const { data, widths } = diffSheet(r.diff, rows)
      if (rows.length === 0) data.push([{ value: tr('Различий нет: листы совпадают'), backgroundColor: undefined }])
      detail.push({ sheet: name, data, widths })
    }
    summary.push([
      bold(sheetTitle(r)),
      { value: st.label, backgroundColor: st.fill },
      { value: c.added },
      { value: c.removed },
      { value: c.changed },
      r.kind === 'compared' ? { value: c.same } : null,
      ref ? { value: ref } : null,
    ])
  }

  summary.push([], [bold(tr('Итоги по колонкам всей книги'))], ...totalsBlock(workbookTotals(results)))
  for (const r of results) {
    if (r.kind === 'compared' && r.diff.totals.length > 0 && results.filter((x) => x.kind === 'compared').length > 1) {
      summary.push([], [bold(tr('Итоги по листу «{{v1}}»', { v1: sheetTitle(r) }))], ...totalsBlock(workbookTotals([r])))
    }
  }
  const unmatched = results.filter((r) => r.kind === 'unmatched')
  if (unmatched.length > 0) {
    summary.push([], [{ value: tr('Не удалось сопоставить строки (нет колонок с одинаковыми названиями): ') + unmatched.map(sheetTitle).join(', '), backgroundColor: WARN_FILL }])
  }

  await write(fileName, [{ sheet: tr('Сводка'), data: summary, widths: [34, 30, 16, 16, 18, 16, 26, 16, 16, 16], sticky: 0 }, ...detail])
}

/** Выгрузка текстовой сверки: абзацы, выбранные фильтром, и итоги. */
export async function exportTextDiff(fileName: string, diff: TextDiff, blocks: TextBlock[], a: SideInfo, b: SideInfo) {
  const data: XCell[][] = [[head(tr('Статус')), head(tr('Было')), head(tr('Стало'))]]
  for (const bl of blocks) {
    data.push([
      { value: STATUS_LABEL[bl.status], backgroundColor: FILL[bl.status] },
      bl.before ? { value: bl.before, wrap: true } : null,
      bl.after ? { value: bl.after, wrap: true } : null,
    ])
  }
  const summary: XCell[][] = [
    sideLine(tr('Было'), a),
    sideLine(tr('Стало'), b),
    [],
    [bold(tr('Добавлено абзацев')), { value: diff.counts.added }],
    [bold(tr('Удалено абзацев')), { value: diff.counts.removed }],
    [bold(tr('Изменено абзацев')), { value: diff.counts.changed }],
    [bold(tr('Без изменений')), { value: diff.counts.same }],
    [bold(tr('Слов было')), { value: diff.wordsBefore }],
    [bold(tr('Слов стало')), { value: diff.wordsAfter }],
  ]
  await write(fileName, [
    { sheet: tr('Различия'), data, widths: [16, 70, 70] },
    { sheet: tr('Итоги'), data: summary, widths: [26, 70], sticky: 0 },
  ])
}
