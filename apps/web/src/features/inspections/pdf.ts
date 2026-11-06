import { toast } from 'sonner'
import { currentLocale } from '@/lib/i18n'
import { INSPECTION_STATUSES, itemRefs, sectionLabel, type InspectionFull, type ItemStatus } from '@/features/inspections/api'
import { tr } from '@/lib/tr'

// A4 в пунктах; поля и сетка таблицы
const PAGE_W = 595.28
const PAGE_H = 841.89
const M = 40
const CONTENT_W = PAGE_W - 2 * M
const BOTTOM = PAGE_H - 46 // ниже — колонтитул

const COL = { num: 22, section: 112, ref: 36, status: 44 }
const COMMENT_W = CONTENT_W - COL.num - COL.section - COL.ref - COL.status

const THUMB_W = 74
const THUMB_H = 56
const GAP = 6

type Rgb = [number, number, number]
const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255]
const INK = rgb(17, 24, 39)
const MUTED = rgb(95, 99, 104)
const LINE = rgb(170, 175, 180)
const HEAD_BG = rgb(232, 235, 230)
const STATUS_COLOR: Record<ItemStatus, { bg: Rgb; fg: Rgb }> = {
  A: { bg: rgb(5, 150, 105), fg: rgb(255, 255, 255) },
  C: { bg: rgb(251, 191, 36), fg: rgb(69, 26, 3) },
  R: { bg: rgb(220, 38, 38), fg: rgb(255, 255, 255) },
}

interface Loaded {
  bytes: Uint8Array
  w: number
  h: number
}

/** Скачивает картинку, уменьшает и перекодирует в JPEG на белом фоне (подпись с прозрачностью тоже); при ошибке — null. */
async function loadJpeg(urlOf: (key: string) => Promise<string>, key: string, maxPx: number): Promise<Loaded | null> {
  try {
    const blob = await (await fetch(await urlOf(key))).blob()
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return out ? { bytes: new Uint8Array(await out.arrayBuffer()), w, h } : null
  } catch {
    return null
  }
}

/**
 * Скачивает отчёт об инспекции как PDF (A4): шапка, схема места, таблица разделов с замечаниями, статусами и фото, общие фото, подписи.
 * Шрифт Noto Sans (латиница и кириллица) и Noto Sans Georgian встраиваются, поэтому русский и грузинский текст читается везде.
 * Библиотека и шрифты подгружаются только при выгрузке.
 */
