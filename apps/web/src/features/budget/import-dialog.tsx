import { tr } from '@/lib/tr'
import { FileSpreadsheet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Cell = string | number | boolean | Date | null | undefined
interface Sheet {
  name: string
  rows: Cell[][]
}

export interface ImportField {
  key: string
  label: string
  required?: boolean
  /** Слова в названии колонки, по которым она находится сама */
  aliases: string[]
  kind?: 'text' | 'number' | 'date'
}

const NONE = '__none__'

const text = (c: Cell) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())

function toNumber(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  const s = text(c).replace(/[\s ]/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toDate(c: Cell): string | null {
  if (c instanceof Date) return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
  const s = text(c)
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (dm) return `${dm[3].length === 2 ? '20' + dm[3] : dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function decode(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return (utf8.match(/�/g) ?? []).length > Math.max(3, utf8.length / 200) ? new TextDecoder('windows-1251').decode(bytes) : utf8
}

async function readSheets(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) {
    const { parseCsv } = await import('@/features/volumes/api')
    return [{ name: 'CSV', rows: parseCsv(decode(await file.arrayBuffer())) }]
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = await readXlsxFile(file)
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }))
}

/** Находит строку заголовков и колонки по названиям (первые 20 строк). */
function detect(rows: Cell[][], fields: ImportField[]): { header: number; map: Record<string, number> } {
  let best = { header: 0, map: {} as Record<string, number>, score: -1 }
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const map: Record<string, number> = {}
    const names = (rows[h] ?? []).map((c) => text(c).toLowerCase())
    for (const f of fields) {
      const idx = names.findIndex((n, i) => n && !Object.values(map).includes(i) && f.aliases.some((a) => n.includes(a)))
      if (idx >= 0) map[f.key] = idx
    }
    const score = Object.keys(map).length
    if (score > best.score) best = { header: h, map, score }
  }
  return { header: best.header, map: best.map }
}

/** Загрузка таблицы Excel/CSV: выбор файла, сопоставление колонок, предпросмотр, отправка. */
export function ImportDialog({
  title,
  description,
  fields,
  onImport,
  onClose,
}: {
  title: string
  description: string
  fields: ImportField[]
  onImport: (rows: Record<string, string | number | null>[]) => Promise<string | void>
  onClose: () => void
}) {
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [fileName, setFileName] = useState('')
  const [map, setMap] = useState<Record<string, number>>({})
  const [header, setHeader] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sheet = sheets[sheetIdx]
  const columns = useMemo(() => {
    const row = sheet?.rows[header] ?? []
    const width = Math.max(row.length, ...(sheet?.rows.slice(header, header + 30).map((r) => r.length) ?? [0]))
    return Array.from({ length: width }, (_, i) => text(row[i]) || tr('Колонка {{v1}}', { v1: i + 1 }))
  }, [sheet, header])

  const parsed = useMemo(() => {
    if (!sheet) return { rows: [] as Record<string, string | number | null>[], skipped: 0 }
    const out: Record<string, string | number | null>[] = []
    let skipped = 0
    for (const r of sheet.rows.slice(header + 1)) {
      if (r.every((c) => !text(c))) continue
      const row: Record<string, string | number | null> = {}
      for (const f of fields) {
        const idx = map[f.key]
        const cell = idx === undefined ? null : r[idx]
        row[f.key] = f.kind === 'number' ? toNumber(cell) : f.kind === 'date' ? toDate(cell) : text(cell) || null
      }
      if (fields.some((f) => f.required && (row[f.key] === null || row[f.key] === ''))) skipped++
      else out.push(row)
    }
    return { rows: out, skipped }
  }, [sheet, header, map, fields])

  async function pick(file: File) {
    setError(null)
    try {
      const s = await readSheets(file)
      if (s.length === 0 || s.every((x) => x.rows.length === 0)) throw new Error('empty')
      setSheets(s)
      setFileName(file.name)
      const first = Math.max(0, s.findIndex((x) => x.rows.length > 0))
      setSheetIdx(first)
      const d = detect(s[first].rows, fields)
      setHeader(d.header)
      setMap(d.map)
    } catch {
      setError(tr('Не удалось прочитать файл. Подойдёт .xlsx или .csv с таблицей.'))
    }
  }

  const missing = fields.filter((f) => f.required && map[f.key] === undefined)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 hover:bg-muted/50">
            <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-sm">{fileName || tr('Выберите файл Excel или CSV')}</span>
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          </label>
          {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}

          {sheet && (
            <>
              {sheets.length > 1 && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="imp-sheet">{tr('Лист')}</Label>
                  <Select
                    value={String(sheetIdx)}
                    onValueChange={(v) => {
                      const i = Number(v)
                      setSheetIdx(i)
                      const d = detect(sheets[i].rows, fields)
                      setHeader(d.header)
                      setMap(d.map)
                    }}
                  >
                    <SelectTrigger id="imp-sheet" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sheets.map((s, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {s.name} ({s.rows.length}{tr('строк)')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`imp-${f.key}`}>
                      {f.label}
                      {f.required && <span className="text-red-600"> *</span>}
                    </Label>
                    <Select value={map[f.key] === undefined ? NONE : String(map[f.key])} onValueChange={(v) => setMap((m) => { const n = { ...m }; if (v === NONE) delete n[f.key]; else n[f.key] = Number(v); return n })}>
                      <SelectTrigger id={`imp-${f.key}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value={NONE}>{tr('Не загружать')}</SelectItem>
                        {columns.map((c, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="imp-header">{tr('Строка с названиями колонок')}</Label>
                <Select value={String(header)} onValueChange={(v) => { setHeader(Number(v)); setMap(detect(sheet.rows.slice(Number(v)), fields).map) }}>
                  <SelectTrigger id="imp-header" className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sheet.rows.slice(0, 20).map((r, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {i + 1}: {r.map(text).filter(Boolean).slice(0, 3).join(' · ') || tr('пусто')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      {fields.filter((f) => map[f.key] !== undefined).map((f) => (
                        <th key={f.key} className="px-2 py-1.5 text-left font-medium">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-t">
                        {fields.filter((f) => map[f.key] !== undefined).map((f) => (
                          <td key={f.key} className="max-w-48 truncate px-2 py-1">
                            {String(r[f.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted-foreground">{tr('Будет загружено строк:')}{' '}<span className="font-medium text-foreground">{parsed.rows.length}</span>
                {parsed.skipped > 0 && tr(', пропущено без обязательных полей: {{skipped}}', { skipped: parsed.skipped })}.
                {missing.length > 0 && <span className="text-red-700 dark:text-red-300">{tr('Укажите колонку:')}{' '}{missing.map((f) => f.label).join(', ')}.</span>}
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          <Button
            type="button"
            disabled={busy || parsed.rows.length === 0 || missing.length > 0}
            onClick={async () => {
              setBusy(true)
              try {
                const msg = await onImport(parsed.rows)
                if (msg) toast.success(msg)
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : tr('Не удалось загрузить.'))
                setBusy(false)
              }
            }}
          >
            {busy ? tr('Загружаем…') : tr('Загрузить ({{length}})', { length: parsed.rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
