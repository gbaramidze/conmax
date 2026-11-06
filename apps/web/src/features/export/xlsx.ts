import { tr } from '@/lib/tr'
import { toast } from 'sonner'

type Cell = string | number | boolean | Date | null | undefined

export interface ExportSheet {
  /** Имя листа (до 31 символа, без : \ / ? * [ ]) */
  name: string
  headers: string[]
  rows: Cell[][]
  /** Ширины колонок в символах; по умолчанию подбираются по содержимому */
  widths?: number[]
}

/** «Задачи ZK7» → безопасное имя файла */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || tr('Выгрузка')
}

function autoWidths(headers: string[], rows: Cell[][]): number[] {
  return headers.map((h, i) => {
    const longest = rows.slice(0, 200).reduce((m, r) => Math.max(m, String(r[i] instanceof Date ? tr('дд.мм.гггг') : (r[i] ?? '')).length), h.length)
    return Math.min(60, Math.max(8, longest + 2))
  })
}

/** Скачивание через ссылку: работает и в обычных браузерах, и на телефоне. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName(fileName)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Скачивает таблицу как .xlsx: заголовок жирным и закреплён, ширины колонок подобраны.
 * Библиотека подгружается только при выгрузке, чтобы не утяжелять приложение.
 */
export async function downloadXlsx(fileName: string, sheet: ExportSheet): Promise<void> {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const data = [
      sheet.headers.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#f2f3f1' })),
      ...sheet.rows.map((r) => r.map((c) => (c instanceof Date ? { value: c, format: 'dd.mm.yyyy' } : (c ?? ''))) as never[]),
    ]
    const blob = await writeXlsxFile(data as never, {
      sheet: safeName(sheet.name).slice(0, 31),
      columns: (sheet.widths ?? autoWidths(sheet.headers, sheet.rows)).map((width) => ({ width })),
      stickyRowsCount: 1,
    } as never).toBlob()

    saveBlob(blob, fileName)
    toast.success(tr('Выгружено строк: {{length}}', { length: sheet.rows.length }))
  } catch {
    toast.error(tr('Не удалось сформировать файл Excel. Попробуйте ещё раз.'))
  }
}

/** Дата ISO (YYYY-MM-DD) → Date для ячейки Excel; пусто → null. */
export function isoToDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(`${iso.slice(0, 10)}T12:00:00`) : null
}