export async function downloadInspectionPdf(input: { projectName: string; placeText: string; full: InspectionFull; urlOf: (storageKey: string) => Promise<string>; schemeUrl?: () => Promise<string> }): Promise<void> {
  try {
    const [{ PDFDocument, rgb: pdfRgb }, fontkitMod, ...fontUrls] = await Promise.all([
      import('pdf-lib'),
      import('@pdf-lib/fontkit'),
      import('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'),
      import('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'),
      import('@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-400-normal.woff?url'),
      import('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url'),
      import('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff?url'),
      import('@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-700-normal.woff?url'),
    ])
    const fontBytes = await Promise.all(fontUrls.map(async (m) => new Uint8Array(await (await fetch(m.default)).arrayBuffer())))

    const { report: r, sections, items, photos, fileKeys } = input.full
    const refs = itemRefs(sections, items)
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkitMod.default)
    const embedded = await Promise.all(fontBytes.map((b) => pdf.embedFont(b, { subset: true })))
    const fonts = {
      regular: embedded.slice(0, 3).map((font) => ({ font, chars: new Set(font.getCharacterSet()) })),
      bold: embedded.slice(3).map((font) => ({ font, chars: new Set(font.getCharacterSet()) })),
    }

    // ---- текст: на каждый символ берётся первый шрифт, в котором он есть (латиница, кириллица, грузинский); нет нигде — пропускается
    type Run = { text: string; font: (typeof fonts.regular)[number]['font'] }
    const toRuns = (text: string, bold: boolean): Run[] => {
      const set = bold ? fonts.bold : fonts.regular
      const runs: Run[] = []
      for (const ch of text.replace(/\s+/g, ' ')) {
        const cp = ch.codePointAt(0)!
        const f = set.find((x) => x.chars.has(cp))
        if (!f) continue
        const last = runs[runs.length - 1]
        if (last && last.font === f.font) last.text += ch
        else runs.push({ text: ch, font: f.font })
      }
      return runs
    }
    const widthOf = (text: string, size: number, bold = false) => toRuns(text, bold).reduce((s, run) => s + run.font.widthOfTextAtSize(run.text, size), 0)
    const wrap = (text: string, size: number, maxW: number, bold = false): string[] => {
      const lines: string[] = []
      for (const para of text.split('\n')) {
        let line = ''
        for (const word of para.split(' ').filter(Boolean)) {
          const test = line ? `${line} ${word}` : word
          if (widthOf(test, size, bold) <= maxW) {
            line = test
            continue
          }
          if (line) lines.push(line)
          line = ''
          let rest = word
          while (widthOf(rest, size, bold) > maxW && rest.length > 1) {
            let n = rest.length - 1
            while (n > 1 && widthOf(rest.slice(0, n), size, bold) > maxW) n--
            lines.push(rest.slice(0, n))
            rest = rest.slice(n)
          }
          line = rest
        }
        lines.push(line)
      }
      return lines.length > 0 ? lines : ['']
    }

    // ---- страницы
    let page = pdf.addPage([PAGE_W, PAGE_H])
    let y = M // от верхнего края вниз
    const pages = [page]
    const newPage = () => {
      page = pdf.addPage([PAGE_W, PAGE_H])
      pages.push(page)
      y = M
    }
    const ensure = (h: number) => {
      if (y + h > BOTTOM) newPage()
    }
    const text = (s: string, x: number, top: number, size: number, o: { bold?: boolean; color?: Rgb } = {}) => {
      let cx = x
      for (const run of toRuns(s, !!o.bold)) {
        page.drawText(run.text, { x: cx, y: PAGE_H - top - size * 0.8, size, font: run.font, color: rgbColor(o.color ?? INK) })
        cx += run.font.widthOfTextAtSize(run.text, size)
      }
    }
    const rgbColor = (c: Rgb) => pdfRgb(c[0], c[1], c[2])
    const rect = (x: number, top: number, w: number, h: number, o: { fill?: Rgb; stroke?: Rgb; width?: number }) =>
      page.drawRectangle({ x, y: PAGE_H - top - h, width: w, height: h, color: o.fill ? (rgbColor(o.fill) as never) : undefined, borderColor: o.stroke ? (rgbColor(o.stroke) as never) : undefined, borderWidth: o.stroke ? (o.width ?? 0.6) : 0 })
    const hline = (x1: number, x2: number, top: number) => page.drawLine({ start: { x: x1, y: PAGE_H - top }, end: { x: x2, y: PAGE_H - top }, thickness: 0.6, color: rgbColor(LINE) as never })
    const vline = (x: number, top1: number, top2: number) => page.drawLine({ start: { x, y: PAGE_H - top1 }, end: { x, y: PAGE_H - top2 }, thickness: 0.6, color: rgbColor(LINE) as never })

    const imageCache = new Map<string, Promise<Loaded | null>>()
    const load = (key: string, px: number) => {
      const k = `${key}:${px}`
      if (!imageCache.has(k)) imageCache.set(k, loadJpeg((x) => (x === 'scheme:current' && input.schemeUrl ? input.schemeUrl() : input.urlOf(x)), key, px))
      return imageCache.get(k)!
    }
    /** Рисует картинку в рамке w×h по центру с сохранением пропорций. */
    const drawImage = async (key: string, x: number, top: number, w: number, h: number, px = 1000, frame = true) => {
      const img = await load(key, px)
      if (frame) rect(x, top, w, h, { stroke: LINE })
      if (!img) return null
      const embeddedImg = await pdf.embedJpg(img.bytes)
      const k = Math.min(w / img.w, h / img.h)
      const dw = img.w * k
      const dh = img.h * k
      page.drawImage(embeddedImg, { x: x + (w - dw) / 2, y: PAGE_H - top - h + (h - dh) / 2, width: dw, height: dh })
      // где легла картинка внутри рамки (нужно, чтобы поставить точки замечаний)
      return { x: x + (w - dw) / 2, top: top + (h - dh) / 2, w: dw, h: dh }
    }

    const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
    const dateOnly = dateFmt.format(new Date(`${r.inspection_date}T12:00:00`))

    // ---- шапка
    text(tr('Отчёт об инспекции выполненных работ'), M, y, 15, { bold: true })
    y += 24
    text(`${r.key}  ·  ${r.title}`, M, y, 11, { color: MUTED })
    y += 22
    const result = r.result ? `${r.result} — ${INSPECTION_STATUSES[r.result]}` : tr('в работе')
    const fields: [string, string][] = [
      [tr('Проект'), input.projectName],
      [tr('Место'), input.placeText],
      [tr('Подрядчик'), r.contractor?.name ?? '—'],
      [tr('Дата инспекции'), dateOnly],
      [tr('Провёл'), r.author?.full_name ?? '—'],
      [tr('Итог'), result],
    ]
    const colW = CONTENT_W / 2 - 8
    for (let i = 0; i < fields.length; i += 2) {
      const pair = fields.slice(i, i + 2)
      const lines = pair.map(([, v]) => wrap(v, 10, colW, true))
      const h = 11 + Math.max(...lines.map((l) => l.length)) * 13 + 5
      ensure(h)
      pair.forEach(([label], k) => {
        const x = M + k * (colW + 16)
        text(label, x, y, 8, { color: MUTED })
        lines[k].forEach((ln, li) => text(ln, x, y + 11 + li * 13, 10, { bold: true }))
      })
      y += h
    }
    y += 2
    text(tr('Статусы: A — принято; C — принято с замечаниями; R — не принято'), M, y, 8.5, { color: MUTED })
    y += 20

    // ---- схема места
    const schemeKey = input.schemeUrl ? 'scheme:current' : undefined
    if (schemeKey || r.scheme_text) {
      ensure(30)
      text(tr('Схема места'), M, y, 11, { bold: true })
      y += 18
      if (schemeKey) {
        const sch = await load(schemeKey, 1600)
        const boxH = sch ? Math.min(250, Math.max(80, (CONTENT_W * sch.h) / sch.w)) : 80
        ensure(boxH)
        const placed = await drawImage(schemeKey, M, y, CONTENT_W, boxH, 1600)
        // точки замечаний: цветной кружок с номером замечания на том месте схемы, которое отметил инспектор
        if (placed) {
          for (const it of items) {
            if (it.scheme_x === null || it.scheme_y === null) continue
            const label = refs.get(it.id) ?? ''
            const cx = placed.x + Number(it.scheme_x) * placed.w
            const cy = placed.top + Number(it.scheme_y) * placed.h
            const lw = Math.max(16, widthOf(label, 7, true) + 8)
            const col = it.status ? STATUS_COLOR[it.status] : { bg: MUTED, fg: rgb(255, 255, 255) }
            page.drawRectangle({ x: cx - lw / 2, y: PAGE_H - cy - 6.5, width: lw, height: 13, color: rgbColor(col.bg), borderColor: rgbColor(rgb(255, 255, 255)), borderWidth: 1, borderRadius: 6.5 } as never)
            text(label, cx - widthOf(label, 7, true) / 2, cy - 4.2, 7, { bold: true, color: col.fg })
          }
        }
        y += boxH + 6
      }
      if (r.scheme_text) {
        for (const ln of wrap(r.scheme_text, 9.5, CONTENT_W)) {
          ensure(13)
          text(ln, M, y, 9.5)
          y += 13
        }
      }
      y += 12
    }

    // ---- таблица разделов
    const tableHeader = () => {
      ensure(40)
      const h = 18
      rect(M, y, CONTENT_W, h, { fill: HEAD_BG, stroke: LINE })
      let x = M
      const cols: [string, number][] = [
        ['№', COL.num],
        [tr('Раздел'), COL.section],
        [tr('Пункт'), COL.ref],
        [tr('Комментарий'), COMMENT_W],
        [tr('Статус'), COL.status],
      ]
      for (const [label, w] of cols) {
        text(label, x + 4, y + 5, 8.5, { bold: true })
        x += w
        if (x < M + CONTENT_W - 1) vline(x, y, y + h)
      }
      y += h
    }
    tableHeader()

    const thumbsPerRow = Math.max(1, Math.floor((COMMENT_W - 8 + GAP) / (THUMB_W + GAP)))
    for (const [si, s] of sections.entries()) {
      const its = items.filter((i) => i.section_id === s.id)
      const rows = its.length > 0 ? its : [null]
      for (const [ri, it] of rows.entries()) {
        const commentText = it ? it.comment || '—' : s.ok ? tr('Без замечаний') : tr('Не проверялся')
        const lines = wrap(commentText, 9, COMMENT_W - 8)
        const itPhotos = it ? photos.filter((p) => p.item_id === it.id) : []
        const thumbRows = Math.ceil(itPhotos.length / thumbsPerRow)
        const sectionLines = wrap(sectionLabel(s), 9, COL.section - 8, true)
        const h = Math.max(22, 8 + lines.length * 12 + (thumbRows > 0 ? 4 + thumbRows * (THUMB_H + GAP) : 0), ri === 0 ? 8 + sectionLines.length * 12 : 0)
        if (y + h > BOTTOM) {
          newPage()
          tableHeader()
        }
        const first = ri === 0 || y === M + 18 // первая строка раздела или первая после заголовка на новой странице
        const status: ItemStatus | null = it ? it.status : s.ok ? 'A' : null
        // границы: слева и справа, вертикали колонок, верх (между строками одного раздела — только справа от колонки раздела)
        vline(M, y, y + h)
        vline(M + CONTENT_W, y, y + h)
        let x = M
        for (const w of [COL.num, COL.section, COL.ref, COMMENT_W]) {
          x += w
          vline(x, y, y + h)
        }
        if (first) hline(M, M + CONTENT_W, y)
        else hline(M + COL.num + COL.section, M + CONTENT_W, y)
        if (first) {
          text(String(si + 1), M + 4, y + 5, 9, { bold: true })
          sectionLines.forEach((ln, li) => text(ln, M + COL.num + 4, y + 5 + li * 12, 9, { bold: true }))
        }
        if (it) text(refs.get(it.id) ?? '', M + COL.num + COL.section + 4, y + 5, 9, { color: MUTED })
        lines.forEach((ln, li) => text(ln, M + COL.num + COL.section + COL.ref + 4, y + 5 + li * 12, 9, { color: it ? INK : MUTED }))
        for (const [pi, ph] of itPhotos.entries()) {
          const px = M + COL.num + COL.section + COL.ref + 4 + (pi % thumbsPerRow) * (THUMB_W + GAP)
          const py = y + 8 + lines.length * 12 + 4 + Math.floor(pi / thumbsPerRow) * (THUMB_H + GAP)
          await drawImage(ph.file.storage_key, px, py, THUMB_W, THUMB_H, 500)
        }
        if (status) {
          const bx = M + CONTENT_W - COL.status + 6
          rect(bx, y + 4, COL.status - 12, 14, { fill: STATUS_COLOR[status].bg })
          const sw = widthOf(status, 9, true)
          text(status, bx + (COL.status - 12 - sw) / 2, y + 6.5, 9, { bold: true, color: STATUS_COLOR[status].fg })
        }
        y += h
      }
    }
    hline(M, M + CONTENT_W, y)
    y += 16

    // ---- общее замечание
    if (r.note) {
      ensure(40)
      text(tr('Общее замечание'), M, y, 11, { bold: true })
      y += 18
      for (const ln of wrap(r.note, 9.5, CONTENT_W)) {
        ensure(13)
        text(ln, M, y, 9.5)
        y += 13
      }
      y += 12
    }

    // ---- общие фото
    const general = photos.filter((p) => !p.item_id)
    if (general.length > 0) {
      ensure(30 + 130)
      text(tr('Общие фото'), M, y, 11, { bold: true })
      y += 18
      const perRow = 3
      const cw = (CONTENT_W - (perRow - 1) * 10) / perRow
      const ch = cw * 0.75
      for (let i = 0; i < general.length; i += perRow) {
        ensure(ch + 16)
        for (const [k, ph] of general.slice(i, i + perRow).entries()) {
          await drawImage(ph.file.storage_key, M + k * (cw + 10), y, cw, ch, 900)
          if (ph.caption) text(wrap(ph.caption, 8, cw)[0], M + k * (cw + 10), y + ch + 2, 8, { color: MUTED })
        }
        y += ch + 16
      }
      y += 4
    }

    // ---- подписи
    ensure(120)
    text(tr('Подписи'), M, y, 11, { bold: true })
    y += 18
    const boxW = CONTENT_W / 2 - 8
    const sides: [string, string | null, string | null, string | null][] = [
      [tr('Заказчик'), r.client_name, r.client_signed_at, r.client_sign_file_id],
      [tr('Подрядчик'), r.contractor_name, r.contractor_signed_at, r.contractor_sign_file_id],
    ]
    for (const [k, [label, name, at, fileId]] of sides.entries()) {
      const x = M + k * (boxW + 16)
      rect(x, y, boxW, 100, { stroke: LINE })
      text(label, x + 8, y + 7, 9, { bold: true })
      const key = fileId ? fileKeys[fileId] : undefined
      if (key) await drawImage(key, x + 8, y + 22, 150, 44, 600, false)
      else hline(x + 8, x + boxW - 8, y + 66)
      if (name) {
        text(name, x + 8, y + 72, 9.5, { bold: true })
        if (at) text(dateFmt.format(new Date(at)), x + 8, y + 86, 8.5, { color: MUTED })
      } else {
        text(tr('Не подписано'), x + 8, y + 72, 9, { color: MUTED })
      }
    }

    // ---- колонтитулы
    pages.forEach((p, i) => {
      const left = `${r.key}  ·  ${input.projectName}`
      const right = `${i + 1} / ${pages.length}`
      page = p
      text(left, M, PAGE_H - 34, 8, { color: MUTED })
      text(right, PAGE_W - M - widthOf(right, 8), PAGE_H - 34, 8, { color: MUTED })
    })

    const bytes = await pdf.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${`${r.key} ${r.title}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    toast.success(tr('Отчёт выгружен в PDF'))
  } catch (e) {
    console.error(e)
    toast.error(tr('Не удалось сформировать PDF. Попробуйте ещё раз.'))
  }
}
