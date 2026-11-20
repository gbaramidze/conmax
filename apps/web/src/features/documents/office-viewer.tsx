import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FILES_BUCKET } from '@/features/activity/api'
import { docWords, HitBar, hasWords, useDomHighlight } from '@/features/documents/dom-highlight'
import { escapeHtml } from '@/lib/print-file'
import { supabase } from '@/lib/supabase'
import type { OfficeKind } from './office'

// книга со стилями, рисунками и фильтрами разбирается exceljs: тяжёлый код грузится только для таблиц
const RichSheets = lazy(() => import('./sheet/rich-viewer'))
/** Крупные книги открываются проще (без стилей): exceljs на них медленный */
const RICH_MAX_BYTES = 10 * 1024 * 1024

type Cell = string | number | boolean | Date | null | undefined
interface Sheet {
  name: string
  rows: Cell[][]
}

/** styled — документ нарисован со стилями Word (docx-preview); false — упрощённо (mammoth), если тот не справился */
type Loaded = { kind: 'excel'; sheets: Sheet[]; rich: ArrayBuffer | null } | { kind: 'word'; html: string; styled: boolean; notes: string[] } | { kind: 'text'; text: string }

const WORD_FORBID = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'frame', 'frameset', 'applet']

/**
 * Word как в Word: страницы, шрифты, цвета, заливка таблиц, колонтитулы с логотипом (docx-preview).
 * Рисуем в отдельный элемент, затем чистим DOMPurify (стили документа оставляем, скрипты и формы — нет);
 * картинки и шрифты — data:, чтобы тот же HTML годился и для печати.
 */
async function renderWord(source: ArrayBuffer): Promise<string> {
  const [{ renderAsync }, { default: DOMPurify }] = await Promise.all([import('docx-preview'), import('dompurify')])
  const buffer = await withVmlStrokes(source).catch(() => source)
  const box = document.createElement('div')
  await renderAsync(buffer, box, box, {
    className: 'docx',
    inWrapper: true,
    ignoreLastRenderedPageBreak: true,
    useBase64URL: true,
    renderComments: false,
    renderChanges: false,
    experimental: false,
  })
  // Рисунки и надписи docx-preview кладёт в <div> внутри абзаца <p>. В HTML-строке так нельзя: при разборе браузер
  // закрывает абзац перед <div>, и пропадает выравнивание (логотип справа, заголовок по центру с линиями).
  // Такие div → span с теми же стилями (inline-block уже в style), до превращения в строку.
  for (const div of Array.from(box.querySelectorAll('p div')).reverse()) {
    const span = document.createElement('span')
    for (const a of Array.from(div.attributes)) span.setAttribute(a.name, a.value)
    if (!span.style.display) span.style.display = 'block'
    span.append(...Array.from(div.childNodes))
    div.replaceWith(span)
  }
  return DOMPurify(window).sanitize(WORD_CSS + box.innerHTML, { ADD_TAGS: ['style'], FORCE_BODY: true, FORBID_TAGS: WORD_FORBID, ALLOW_DATA_ATTR: false })
}

/**
 * Линии и рамки старого формата (VML: линии под шапкой, рамки) хранят цвет и толщину в атрибутах
 * strokecolor/strokeweight, а docx-preview понимает только вложенный <v:stroke> — без него линия невидима.
 * Переносим атрибуты во вложенный элемент. Нечего переносить — файл не трогаем.
 */
async function withVmlStrokes(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const TAG = /<v:(line|rect|roundrect|oval|shape|polyline)\b([^>]*?)(\/?)>/g
  let changed = false
  for (const name of Object.keys(zip.files).filter((n) => /^word\/[^/]+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string')
    if (!xml.includes('strokecolor') && !xml.includes('strokeweight')) continue
    const next = xml.replace(TAG, (all, tag: string, attrs: string, self: string) => {
      const color = /\bstrokecolor="([^"]+)"/.exec(attrs)?.[1]
      const weight = /\bstrokeweight="([^"]+)"/.exec(attrs)?.[1]
      if (!color && !weight || /\bstroked="(f|false)"/.test(attrs)) return all
      const stroke = `<v:stroke${color ? ` color="${color.replace(/\s.*$/, '')}"` : ''}${weight ? ` weight="${weight}"` : ''}/>`
      return self ? `<v:${tag}${attrs}>${stroke}</v:${tag}>` : `${all}${stroke}`
    })
    if (next !== xml) {
      zip.file(name, next)
      changed = true
    }
  }
  return changed ? zip.generateAsync({ type: 'arraybuffer' }) : buffer
}

