// Штамп электронной подписи, вшитый в страницу PDF (pdf-lib, в браузере):
//   ┌ eSigned by: ─────────────────────┐
//   │ Имя Фамилия: 80a6c827-16e7-…      │
//   │        (рисунок подписи)          │
//   │ 20.11.2026 14:37  Certified by CONMAX ┘
// У каждого штампа свой код (он же строка журнала подписей): по коду с любой страницы подпись проверяется.
// Шрифты Noto Sans (латиница, кириллица) и Noto Sans Georgian: для каждого символа берётся первый шрифт, где он есть.
// Модуль грузится только при подписании (тяжёлые pdf-lib и шрифты не попадают в основной бандл).

import type { PDFFont, PDFPage } from 'pdf-lib'

/** Где стоит штамп: страница (с 0) и доли видимого листа (как его рисует pdf.js, с учётом поворота) от левого верхнего угла. */
export interface Placement {
  page: number
  x: number
  y: number
  /** ширина штампа в долях ширины листа */
  w: number
}

/** Штамп с его собственным кодом */
export type Mark = Placement & { code: string }

export interface StampInfo {
  name: string
  signedAt: Date
  /** PNG подписи: data:image/png;base64,… */
  image: string
}

/** Высота штампа к ширине */
export const STAMP_RATIO = 0.42

const GREEN = [0.33, 0.78, 0.25] as const
const INK = [0.2, 0.25, 0.32] as const

async function loadFonts() {
  const urls = await Promise.all([
    import('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'),
    import('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'),
    import('@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-400-normal.woff?url'),
    import('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url'),
  ])
  return Promise.all(urls.map(async (m) => new Uint8Array(await (await fetch(m.default)).arrayBuffer())))
}

type Face = { font: PDFFont; chars: Set<number> }

/** Текст кусками по шрифтам: латиница/кириллица/грузинский; символы, которых нет ни в одном шрифте, пропускаются. */
function runs(text: string, faces: Face[]) {
  const out: { text: string; font: PDFFont }[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const face = faces.find((f) => f.chars.has(cp))
    if (!face) continue
    const last = out[out.length - 1]
    if (last && last.font === face.font) last.text += ch
    else out.push({ text: ch, font: face.font })
  }
  return out
}

const widthOf = (text: string, faces: Face[], size: number) => runs(text, faces).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0)

/** Обрезает строку с «…», чтобы она уместилась в ширину. */
function fit(text: string, faces: Face[], size: number, max: number) {
  if (widthOf(text, faces, size) <= max) return text
  let t = text
  while (t.length > 1 && widthOf(t + '…', faces, size) > max) t = t.slice(0, -1)
  return t + '…'
}

