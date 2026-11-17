import { currentLocale } from '@/lib/i18n'
import { BOTTOM, CONTENT_W, createPdfKit, INK, LINE, loadJpeg, MARGIN, MUTED, PAGE_H, PAGE_W, rgb, SOFT, type Loaded, type Rgb } from '@/lib/pdf-kit'
import { tr } from '@/lib/tr'
import type { SchemeSource } from '@/features/inspections/scheme-image'
import { noteAddresseeName, notePhotos, noteScheme, type NoteRow } from '@/features/notes/api'

export interface NotesPdfItem {
  note: NoteRow
  /** «Корпус 1 › Секция 1 › Этаж 6 › King 2» */
  place: string
  stale: boolean
}

export interface NotesPdfInput {
  projectName: string
  projectCode: string
  /** Какие условия включены: «Подрядчик — МонолитСтрой», «Период — 1–17 нояб.» */
  filters: { label: string; value: string }[]
  items: NotesPdfItem[]
  generatedBy: string
  /** Временный адрес файла из хранилища */
  urlOf: (storageKey: string) => Promise<string>
  /** Адрес картинки схемы (для чертежа в PDF — отрисованная страница) */
  schemeUrl: (source: SchemeSource) => Promise<string>
  onProgress?: (done: number, total: number) => void
}

const SIGNAL = rgb(255, 194, 14)
const AMBER = rgb(245, 158, 11)
const GREEN = rgb(22, 163, 74)
const PAD = 10
const BAR = 4
const THUMB_W = 84
const THUMB_H = 63
const SCHEME_W = 200
const SCHEME_H = 135
const GAP = 6
const MAX_PHOTOS = 4
const MAX_TEXT_LINES = 14

/**
 * Отчёт по отфильтрованным заметкам, A4: шапка с условиями отбора и итогами, затем заметки карточками
 * (место, статус, текст, автор, дата, адресат, фото и схема с точкой). Фото сжимаются, поэтому файл остаётся лёгким для отправки.
 */