/** Фигуры (линии) рисуются svg без размеров — пусть выходят за рамку, иначе обрезаются */
const WORD_CSS = '<style>.docx svg{overflow:visible}</style>'

/** Печать Word: без серого поля и теней вокруг страниц */
const WORD_PRINT_CSS = '<style>.docx-wrapper{background:none!important;padding:0!important}.docx-wrapper>section.docx{box-shadow:none!important;margin:0 auto!important}</style>'

function decode(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return (utf8.match(/�/g) ?? []).length > Math.max(3, utf8.length / 200) ? new TextDecoder('windows-1251').decode(bytes) : utf8
}

async function load(source: string | Blob, name: string, kind: OfficeKind): Promise<Loaded> {
  let blob: Blob
  if (typeof source === 'string') {
    const { data, error } = await supabase.storage.from(FILES_BUCKET).download(source)
    if (error || !data) throw error ?? new Error('file_not_found')
    blob = data
  } else blob = source
  if (kind === 'excel') {
    if (/\.(csv)$/i.test(name) || blob.type === 'text/csv') {
      const { parseCsv } = await import('@/features/volumes/api')
      return { kind, sheets: [{ name: 'CSV', rows: parseCsv(decode(await blob.arrayBuffer())) }], rich: null }
    }
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(blob)
    return { kind, sheets: sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] })), rich: blob.size <= RICH_MAX_BYTES ? await blob.arrayBuffer() : null }
  }
  if (kind === 'word') {
    const buffer = await blob.arrayBuffer()
    try {
      return { kind, html: await renderWord(buffer), styled: true, notes: [] }
    } catch (e) {
      console.warn('docx-preview failed, falling back to mammoth', e)
    }
    const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([import('mammoth'), import('dompurify')])
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
    return { kind, html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }), styled: false, notes: result.messages.filter((m) => m.type === 'warning').map((m) => m.message).slice(0, 5) }
  }
  return { kind: 'text', text: decode(await blob.arrayBuffer()) }
}

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
const numFmt = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 6 })
const show = (c: Cell): string => (c === null || c === undefined ? '' : c instanceof Date ? dateFmt.format(c) : typeof c === 'number' ? numFmt.format(c) : typeof c === 'boolean' ? (c ? tr('Да') : tr('Нет')) : String(c))
const colName = (i: number) => {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}
const PAGE = 500

/** Строк листа в печати: больше на бумагу всё равно не нужно, а браузер на десятках тысяч строк надолго зависает. */
const PRINT_MAX_ROWS = 5000

/** Тот же файл как страница для печати: Word — как в просмотре, таблица — все листы подряд, текст — моноширинным. */
export async function officePrintHtml(blob: Blob, name: string, kind: OfficeKind): Promise<string> {
  const data = await load(blob, name, kind)
  if (data.kind === 'word') return data.styled ? `${WORD_PRINT_CSS}${data.html}` : data.html
  if (data.kind === 'text') return `<pre>${escapeHtml(data.text)}</pre>`
  return data.sheets
    .map((s) => {
      const width = Math.max(1, ...s.rows.slice(0, 300).map((r) => r.length))
      const rows = s.rows
        .slice(0, PRINT_MAX_ROWS)
        .map((r) => `<tr>${Array.from({ length: width }, (_, c) => `<td${typeof r[c] === 'number' ? ' style="text-align:right"' : ''}>${escapeHtml(show(r[c]))}</td>`).join('')}</tr>`)
        .join('')
      return `<section class="sheet">${data.sheets.length > 1 ? `<h2>${escapeHtml(s.name)}</h2>` : ''}<table>${rows}</table></section>`
    })
    .join('')
}

