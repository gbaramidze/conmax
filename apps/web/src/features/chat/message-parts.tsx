import { useQuery } from '@tanstack/react-query'
import { Copy, File as FileIcon, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { formatBytes } from '@/features/activity/api'
import { chatFileUrlQuery, type ChatAttachment, type ChatMessage } from '@/features/chat/api'
import { VoicePlayer } from '@/features/chat/voice-player'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Эмодзи
// ---------------------------------------------------------------------------
const ChatEmojiPicker = lazy(() => import('@/features/chat/emoji-picker'))

/** Выбор эмодзи (библиотека emoji-picker-react, подгружается при первом открытии); `onPick` вызывается с выбранным символом. */
export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <Suspense fallback={<div className="flex h-24 w-72 max-w-full items-center justify-center text-sm text-muted-foreground">{tr('Загружаем…')}</div>}>
      <ChatEmojiPicker onPick={onPick} />
    </Suspense>
  )
}

/** Кнопка с окном эмодзи; после выбора окно закрывается (`keepOpen` — оставить, чтобы выбрать несколько). */
export function EmojiPopover({ onPick, trigger, align = 'start', keepOpen }: { onPick: (emoji: string) => void; trigger: React.ReactNode; align?: 'start' | 'end'; keepOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side="top" className="border-0 p-0 shadow-lg">
        <EmojiGrid
          onPick={(e) => {
            onPick(e)
            if (!keepOpen) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Сообщение из одних эмодзи (1–3 штуки, без текста и вложений) показывается крупно и без «пузыря», как в мессенджерах.
 * Возвращает число эмодзи или 0, если в сообщении есть что-то ещё.
 */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}[\p{Emoji_Modifier}️⃣]*(?:‍\p{Extended_Pictographic}[\p{Emoji_Modifier}️]*)*|\p{Regional_Indicator}{2})$/u
export function emojiOnlyCount(body: string): number {
  const text = body.trim()
  if (!text) return 0
  const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((x) => x.segment) : [...text]
  const visible = parts.filter((g) => g.trim() !== '')
  if (visible.length === 0 || visible.length > 3) return 0
  return visible.every((g) => EMOJI_ONLY.test(g)) ? visible.length : 0
}

// ---------------------------------------------------------------------------
// Реакции
// ---------------------------------------------------------------------------
export function ReactionBar({ message, me, onReact }: { message: ChatMessage; me: string; onReact: (emoji: string) => void }) {
  const groups = new Map<string, { count: number; mine: boolean }>()
  for (const r of message.reactions) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false }
    g.count += 1
    g.mine ||= r.user_id === me
    groups.set(r.emoji, g)
  }
  if (groups.size === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {[...groups].map(([emoji, g]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          aria-pressed={g.mine}
          aria-label={tr('Реакция {{emoji}}: {{count}}', { emoji, count: g.count })}
          className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', g.mine ? 'border-primary bg-primary/10' : 'bg-background hover:bg-muted')}
        >
          <span className="text-sm">{emoji}</span>
          <span className="tabular-nums">{g.count}</span>
        </button>
      ))}
    </div>
  )
}