function drawRuns(page: PDFPage, text: string, faces: Face[], x: number, y: number, size: number, color: readonly [number, number, number], rgb: (r: number, g: number, b: number) => unknown) {
  let cx = x
  for (const r of runs(text, faces)) {
    page.drawText(r.text, { x: cx, y, size, font: r.font, color: rgb(...color) as never })
    cx += r.font.widthOfTextAtSize(r.text, size)
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const stampDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Вшивает штампы во все отмеченные места PDF (у каждого — свой код) и возвращает новый файл. */
export async function stampPdf(source: ArrayBuffer, marks: Mark[], info: StampInfo): Promise<Uint8Array> {
  const [{ PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix }, fontkit, fontBytes] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    loadFonts(),
  ])
  const pdf = await PDFDocument.load(source, { updateMetadata: false })
  pdf.registerFontkit(fontkit.default)
  const fonts = await Promise.all(fontBytes.map((b) => pdf.embedFont(b, { subset: true })))
  const regular: Face[] = fonts.slice(0, 3).map((font) => ({ font, chars: new Set(font.getCharacterSet()) }))
  const bold: Face[] = [{ font: fonts[3], chars: new Set(fonts[3].getCharacterSet()) }, ...regular.slice(1)]
  const png = await pdf.embedPng(info.image)

  const wrapped = new Set<number>()
  for (const mark of marks) {
    const index = Math.min(mark.page, pdf.getPageCount() - 1)
    const page = pdf.getPage(index)
    // прежнее содержимое — в q…Q: иначе его незакрытые преобразования сдвинули бы штамп
    if (!wrapped.has(index)) {
      page.translateContent(0, 0)
      wrapped.add(index)
    }

    const crop = page.getCropBox()
    const rot = ((page.getRotation().angle % 360) + 360) % 360
    const turned = rot === 90 || rot === 270
    const dw = turned ? crop.height : crop.width
    const dh = turned ? crop.width : crop.height
    // локальные координаты «как видно на экране» (ось y вверх) → координаты страницы с учётом поворота
    const cm: Record<number, [number, number, number, number, number, number]> = {
      0: [1, 0, 0, 1, crop.x, crop.y],
      90: [0, 1, -1, 0, crop.x + crop.width, crop.y],
      180: [-1, 0, 0, -1, crop.x + crop.width, crop.y + crop.height],
      270: [0, -1, 1, 0, crop.x, crop.y + crop.height],
    }
    const w = Math.max(120, mark.w * dw)
    const h = w * STAMP_RATIO
    const x = Math.min(Math.max(0, mark.x * dw), dw - w)
    const top = Math.min(Math.max(0, mark.y * dh), dh - h)
    const y = dh - top - h

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...(cm[rot] ?? cm[0])))

    const k = w / 220 // всё в штампе — от ширины 220 pt
    const label = 9 * k
    const small = 7.2 * k
    const line = 1.2 * k
    const inset = label * 0.6

    // рамка: сверху и снизу — разрывы под надписи
    const head = 'eSigned by:'
    const headW = widthOf(head, bold, label)
    const foot = 'CONMAX'
    const footPrefix = 'Certified by '
    const footW = widthOf(footPrefix, regular, small) + widthOf(foot, bold, label)
    const fy = y + inset // нижняя линия рамки
    const ty = y + h - label * 0.5 // верхняя линия рамки
    const border = rgb(...GREEN)
    const seg = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: line, color: border })
    const gap = 3 * k
    seg(x, fy, x, ty) // левая
    seg(x + w, fy, x + w, ty) // правая
    seg(x, ty, x + 4 * k, ty)
    seg(x + 4 * k + headW + 2 * gap, ty, x + w, ty)
    seg(x, fy, x + w - footW - 2 * gap - 4 * k, fy)
    seg(x + w - 4 * k, fy, x + w, fy)

    drawRuns(page, head, bold, x + 4 * k + gap, ty - label * 0.33, label, INK, rgb)
    const fx = x + w - 4 * k - gap - footW
    drawRuns(page, footPrefix, regular, fx, fy - small * 0.33, small, INK, rgb)
    drawRuns(page, foot, bold, fx + widthOf(footPrefix, regular, small), fy - label * 0.33, label, INK, rgb)

    // имя, под ним код этого штампа — код всегда целиком (по нему проверяют подпись): не влезает — мельче шрифт
    const textX = x + 6 * k
    const maxW = w - 12 * k
    const nameY = ty - label * 0.33 - small * 1.55
    drawRuns(page, fit(`${info.name}:`, regular, small, maxW), regular, textX, nameY, small, INK, rgb)
    const codeSize = Math.min(small * 0.92, (small * maxW) / Math.max(1, widthOf(mark.code, regular, small)))
    drawRuns(page, mark.code, regular, textX, nameY - small * 1.2, codeSize, INK, rgb)
    // дата — внизу слева, над рамкой
    drawRuns(page, stampDate(info.signedAt), regular, textX, fy + small * 0.55, small * 0.9, INK, rgb)

    // рисунок подписи — по центру свободного места
    const areaTop = nameY - small * 1.6
    const areaBottom = fy + small * 1.7
    const areaH = Math.max(8, areaTop - areaBottom)
    const scale = Math.min(maxW / png.width, areaH / png.height)
    const iw = png.width * scale
    const ih = png.height * scale
    page.drawImage(png, { x: x + (w - iw) / 2, y: areaBottom + (areaH - ih) / 2, width: iw, height: ih })

    page.pushOperators(popGraphicsState())
  }
  return pdf.save()
}

/** SHA-256 файла шестнадцатеричной строкой — для журнала и проверки. */
export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
