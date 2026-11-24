import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ImageOff } from 'lucide-react'
import { tr } from '@/lib/tr'
import { mailInlineImagesQuery } from '@/features/mail/api'
import { Button } from '@/components/ui/button'
import { internalPath, openExternal } from '@/lib/open-link'

/**
 * Тело письма. Чужой HTML опасен, поэтому три защиты: DOMPurify вырезает скрипты, формы и встраиваемое;
 * iframe без `allow-scripts` не выполняет код; CSP внутри iframe запрещает всё, кроме встроенных стилей и картинок.
 * Внешние картинки показываются сразу (решение пользователя, 19.11.2026), только по https и без Referer.
 */
const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'svg', 'math']

interface Cleaned {
  html: string
  blockedImages: number
}

async function clean(html: string, allowImages: boolean): Promise<Cleaned> {
  const { default: DOMPurify } = await import('dompurify')
  // Отдельный экземпляр: хуки и настройки не должны влиять на другие места, где используется DOMPurify
  const purify = DOMPurify(window)
  const root = purify.sanitize(html, { RETURN_DOM: true, FORBID_TAGS, FORBID_ATTR: ['srcset', 'ping', 'formaction'], ALLOW_DATA_ATTR: false }) as HTMLElement
  let blocked = 0
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (/^data:image\//i.test(src)) continue
    if (allowImages && /^https:\/\//i.test(src)) {
      img.setAttribute('referrerpolicy', 'no-referrer')
      continue
    }
    if (/^https?:\/\//i.test(src)) blocked++
    img.remove()
  }
  linkifyDom(root)
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? ''
    if (!/^(https?:|mailto:|tel:)/i.test(href)) a.removeAttribute('href')
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer nofollow')
  }
  return { html: root.innerHTML, blockedImages: blocked }
}

// ---------------------------------------------------------------------------
// Автоссылки: в письмах часто адрес встречи (Zoom, Teams) или сайта написан просто текстом — делаем его ссылкой
// ---------------------------------------------------------------------------
const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi

/** Части текста: обычный текст и ссылки. Хвостовая пунктуация («.», «)», «,») в ссылку не входит. */
function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    let raw = m[0]
    const trail = /[.,;:!?)\]}>]+$/.exec(raw)
    // закрывающую скобку оставляем, если в ссылке есть открывающая (Википедия и т.п.)
    if (trail && !(trail[0].startsWith(')') && raw.includes('('))) raw = raw.slice(0, raw.length - trail[0].length)
    const start = m.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start) })
    const href = raw.includes('@') && !/^(https?:\/\/|www\.)/i.test(raw) ? `mailto:${raw}` : /^www\./i.test(raw) ? `https://${raw}` : raw
    out.push({ text: raw, href })
    last = start + raw.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

function linkifyDom(root: HTMLElement): void {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, style, script, textarea, title') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    LINK_RE.lastIndex = 0
    if (LINK_RE.test(t.data)) nodes.push(t)
  }
  for (const node of nodes) {
    const parts = splitLinks(node.data)
    if (!parts.some((p) => p.href)) continue
    const frag = doc.createDocumentFragment()
    for (const p of parts) {
      if (!p.href) {
        frag.append(p.text)
        continue
      }
      const a = doc.createElement('a')
      a.setAttribute('href', p.href)
      a.textContent = p.text
      frag.append(a)
    }
    node.replaceWith(frag)
  }
}

/**
 * Клик по ссылке в письме. Ссылка на само приложение (письма уведомлений) открывается здесь же, переходом внутри
 * приложения, а не новым окном; чужая — в браузере (в установленном приложении — не новым окном приложения).
 * Клик с Ctrl/Shift/Cmd или средней кнопкой оставляем браузеру: так человек сам просит новую вкладку.
 */
function useMailLinkClick() {
  const router = useRouter()
  return (e: MouseEvent | ReactMouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (/^(mailto|tel):/i.test(href)) {
      // без нового пустого окна: почтовая программа или звонилка откроются поверх
      window.location.href = href
      return
    }
    const path = internalPath(href)
    if (path) void router.history.push(path)
    else if (/^https?:\/\//i.test(href)) openExternal(href)
  }
}

/** Простое (не HTML) письмо: текст с кликабельными ссылками */
function LinkedText({ text }: { text: string }) {
  const onClick = useMailLinkClick()
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" onClick={onClick} className="break-all text-mail-ink underline underline-offset-2 hover:no-underline">
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  )
}

/**
 * Узкий экран (телефон): письмо целиком в ширину, без прокрутки вбок. Outlook и подписи задают таблицам и ячейкам
 * ширину в pt (375pt шире телефона) — на узком экране её снимаем, ячейки переносят текст.
 */
