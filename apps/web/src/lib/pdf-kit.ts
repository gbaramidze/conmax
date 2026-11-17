// Общие кирпичики для PDF, собираемых в браузере (pdf-lib): шрифты с кириллицей и грузинским, перенос строк, картинки в JPEG.
// Библиотека и шрифты подгружаются только при выгрузке, поэтому в основной бандл не попадают.

export type Rgb = [number, number, number]
export const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255]

// A4 в пунктах
export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const MARGIN = 40
export const CONTENT_W = PAGE_W - 2 * MARGIN
/** Ниже этой отметки (от верха) — колонтитул */
export const BOTTOM = PAGE_H - 46

export const INK = rgb(17, 24, 39)
export const MUTED = rgb(95, 99, 104)
export const LINE = rgb(205, 209, 204)
export const SOFT = rgb(242, 243, 241)

export interface Loaded {
  bytes: Uint8Array
  w: number
  h: number
}

/** Скачивает картинку по адресу, уменьшает и перекодирует в JPEG на белом фоне; при ошибке — null (в PDF останется пустая рамка). */
export async function loadJpeg(url: string, maxPx: number): Promise<Loaded | null> {
  try {
    const blob = await (await fetch(url)).blob()
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
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    return out ? { bytes: new Uint8Array(await out.arrayBuffer()), w, h } : null
  } catch {
    return null
  }
}

/**
 * Документ с тремя семействами шрифта (Noto Sans: латиница и кириллица, Noto Sans Georgian) в обычном и жирном начертании.
 * Для каждого символа берётся первый шрифт, где он есть; символ, которого нет нигде, пропускается.
 */
export async function createPdfKit() {
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
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkitMod.default)
  const embedded = await Promise.all(fontBytes.map((b) => pdf.embedFont(b, { subset: true })))
  const fonts = {
    regular: embedded.slice(0, 3).map((font) => ({ font, chars: new Set(font.getCharacterSet()) })),
    bold: embedded.slice(3).map((font) => ({ font, chars: new Set(font.getCharacterSet()) })),
  }

  type Run = { text: string; font: (typeof fonts.regular)[number]['font'] }
  const toRuns = (text: string, bold: boolean): Run[] => {
    const set = bold ? fonts.bold : fonts.regular
    const runs: Run[] = []
    for (const ch of text.replace(/[ \t\r\f\v]+/g, ' ')) {
      if (ch === '\n') continue
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

  /** Разбивает текст по строкам с учётом ширины; абзацы (\n) сохраняются, слишком длинные слова режутся. */
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

  /** Обрезает строку многоточием, чтобы она влезла в ширину. */
  const fit = (text: string, size: number, maxW: number, bold = false): string => {
    if (widthOf(text, size, bold) <= maxW) return text
    let n = text.length
    while (n > 1 && widthOf(`${text.slice(0, n)}…`, size, bold) > maxW) n--
    return `${text.slice(0, n)}…`
  }

  const color = (c: Rgb) => pdfRgb(c[0], c[1], c[2])
  return { pdf, toRuns, widthOf, wrap, fit, color }
}
