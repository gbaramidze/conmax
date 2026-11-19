import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Link2, List, ListOrdered, Paperclip, Quote, Send, Strikethrough, Trash2, Underline, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { peopleDirectoryQuery } from '@/features/people/api'
import { UserAvatar } from '@/features/profile/avatar'
import { sanitizeSignature, SignatureEditor, SignaturePreview } from '@/features/mail/signature'
import {
  mailAccountQuery,
  MailError,
  mailErrorText,
  mailSend,
  saveMailSignature,
  type ComposeMode,
  type MailAccount,
  type MailAddress,
  type MailListItem,
  type MailMessage,
  type OutgoingFile,
} from '@/features/mail/api'

// ---------------------------------------------------------------------------
// Редактор текста письма и подписи
// ---------------------------------------------------------------------------
const extensions = (placeholder: string) => [
  StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
  Placeholder.configure({ placeholder }),
]

/** HTML письма: шрифт как у Outlook, абзацы без лишних отступов (Enter = новая строка, как в почте) */
export function emailHtml(editorHtml: string): string {
  const body = editorHtml
    .replace(/<p>/g, '<p style="margin:0">')
    .replace(/<ul>/g, '<ul style="margin:0 0 0 1.5em;padding:0">')
    .replace(/<ol>/g, '<ol style="margin:0 0 0 1.5em;padding:0">')
    .replace(/<blockquote>/g, '<blockquote style="margin:0 0 0 .5em;padding-left:1em;border-left:3px solid #ccc;color:#555">')
  return `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000">${body}</div>`
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive('bold'),
      italic: !!e?.isActive('italic'),
      underline: !!e?.isActive('underline'),
      strike: !!e?.isActive('strike'),
      bullet: !!e?.isActive('bulletList'),
      ordered: !!e?.isActive('orderedList'),
      quote: !!e?.isActive('blockquote'),
      link: !!e?.isActive('link'),
    }),
  })
  if (!editor || !active) return null

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
    const url = window.prompt(tr('Адрес ссылки (пусто — убрать ссылку)'), prev)
    if (url === null) return
    if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  const items: { label: string; icon: ReactNode; on: boolean; run: () => void }[] = [
    { label: tr('Жирный'), icon: <Bold />, on: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: tr('Курсив'), icon: <Italic />, on: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: tr('Подчёркнутый'), icon: <Underline />, on: active.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: tr('Зачёркнутый'), icon: <Strikethrough />, on: active.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: tr('Маркированный список'), icon: <List />, on: active.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: tr('Нумерованный список'), icon: <ListOrdered />, on: active.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: tr('Цитата'), icon: <Quote />, on: active.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: tr('Ссылка'), icon: <Link2 />, on: active.link, run: setLink },
  ]

  return (
    <div role="toolbar" aria-label={tr('Форматирование')} className="flex flex-wrap gap-0.5 border-b bg-muted/40 p-1">
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          aria-label={i.label}
          aria-pressed={i.on}
          title={i.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={i.run}
          className={cn(
            'flex size-9 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:size-8 [&_svg]:size-4',
            i.on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
          )}
        >
          {i.icon}
        </button>
      ))}
    </div>
  )
}

