import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { tr } from '@/lib/tr'
import { Button } from '@/components/ui/button'

/**
 * Тело письма. Чужой HTML опасен, поэтому три защиты: DOMPurify вырезает скрипты, формы и встраиваемое;
 * iframe без `allow-scripts` не выполняет код; CSP внутри iframe запрещает всё, кроме встроенных стилей и картинок.
 * Внешние картинки (пиксели слежения) по умолчанию заблокированы — пользователь включает их для одного письма.
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
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? ''
    if (!/^(https?:|mailto:|tel:)/i.test(href)) a.removeAttribute('href')
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer nofollow')
  }
  return { html: root.innerHTML, blockedImages: blocked }
}

function frameDoc(inner: string, allowImages: boolean): string {
  const csp = `default-src 'none'; img-src data: ${allowImages ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#14181b}body{font:14px/1.5 Arial,Helvetica,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#1a5fb4}blockquote{margin:0 0 0 .5em;padding-left:1em;border-left:3px solid #ccc;color:#555}</style></head><body>${inner}</body></html>`
}

export function MailBody({ html, text }: { html: string | null; text: string }) {
  const [allowImages, setAllowImages] = useState(false)
  const [cleaned, setCleaned] = useState<Cleaned | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  useEffect(() => {
    if (html === null) return
    let alive = true
    void clean(html, allowImages).then((c) => alive && setCleaned(c))
    return () => {
      alive = false
    }
  }, [html, allowImages])

  const doc = useMemo(() => (cleaned ? frameDoc(cleaned.html, allowImages) : ''), [cleaned, allowImages])

  function measure() {
    const body = frame.current?.contentDocument?.documentElement
    if (body) setHeight(Math.max(120, body.scrollHeight + 4))
  }

  if (html === null) {
    return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{text}</pre>
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
          measure()
          setTimeout(measure, 400)
          setTimeout(measure, 1500)
        }}
        style={{ height }}
        className="w-full rounded-md border bg-white"
      />
    </div>
  )
}
