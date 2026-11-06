import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Building2, Check, MessageSquarePlus, Mic, Network, Paperclip, Pencil, Send, Smile, Trash2, Users, UsersRound, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-provider'
import {
  chatMessagesQuery,
  chatOverviewQuery,
  chatPeopleQuery,
  createChatGroup,
  deleteChatGroup,
  deleteChatMessage,
  editChatMessage,
  leaveChatGroup,
  markChatRead,
  openChat,
  reactChatMessage,
  sendChatMessage,
  updateChatGroup,
  uploadChatFile,
  CHAT_MAX_FILES,
  CHAT_MAX_FILE_BYTES,
  type ChatChannel,
  type ChatPerson,
  type ChatMessage,
  type UploadedChatFile,
} from '@/features/chat/api'
import { AttachmentView, emojiOnlyCount, EmojiPopover, MessageSheet, ReactionAddButton, ReactionBar, clock, useVoiceRecorder, type VoiceResult } from '@/features/chat/message-parts'
import { formatBytes } from '@/features/activity/api'
import { NotifyPrompt } from '@/features/chat/notify'
import { OnlineDot, presenceText, useOnline } from '@/features/chat/presence'
import { UserAvatar } from '@/features/profile/avatar'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Разделённая панель»: каналы слева, переписка справа; на телефоне — по очереди
export const Route = createFileRoute('/_app/chat')({
  validateSearch: z.object({
    channel: z.string().optional().catch(undefined),
    with: z.string().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([queryClient.ensureQueryData(chatOverviewQuery), queryClient.ensureQueryData(chatPeopleQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем чат…')}</p>,
  component: ChatPage,
})

function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? ''
  if (message.includes('permission denied')) return tr('Нет доступа к этой переписке.')
  if (message.includes('invalid_message')) return tr('Сообщение пустое или длиннее 4000 символов.')
  if (message.includes('file_too_large')) return tr('Файл больше 25 МБ.')
  if (message.includes('invalid_attachment')) return tr('Не удалось прикрепить файл. Загрузите его ещё раз.')
  if (message.includes('group_needs_members')) return tr('Добавьте в группу хотя бы одного человека.')
  if (message.includes('invalid_name')) return tr('Назовите группу: от 1 до 80 символов.')
  if (message.includes('creator_cannot_leave')) return tr('Создатель не может выйти из группы: удалите её или оставьте.')
  return tr('Не получилось. Проверьте соединение и повторите.')
}

// заголовки секций списка; проектные каналы подписаны своим проектом
const KIND_HEADINGS: Partial<Record<ChatChannel['kind'], string>> = {
  group: tr('Группы'),
  direct: tr('Личные'),
}

const timeFmt = () => new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit' })
const dayFmt = () => new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * На телефоне экранная клавиатура не меняет высоту страницы, а лишь перекрывает её. Чтобы поле ввода оставалось над клавиатурой,
 * высота и сдвиг чата берутся из видимой области (`visualViewport`) через переменные CSS; без неё работает `100dvh`.
 */
function useVisualViewport(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport
    const el = ref.current
    if (!vv || !el) return
    const apply = () => {
      el.style.setProperty('--vv-height', `${vv.height}px`)
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [ref])
}

function ChatPage() {
  const { channel: channelParam, with: withUser } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const me = session!.user.id
  const { data: channels } = useSuspenseQuery(chatOverviewQuery)
  const { data: peopleRows } = useSuspenseQuery(chatPeopleQuery)
  const online = useOnline()
  const [picking, setPicking] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useVisualViewport(boxRef)

  const people = useMemo(() => new Map(peopleRows.map((m) => [m.id, m])), [peopleRows])

  const titleOf = (c: ChatChannel): string => {
    if (c.kind === 'project') return tr('Вся команда')
    if (c.kind === 'org') return c.organization_name ?? tr('Организация')
    if (c.kind === 'discipline') return `${c.discipline_code ?? ''} · ${c.discipline_name ?? tr('Направление')}`
    if (c.kind === 'group') return c.name ?? tr('Группа')
    return people.get(c.other_user_id ?? '')?.full_name ?? tr('Участник')
  }

  // личные и группы — по свежести переписки; проектные — по проекту, внутри: общий, направления, организации
  const sorted = useMemo(() => {
    const rank = { direct: 0, group: 1, project: 2, discipline: 3, org: 4 } as const
    return [...channels].sort((a, b) => {
      if (rank[a.kind] !== rank[b.kind] && (rank[a.kind] < 2 || rank[b.kind] < 2)) return rank[a.kind] - rank[b.kind]
      if (a.kind === 'direct' || a.kind === 'group') return (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')
      if (a.project_code !== b.project_code) return (a.project_code ?? '').localeCompare(b.project_code ?? '')
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
      return titleOf(a).localeCompare(titleOf(b))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, people])

  const select = (id: string | undefined) =>
    void navigate({ to: '/chat', search: id ? { channel: id } : {}, replace: true })

  // Ссылка «Написать» со страницы подрядчика: открыть (или создать) личную переписку и перейти в неё
  useEffect(() => {
    if (!withUser) return
    openChat({ kind: 'direct', userId: withUser })
      .then(async (id) => {
        await queryClient.invalidateQueries({ queryKey: ['chat', 'overview'] })
        select(id)
      })
      .catch((e) => {
        toast.error(errorText(e))
        select(undefined)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withUser])

  const active = channels.find((c) => c.id === channelParam) ?? (withUser ? undefined : sorted[0])

  const startDirect = async (userId: string) => {
    try {
      const id = await openChat({ kind: 'direct', userId })
      await queryClient.invalidateQueries({ queryKey: ['chat', 'overview'] })
      setPicking(false)
      select(id)
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* на телефоне чат открыт на весь экран поверх верхней панели и нижней навигации (выход — стрелка «назад»); на компьютере занимает всё место правее боковой панели и ниже верхней, без полей */}
      <div ref={boxRef} className="grid overflow-hidden bg-card max-lg:fixed max-lg:inset-x-0 max-lg:top-[var(--vv-top,0px)] max-lg:h-[var(--vv-height,100dvh)] max-lg:z-40 max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)] lg:fixed lg:left-56 lg:right-0 lg:top-14 lg:bottom-0 lg:z-20 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r', channelParam && 'max-lg:hidden')} aria-label={tr('Каналы чата')}>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-ml-2 lg:hidden"
                aria-label={tr('Назад')}
                onClick={() => (window.history.length > 1 ? router.history.back() : void navigate({ to: '/today' }))}
              >
                <ArrowLeft className="size-5" />
              </Button>
              <h2 className="text-sm font-semibold">{tr('Чат')}</h2>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
              <MessageSquarePlus className="size-4" /> {tr('Написать')}
            </Button>
          </div>
          <NotifyPrompt />
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {sorted.map((c, i) => (
              <li key={c.id}>
                {(c.kind === 'direct' || c.kind === 'group' ? sorted[i - 1]?.kind !== c.kind : sorted[i - 1]?.project_id !== c.project_id) && (
                  <h3 className="truncate bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                    {c.kind === 'direct' || c.kind === 'group' ? KIND_HEADINGS[c.kind] : `${c.project_code} · ${c.project_name}`}
                  </h3>
                )}
                <ChannelRow
                  channel={c}
                  title={titleOf(c)}
                  person={c.other_user_id ? people.get(c.other_user_id) : undefined}
                  online={c.other_user_id ? online(c.other_user_id).online : false}
                  active={active?.id === c.id}
                  me={me}
                  authorName={c.last_author_id ? people.get(c.last_author_id)?.full_name : undefined}
                  onSelect={() => select(c.id)}
                />
              </li>
            ))}
            {sorted.length === 0 && <li className="p-4 text-sm text-muted-foreground">{tr('Каналов пока нет. Нажмите «Написать» и выберите человека.')}</li>}
          </ul>
        </aside>

        <section className={cn('flex min-h-0 flex-col', !channelParam && 'max-lg:hidden')} aria-label={tr('Переписка')}>
          {active ? (
            <Thread
              key={active.id}
              channel={active}
              title={titleOf(active)}
              people={people}
              me={me}
              online={online}
              scope={active.project_code ? `${active.project_code} · ${active.project_name}` : undefined}
              onBack={() => select(undefined)}
              onGroupGone={() => select(undefined)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{tr('Выберите переписку слева или начните новую.')}</div>
          )}
        </section>
      </div>

      {picking && (
        <NewChatDialog
          people={[...people.values()]}
          online={online}
          onPickPerson={startDirect}
          onGroupCreated={async (id) => {
            await queryClient.invalidateQueries({ queryKey: ['chat', 'overview'] })
            setPicking(false)
            select(id)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

function ChannelRow({
  channel,
  title,
  person,
  online,
  active,
  me,
  authorName,
  onSelect,
}: {
  channel: ChatChannel
  title: string
  person?: ChatPerson
  online: boolean
  active: boolean
  me: string
  authorName?: string
  onSelect: () => void
}) {
  const preview =
    channel.last_body !== null
      ? `${channel.last_author_id === me ? tr('Вы') : (authorName?.split(' ')[0] ?? '')}${channel.last_author_id === me || authorName ? ': ' : ''}${channel.last_body || tr('Вложение')}`
      : tr('Пока нет сообщений')
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn('flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active && 'bg-muted')}
    >
      <span className="relative shrink-0">
        {channel.kind === 'direct' ? (
          <>
            <UserAvatar name={title} path={person?.avatar_path} className="size-9 bg-muted text-sm font-medium text-foreground" />
            <OnlineDot online={online} className="absolute -bottom-0.5 -right-0.5" />
          </>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {channel.kind === 'project' ? <Users className="size-4" /> : channel.kind === 'discipline' ? <Network className="size-4" /> : channel.kind === 'group' ? <UsersRound className="size-4" /> : <Building2 className="size-4" />}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', channel.unread > 0 ? 'font-semibold' : 'font-medium')}>{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{preview}</span>
      </span>
      {channel.unread > 0 && (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-signal px-1.5 text-xs font-semibold leading-5 text-signal-foreground">
          {channel.unread > 99 ? '99+' : channel.unread}
          <span className="sr-only"> {tr('непрочитанных')}</span>
        </span>
      )}
    </button>
  )
}

function Thread({
  channel,
  title,
  people,
  me,
  online,
  scope,
  onBack,
  onGroupGone,
}: {
  channel: ChatChannel
  title: string
  people: Map<string, ChatPerson>
  me: string
  online: ReturnType<typeof useOnline>
  /** Проект канала для подписи («ZK7 · ЖК …»); у личных и групп его нет */
  scope?: string
  onBack: () => void
  onGroupGone: () => void
}) {
  const queryClient = useQueryClient()
  const { data: messages = [] } = useQuery(chatMessagesQuery(channel.id))
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const { tenantId } = useAuth()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [managing, setManaging] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const voice = useVoiceRecorder()
  const lastId = messages[messages.length - 1]?.id

  const other = channel.other_user_id ? people.get(channel.other_user_id) : undefined
  const subtitle =
    channel.kind === 'direct'
      ? presenceText(online(channel.other_user_id))
      : channel.kind === 'project'
        ? `${scope} · ${tr('Внутренняя команда проекта. Подрядчики сюда не заходят.')}`
        : channel.kind === 'discipline'
          ? `${scope} · ${tr('Сотрудники направления: {{name}}', { name: title })}`
          : channel.kind === 'group'
            ? (channel.member_ids ?? []).map((id) => people.get(id)?.full_name.split(' ')[0] ?? tr('Участник')).join(', ')
            : `${scope} · ${tr('Сотрудники организации и наша команда')}`

  // новые сообщения: прокручиваем вниз, если читатель уже был внизу (или это первая загрузка)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [lastId])

  // клавиатура телефона меняет высоту ленты: если читатель был внизу, остаёмся внизу
  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // прочитано: пока переписка открыта и вкладка видна
  useEffect(() => {
    if (channel.unread === 0 || document.visibilityState !== 'visible') return
    markChatRead(channel.id)
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chat', 'overview'] }),
        queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] }),
      ]))
      .catch(() => {})
  }, [channel.id, channel.unread, lastId, queryClient])

  const send = useMutation({
    mutationFn: async (input: { body: string; files: File[]; voice?: VoiceResult }) => {
      const ctx = { tenantId: tenantId!, projectId: channel.project_id, channelId: channel.id }
      const uploaded: UploadedChatFile[] = []
      for (const f of input.files) uploaded.push(await uploadChatFile(ctx, f))
      if (input.voice) uploaded.push(await uploadChatFile(ctx, input.voice.file, { kind: 'voice', durationSec: input.voice.durationSec }))
      await sendChatMessage(channel.id, input.body, uploaded)
    },
    onSuccess: async () => {
      stickRef.current = true
      await queryClient.invalidateQueries({ queryKey: ['chat'] })
    },
    onError: (e, input) => {
      setText((current) => current || input.body)
      setFiles((current) => (current.length ? current : input.files))
      toast.error(errorText(e))
    },
  })
  const remove = useMutation({
    mutationFn: deleteChatMessage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat'] }),
    onError: (e) => toast.error(errorText(e)),
  })
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => editChatMessage(id, body),
    onSuccess: async () => {
      setEditing(null)
      setText('')
      await queryClient.invalidateQueries({ queryKey: ['chat', 'messages', channel.id] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const react = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) => reactChatMessage(id, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', 'messages', channel.id] }),
    onError: (e) => toast.error(errorText(e)),
  })

  const startEdit = (m: ChatMessage) => {
    setEditing(m)
    setText(m.body)
    setFiles([])
    requestAnimationFrame(() => taRef.current?.focus())
  }
  const cancelEdit = () => {
    setEditing(null)
    setText('')
  }

  const submit = () => {
    const body = text.trim()
    if (editing) {
      if ((!body && editing.attachments.length === 0) || edit.isPending) return
      edit.mutate({ id: editing.id, body })
      return
    }
    if ((!body && files.length === 0) || send.isPending) return
    setText('')
    setFiles([])
    send.mutate({ body, files })
  }

  const addFiles = (picked: File[]) => {
    const fit = picked.filter((f) => {
      if (f.size <= CHAT_MAX_FILE_BYTES) return true
      toast.error(tr('«{{name}}» больше 25 МБ и не отправлен.', { name: f.name }))
      return false
    })
    setFiles((current) => {
      const next = [...current, ...fit]
      if (next.length > CHAT_MAX_FILES) toast.error(tr('В одном сообщении не больше {{n}} файлов.', { n: CHAT_MAX_FILES }))
      return next.slice(0, CHAT_MAX_FILES)
    })
  }

  const insertEmoji = (emoji: string) => {
    const el = taRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? start
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const showClip = !editing && !text.trim()

  const startVoice = async () => {
    if (!(await voice.start())) toast.error(tr('Нет доступа к микрофону. Разрешите его в настройках браузера.'))
  }
  const sendVoice = async () => {
    const result = await voice.finish()
    if (result) send.mutate({ body: '', files: [], voice: result })
  }

  // разделители по дням
  const rows = useMemo(() => {
    const out: ({ type: 'day'; key: string; label: string } | { type: 'msg'; key: string; m: ChatMessage; first: boolean })[] = []
    let day = ''
    let prev: ChatMessage | undefined
    for (const m of messages) {
      const d = new Date(m.created_at)
      const key = d.toDateString()
      if (key !== day) {
        out.push({ type: 'day', key: `d-${key}`, label: dayFmt().format(d) })
        day = key
        prev = undefined
      }
      const first = !prev || prev.author_id !== m.author_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000
      out.push({ type: 'msg', key: m.id, m, first })
      prev = m
    }
    return out
  }, [messages])

  return (
    <>
      <header className="flex items-center gap-2 border-b px-2 py-2 sm:px-3">
        <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={tr('К списку переписок')}>
          <ArrowLeft className="size-5" />
        </Button>
        {channel.kind === 'direct' && (
          <span className="relative shrink-0">
            <UserAvatar name={title} path={other?.avatar_path} className="size-9 bg-muted text-sm font-medium text-foreground" />
            <OnlineDot online={online(channel.other_user_id).online} className="absolute -bottom-0.5 -right-0.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {channel.kind === 'group' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setManaging(true)}>
            <Users className="size-4" /> {tr('Состав')}
          </Button>
        )}
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles([...e.dataTransfer.files])
        }}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3 lg:px-6"
        role="log"
        aria-live="polite"
        aria-label={tr('Сообщения')}
      >
        <div className="mt-auto" aria-hidden />
        {messages.length === 0 && <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">{tr('Сообщений пока нет. Напишите первым.')}</p>}
        {rows.map((r) =>
          r.type === 'day' ? (
            <div key={r.key} className="my-2 flex justify-center">
              <span className="rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">{r.label}</span>
            </div>
          ) : (
            <Bubble
              key={r.key}
              m={r.m}
              first={r.first}
              mine={r.m.author_id === me}
              author={people.get(r.m.author_id)}
              showAuthor={channel.kind !== 'direct'}
              me={me}
              onDelete={() => remove.mutate(r.m.id)}
              onEdit={() => startEdit(r.m)}
              onReact={(emoji) => react.mutate({ id: r.m.id, emoji })}
            />
          ),
        )}
      </div>

      {editing && (
        <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-1.5 text-sm" role="status">
          <Pencil className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {tr('Изменение сообщения')}: <span className="text-muted-foreground">{editing.body || tr('Вложение')}</span>
          </span>
          <button type="button" onClick={cancelEdit} aria-label={tr('Отменить изменение')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 border-t px-2 pt-2 sm:px-3" aria-label={tr('Прикреплённые файлы')}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full border bg-muted py-0.5 pl-3 pr-1 text-xs">
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              <button type="button" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))} aria-label={tr('Убрать файл {{name}}', { name: f.name })} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {voice.recording ? (
        <div className="flex items-center gap-2 border-t p-2 sm:p-3" role="status" aria-label={tr('Идёт запись голосового сообщения')}>
          <Button type="button" variant="ghost" size="icon" onClick={voice.cancel} aria-label={tr('Отменить запись')} title={tr('Отменить запись')}>
            <Trash2 className="size-5" />
          </Button>
          <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-red-600" />
          <span className="flex-1 text-sm tabular-nums">{clock(voice.seconds)}</span>
          <Button type="button" onClick={() => void sendVoice()} aria-label={tr('Отправить голосовое сообщение')}>
            <Send className="size-4" />
          </Button>
        </div>
      ) : (
        <form
          className="flex items-end gap-1 border-t p-2 sm:gap-2 sm:p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <EmojiPopover
            onPick={insertEmoji}
            keepOpen
            trigger={
              <Button type="button" variant="ghost" size="icon" aria-label={tr('Эмодзи')} title={tr('Эмодзи')}>
                <Smile className="size-5" />
              </Button>
            }
          />
          <div className="relative min-w-0 flex-1">
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape' && editing) cancelEdit()
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files]
              if (pasted.length > 0) {
                e.preventDefault()
                addFiles(pasted)
              }
            }}
            rows={1}
            maxLength={4000}
            aria-label={tr('Сообщение')}
            placeholder={tr('Сообщение')}
            className={cn('max-h-32 min-h-11 resize-none', showClip && 'pr-11')}
          />
          {/* скрепка живёт внутри поля, пока в нём нет текста; с первой буквой уступает место кнопке «Отправить» */}
          {showClip && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label={tr('Прикрепить файл или фото')}
              title={tr('Прикрепить файл или фото')}
              className="absolute bottom-1 right-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Paperclip className="size-5" />
            </button>
          )}
          </div>
          {!editing && !text.trim() && files.length === 0 && voice.supported ? (
            <Button type="button" onClick={() => void startVoice()} disabled={send.isPending} aria-label={tr('Записать голосовое сообщение')} title={tr('Записать голосовое сообщение')}>
              <Mic className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={editing ? (!text.trim() && editing.attachments.length === 0) || edit.isPending : (!text.trim() && files.length === 0) || send.isPending}
              aria-label={editing ? tr('Сохранить изменение') : tr('Отправить')}
            >
              {editing ? <Check className="size-4" /> : <Send className="size-4" />}
            </Button>
          )}
        </form>
      )}
      {managing && (
        <GroupDialog
          channel={channel}
          people={[...people.values()]}
          online={online}
          me={me}
          onDone={async (gone) => {
            await queryClient.invalidateQueries({ queryKey: ['chat'] })
            setManaging(false)
            if (gone) onGroupGone()
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </>
  )
}

function Bubble({
  m,
  first,
  mine,
  author,
  showAuthor,
  me,
  onDelete,
  onEdit,
  onReact,
}: {
  m: ChatMessage
  first: boolean
  mine: boolean
  author?: ChatPerson
  showAuthor: boolean
  me: string
  onDelete: () => void
  onEdit: () => void
  onReact: (emoji: string) => void
}) {
  const [menu, setMenu] = useState(false)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  const openMenu = () => {
    cancelPress()
    navigator.vibrate?.(15)
    setMenu(true)
  }
  const time = timeFmt().format(new Date(m.created_at))
  const bigEmoji = m.attachments.length === 0 ? emojiOnlyCount(m.body) : 0
  const name = author?.full_name ?? tr('Участник')
  return (
    <div
      className={cn('group flex gap-2 [@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]', mine && 'flex-row-reverse', first && 'mt-2')}
      // на телефоне: долгое нажатие открывает меню сообщения (прокрутка и касание пальцем отменяют его)
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' || m.deleted_at) return
        press.current = { timer: setTimeout(openMenu, 450), x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        if (!m.deleted_at && window.matchMedia('(hover: none)').matches) {
          e.preventDefault()
          openMenu()
        }
      }}
    >
      <div className="w-8 shrink-0">
        {first && !mine && <UserAvatar name={name} path={author?.avatar_path} className="size-8 bg-muted text-xs font-medium text-foreground" />}
      </div>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%]', mine && 'items-end')}>
        {first && !mine && showAuthor && (
          <span className="mb-0.5 truncate text-xs text-muted-foreground">
            {name}
            {author?.job_title ? ` · ${author.job_title}` : ''}
          </span>
        )}
        <div className={cn('flex items-end gap-1', mine && 'flex-row-reverse')}>
          {m.deleted_at ? (
            <p className="rounded-lg border border-dashed px-3 py-1.5 text-sm italic text-muted-foreground">{tr('Сообщение удалено')}</p>
          ) : (
            <div className={cn('flex min-w-0 flex-col gap-1', mine && 'items-end')}>
              {m.body &&
                (bigEmoji > 0 ? (
                  // размер относительно обычного текста сообщения (14 px): один эмодзи ×2, несколько ×1,5
                  <p className={cn('py-0.5 leading-tight', bigEmoji === 1 ? 'text-[28px]' : 'text-[21px]')}>{m.body.trim()}</p>
                ) : (
                  <p className={cn('whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{m.body}</p>
                ))}
              {m.attachments.map((a) =>
                a.kind === 'image' ? (
                  <AttachmentView key={a.id} a={a} mine={mine} />
                ) : (
                  <div key={a.id} className={cn('max-w-full rounded-lg p-1.5', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                    <AttachmentView a={a} mine={mine} />
                  </div>
                ),
              )}
            </div>
          )}
          <span className="shrink-0 pb-0.5 text-[11px] tabular-nums text-muted-foreground">
            {m.edited_at && !m.deleted_at ? `${tr('изменено')} · ` : ''}
            {time}
          </span>
          {/* на компьютере действия появляются при наведении; на телефоне их заменяет долгое нажатие */}
          {!m.deleted_at && (
            <span className="flex shrink-0 [@media(hover:none)]:hidden [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
              <ReactionAddButton onPick={onReact} />
              {mine && (
                <button type="button" onClick={onEdit} aria-label={tr('Изменить сообщение')} title={tr('Изменить сообщение')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <Pencil className="size-4" />
                </button>
              )}
              {mine && (
                <button type="button" onClick={onDelete} aria-label={tr('Удалить сообщение')} title={tr('Удалить сообщение')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <Trash2 className="size-4" />
                </button>
              )}
            </span>
          )}
        </div>
        {!m.deleted_at && <ReactionBar message={m} me={me} onReact={onReact} />}
      </div>
      {menu && <MessageSheet message={m} mine={mine} onReact={onReact} onEdit={onEdit} onDelete={onDelete} onClose={() => setMenu(false)} />}
    </div>
  )
}

function matches(m: ChatPerson, q: string): boolean {
  const needle = q.trim().toLowerCase()
  return !needle || `${m.full_name} ${m.job_title ?? ''} ${m.email}`.toLowerCase().includes(needle)
}

/** Поиск и список людей: по одному (`onPick`) или с галочками (`selected` + `onToggle`). Кто в сети — выше. */
function PeoplePicker({
  people,
  online,
  onPick,
  selected,
  onToggle,
  readOnly,
}: {
  people: ChatPerson[]
  online: ReturnType<typeof useOnline>
  onPick?: (userId: string) => void
  selected?: Set<string>
  onToggle?: (userId: string) => void
  readOnly?: boolean
}) {
  const [q, setQ] = useState('')
  const list = useMemo(
    () =>
      people
        .filter((m) => matches(m, q))
        .sort((a, b) => Number(online(b.id).online) - Number(online(a.id).online) || a.full_name.localeCompare(b.full_name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, q, online],
  )
  return (
    <>
      {!readOnly && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Имя, должность или почта')} aria-label={tr('Поиск человека')} />}
      <ul className="-mx-1 flex max-h-72 flex-col overflow-y-auto">
        {list.map((m) => {
          const state = online(m.id)
          const checked = selected?.has(m.id) ?? false
          const content = (
            <>
              {selected && !readOnly && (
                <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                  {checked && <Check className="size-3" />}
                </span>
              )}
              <span className="relative shrink-0">
                <UserAvatar name={m.full_name} path={m.avatar_path} className="size-9 bg-muted text-sm font-medium text-foreground" />
                <OnlineDot online={state.online} className="absolute -bottom-0.5 -right-0.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{m.full_name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[m.job_title || m.organization_name, presenceText(state)].filter(Boolean).join(' · ')}</span>
              </span>
            </>
          )
          return (
            <li key={m.id}>
              {readOnly ? (
                <div className="flex min-h-12 items-center gap-3 px-2 py-1.5">{content}</div>
              ) : (
                <button
                  type="button"
                  role={selected ? 'checkbox' : undefined}
                  aria-checked={selected ? checked : undefined}
                  onClick={() => (selected ? onToggle?.(m.id) : onPick?.(m.id))}
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              )}
            </li>
          )
        })}
        {list.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">{tr('Никого не нашли.')}</li>}
      </ul>
    </>
  )
}

function useToggleSet(initial: Iterable<string> = []) {
  const [set, setSet] = useState(() => new Set(initial))
  const toggle = (id: string) =>
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return [set, toggle] as const
}

function NewChatDialog({
  people,
  online,
  onPickPerson,
  onGroupCreated,
  onClose,
}: {
  people: ChatPerson[]
  online: ReturnType<typeof useOnline>
  onPickPerson: (userId: string) => void
  onGroupCreated: (channelId: string) => void | Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [name, setName] = useState('')
  const [picked, toggle] = useToggleSet()
  const create = useMutation({
    mutationFn: () => createChatGroup(name, [...picked]),
    onSuccess: (id) => onGroupCreated(id),
    onError: (e) => toast.error(errorText(e)),
  })
  const tab = (value: 'direct' | 'group', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={cn('min-h-10 flex-1 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === value ? 'bg-background shadow-soft' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'direct' ? tr('Новая переписка') : tr('Новая группа')}</DialogTitle>
          <DialogDescription>
            {mode === 'direct'
              ? tr('Выберите человека. Те, кто сейчас в проекте, отмечены зелёной точкой и стоят выше.')
              : tr('Назовите группу и отметьте участников. Создатель может менять состав и удалить группу.')}
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1">
          {tab('direct', tr('Личная'))}
          {tab('group', tr('Группа'))}
        </div>
        {mode === 'group' && (
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr('Название группы')} aria-label={tr('Название группы')} autoFocus />
        )}
        <PeoplePicker people={people} online={online} onPick={mode === 'direct' ? onPickPerson : undefined} selected={mode === 'group' ? picked : undefined} onToggle={toggle} />
        {mode === 'group' && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="button" disabled={!name.trim() || picked.size === 0 || create.isPending} onClick={() => create.mutate()}>
              {tr('Создать группу')}
              {picked.size > 0 ? ` (${picked.size + 1})` : ''}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Состав группы: создатель меняет название и людей или удаляет группу, остальные видят состав и могут выйти. */
function GroupDialog({
  channel,
  people,
  online,
  me,
  onDone,
  onClose,
}: {
  channel: ChatChannel
  people: ChatPerson[]
  online: ReturnType<typeof useOnline>
  me: string
  onDone: (gone: boolean) => void | Promise<void>
  onClose: () => void
}) {
  const isOwner = channel.created_by === me
  const [name, setName] = useState(channel.name ?? '')
  const [picked, toggle] = useToggleSet((channel.member_ids ?? []).filter((id) => id !== me))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fail = (e: unknown) => toast.error(errorText(e))
  const save = useMutation({ mutationFn: () => updateChatGroup(channel.id, name, [...picked]), onSuccess: () => onDone(false), onError: fail })
  const leave = useMutation({ mutationFn: () => leaveChatGroup(channel.id), onSuccess: () => onDone(true), onError: fail })
  const remove = useMutation({ mutationFn: () => deleteChatGroup(channel.id), onSuccess: () => onDone(true), onError: fail })
  const members = people.filter((m) => (channel.member_ids ?? []).includes(m.id))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isOwner ? tr('Группа: название и состав') : tr('Состав группы')}</DialogTitle>
          <DialogDescription>{isOwner ? tr('Вы создали эту группу и можете менять её состав.') : tr('Состав меняет создатель группы. Вы можете выйти из неё.')}</DialogDescription>
        </DialogHeader>
        {isOwner ? (
          <>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={tr('Название группы')} />
            <PeoplePicker people={people} online={online} selected={picked} onToggle={toggle} />
          </>
        ) : (
          <PeoplePicker people={members} online={online} readOnly />
        )}
        {confirmDelete ? (
          <DialogFooter>
            <p className="mr-auto text-sm">{tr('Удалить группу «{{name}}»? Переписка скроется у всех участников.', { name: channel.name ?? '' })}</p>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              {tr('Отмена')}
            </Button>
            <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {tr('Удалить группу')}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            {isOwner ? (
              <>
                <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirmDelete(true)}>
                  {tr('Удалить группу')}
                </Button>
                <Button type="button" disabled={!name.trim() || picked.size === 0 || save.isPending} onClick={() => save.mutate()}>
                  {tr('Сохранить')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" disabled={leave.isPending} onClick={() => leave.mutate()}>
                {tr('Выйти из группы')}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
