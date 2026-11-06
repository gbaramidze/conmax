import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Найденное слово на листе: прямоугольник в долях страницы (0…1). */
export interface TextHit {
  page: number
  x: number
  y: number
  w: number
  h: number
}

/** Слова запроса: по ним ищем и подсвечиваем (короче двух знаков не берём — это шум). */
export const queryWords = (q: string) => [...new Set(q.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2))]

/**
 * Ищет слова запроса в текстовом слое всех листов PDF и возвращает их положение на листе.
 * Работает только с PDF, где есть текст (не скан): у скана текстового слоя нет, и найти слово на листе нельзя без распознавания (OCR).
 * Лист считается по частям, поиск можно прервать (`isCancelled`). Не больше 500 листов и 2000 совпадений.
 */
export async function findInPdf(doc: PDFDocumentProxy, query: string, isCancelled: () => boolean): Promise<TextHit[]> {
  const words = queryWords(query)
  if (words.length === 0) return []
  const hits: TextHit[] = []
  const last = Math.min(doc.numPages, 500)
  for (let n = 1; n <= last && hits.length < 2000; n++) {
    if (isCancelled()) return hits
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const text = item.str.toLowerCase()
      for (const w of words) {
        let from = 0
        for (;;) {
          const i = text.indexOf(w, from)
          if (i < 0) break
          from = i + w.length
          const r = wordRect(item as unknown as PdfItem, vp, i, w.length)
          hits.push({ page: n, ...r })
        }
      }
    }
  }
  // по листам, внутри листа сверху вниз и слева направо
  return hits.sort((p, q) => p.page - q.page || p.y - q.y || p.x - q.x)
}

type PdfItem = { str: string; width: number; height: number; transform: number[] }

/** Прямоугольник части строки (символы i…i+len) в долях листа; строки на чертежах бывают повёрнуты. */
function wordRect(item: PdfItem, vp: { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] }, i: number, len: number) {
  const [a, b, , , e, f] = item.transform as number[]
  const norm = Math.hypot(a!, b!) || 1
  const dx = a! / norm
  const dy = b! / norm
  const px = -dy
  const py = dx
  const total = item.str.length || 1
  const s0 = (item.width * i) / total
  const s1 = (item.width * (i + len)) / total
  const xs: number[] = []
  const ys: number[] = []
  for (const [s, up] of [
    [s0, -0.15],
    [s1, -0.15],
    [s1, 0.85],
    [s0, 0.85],
  ] as const) {
    xs.push(e! + dx * s + px * item.height * up)
    ys.push(f! + dy * s + py * item.height * up)
  }
  const [vx1, vy1] = vp.convertToViewportPoint(Math.min(...xs), Math.min(...ys))
  const [vx2, vy2] = vp.convertToViewportPoint(Math.max(...xs), Math.max(...ys))
  return { x: Math.min(vx1!, vx2!) / vp.width, y: Math.min(vy1!, vy2!) / vp.height, w: Math.abs(vx2! - vx1!) / vp.width, h: Math.abs(vy2! - vy1!) / vp.height }
}