export async function buildNotesPdf(input: NotesPdfInput): Promise<{ blob: Blob; pages: number }> {
  const { pdf, toRuns, widthOf, wrap, fit, color } = await createPdfKit()
  let page = pdf.addPage([PAGE_W, PAGE_H])
  const pages = [page]
  let y = MARGIN

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    pages.push(page)
    y = MARGIN
  }
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage()
  }
  const text = (s: string, x: number, top: number, size: number, o: { bold?: boolean; color?: Rgb } = {}) => {
    let cx = x
    for (const run of toRuns(s, !!o.bold)) {
      page.drawText(run.text, { x: cx, y: PAGE_H - top - size * 0.8, size, font: run.font, color: color(o.color ?? INK) })
      cx += run.font.widthOfTextAtSize(run.text, size)
    }
  }
  const rect = (x: number, top: number, w: number, h: number, o: { fill?: Rgb; stroke?: Rgb }) =>
    page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color: o.fill ? color(o.fill) : undefined, borderColor: o.stroke ? color(o.stroke) : undefined, borderWidth: o.stroke ? 0.7 : 0 })

  const imageCache = new Map<string, Promise<Loaded | null>>()
  const load = (key: string, px: number, urlOf: () => Promise<string>) => {
    const k = `${key}:${px}`
    if (!imageCache.has(k)) imageCache.set(k, urlOf().then((u) => loadJpeg(u, px), () => null))
    return imageCache.get(k)!
  }
  /** Картинка в рамке w×h по центру с сохранением пропорций; возвращает, где она легла (для точки на схеме). */
  const drawImage = async (img: Loaded | null, x: number, top: number, w: number, h: number) => {
    rect(x, top, w, h, { fill: SOFT, stroke: LINE })
    if (!img) return null
    const embedded = await pdf.embedJpg(img.bytes)
    const k = Math.min(w / img.w, h / img.h)
    const dw = img.w * k
    const dh = img.h * k
    const ix = x + (w - dw) / 2
    const itop = top + (h - dh) / 2
    page.drawImage(embedded, { x: ix, y: PAGE_H - itop - dh, width: dw, height: dh })
    return { x: ix, top: itop, w: dw, h: dh }
  }

  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
  const dateTimeFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  // ---- шапка
  const open = input.items.filter((i) => i.note.status === 'open').length
  const done = input.items.length - open
  text(tr('Заметки с площадки'), MARGIN, y, 17, { bold: true })
  y += 25
  text(`${input.projectName}  ·  ${input.projectCode}`, MARGIN, y, 10.5, { color: MUTED })
  y += 24

  const colW = CONTENT_W / 2 - 8
  const rows: [string, string][] = [
    ...input.filters.map((f): [string, string] => [f.label, f.value]),
    [tr('Заметок'), tr('{{n}} (открытых: {{open}}, закрытых: {{done}})', { n: input.items.length, open, done })],
    [tr('Сформировано'), `${dateFmt.format(new Date())} · ${input.generatedBy}`],
  ]
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2)
    const lines = pair.map(([, v]) => wrap(v, 9.5, colW, true))
    const h = 11 + Math.max(...lines.map((l) => l.length)) * 12.5 + 6
    ensure(h)
    pair.forEach(([label], k) => {
      const x = MARGIN + k * (colW + 16)
      text(label, x, y, 8, { color: MUTED })
      lines[k].forEach((ln, li) => text(ln, x, y + 11 + li * 12.5, 9.5, { bold: true }))
    })
    y += h
  }
  y += 4
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - y }, end: { x: MARGIN + CONTENT_W, y: PAGE_H - y }, thickness: 0.8, color: color(INK) })
  y += 14

  // ---- заметки
  const innerW = CONTENT_W - BAR - 2 * PAD
  for (const [index, item] of input.items.entries()) {
    const n = item.note
    const parts = item.place.split(' › ')
    const placeName = parts[parts.length - 1]
    const parents = parts.slice(0, -1).join(' › ')
    const statusLabel = n.status === 'done' ? tr('Закрыта') : item.stale ? tr('Висит долго') : tr('Открыта')
    const statusColor = n.status === 'done' ? GREEN : item.stale ? AMBER : SIGNAL
    const statusW = widthOf(statusLabel, 8.5, true) + 16

    const body = n.comment?.body_text?.trim() ?? ''
    let bodyLines = body ? wrap(body, 10, innerW) : []
    if (bodyLines.length > MAX_TEXT_LINES) bodyLines = [...bodyLines.slice(0, MAX_TEXT_LINES - 1), `${bodyLines[MAX_TEXT_LINES - 1]}…`]
    const photos = notePhotos(n)
    const scheme = noteScheme(n)
    const hasImages = photos.length > 0 || !!scheme

    const meta = [
      n.author?.full_name,
      dateTimeFmt.format(new Date(n.created_at)),
      noteAddresseeName(n) ? `→ ${noteAddresseeName(n)}` : null,
      n.task ? n.task.key : null,
      n.comment?.visibility === 'internal' ? tr('внутренняя') : null,
      n.status === 'done' && n.resolved_at ? tr('закрыта {{d}}', { d: dateTimeFmt.format(new Date(n.resolved_at)) }) : null,
      photos.length > MAX_PHOTOS ? tr('ещё фото: {{n}}', { n: photos.length - MAX_PHOTOS }) : null,
    ].filter(Boolean) as string[]
    const metaLines = wrap(meta.join('  ·  '), 8.5, innerW)

    // ряд картинок: фото слева, схема с точкой справа (она крупнее, чтобы на плане было видно место)
    const rowH = scheme ? SCHEME_H : THUMB_H
    const h = PAD + (parents ? 11 : 0) + 15 + (bodyLines.length > 0 ? 6 + bodyLines.length * 13 : 0) + 6 + metaLines.length * 11.5 + (hasImages ? 8 + rowH : 0) + PAD
    ensure(h + 8)

    // карточка: рамка, цветная полоса статуса
    rect(MARGIN, y, CONTENT_W, h, { stroke: LINE })
    rect(MARGIN, y, BAR, h, { fill: statusColor })
    const x0 = MARGIN + BAR + PAD
    let cy = y + PAD
    if (parents) {
      text(fit(parents, 8, innerW - statusW - 8), x0, cy, 8, { color: MUTED })
      cy += 11
    }
    text(fit(placeName, 11, innerW - statusW - 8, true), x0, cy, 11, { bold: true })
    // статус справа
    const sx = MARGIN + CONTENT_W - PAD - statusW
    rect(sx, y + PAD - 1, statusW, 15, { fill: n.status === 'done' ? rgb(220, 244, 228) : item.stale ? rgb(254, 236, 200) : SOFT })
    rect(sx + 5, y + PAD + 4.5, 5, 5, { fill: statusColor })
    text(statusLabel, sx + 13, y + PAD + 1.5, 8.5, { bold: true })
    cy += 15
    if (bodyLines.length > 0) {
      cy += 6
      for (const ln of bodyLines) {
        text(ln, x0, cy, 10)
        cy += 13
      }
    }
    cy += 6
    for (const ln of metaLines) {
      text(ln, x0, cy, 8.5, { color: MUTED })
      cy += 11.5
    }
    if (hasImages) {
      cy += 8
      let ix = x0
      // с большой схемой справа фото идут в две строки по две; без схемы — в одну
      const photoArea = scheme ? CONTENT_W - BAR - 2 * PAD - SCHEME_W - GAP : innerW
      const perRow = Math.max(1, Math.floor((photoArea + GAP) / (THUMB_W + GAP)))
      for (const [pi, f] of photos.slice(0, MAX_PHOTOS).entries()) {
        const img = await load(f.storage_key, 420, () => input.urlOf(f.storage_key))
        await drawImage(img, ix + (pi % perRow) * (THUMB_W + GAP), cy + Math.floor(pi / perRow) * (THUMB_H + GAP), THUMB_W, THUMB_H)
      }
      if (scheme) {
        const sImg = await load(`scheme:${scheme.storageKey}`, 1100, () => input.schemeUrl(scheme))
        const placed = await drawImage(sImg, MARGIN + CONTENT_W - PAD - SCHEME_W, cy, SCHEME_W, SCHEME_H)
        if (placed && n.scheme_x !== null && n.scheme_y !== null) {
          const px = placed.x + Number(n.scheme_x) * placed.w
          const py = placed.top + Number(n.scheme_y) * placed.h
          page.drawCircle({ x: px, y: PAGE_H - py, size: 5, color: color(SIGNAL), borderColor: color(INK), borderWidth: 1.4 })
        }
      }
    }
    y += h + 8
    input.onProgress?.(index + 1, input.items.length)
  }

  if (input.items.length === 0) {
    text(tr('По этим условиям заметок нет.'), MARGIN, y, 10, { color: MUTED })
  }

  // ---- колонтитулы
  pages.forEach((p, i) => {
    page = p
    const right = `${i + 1} / ${pages.length}`
    text(`${input.projectCode}  ·  ${tr('Заметки с площадки')}`, MARGIN, PAGE_H - 34, 8, { color: MUTED })
    text(right, PAGE_W - MARGIN - widthOf(right, 8), PAGE_H - 34, 8, { color: MUTED })
  })

  const bytes = await pdf.save()
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), pages: pages.length }
}