function useMailEditor(initial: string, placeholder: string, label: string, minHeight: string) {
  return useEditor({
    extensions: extensions(placeholder),
    content: initial,
    autofocus: 'start',
    editorProps: {
      attributes: {
        class: cn('prose-comment px-4 py-3 text-base outline-none md:text-sm', minHeight),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Адресаты: «плашки» + ввод с подсказками (люди CONMAX и адреса из уже загруженных писем)
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/

/** «Иван Петров <ivan@x.ge>», «ivan@x.ge» → адрес; что не похоже на адрес — null */
function parseAddress(raw: string): MailAddress | null {
  const s = raw.trim().replace(/^["']|["']$/g, '')
  if (!s) return null
  const m = /^(.*)<([^>]+)>$/.exec(s)
  const address = (m ? m[2] : s).trim()
  if (!EMAIL_RE.test(address)) return null
  return { name: m ? m[1].trim().replace(/^["']|["']$/g, '') : '', address }
}

export function useAddressBook(): MailAddress[] {
  const queryClient = useQueryClient()
  const { data: people } = useQuery(peopleDirectoryQuery)
  return useMemo(() => {
    const seen = new Map<string, MailAddress>()
    const add = (a: MailAddress | undefined) => {
      if (!a?.address || !EMAIL_RE.test(a.address)) return
      const key = a.address.toLowerCase()
      if (!seen.has(key) || (!seen.get(key)!.name && a.name)) seen.set(key, { name: a.name, address: a.address })
    }
    for (const p of people ?? []) add({ name: p.full_name, address: p.email })
    for (const [, data] of queryClient.getQueriesData<{ pages?: { messages: MailListItem[] }[] } | MailListItem[]>({ queryKey: ['mail', 'messages'] })) {
      const list = Array.isArray(data) ? data : (data?.pages ?? []).flatMap((p) => p.messages)
      for (const m of list) {
        add(m.from)
        for (const t of m.to ?? []) add(t)
      }
    }
    return [...seen.values()]
  }, [people, queryClient])
}

export function RecipientInput({ label, value, onChange, book, autoFocus }: { label: string; value: MailAddress[]; onChange: (v: MailAddress[]) => void; book: MailAddress[]; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = text.trim().toLowerCase()
  const taken = new Set(value.map((v) => v.address.toLowerCase()))
  const hints = q.length < 1 ? [] : book.filter((a) => !taken.has(a.address.toLowerCase()) && (a.name.toLowerCase().includes(q) || a.address.toLowerCase().includes(q))).slice(0, 6)

  const add = (a: MailAddress) => {
    if (!taken.has(a.address.toLowerCase())) onChange([...value, a])
    setText('')
    setActive(0)
  }
  // Ввод через запятую/точку с запятой или вставка списка адресов
  const commit = (raw: string) => {
    const parts = raw.split(/[,;\n]+/)
    const ok: MailAddress[] = []
    const bad: string[] = []
    for (const p of parts) {
      if (!p.trim()) continue
      const a = parseAddress(p)
      if (a && !taken.has(a.address.toLowerCase())) ok.push(a)
      else if (!a) bad.push(p.trim())
    }
    if (ok.length) onChange([...value, ...ok])
    setText(bad.join(', '))
    return bad.length === 0
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (hints.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % hints.length : (i - 1 + hints.length) % hints.length))
      return
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (hints.length && (e.key === 'Enter' || e.key === 'Tab') && hints[active]) {
        e.preventDefault()
        add(hints[active])
        return
      }
      if (text.trim()) {
        if (e.key !== 'Tab') e.preventDefault()
        commit(text)
      }
      return
    }
    if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }

  return (
    <div className="relative flex min-h-11 flex-1 flex-wrap items-center gap-1 py-1" onClick={() => inputRef.current?.focus()}>
      {value.map((a, i) => (
        <span key={`${a.address}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-2.5 pr-1 text-[13px]" title={a.address}>
          <span className="truncate">{a.name || a.address}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onChange(value.filter((_, j) => j !== i))
            }}
            aria-label={tr('Убрать {{name}}', { name: a.name || a.address })}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit(text)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (/[,;\n]/.test(pasted)) {
            e.preventDefault()
            commit(text + pasted)
          }
        }}
        aria-label={label}
        role="combobox"
        aria-expanded={hints.length > 0}
        aria-autocomplete="list"
        className="h-8 min-w-32 flex-1 bg-transparent text-base outline-none md:text-sm"
      />
      {hints.length > 0 && (
        <ul role="listbox" className="absolute left-0 top-full z-30 mt-1 w-full max-w-sm overflow-hidden rounded-lg border bg-popover py-1 shadow-md">
          {hints.map((h, i) => (
            <li key={h.address} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(h)}
                className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left', i === active ? 'bg-mail-soft' : 'hover:bg-muted')}
              >
                <UserAvatar name={h.name || h.address} className="size-7 text-[10px]" />
                <span className="min-w-0">
                  {h.name && <span className="block truncate text-sm">{h.name}</span>}
                  <span className="block truncate text-xs text-muted-foreground">{h.address}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Окно письма
// ---------------------------------------------------------------------------
export interface ComposeRequest {
  mode: ComposeMode
  /** Письмо, на которое отвечаем или которое пересылаем */
  source?: MailMessage
  /** Адресат для нового письма (из карточки человека) */
  to?: MailAddress
  /** Чтобы повторное «Ответить» на то же письмо открыло окно заново */
  n: number
}

const prefixed = (subject: string, prefix: 'RE' | 'FW') => {
  const re = prefix === 'RE' ? /^\s*(re|ответ|отв|ynt|aw)\s*:/i : /^\s*(fw|fwd|пересл|tr|wg)\s*:/i
  return re.test(subject) ? subject : `${prefix}: ${subject}`
}
const same = (a: MailAddress, b: string) => a.address.toLowerCase() === b.toLowerCase()

function defaults(req: ComposeRequest, me: string) {
  const s = req.source
  if (!s || req.mode === 'new') return { to: req.to ? [req.to] : [], cc: [] as MailAddress[], subject: '' }
  if (req.mode === 'forward') return { to: [], cc: [], subject: prefixed(s.subject, 'FW') }
  if (req.mode === 'reply') return { to: [s.from], cc: [], subject: prefixed(s.subject, 'RE') }
  // ответить всем: отправитель и все получатели, кроме меня
  const uniq = (list: MailAddress[]) => list.filter((a, i) => a.address && !same(a, me) && list.findIndex((b) => same(b, a.address)) === i)
  const to = uniq([s.from, ...s.to])
  const cc = uniq(s.cc).filter((a) => !to.some((t) => same(t, a.address)))
  return { to, cc, subject: prefixed(s.subject, 'RE') }
}

const TITLES: Record<ComposeMode, () => string> = {
  new: () => tr('Новое письмо'),
  reply: () => tr('Ответ'),
  replyAll: () => tr('Ответ всем'),
  forward: () => tr('Пересылка'),
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ${tr('КБ')}` : `${(n / 1024 / 1024).toFixed(1)} ${tr('МБ')}`)

export function Composer({ request, account, onClose, onSent }: { request: ComposeRequest; account: MailAccount; onClose: () => void; onSent: () => void }) {
  const queryClient = useQueryClient()
  const book = useAddressBook()
  const start = useMemo(() => defaults(request, account.email), [request, account.email])
  const [to, setTo] = useState<MailAddress[]>(start.to)
  const [cc, setCc] = useState<MailAddress[]>(start.cc)
  const [bcc, setBcc] = useState<MailAddress[]>([])
  const [showCc, setShowCc] = useState(start.cc.length > 0)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState(start.subject)
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [armed, setArmed] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Подпись: к новому письму — всегда, к ответу и пересылке — если включено. Отдельным блоком под текстом, а не внутри
  // редактора: так её оформление (шрифты, таблицы, логотип) не упрощается. Из этого письма её можно убрать.
  const [withSignature, setWithSignature] = useState(!!account.signature && (request.mode === 'new' || account.signature_on_reply))
  const editor = useMailEditor('<p></p>', tr('Текст письма…'), tr('Текст письма'), 'min-h-48')

  // Есть ли что терять: текст изменился против начального (пустая строка + подпись) или прикреплены файлы
  const baseText = useRef<string | null>(null)
  useEffect(() => {
    if (editor && baseText.current === null) baseText.current = editor.getText()
  }, [editor])
  const dirty = () => files.length > 0 || (!!editor && editor.getText().trim() !== (baseText.current ?? '').trim())

  function pick(list: FileList | null) {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (f.size > 3 * 1024 * 1024) {
        toast.error(tr('«{{name}}» больше 3 МБ: такие файлы пока можно отправить только из Outlook.', { name: f.name }))
        continue
      }
      next.push(f)
    }
    if (next.reduce((s, f) => s + f.size, 0) > 10 * 1024 * 1024) {
      toast.error(mailErrorText(new MailError('files_too_large')))
      return
    }
    setFiles(next)
  }

  async function send() {
    if (!editor || sending) return
    if (to.length + cc.length + bcc.length === 0) {
      toast.error(tr('Укажите хотя бы одного адресата.'))
      return
    }
    if (!subject.trim() && request.mode === 'new' && !window.confirm(tr('Отправить письмо без темы?'))) return
    setSending(true)
    try {
      const attachments: OutgoingFile[] = []
      for (const f of files) attachments.push({ name: f.name, content_type: f.type || 'application/octet-stream', data: await readBase64(f) })
      await mailSend({
        mode: request.mode,
        id: request.source?.id,
        to,
        cc,
        bcc,
        subject: subject.trim(),
        html: emailHtml(editor.getHTML()) + (withSignature && account.signature ? `<br>${(await sanitizeSignature(account.signature)).html}` : ''),
        attachments,
      })
      toast.success(tr('Письмо отправлено'))
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] })
      void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] })
      onSent()
    } catch (e) {
      toast.error(mailErrorText(e))
      setSending(false)
    }
  }

  function discard() {
    if (dirty() && !armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 3000)
      return
    }
    onClose()
  }

  const row = 'flex items-start gap-2 border-b px-4'
  const lbl = 'w-14 shrink-0 pt-3 text-sm text-muted-foreground'

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void send()
        }
      }}
    >
      <div className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5 sm:px-4">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{TITLES[request.mode]()}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('Закрыть')}
          title={tr('Закрыть')}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className={row}>
          <span className={lbl}>{tr('Кому')}</span>
          <RecipientInput label={tr('Кому')} value={to} onChange={setTo} book={book} autoFocus={request.mode === 'new' || request.mode === 'forward'} />
          <div className="flex shrink-0 gap-1 pt-2.5 text-xs">
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                {tr('Копия')}
              </button>
            )}
            {!showBcc && (
              <button type="button" onClick={() => setShowBcc(true)} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                {tr('Скрытая')}
              </button>
            )}
          </div>
        </div>
        {showCc && (
          <div className={row}>
            <span className={lbl}>{tr('Копия')}</span>
            <RecipientInput label={tr('Копия')} value={cc} onChange={setCc} book={book} />
          </div>
        )}
        {showBcc && (
          <div className={row}>
            <span className={lbl} title={tr('Скрытая копия: другие адресаты её не видят')}>
              {tr('Скрытая')}
            </span>
            <RecipientInput label={tr('Скрытая копия')} value={bcc} onChange={setBcc} book={book} />
          </div>
        )}
        <div className={row}>
          <span className={lbl}>{tr('Тема')}</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={400}
            aria-label={tr('Тема')}
            className="h-11 min-w-0 flex-1 bg-transparent text-base font-medium outline-none md:text-sm"
          />
        </div>

        <Toolbar editor={editor} />
        <EditorContent editor={editor} />

        {account.signature && (
          <div className="mx-4 mb-3">
            {withSignature ? (
              <div className="group relative rounded-md border border-dashed">
                <SignaturePreview html={account.signature} />
                <button
                  type="button"
                  onClick={() => setWithSignature(false)}
                  className="absolute right-1.5 top-1.5 rounded bg-background/90 px-2 py-0.5 text-xs text-muted-foreground opacity-0 shadow-sm outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 max-lg:opacity-100"
                >
                  {tr('Убрать подпись')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setWithSignature(true)} className="text-xs font-medium text-mail-ink hover:underline">
                {tr('Добавить подпись')}
              </button>
            )}
          </div>
        )}

        {request.mode !== 'new' && request.source && (
          <p className="mx-4 mb-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {request.mode === 'forward'
              ? tr('Исходное письмо и его вложения будут добавлены под вашим текстом.')
              : tr('Исходное письмо будет добавлено под вашим текстом, как в Outlook.')}
          </p>
        )}

        {files.length > 0 && (
          <ul className="mx-4 mb-3 flex flex-wrap gap-2" aria-label={tr('Вложения')}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background py-1.5 pl-2.5 pr-1 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fileSize(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  aria-label={tr('Убрать {{name}}', { name: f.name })}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2.5 sm:px-4">
        <Button type="button" onClick={() => void send()} disabled={sending || !editor} title="Ctrl+Enter" className="bg-mail text-mail-foreground hover:bg-mail/90">
          <Send />
          {sending ? tr('Отправляем…') : tr('Отправить')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()} disabled={sending}>
          <Paperclip />
          <span className="max-sm:sr-only">{tr('Прикрепить')}</span>
        </Button>
        <button
          type="button"
          onClick={discard}
          disabled={sending}
          className={cn(
            'ml-auto flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&_svg]:size-4',
            armed ? 'bg-destructive text-white' : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          )}
          title={tr('Удалить черновик')}
        >
          <Trash2 />
          <span className={cn(!armed && 'max-sm:sr-only')}>{armed ? tr('Точно удалить?') : tr('Удалить черновик')}</span>
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Подпись
// ---------------------------------------------------------------------------
export function SignatureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: account } = useQuery(mailAccountQuery)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Подпись')}</DialogTitle>
          <DialogDescription>{tr('Добавляется в конец новых писем. Outlook свою подпись другим программам не отдаёт, поэтому её нужно задать здесь.')}</DialogDescription>
        </DialogHeader>
        {account && open && <SignatureForm account={account} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SignatureForm({ account, onDone }: { account: MailAccount; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [onReply, setOnReply] = useState(account.signature_on_reply)
  const [saving, setSaving] = useState(false)
  const html = useRef(account.signature ?? '')

  async function save() {
    setSaving(true)
    try {
      const clean = await sanitizeSignature(html.current)
      const hasContent = /<img\b/i.test(clean.html) || clean.html.replace(/<[^>]+>|&nbsp;/g, '').trim() !== ''
      await saveMailSignature(hasContent ? clean.html : null, onReply)
      await queryClient.invalidateQueries({ queryKey: ['mail', 'account'] })
      toast.success(tr('Подпись сохранена'))
      onDone()
    } catch {
      toast.error(tr('Не удалось сохранить подпись. Попробуйте ещё раз.'))
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SignatureEditor initial={account.signature ?? ''} onChange={(v) => (html.current = v)} />
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={onReply} onChange={(e) => setOnReply(e.target.checked)} className="size-4 accent-[var(--mail)]" />
        {tr('Добавлять подпись к ответам и пересылке')}
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
          {tr('Отмена')}
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? tr('Сохраняем…') : tr('Сохранить')}
        </Button>
      </DialogFooter>
    </div>
  )
}