export const ReactionAddButton = ({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) => (
  <EmojiPopover
    onPick={onPick}
    align="end"
    trigger={
      <button
        type="button"
        aria-label={tr('Добавить реакцию')}
        title={tr('Добавить реакцию')}
        className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        <SmilePlus className="size-4" />
      </button>
    }
  />
)

// ---------------------------------------------------------------------------
// Вложения в сообщении
// ---------------------------------------------------------------------------
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

export function AttachmentView({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  const { data: url, isError } = useQuery(chatFileUrlQuery(a.storage_key, a.kind === 'file' ? a.name : undefined))

  if (a.kind === 'image') {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" aria-label={tr('Открыть фото: {{name}}', { name: a.name })}>
        <img src={url} alt={a.name} loading="lazy" className="max-h-60 max-w-full rounded-lg object-cover" />
      </a>
    ) : (
      <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">{isError ? tr('Не открылось') : tr('Загружаем…')}</div>
    )
  }
  if (a.kind === 'voice') return <VoicePlayer url={url} id={a.storage_key} durationSec={a.duration_sec} mine={mine} />
  return (
    <a
      href={url}
      download={a.name}
      aria-disabled={!url}
      className={cn('flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', mine ? 'border-primary-foreground/30 hover:bg-primary-foreground/10' : 'bg-background hover:bg-muted')}
    >
      <FileIcon className="size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{a.name}</span>
        <span className={cn('block text-xs', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{formatBytes(a.size_bytes)}</span>
      </span>
    </a>
  )
}

// ---------------------------------------------------------------------------
// Запись голосового сообщения
// ---------------------------------------------------------------------------
const VOICE_BITS_PER_SECOND = 32_000

function pickMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}
const extFor = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm')

export interface VoiceResult {
  file: File
  durationSec: number
}

/** Запись с микрофона: `start` просит доступ, `finish` останавливает и отдаёт файл, `cancel` выбрасывает запись. Нужен https или localhost. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const supported = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  const release = useCallback(() => {
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    rec.current = null
    setRecording(false)
    setSeconds(0)
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      stream.current = media
      const mime = pickMime()
      const r = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: VOICE_BITS_PER_SECOND })
      chunks.current = []
      r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
      r.start(1000)
      rec.current = r
      startedAt.current = Date.now()
      setSeconds(0)
      setRecording(true)
      timer.current = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 500)
      return true
    } catch {
      release()
      return false
    }
  }, [release])

  const finish = useCallback(
    () =>
      new Promise<VoiceResult | null>((resolve) => {
        const r = rec.current
        if (!r) return resolve(null)
        r.onstop = () => {
          const type = (r.mimeType || 'audio/webm').split(';')[0]!
          const blob = new Blob(chunks.current, { type })
          const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
          release()
          const stamp = new Date().toISOString().slice(0, 16).replace(/[^\d]/g, '')
          resolve({ file: new File([blob], `voice-${stamp}.${extFor(type)}`, { type }), durationSec })
        }
        r.stop()
      }),
    [release],
  )

  const cancel = useCallback(() => {
    const r = rec.current
    if (r) {
      r.onstop = null
      if (r.state !== 'inactive') r.stop()
    }
    release()
  }, [release])

  useEffect(() => cancel, [cancel])

  return { supported, recording, seconds, start, finish, cancel }
}

// ---------------------------------------------------------------------------
// Меню сообщения (долгое нажатие на телефоне)
// ---------------------------------------------------------------------------
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

/** Нижняя панель действий с сообщением: реакции, копировать, изменить, удалить (последние два — только у своих). */
export function MessageSheet({
  message,
  mine,
  onReact,
  onEdit,
  onDelete,
  onClose,
}: {
  message: ChatMessage
  mine: boolean
  onReact: (emoji: string) => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const [more, setMore] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="gap-2 rounded-t-2xl p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <SheetTitle className="sr-only">{tr('Действия с сообщением')}</SheetTitle>
        <SheetDescription className="sr-only">{tr('Реакция, копирование, изменение и удаление сообщения')}</SheetDescription>
        {confirmDelete ? (
          <div className="flex flex-col gap-3 p-1">
            <p className="text-base font-medium">{tr('Удалить сообщение?')}</p>
            <p className="text-sm text-muted-foreground">{tr('Оно пропадёт у всех участников вместе с файлами и реакциями.')}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-12 flex-1 rounded-lg border text-base outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                {tr('Отмена')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete()
                  onClose()
                }}
                className="min-h-12 flex-1 rounded-lg bg-destructive text-base font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tr('Удалить')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-1 px-1">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={e}
                  onClick={() => {
                    onReact(e)
                    onClose()
                  }}
                  className="flex size-11 items-center justify-center rounded-full text-2xl outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {e}
                </button>
              ))}
              <button type="button" aria-label={tr('Другие эмодзи')} aria-expanded={more} onClick={() => setMore((v) => !v)} className="flex size-11 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <SmilePlus className="size-5" />
              </button>
            </div>
            {more && (
              <div className="flex justify-center">
                <EmojiGrid
                  onPick={(e) => {
                    onReact(e)
                    onClose()
                  }}
                />
              </div>
            )}
            {message.body && (
              <button
                type="button"
                className={row}
                onClick={() => {
                  void navigator.clipboard?.writeText(message.body).then(() => toast.success(tr('Текст скопирован')))
                  onClose()
                }}
              >
                <Copy className="size-5" /> {tr('Копировать текст')}
              </button>
            )}
            {mine && (
              <button
                type="button"
                className={row}
                onClick={() => {
                  onEdit()
                  onClose()
                }}
              >
                <Pencil className="size-5" /> {tr('Изменить')}
              </button>
            )}
            {mine && (
              <button type="button" className={cn(row, 'text-destructive')} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-5" /> {tr('Удалить')}
              </button>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
