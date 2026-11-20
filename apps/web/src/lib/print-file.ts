/**
 * Печать файла из браузера без скачивания: PDF печатается встроенным просмотрщиком браузера, всё остальное (фото,
 * Word, таблицы, текст) — как простая страница в скрытой рамке. Окно печати — системное, принтер выбирает человек.
 */

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const BASE_CSS = `
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #000; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  td, th { border: 1px solid #999; padding: 3px 5px; vertical-align: top; text-align: left; }
  th { background: #eee; }
  h1, h2, h3 { page-break-after: avoid; }
  pre { white-space: pre-wrap; word-break: break-word; font: 9.5pt/1.4 ui-monospace, Consolas, monospace; margin: 0; }
  .sheet + .sheet { page-break-before: always; }
  .sheet h2 { font-size: 12pt; margin: 0 0 6pt; }
`

function frame(): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  f.tabIndex = -1
  // не display:none — в некоторых браузерах скрытая так рамка печатает пустую страницу
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0', pointerEvents: 'none' })
  return f
}

function printFrame(f: HTMLIFrameElement, cleanup: () => void) {
  const win = f.contentWindow
  if (!win) return cleanup()
  let done = false
  const finish = () => {
    if (done) return
    done = true
    // после закрытия окна печати; с запасом — Safari и Firefox возвращаются из print() сразу
    window.setTimeout(cleanup, 1000)
  }
  win.addEventListener('afterprint', finish)
  win.focus()
  win.print()
  window.setTimeout(finish, 60_000)
}

/** Печать готового HTML (содержимое body). Рамка без скриптов: только печать из этой страницы. */
export function printHtml(title: string, body: string, css = ''): Promise<void> {
  return new Promise((resolve) => {
    const f = frame()
    f.setAttribute('sandbox', 'allow-same-origin allow-modals')
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`
    f.onload = async () => {
      const doc = f.contentDocument
      // картинки должны догрузиться, иначе на листе пусто
      if (doc)
        await Promise.all(
          [...doc.images].map((img) =>
            img.complete
              ? null
              : new Promise<void>((r) => {
                  img.onload = img.onerror = () => r()
                }),
          ),
        )
      printFrame(f, () => f.remove())
      resolve()
    }
    document.body.append(f)
  })
}

/** Печать PDF встроенным просмотрщиком браузера. Если браузер не умеет — PDF открывается в новой вкладке, печать оттуда. */
export function printPdf(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }))
  const fallback = () => {
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return new Promise((resolve) => {
    const f = frame()
    f.src = url
    f.onload = () => {
      // встроенному просмотрщику нужно мгновение, чтобы разобрать файл
      window.setTimeout(() => {
        try {
          printFrame(f, () => {
            f.remove()
            URL.revokeObjectURL(url)
          })
        } catch {
          f.remove()
          fallback()
        }
        resolve()
      }, 400)
    }
    document.body.append(f)
  })
}

/** Печать картинки на всю ширину листа. */
export function printImage(blob: Blob, name: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  return printHtml(name, `<img src="${url}" alt="" style="display:block;margin:0 auto;max-height:100vh;object-fit:contain">`).finally(() =>
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000),
  )
}