/** Просмотр таблиц, документов Word и текста прямо в браузере (без отправки файла куда-либо). */
/** Рамка с подсветкой найденных слов вокруг Word-документа и текста: слова красятся прямо в нарисованном содержимом. */
function HighlightFrame({ q, children }: { q: string | undefined; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const h = useDomHighlight(ref, q)
  return (
    <div className="relative h-full">
      {h.enabled && <HitBar words={h.words} count={h.count} active={h.active} onGo={(d) => h.go(h.active + d)} onClose={h.disable} />}
      <div ref={ref} className="h-full">
        {children}
      </div>
    </div>
  )
}

/**
 * Файл из хранилища (`storageKey`) или уже загруженный (`blob` + `cacheKey`, например вложение письма) —
 * разбирается в браузере, никуда не отправляется.
 */
export function OfficeViewer({
  storageKey,
  blob,
  cacheKey,
  name,
  kind,
  highlight,
}: {
  storageKey?: string
  blob?: Blob
  cacheKey?: string
  name: string
  kind: OfficeKind
  highlight?: string
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['office-file', storageKey ?? cacheKey ?? name],
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    enabled: !!storageKey || !!blob,
    queryFn: () => load(storageKey ?? blob!, name, kind),
  })

  if (isLoading) return <p className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">{tr('Открываем файл…')}</p>
  if (isError || !data) return <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Не удалось прочитать файл. Он может быть повреждён или защищён паролем: скачайте его и откройте в программе.')}</p>
  if (data.kind === 'excel')
    return data.rich ? (
      <Suspense fallback={<p className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">{tr('Открываем таблицу…')}</p>}>
        <RichSheets buffer={data.rich} highlight={highlight} fallback={<Sheets sheets={data.sheets} highlight={highlight} />} />
      </Suspense>
    ) : (
      <Sheets sheets={data.sheets} highlight={highlight} />
    )
  if (data.kind === 'word' && data.styled)
    return (
      <HighlightFrame q={highlight}>
        <StyledWord html={data.html} />
      </HighlightFrame>
    )
  if (data.kind === 'word')
    return (
      <HighlightFrame q={highlight}>
      <div className="h-full overflow-y-auto">
        <article
          className="prose-office mx-auto max-w-3xl px-5 py-6 text-sm leading-relaxed [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: data.html || tr('<p>В документе нет текста.</p>') }}
        />
        {data.notes.length > 0 && <p className="mx-auto max-w-3xl px-5 pb-6 text-xs text-muted-foreground">{tr('Часть оформления может отображаться упрощённо. Для точного вида скачайте файл.')}</p>}
      </div>
      </HighlightFrame>
    )
  return (
    <HighlightFrame q={highlight}>
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed">{data.text || tr('Файл пустой.')}</pre>
    </HighlightFrame>
  )
}

/**
 * Word со стилями: страницы на сером поле, как в Word. Страница уже окна (телефон, узкая панель) — уменьшаем её
 * целиком (CSS zoom) по ширине, а не заставляем листать вбок.
 */
function StyledWord({ html }: { html: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const doc = inner.current
    if (!box || !doc) return
    const fit = () => {
      const page = doc.querySelector<HTMLElement>('section.docx')
      if (!page) return
      // ширина страницы с полями серой подложки — без текущего масштаба
      const width = page.offsetWidth + 2 * 30
      const zoom = Math.min(1, Math.max(0.3, (box.clientWidth - 4) / width))
      doc.style.zoom = zoom < 1 ? String(zoom) : ''
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [html])
  return (
    <div ref={scroller} className="h-full overflow-auto bg-[#808080]/30">
      {/* стили документа (теги style внутри) относятся только к классу .docx */}
      <div ref={inner} className="[&_.docx-wrapper]:!bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function Sheets({ sheets, highlight }: { sheets: Sheet[]; highlight?: string }) {
  const words = docWords(highlight)
  // листы, где есть искомые слова: на первый из них книга открывается сама
  const hitSheets = useMemo(() => (words.length ? sheets.map((s, i) => (s.rows.some((r) => r.some((c) => hasWords(show(c), words))) ? i : -1)).filter((i) => i >= 0) : []), [sheets, words.join(' ')]) // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState(() => hitSheets[0] ?? 0)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const sheet = sheets[Math.min(active, sheets.length - 1)]
  const frame = useRef<HTMLDivElement>(null)
  const h = useDomHighlight(frame, highlight, active)
  // строки с совпадениями могут быть далеко внизу: показываем лист до последнего из них
  useEffect(() => {
    if (!words.length) return
    let last = -1
    sheet.rows.forEach((r, i) => {
      if (r.some((c) => hasWords(show(c), words))) last = i
    })
    if (last >= 0) setLimit((l) => Math.max(l, Math.min(5000, last + 20)))
  }, [sheet, words.join(' ')]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (d: 1 | -1) => {
    const edge = d === 1 ? h.active === h.count - 1 : h.active === 0
    const at = hitSheets.indexOf(active)
    if (edge && hitSheets.length > 1 && at >= 0) {
      h.startAt.current = d === 1 ? 'first' : 'last'
      setActive(hitSheets[(at + d + hitSheets.length) % hitSheets.length]!)
      return
    }
    h.go(h.active + d)
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = sheet.rows.map((r, i) => ({ r, i }))
    return q ? all.filter(({ r }) => r.some((c) => show(c).toLowerCase().includes(q))) : all
  }, [sheet, query])
  const width = useMemo(() => Math.max(1, ...sheet.rows.slice(0, 300).map((r) => r.length)), [sheet])
  const shown = rows.slice(0, limit)

  return (
    <div ref={frame} className="relative flex h-full min-h-0 flex-col">
      {h.enabled && <HitBar words={h.words} count={h.count} active={h.active} onGo={go} onClose={h.disable} note={hitSheets.length > 1 ? tr('листов с совпадениями: {{n}}', { n: hitSheets.length }) : undefined} />}
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }} placeholder={tr('Найти в листе')} aria-label={tr('Найти в листе')} className="h-9 pl-9" />
        </div>
        <span className="text-xs text-muted-foreground">
          {query ? tr('Найдено строк: {{length}}', { length: rows.length }) : tr('Строк: {{length}}', { length: sheet.rows.length })}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet.rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{tr('Лист пустой.')}</p>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 w-10 border-b border-r bg-muted px-2 py-1.5 text-right font-normal text-muted-foreground" />
                {Array.from({ length: width }, (_, c) => (
                  <th key={c} className="sticky top-0 z-10 min-w-24 border-b border-r bg-muted px-2 py-1.5 text-left font-normal text-muted-foreground">
                    {colName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ r, i }) => (
                <tr key={i} className="hover:bg-muted/40">
                  <th className="sticky left-0 z-10 border-b border-r bg-muted px-2 py-1 text-right font-normal tabular-nums text-muted-foreground">{i + 1}</th>
                  {Array.from({ length: width }, (_, c) => {
                    const v = r[c]
                    return (
                      <td key={c} className={`max-w-96 border-b border-r px-2 py-1 align-top ${typeof v === 'number' ? 'text-right tabular-nums' : 'whitespace-pre-wrap'}`}>
                        {show(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > shown.length && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{tr('Показать ещё')}{' '}{Math.min(PAGE, rows.length - shown.length)}{tr('из')}{' '}{rows.length - shown.length}
            </Button>
          </div>
        )}
      </div>
      {sheets.length > 1 && (
        <div role="tablist" aria-label={tr('Листы')} className="flex gap-1 overflow-x-auto border-t bg-muted/40 p-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => { setActive(i); setQuery(''); setLimit(PAGE) }}
              className={`min-h-9 shrink-0 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === active ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60'}`}
            >
              {s.name}
              {hitSheets.includes(i) && <span aria-label={tr('есть совпадения')} className="ml-1.5 inline-block size-2 rounded-full bg-yellow-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
