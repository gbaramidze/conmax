// Decision Sheet (дан. 3 процедуры PR-01) — лист решения о закупке в PDF, собирается в браузере из карточки заявки:
// что покупаем, у кого и почему, сравнение предложений, уровень согласования по порогу, решения согласующих с датами,
// подтверждение инициатора, заказ. Решения согласующих — электронные (журнал заявки), лист их фиксирует для архива и 1C.
// Шрифты Noto Sans (латиница, кириллица, обычный и жирный) и Noto Sans Georgian; pdf-lib грузится только при нажатии.

import type { PDFFont, PDFPage } from 'pdf-lib'
import { symbolOf } from '@/features/projects/currency'
import { currentLocale } from '@/lib/i18n'
import { tr, trData } from '@/lib/tr'
import { inBase, quoteTotal, REQUEST_STATUSES, TIERS, type RequestDetail } from './api'

type Face = { font: PDFFont; chars: Set<number> }

async function loadFonts() {
  const urls = await Promise.all([
    import('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'),
    import('@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'),
    import('@fontsource/noto-sans-georgian/files/noto-sans-georgian-georgian-400-normal.woff?url'),
    import('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url'),
    import('@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff?url'),
  ])
  return Promise.all(urls.map(async (m) => new Uint8Array(await (await fetch(m.default)).arrayBuffer())))
}

const A4 = { w: 595.28, h: 841.89 }
const M = 40
const INK = [0.1, 0.12, 0.14] as const
const MUTED = [0.42, 0.44, 0.43] as const
const GREEN = [0.06, 0.45, 0.25] as const
const LINE = [0.85, 0.86, 0.85] as const