const NARROW_CSS =
  '@media (max-width:640px){body{padding:12px}table{width:auto!important;max-width:100%!important;table-layout:auto!important}td,th{width:auto!important;white-space:normal!important}img{height:auto!important}p{text-indent:0!important}}'

function frameDoc(inner: string, allowImages: boolean): string {
  const csp = `default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#14181b}body{padding:16px 20px;font:14px/1.5 Arial,Helvetica,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#1a5fb4}blockquote{margin:0 0 0 .5em;padding-left:1em;border-left:3px solid #ccc;color:#555}${NARROW_CSS}</style></head><body>${inner}</body></html>`
}

const CID_RE = /(src\s*=\s*["'])cid:([^"']+)(["'])/gi

/** Встроенные картинки (cid:) → data:image из догруженных; ещё не пришедшие остаются cid: и пока не показываются */
function withInline(html: string, images: Record<string, string> | undefined): string {
  if (!images) return html
  return html.replace(CID_RE, (all, pre, cid, post) => {
    const data = images[String(cid).toLowerCase()]
    return data ? `${pre}${data}${post}` : all
  })
}

export function MailBody({ messageId, html, text }: { messageId?: string; html: string | null; text: string }) {
  // Картинки из интернета показываются сразу (так решил пользователь); при желании их можно скрыть для письма
  const [allowImages, setAllowImages] = useState(true)
  const [cleaned, setCleaned] = useState<Cleaned | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)
  // обработчик зависит только от роутера (он один на приложение), поэтому годится и из прошлой отрисовки
  const onLinkClick = useMailLinkClick()

  // Логотипы в подписях и вставленные скриншоты догружаются после текста — письмо не ждёт их
  const hasCid = !!messageId && html !== null && /src\s*=\s*["']cid:/i.test(html)
  const { data: inline } = useQuery({ ...mailInlineImagesQuery(messageId ?? ''), enabled: hasCid })
  const source = useMemo(() => (html === null ? null : withInline(html, inline)), [html, inline])

  useEffect(() => {
    if (source === null) return
    let alive = true
    void clean(source, allowImages).then((c) => alive && setCleaned(c))
    return () => {
      alive = false
    }
  }, [source, allowImages])

  const doc = useMemo(() => (cleaned ? frameDoc(cleaned.html, allowImages) : ''), [cleaned, allowImages])

  function measure() {
    const body = frame.current?.contentDocument?.body
    // высота тела письма (body с полями), а не окна iframe — иначе при сужении колонки высота не пересчитывается
    if (!body) return
    const root = body.ownerDocument.documentElement
    // широкая таблица (подпись) даёт горизонтальную полосу прокрутки — она отнимает высоту, добавляем её
    const hbar = root.scrollWidth > root.clientWidth ? 18 : 0
    setHeight(Math.max(120, Math.ceil(body.getBoundingClientRect().height) + 4 + hbar))
  }

  // Высота письма меняется после загрузки: картинки догружаются, колонка сужается или расширяется.
  // Скрипты в iframe запрещены, поэтому следим снаружи: за шириной самого iframe и первые секунды — по таймеру.
  const [loadedAt, setLoadedAt] = useState(0)
  useEffect(() => {
    const el = frame.current
    if (!el || !loadedAt) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    let n = 0
    const timer = window.setInterval(() => {
      measure()
      if (++n >= 16) window.clearInterval(timer)
    }, 500)
    return () => {
      ro.disconnect()
      window.clearInterval(timer)
    }
  }, [loadedAt])

  if (html === null) {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md border bg-background px-5 py-4 font-sans text-sm leading-relaxed">
        <LinkedText text={text} />
      </pre>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {cleaned && cleaned.blockedImages > 0 && !allowImages && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-2 text-sm text-muted-foreground">
          <ImageOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tr('Картинки из интернета скрыты: по ним отправитель узнаёт, что вы открыли письмо.')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setAllowImages(true)}>
            {tr('Показать картинки')}
          </Button>
        </div>
      )}
      <iframe
        ref={frame}
        title={tr('Текст письма')}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        onLoad={() => {
          // скрипты в iframe запрещены, но документ того же источника: клики по ссылкам ловим отсюда.
          // Новый srcDoc — новый документ, поэтому слушатель вешается при каждой загрузке.
          frame.current?.contentDocument?.addEventListener('click', onLinkClick)
          measure()
          setLoadedAt(Date.now())
        }}
        style={{ height }}
        className="w-full rounded-md border bg-white"
      />
    </div>
  )
}
