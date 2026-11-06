import { tr } from '@/lib/tr'
export type OfficeKind = 'excel' | 'word' | 'text'

const EXCEL = /\.(xlsx|xlsm|csv)$/i
const WORD = /\.docx$/i
const TEXT = /\.(txt|md|log|json|xml|ini|yaml|yml|tsv)$/i

/** Что открывается на экране без PDF: таблицы Excel и CSV, Word (.docx), обычный текст. Старые .xls и .doc — только скачать. */
export function officeKind(name: string | null | undefined, mime: string | null | undefined): OfficeKind | null {
  const n = name ?? ''
  const m = mime ?? ''
  if (EXCEL.test(n) || m === 'text/csv' || m.includes('spreadsheetml')) return 'excel'
  if (WORD.test(n) || m.includes('wordprocessingml')) return 'word'
  if (TEXT.test(n) || m === 'text/plain' || m === 'application/json') return 'text'
  return null
}

/** Файл слишком большой, чтобы разбирать в браузере. */
export const OFFICE_MAX_BYTES = 25 * 1024 * 1024

export const OFFICE_LABELS: Record<OfficeKind, string> = { excel: tr('Таблица'), word: tr('Документ Word'), text: tr('Текст') }