export async function downloadDecisionSheet(r: RequestDetail): Promise<void> {
  const [{ PDFDocument, rgb }, fontkit, bytes] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit'), loadFonts()])
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit.default)
  const fonts = await Promise.all(bytes.map((b) => pdf.embedFont(b, { subset: true })))
  const face = (f: PDFFont): Face => ({ font: f, chars: new Set(f.getCharacterSet()) })
  const regular = [face(fonts[0]), face(fonts[1]), face(fonts[2])]
  const bold = [face(fonts[3]), face(fonts[4]), face(fonts[2])]
  const color = (c: readonly [number, number, number]) => rgb(c[0], c[1], c[2])

  // текст кусками по шрифтам (символы без шрифта пропускаются)
  const runs = (text: string, faces: Face[]) => {
    const out: { text: string; font: PDFFont }[] = []
    for (const ch of text) {
      const f = faces.find((x) => x.chars.has(ch.codePointAt(0)!))
      if (!f) continue
      const last = out[out.length - 1]
      if (last && last.font === f.font) last.text += ch
      else out.push({ text: ch, font: f.font })
    }
    return out
  }
  const width = (text: string, faces: Face[], size: number) => runs(text, faces).reduce((w, x) => w + x.font.widthOfTextAtSize(x.text, size), 0)
  const wrap = (text: string, faces: Face[], size: number, max: number): string[] => {
    const lines: string[] = []
    for (const para of text.split('\n')) {
      let cur = ''
      for (const word of para.split(' ')) {
        const next = cur ? `${cur} ${word}` : word
        if (width(next, faces, size) <= max || !cur) cur = next
        else {
          lines.push(cur)
          cur = word
        }
      }
      lines.push(cur)
    }
    return lines
  }

  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - M
  const newPageIfNeeded = (h: number) => {
    if (y - h < M + 20) {
      page = pdf.addPage([A4.w, A4.h])
      y = A4.h - M
    }
  }
  const draw = (text: string, x: number, yy: number, size: number, faces = regular, c: readonly [number, number, number] = INK) => {
    let cx = x
    for (const part of runs(text, faces)) {
      page.drawText(part.text, { x: cx, y: yy, size, font: part.font, color: color(c) })
      cx += part.font.widthOfTextAtSize(part.text, size)
    }
  }
  const para = (text: string, size = 10, faces = regular, c: readonly [number, number, number] = INK, indent = 0) => {
    for (const line of wrap(text, faces, size, A4.w - 2 * M - indent)) {
      newPageIfNeeded(size + 4)
      draw(line, M + indent, y - size, size, faces, c)
      y -= size + 4
    }
  }
  const heading = (text: string) => {
    y -= 8
    newPageIfNeeded(30)
    draw(text, M, y - 12, 12, bold)
    y -= 18
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: color(LINE) })
    y -= 6
  }
  /** Пары «подпись — значение» в две колонки */
  const facts = (rows: [string, string][]) => {
    const keyW = 160
    for (const [k, v] of rows) {
      // подпись тоже переносится, чтобы длинная не наезжала на значение
      const keys = wrap(k, regular, 9.5, keyW - 10)
      const lines = wrap(v || '—', regular, 10, A4.w - 2 * M - keyW)
      const n = Math.max(keys.length, lines.length)
      newPageIfNeeded(n * 14)
      keys.forEach((line, i) => draw(line, M, y - 10 - i * 14, 9.5, regular, MUTED))
      lines.forEach((line, i) => draw(line, M + keyW, y - 10 - i * 14, 10))
      y -= n * 14 + 2
    }
  }
  /** Таблица: колонки с долями ширины; строки переносятся по словам */
  const table = (cols: { title: string; w: number; right?: boolean }[], rows: { cells: string[]; strong?: boolean }[]) => {
    const total = A4.w - 2 * M
    const xs = cols.reduce<number[]>((acc, _c, i) => [...acc, i === 0 ? M : acc[i - 1] + cols[i - 1].w * total], [])
    const row = (cells: string[], faces: Face[], c: readonly [number, number, number], size: number) => {
      const wrapped = cells.map((cell, i) => wrap(cell || '—', faces, size, cols[i].w * total - 8))
      const h = Math.max(...wrapped.map((l) => l.length)) * (size + 3) + 6
      newPageIfNeeded(h)
      wrapped.forEach((lines, i) =>
        lines.forEach((line, j) => {
          const x = cols[i].right ? xs[i] + cols[i].w * total - 4 - width(line, faces, size) : xs[i] + 2
          draw(line, x, y - size - 2 - j * (size + 3), size, faces, c)
        }),
      )
      y -= h
      page.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.4, color: color(LINE) })
    }
    row(cols.map((c) => c.title), regular, MUTED, 8.5)
    for (const x of rows) row(x.cells, x.strong ? bold : regular, x.strong ? GREEN : INK, 9.5)
    y -= 4
  }

  const loc = currentLocale()
  const nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 })
  const money = (n: number | null, cur: string | null) => (n === null ? '—' : `${nf.format(n)} ${cur ? symbolOf(cur) : ''}`.trim())
  const date = (d: string | null) => (d ? new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d.length === 10 ? `${d}T12:00:00` : d)) : '—')
  const dateTime = (d: string | null) =>
    d ? new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—'

  const rfq = r.rfq
  const chosen = rfq?.quotes.find((q) => q.id === r.quote_id) ?? null

  // шапка
  draw(r.company, M, y - 10, 10, regular, MUTED)
  const stampText = tr('Сформировано {{d}}', { d: dateTime(new Date().toISOString()) })
  draw(stampText, A4.w - M - width(stampText, regular, 8.5), y - 10, 8.5, regular, MUTED)
  y -= 30
  draw('Decision Sheet', M, y - 18, 18, bold)
  y -= 24
  para(tr('Решение о закупке {{key}}', { key: r.key }), 12, regular, MUTED)
  para(r.title, 13, bold)
  y -= 4

  heading(tr('Заявка'))
  facts([
    [tr('Проект'), `${r.project.code} · ${r.project.name}`],
    [tr('Инициатор'), r.requester_name ?? '—'],
    [tr('Закупщик'), r.buyer_name ?? '—'],
    [tr('Нужно на площадке до'), date(r.needed_by)],
    [tr('Статья бюджета'), r.item ? `${r.item.code} · ${r.item.name}` : '—'],
    [tr('Статус'), REQUEST_STATUSES[r.status]],
  ])

  heading(tr('Решение'))
  facts([
    [tr('Поставщик'), r.supplier],
    [tr('Сумма'), `${money(r.amount, r.currency)}${r.currency !== 'GEL' && r.amount_gel !== null ? ` (≈ ${money(r.amount_gel, 'GEL')})` : ''}`],
    [tr('Срок поставки'), chosen?.delivery_days == null ? '—' : tr('{{n}} дн.', { n: chosen.delivery_days })],
    [tr('Оплата и условия'), chosen?.terms ?? ''],
    [tr('Уровень согласования'), r.tier ? TIERS[r.tier] : '—'],
    ...(r.approval_note ? [[tr('Почему этот поставщик'), r.approval_note] as [string, string]] : []),
    ...(r.single_source_reason ? [[tr('Почему меньше трёх предложений'), r.single_source_reason] as [string, string]] : []),
    ...(r.over_budget ? [[tr('Бюджет'), tr('Сумма больше остатка бюджета статьи.')] as [string, string]] : []),
  ])

  if (rfq && rfq.quotes.length > 0) {
    heading(tr('Сравнение предложений'))
    table(
      [
        { title: tr('Поставщик'), w: 0.3 },
        { title: tr('Итого'), w: 0.2, right: true },
        { title: tr('Срок'), w: 0.12, right: true },
        { title: tr('Оплата и условия'), w: 0.38 },
      ],
      rfq.quotes.map((q) => {
        const t = quoteTotal(rfq.lines, q)
        const base = t === null ? null : inBase(t, q.currency, r.project.currency, r.project.fx_rate)
        return {
          strong: q.id === r.quote_id,
          cells: [
            `${q.supplier}${q.id === r.quote_id ? ` — ${tr('выбрано')}` : ''}${q.supplier_status === 'restricted' ? ` (${tr('ограниченный список')})` : ''}`,
            t === null ? tr('не по всем позициям') : `${money(t, q.currency)}${q.currency !== r.project.currency && base !== null ? `\n≈ ${money(base, r.project.currency)}` : ''}`,
            q.delivery_days === null ? '—' : tr('{{n}} дн.', { n: q.delivery_days }),
            q.terms,
          ],
        }
      }),
    )
  }

  heading(tr('Позиции'))
  table(
    [
      { title: tr('Позиция'), w: 0.46 },
      { title: tr('Кол-во'), w: 0.16, right: true },
      { title: tr('Цена'), w: 0.18, right: true },
      { title: tr('Сумма'), w: 0.2, right: true },
    ],
    (rfq?.lines ?? []).map((l) => {
      const p = chosen?.prices.find((x) => x.line_id === l.id)
      return { cells: [l.name, `${nf.format(l.qty)} ${l.unit}`, p ? money(p.unit_price, chosen!.currency) : '—', p ? money(p.unit_price * l.qty, chosen!.currency) : '—'] }
    }),
  )

  const round = r.approvals.filter((a) => a.round === r.approval_round)
  if (round.length > 0) {
    heading(tr('Согласование'))
    const word = (s: string) => (s === 'approved' ? tr('Одобрено') : s === 'rejected' ? tr('Не согласовано') : s === 'cancelled' ? tr('не потребовалось') : tr('ждём решения'))
    table(
      [
        { title: tr('Согласующий'), w: 0.3 },
        { title: tr('Решение'), w: 0.18 },
        { title: tr('Дата и время'), w: 0.2 },
        { title: tr('Комментарий'), w: 0.32 },
      ],
      round.map((a) => ({ strong: a.status === 'approved', cells: [`${a.name}${a.job_title ? `\n${trData(a.job_title)}` : ''}`, word(a.status), dateTime(a.decided_at), a.note] })),
    )
  }

  const confirmed = ['confirmed', 'ordered', 'shipped', 'delivered'].includes(r.status)
  heading(tr('Подтверждение и заказ'))
  facts([
    [tr('Инициатор подтвердил'), confirmed ? `${r.decided_by_name ?? r.requester_name ?? '—'}, ${dateTime(r.decided_at)}` : tr('ещё нет')],
    [tr('Заказ'), r.ordered_at ? `${r.order_ref || '—'}, ${date(r.ordered_at)}` : tr('ещё не оформлен')],
    ...(r.expected_at ? [[tr('Ожидается'), date(r.expected_at)] as [string, string]] : []),
  ])

  y -= 10
  para(tr('Решения согласующих приняты электронно в CONMAX и хранятся в журнале заявки {{key}}.', { key: r.key }), 8.5, regular, MUTED)

  // номера страниц
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    page = p
    const text = `${r.key} · ${i + 1} / ${pages.length}`
    draw(text, A4.w - M - width(text, regular, 8), M - 18, 8, regular, MUTED)
  })

  const out = await pdf.save()
  const blob = new Blob([out as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${new Date().toLocaleDateString('sv')}_${r.project.code}_${r.supplier || 'supplier'}_DecisionSheet_${r.key}.pdf`.replace(/[\\/:*?"<>|]+/g, '_')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
