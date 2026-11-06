import { tr } from '@/lib/tr'
// Текстовые файлы и CSV для правки: определение кодировки и переводов строк при чтении, запись в UTF-8.
import { compareTexts, type TextBlock } from '../compare/text-diff'
import type { ECell, EditRow, EditSheet } from './sheet-model'
import { EMPTY_LAYOUT, nextKey } from './sheet-model'

export interface TextMeta {
  /** В начале файла была метка порядка байтов UTF-8 */
  bom: boolean
  /** Переводы строк в исходном файле */
  eol: '\r\n' | '\n'
  /** Файл был не в UTF-8 (Windows-1251, UTF-16): сохранится в UTF-8 */
  converted: 'windows-1251' | 'utf-16' | null
}

export interface DecodedText extends TextMeta {
  /** Текст с переводами строк \n, как в поле ввода */
  text: string
}

export function decodeText(bytes: ArrayBuffer): DecodedText {
  const b = new Uint8Array(bytes)
  let converted: TextMeta['converted'] = null
  let bom = false
  let raw: string
  if (b[0] === 0xff && b[1] === 0xfe) {
    raw = new TextDecoder('utf-16le').decode(b.subarray(2))
    converted = 'utf-16'
  } else if (b[0] === 0xfe && b[1] === 0xff) {
    raw = new TextDecoder('utf-16be').decode(b.subarray(2))
    converted = 'utf-16'
  } else {
    bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
    const utf8 = new TextDecoder('utf-8').decode(bytes)
    if ((utf8.match(/�/g) ?? []).length > Math.max(3, utf8.length / 200)) {
      raw = new TextDecoder('windows-1251').decode(bytes)
      converted = 'windows-1251'
      bom = false
    } else raw = utf8
  }
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/\n/g) ?? []).length
  return { text: raw.replace(/\r\n?/g, '\n'), bom, eol: crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n', converted }
}

export function encodeText(text: string, meta: TextMeta, mime = 'text/plain'): Blob {
  const body = meta.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n?/g, '\n')
  return new Blob([meta.bom ? '﻿' : '', body], { type: `${mime};charset=utf-8` })
}

// ---------------------------------------------------------------------------
// Сводка «что изменилось» для текста и Word
// ---------------------------------------------------------------------------

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Заметка к версии по сверке абзацев: сколько изменено, добавлено, удалено и первые три изменения.
 * unit — «строк» для текстового файла, «абзацев» для Word.
 */
export function summarizeParagraphs(before: string[], after: string[], unit: 'строк' | 'абзацев'): { changed: boolean; text: string } {
  const diff = compareTexts(before.join('\n'), after.join('\n'))
  // абзац, который заменили на непохожий, сверка видит как «удалён» и «добавлен»: для заметки склеиваем такие пары в «изменён»
  type Item = { kind: 'changed' | 'added' | 'removed'; before?: string; after?: string; parts?: TextBlock['parts'] }
  const items: Item[] = []
  const blocks = diff.blocks.filter((b) => b.status !== 'same')
  for (let i = 0; i < blocks.length; ) {
    const run = (status: TextBlock['status'], from: number) => {
      let j = from
      while (j < blocks.length && blocks[j].status === status) j++
      return j
    }
    if (blocks[i].status === 'removed') {
      const endR = run('removed', i)
      const endA = run('added', endR)
      const pairs = Math.min(endR - i, endA - endR)
      for (let k = 0; k < pairs; k++) items.push({ kind: 'changed', before: blocks[i + k].before ?? '', after: blocks[endR + k].after ?? '' })
      for (let k = pairs; k < endR - i; k++) items.push({ kind: 'removed', before: blocks[i + k].before ?? '' })
      for (let k = pairs; k < endA - endR; k++) items.push({ kind: 'added', after: blocks[endR + k].after ?? '' })
      i = endA
    } else {
      const bl = blocks[i]
      items.push(bl.status === 'added' ? { kind: 'added', after: bl.after ?? '' } : { kind: 'changed', before: bl.before ?? '', after: bl.after ?? '', parts: bl.parts })
      i++
    }
  }
  const count = (kind: Item['kind']) => items.filter((it) => it.kind === kind).length
  const changed = count('changed')
  const added = count('added')
  const removed = count('removed')
  if (added + removed + changed === 0) return { changed: false, text: '' }
  const parts: string[] = []
  if (changed > 0) parts.push(tr('изменено {{unit}}: {{changed}}', { unit, changed }))
  if (added > 0) parts.push(tr('добавлено: {{added}}', { added }))
  if (removed > 0) parts.push(tr('удалено: {{removed}}', { removed }))
  let text = `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase())
  const examples = items.slice(0, 3).map((it) => {
    if (it.kind === 'added') return tr('добавлено «{{v1}}»', { v1: clip(it.after ?? '') })
    if (it.kind === 'removed') return tr('удалено «{{v1}}»', { v1: clip(it.before ?? '') })
    const words = (kind: 'add' | 'del') => (it.parts ?? []).filter((p) => p.kind === kind).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim()
    const del = it.parts ? words('del') : ''
    const add = it.parts ? words('add') : ''
    if (it.parts) return del && add ? `«${clip(del, 40)}» → «${clip(add, 40)}»` : add ? tr('дописано «{{v1}}»', { v1: clip(add) }) : del ? tr('убрано «{{v1}}»', { v1: clip(del) }) : `«${clip(it.before ?? '')}» → «${clip(it.after ?? '')}»`
    return `«${clip(it.before ?? '', 40)}» → «${clip(it.after ?? '', 40)}»`
  })
  if (examples.length > 0) text += tr(' Например: {{v1}}.', { v1: examples.join('; ') })
  return { changed: true, text }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface CsvMeta extends TextMeta {
  delimiter: ';' | ','
  /** Файл заканчивается переводом строки */
  finalEol: boolean
}

export async function readCsv(bytes: ArrayBuffer): Promise<{ sheet: EditSheet; meta: CsvMeta }> {
  const { parseCsv } = await import('@/features/volumes/api')
  const d = decodeText(bytes)
  const first = d.text.replace(/^﻿/, '').split('\n')[0]
  const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const parsed = d.text.trim() === '' ? [] : parseCsv(d.text)
  const orig: ECell[][] = parsed.map((r) => r.slice())
  const rows: EditRow[] = parsed.map((r, i) => ({ id: i, key: nextKey(), cells: r.slice() }))
  const width = Math.max(1, ...parsed.map((r) => r.length))
  return { sheet: { name: 'CSV', rows, orig, width, layout: EMPTY_LAYOUT }, meta: { bom: d.bom, eol: d.eol, converted: d.converted, delimiter, finalEol: /\n$/.test(d.text) } }
}

export function writeCsv(sheet: EditSheet, meta: CsvMeta): Blob {
  const quote = (v: string) => (/["\n\r]/.test(v) || v.includes(meta.delimiter) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = sheet.rows.map((r) => {
    const n = r.id >= 0 ? r.cells.length : Math.max(r.cells.length, sheet.width)
    return Array.from({ length: n }, (_, c) => {
      const v = r.cells[c]
      return quote(v === null || v === undefined ? '' : String(v))
    }).join(meta.delimiter)
  })
  const text = lines.join('\n') + (lines.length > 0 && meta.finalEol ? '\n' : '')
  return encodeText(text, meta, 'text/csv')
}
