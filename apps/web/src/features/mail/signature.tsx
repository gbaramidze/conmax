import { ImagePlus, Eraser } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { toast } from 'sonner'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Подпись — «как в Outlook»: HTML хранится как есть (шрифты, цвета, таблицы, ссылки), без упрощения редактором.
 * Чтобы чужой HTML был безопасен, он чистится (DOMPurify): без скриптов, форм, встраиваемого и классов;
 * картинки — только https или data:image (логотип ужимается на сайте до 600 px). При отправке функция `mail`
 * прикладывает data-картинки к письму встроенными вложениями (cid), поэтому получатель видит их как в Outlook.
 */
const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'style', 'svg', 'math', 'frame', 'frameset', 'applet']

export async function sanitizeSignature(html: string): Promise<{ html: string; lostImages: number }> {
  const { default: DOMPurify } = await import('dompurify')
  const purify = DOMPurify(window)
  const root = purify.sanitize(html, { RETURN_DOM: true, FORBID_TAGS, FORBID_ATTR: ['class', 'id', 'srcset', 'ping', 'formaction'], ALLOW_DATA_ATTR: false }) as HTMLElement
  let lost = 0
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    // file:/// (из Outlook для Windows), cid:, blob: — браузеру недоступны: такую картинку нужно добавить кнопкой «Картинка»
    if (!/^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(src)) {
      img.remove()
      lost++
    }
  }
  // служебные теги Word/Outlook (<o:p>) — без них, текст остаётся
  for (const el of Array.from(root.querySelectorAll('*'))) if (el.tagName.includes(':')) el.replaceWith(...Array.from(el.childNodes))
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? ''
    if (!/^(https?:|mailto:|tel:)/i.test(href)) a.removeAttribute('href')
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
  return { html: root.innerHTML.trim(), lostImages: lost }
}

/** Картинка → data:image, не шире 600 px; прозрачность сохраняется (PNG), фото — JPEG */
async function imageToDataUrl(file: File, maxWidth = 600): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('bad_image'))
      i.src = url
    })
    const scale = Math.min(1, maxWidth / img.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = /png|gif|webp/i.test(file.type)
    let out = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88)
    // большой PNG-логотип — пробуем JPEG
    if (out.length > 500_000 && png) out = canvas.toDataURL('image/jpeg', 0.85)
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Редактор подписи: вставка из Outlook или сайта с оформлением, картинки из буфера и кнопкой */
export function SignatureEditor({ initial, onChange }: { initial: string; onChange: (html: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [empty, setEmpty] = useState(!initial)

  // начальное содержимое — один раз (дальше div живёт сам, иначе каретка прыгает)
  useEffect(() => {
    if (box.current) box.current.innerHTML = initial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    const html = box.current?.innerHTML ?? ''
    setEmpty(!box.current?.textContent?.trim() && !box.current?.querySelector('img'))
    onChange(html)
  }

  const insertHtml = (html: string) => {
    box.current?.focus()
    document.execCommand('insertHTML', false, html)
    emit()
  }

  async function addImages(files: File[]) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > 8 * 1024 * 1024) {
        toast.error(tr('Картинка больше 8 МБ — выберите поменьше.'))
        continue
      }
      try {
        const src = await imageToDataUrl(f)
        insertHtml(`<img src="${src}" alt="" style="max-width:100%">`)
      } catch {
        toast.error(tr('Не удалось прочитать картинку.'))
      }
    }
  }

  async function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData('text/html')
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (!html && images.length === 0) return // обычный текст — как есть
    e.preventDefault()
    if (!html) {
      await addImages(images)
      return
    }
    // Картинки, которые браузеру недоступны (file:/// из Outlook для Windows), подменяем картинками из буфера, если они там есть
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const bad = Array.from(doc.querySelectorAll('img')).filter((i) => !/^(https:\/\/|data:image\/)/i.test(i.getAttribute('src') ?? ''))
    for (let k = 0; k < bad.length && k < images.length; k++) bad[k].setAttribute('src', await imageToDataUrl(images[k]))
    const clean = await sanitizeSignature(doc.body.innerHTML)
    insertHtml(clean.html)
    if (clean.lostImages > 0) toast.warning(tr('Часть картинок не скопировалась (браузеру недоступны файлы с компьютера). Добавьте их кнопкой «Картинка».'))
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div role="toolbar" aria-label={tr('Подпись')} className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <ImagePlus />
          {tr('Картинка')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (box.current) box.current.innerHTML = ''
            emit()
          }}
          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <Eraser />
          {tr('Очистить')}
        </button>
        <span className="ml-auto px-2 text-xs text-muted-foreground max-sm:hidden">{tr('Скопируйте подпись в Outlook и вставьте сюда (Ctrl+V)')}</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            void addImages(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      <div className="relative bg-white text-black">
        {empty && (
          <p className="pointer-events-none absolute left-4 top-3 text-sm text-neutral-400">{tr('Например: С уважением, имя, должность, телефон')}</p>
        )}
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={tr('Подпись')}
          onInput={emit}
          onPaste={(e) => void onPaste(e)}
          className="max-h-[50vh] min-h-32 overflow-auto px-4 py-3 text-sm outline-none [&_img]:inline-block [&_img]:max-w-full"
          style={{ fontFamily: 'Calibri, Arial, Helvetica, sans-serif' }}
        />
      </div>
    </div>
  )
}

/** Подпись под текстом письма: как её увидит получатель (белый фон, как в почте) */
export function SignaturePreview({ html, className }: { html: string; className?: string }) {
  const [clean, setClean] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void sanitizeSignature(html).then((r) => alive && setClean(r.html))
    return () => {
      alive = false
    }
  }, [html])
  if (!clean) return null
  return (
    <div
      className={cn('overflow-x-auto rounded-md bg-white px-4 py-3 text-sm text-black [&_img]:inline-block [&_img]:max-w-full', className)}
      style={{ fontFamily: 'Calibri, Arial, Helvetica, sans-serif' }}
      // подпись очищена DOMPurify (без скриптов, форм и классов), это собственная подпись пользователя
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
