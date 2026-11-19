import { useInfiniteQuery, useIsFetching, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Bell,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  ChevronDown,
  ChevronRight,
  Clock,
  MapPin,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FilePen,
  FileSpreadsheet,
  FileText,
  Flag,
  Folder,
  Inbox,
  ListFilter,
  Mail,
  MailOpen,
  Maximize2,
  Minimize2,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/features/profile/avatar'
import {
  downloadAttachment,
  filterLabel,
  folderLabel,
  MAIL_FILTERS,
  mailAccountQuery,
  mailAuthUrl,
  mailChildrenQuery,
  mailConnect,
  mailDelete,
  MailError,
  mailMarkRead,
  mailMove,
  mailReconnect,
  mailConversationQuery,
  mailErrorText,
  mailFoldersQuery,
  mailMessageQuery,
  mailMessagesQuery,
  matchesFilter,
  OUTLOOK_COMPOSE_URL,
  type MailAddress,
  type MailAttachment,
  type MailFilter,
  type MailFolder,
  type MailListItem,
  type MailMeeting,
  type MailMessage,
  type MailThreadItem,
} from '@/features/mail/api'
import { MailBody } from '@/features/mail/mail-body'
import { PersonCard, useKnownPerson } from '@/features/mail/person-card'

export const Route = createFileRoute('/_app/mail')({
  validateSearch: z.object({
    folder: z.string().optional().catch(undefined),
    m: z.string().optional().catch(undefined),
    q: z.string().optional().catch(undefined),
    f: z.enum(MAIL_FILTERS).optional().catch(undefined),
    // Возврат из Microsoft после входа
    code: z.string().optional().catch(undefined),
    state: z.string().optional().catch(undefined),
    error: z.string().optional().catch(undefined),
    error_description: z.string().optional().catch(undefined),
  }),
  component: MailPage,
})

function MailPage() {
  const search = Route.useSearch()
  const { data: account, isPending } = useQuery(mailAccountQuery)

  if (search.code || search.error) return <Callback code={search.code} state={search.state} error={search.error} description={search.error_description} />
  if (isPending) return <p className="p-6 text-sm text-muted-foreground">{tr('Загружаем почту…')}</p>
  if (!account) return <NotConnected />
  return <Mailbox email={account.email} name={account.display_name} />
}

// ---------------------------------------------------------------------------
// Подключение
// ---------------------------------------------------------------------------
function Notice({ children }: { children: ReactNode }) {
  return <div className="mx-auto mt-6 flex w-full max-w-xl flex-col items-start gap-3 rounded-lg border bg-card p-5 shadow-soft lg:mt-10">{children}</div>
}

function NotConnected() {
  return (
    <Notice>
      <span className="flex size-10 items-center justify-center rounded-full bg-mail-soft text-mail-ink">
        <Mail className="size-5" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">{tr('Почта не подключена')}</h1>
      <p className="text-sm text-muted-foreground">{tr('Подключите рабочий Outlook в профиле: письма появятся здесь. Видите их только вы.')}</p>
      <Button asChild>
        <Link to="/profile">{tr('Перейти в профиль')}</Link>
      </Button>
    </Notice>
  )
}

/** Microsoft вернул пользователя с кодом: меняем его на токены (код одноразовый, поэтому только один раз). */
function Callback({ code, state, error, description }: { code?: string; state?: string; error?: string; description?: string }) {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const started = useRef(false)
  const consent = !!error && /AADSTS(65001|90094|90095|650056|650051)|consent|admin/i.test(`${error} ${description ?? ''}`)
  const [failure, setFailure] = useState<string | null>(() => {
    if (!error) return null
    // 65001 / consent_required: администратор организации не разрешил приложению доступ к почте
    if (consent) {
      return tr('Администратор вашего Microsoft 365 должен разрешить приложению доступ к почте. Передайте ему ссылку на согласие (см. инструкцию подключения) и попробуйте снова.')
    }
    if (error === 'access_denied') return tr('Вы отказались давать доступ к почте.')
    return tr('Microsoft не дал войти: {{text}}', { text: (description ?? error).slice(0, 200) })
  })

  useEffect(() => {
    if (error || !code || !state || started.current) return
    started.current = true
    mailConnect(code, state)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['mail'] })
        toast.success(tr('Outlook подключён'))
        await navigate({ to: '/mail', search: {}, replace: true })
      })
      .catch((e) => setFailure(mailErrorText(e)))
  }, [code, state, error, queryClient, navigate])

  return (
    <Notice>
      {failure ? (
        <>
          <TriangleAlert className="size-6 text-destructive" aria-hidden />
          <h1 className="text-xl font-semibold">{tr('Не удалось подключить почту')}</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {failure}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/profile">{tr('Вернуться в профиль')}</Link>
            </Button>
            {/* Администратор не разрешил изменение писем — можно подключиться только для чтения, как раньше */}
            {consent && (
              <Button variant="outline" onClick={() => void mailAuthUrl(true).then((u) => window.location.assign(u)).catch((e) => toast.error(mailErrorText(e)))}>
                {tr('Подключить только для чтения')}
              </Button>
            )}
          </div>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {tr('Подключаем Outlook…')}
        </p>
      )}
    </Notice>
  )
}

// ---------------------------------------------------------------------------
// Ящик: папки · письма · письмо (как в Outlook и Zoho Mail)
// ---------------------------------------------------------------------------
const FOLDERS_KEY = 'buildos.mail.folders.collapsed'
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const writeFlag = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* приватный режим */
  }
}

const FOLDER_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  sentitems: Send,
  drafts: FilePen,
  archive: Archive,
  deleteditems: Trash2,
  junkemail: ShieldAlert,
}
const folderIcon = (f: MailFolder) => (f.well_known ? FOLDER_ICONS[f.well_known] : null) ?? Folder

type Go = (next: { folder?: string; m?: string; q?: string; f?: MailFilter }) => void

function Mailbox({ email, name }: { email: string; name: string | null }) {
  const { folder: folderParam, m, q, f } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const folders = useQuery(mailFoldersQuery)
  // Системные папки Graph принимает по имени (inbox, sentitems…): так список не запрашивается дважды, пока грузятся папки
  const folder = folderParam ?? 'inbox'
  const filter: MailFilter = f ?? 'all'
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => readFlag(FOLDERS_KEY))
  // «Во весь экран»: письмо без списка (на десктопе)
  const [wide, setWide] = useState(false)

  const go: Go = (next) =>
    void navigate({ to: '/mail', search: { folder: next.folder ?? folder, m: next.m, q: next.q, f: next.f === 'all' ? undefined : next.f } })
  const openFolder = (key: string, nextFilter?: MailFilter) => go({ folder: key, f: nextFilter })

  // Более раннее письмо той же переписки уже показано справа отдельным блоком — тогда просто прокручиваем к нему,
  // а не открываем заново (n — чтобы повторный щелчок по тому же письму снова прокрутил)
  const [jump, setJump] = useState<{ m: string; id: string; n: number } | null>(null)
  const focus = jump && jump.m === m ? jump : null
  const openMessage = (id: string) => {
    const shown = m ? queryClient.getQueryData(mailMessageQuery(m).queryKey) : undefined
    if (m && id !== m && shown?.thread.some((t) => t.id === id)) {
      setJump({ m, id, n: Date.now() })
      return
    }
    setJump(null)
    go({ m: id, q, f: filter })
  }

  // После удаления открываем следующее письмо списка (или предыдущее, если удалили последнее)
  const neighbour = (id: string) => {
    const data = queryClient.getQueryData(mailMessagesQuery(folder, q ?? '', filter).queryKey)
    const items = (data?.pages.flatMap((p) => p.messages) ?? []).filter((it) => matchesFilter(it, filter))
    const i = items.findIndex((it) => it.id === id)
    if (i < 0) return undefined
    return (items[i + 1] ?? items[i - 1])?.id
  }

  const collapseFolders = (v: boolean) => {
    setFoldersCollapsed(v)
    writeFlag(FOLDERS_KEY, v)
  }

  // Название открытой папки: среди корневых или среди уже раскрытых подпапок
  const current = useMemo(() => {
    const all = [...(folders.data ?? [])]
    for (const [, list] of queryClient.getQueriesData<MailFolder[]>({ queryKey: ['mail', 'children'] })) all.push(...(list ?? []))
    return all.find((x) => (x.well_known ?? x.id) === folder || x.id === folder) ?? null
  }, [folders.data, folder, queryClient])

  // Название папки по id или системному имени — у писем раскрытой ветки (они бывают из разных папок)
  const folderName = (id: string | null | undefined) => {
    if (!id) return null
    const f = (folders.data ?? []).find((x) => x.id === id || x.well_known === id)
    return f ? folderLabel(f) : null
  }

  // Письма и папки читаются «вживую»: если доступ отозван, показываем это одним сообщением
  if (folders.error) {
    return (
      <Notice>
        <TriangleAlert className="size-6 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">{tr('Почта недоступна')}</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {mailErrorText(folders.error)}
        </p>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/profile">{tr('Открыть профиль')}</Link>
          </Button>
          <Button variant="outline" onClick={() => void folders.refetch()}>
            {tr('Повторить')}
          </Button>
        </div>
      </Notice>
    )
  }

  return (
    <div className="flex flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-row lg:overflow-hidden">
      <h1 className="sr-only">{tr('Почта')}</h1>

      {/* Папки: полная панель от 1280 px (если не свёрнута), иначе — узкая полоса значков */}
      <FolderPane
        className={cn('hidden', !foldersCollapsed && 'xl:flex')}
        email={email}
        name={name}
        folders={folders.data}
        loading={folders.isPending}
        active={folder}
        filter={filter}
        onOpen={openFolder}
        onCollapse={() => collapseFolders(true)}
      />
      <FolderRail
        className={cn('hidden lg:flex', !foldersCollapsed && 'xl:hidden')}
        folders={folders.data}
        active={folder}
        onOpen={openFolder}
        onExpand={() => collapseFolders(false)}
      />

      {/* Список писем */}
      <section
        aria-label={tr('Письма')}
        className={cn(
          'min-h-0 flex-col bg-card max-lg:-mx-4 max-lg:-mt-5 sm:max-lg:-mx-6',
          // письмо не выбрано — список во всю ширину; выбрано — узкая колонка слева от письма
          m ? 'hidden lg:flex lg:w-[23rem] lg:shrink-0 lg:border-r xl:w-[26rem]' : 'flex lg:min-w-0 lg:flex-1',
          m && wide && 'lg:hidden',
        )}
      >
        <ListHeader
          title={current ? folderLabel(current) : folder === 'inbox' ? tr('Входящие') : tr('Папка')}
          unread={current?.unread ?? 0}
          folders={folders.data}
          folder={folder}
          onFolder={(key) => openFolder(key)}
        />
        <SearchBox key={q ?? ''} initial={q ?? ''} onSearch={(text) => go({ q: text || undefined, f: filter })}>
          <FilterMenu value={filter} onChange={(v) => go({ q, f: v })} />
        </SearchBox>
        <MessageList
          folder={folder}
          search={q ?? ''}
          filter={filter}
          wide={!m}
          sent={current?.well_known === 'sentitems' || current?.well_known === 'drafts'}
          folderName={folderName}
          selected={focus?.id ?? m}
          onOpen={openMessage}
          onClose={() => go({ q, f: filter })}
        />
      </section>

      {/* Письмо — только когда выбрано */}
      {m && (
        <section aria-label={tr('Письмо')} className="flex min-h-0 min-w-0 flex-1 flex-col bg-card max-lg:-mx-4 max-lg:-mt-5 sm:max-lg:-mx-6">
          <Reader
            key={m}
            id={m}
            folderName={folderName}
            focus={focus}
            inTrash={folder === 'deleteditems' || current?.well_known === 'deleteditems'}
            neighbour={neighbour}
            onDeleted={(next) => {
              setJump(null)
              go({ m: next, q, f: filter })
            }}
            wide={wide}
            onWide={() => setWide((v) => !v)}
            onClose={() => {
              setWide(false)
              go({ q, f: filter })
            }}
          />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Папки
// ---------------------------------------------------------------------------
const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
)

const VIEWS: { filter: MailFilter; icon: LucideIcon }[] = [
  { filter: 'unread', icon: Mail },
  { filter: 'attachments', icon: Paperclip },
  { filter: 'important', icon: Star },
  { filter: 'flagged', icon: Flag },
]

function FolderPane({
  className,
  email,
  name,
  folders,
  loading,
  active,
  filter,
  onOpen,
  onCollapse,
}: {
  className?: string
  email: string
  name: string | null
  folders: MailFolder[] | undefined
  loading: boolean
  active: string
  filter: MailFilter
  onOpen: (key: string, filter?: MailFilter) => void
  onCollapse: () => void
}) {
  const queryClient = useQueryClient()
  const fetching = useIsFetching({ queryKey: ['mail'] }) > 0
  return (
    <nav aria-label={tr('Папки')} className={cn('w-60 shrink-0 flex-col border-r bg-mail-pane', className)}>
      <div className="flex items-center gap-1.5 p-3 pb-2">
        <Button asChild className="h-10 flex-1 justify-start gap-2 bg-mail text-mail-foreground shadow-sm hover:bg-mail/90">
          <a href={OUTLOOK_COMPOSE_URL} target="_blank" rel="noopener noreferrer" title={tr('Откроется Outlook в новой вкладке')}>
            <PenSquare />
            {tr('Новое письмо')}
          </a>
        </Button>
        <IconButton label={tr('Свернуть папки')} onClick={onCollapse}>
          <PanelLeftClose />
        </IconButton>
      </div>

      <div className="mx-3 flex items-center gap-2.5 rounded-md px-1 py-2">
        <UserAvatar name={name || email} className="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          {name && <p className="truncate text-sm font-medium leading-tight">{name}</p>}
          <p className="truncate text-xs text-muted-foreground" title={email}>
            {email}
          </p>
        </div>
        <IconButton label={tr('Обновить')} onClick={() => void queryClient.invalidateQueries({ queryKey: ['mail'] })}>
          <RefreshCw className={cn(fetching && 'animate-spin motion-reduce:animate-none')} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 [scrollbar-width:thin]">
        <SectionLabel>{tr('Папки')}</SectionLabel>
        <ul className="flex flex-col gap-px px-2">
          {loading && Array.from({ length: 6 }, (_, i) => <li key={i} className="mx-1 my-1.5 h-5 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}
          {(folders ?? []).map((f) => (
            <FolderRow key={f.id} f={f} depth={0} active={active} filter={filter} onOpen={onOpen} />
          ))}
        </ul>

        <SectionLabel>{tr('Представления')}</SectionLabel>
        <ul className="flex flex-col gap-px px-2">
          {VIEWS.map((v) => {
            const on = active === 'inbox' && filter === v.filter
            return (
              <li key={v.filter}>
                <PaneRow icon={v.icon} label={filterLabel(v.filter)} active={on} onClick={() => onOpen('inbox', on ? 'all' : v.filter)} />
              </li>
            )
          })}
        </ul>

        <div className="mt-auto px-2 pt-4">
          <Link
            to="/settings/notifications"
            className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
          >
            <Bell className="size-4" aria-hidden />
            {tr('Уведомления о письмах')}
          </Link>
        </div>
      </div>
    </nav>
  )
}

function PaneRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  depth = 0,
  lead,
}: {
  icon: LucideIcon
  label: string
  count?: number
  active: boolean
  onClick: () => void
  depth?: number
  lead?: ReactNode
}) {
  return (
    <div className="relative flex items-center" style={{ paddingLeft: depth * 14 }}>
      {lead}
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? "bg-mail-soft font-semibold text-mail-ink before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-mail before:content-['']"
            : 'text-foreground/80 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && count > 0 && <span className={cn('shrink-0 text-xs tabular-nums', active ? 'text-mail-ink' : 'font-semibold text-foreground')}>{count}</span>}
      </button>
    </div>
  )
}

function FolderRow({
  f,
  depth,
  active,
  filter,
  onOpen,
}: {
  f: MailFolder
  depth: number
  active: string
  filter: MailFilter
  onOpen: (key: string, filter?: MailFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const children = useQuery({ ...mailChildrenQuery(f.id), enabled: open && f.has_children })
  const key = f.well_known ?? f.id
  const isActive = (active === key || active === f.id) && !(key === 'inbox' && filter !== 'all')
  return (
    <li>
      <PaneRow
        icon={folderIcon(f)}
        label={folderLabel(f)}
        count={f.well_known === 'drafts' ? f.total : f.unread}
        active={isActive}
        depth={depth}
        onClick={() => onOpen(key)}
        lead={
          f.has_children ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? tr('Свернуть подпапки') : tr('Показать подпапки')}
              className="absolute z-10 flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: depth * 14 - 8 }}
            >
              <ChevronRight className={cn('size-3.5 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
            </button>
          ) : null
        }
      />
      {open && f.has_children && (
        <ul className="flex flex-col gap-px">
          {children.isPending && (
            <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: (depth + 1) * 14 + 10 }}>
              {tr('Загружаем…')}
            </li>
          )}
          {(children.data ?? []).map((c) => (
            <FolderRow key={c.id} f={c} depth={depth + 1} active={active} filter={filter} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Свёрнутые папки: полоса значков со счётчиком непрочитанного */
function FolderRail({
  className,
  folders,
  active,
  onOpen,
  onExpand,
}: {
  className?: string
  folders: MailFolder[] | undefined
  active: string
  onOpen: (key: string) => void
  onExpand: () => void
}) {
  return (
    <nav aria-label={tr('Папки')} className={cn('w-14 shrink-0 flex-col items-center gap-1 border-r bg-mail-pane py-3', className)}>
      <a
        href={OUTLOOK_COMPOSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={tr('Новое письмо')}
        aria-label={tr('Новое письмо')}
        className="mb-2 flex size-10 items-center justify-center rounded-md bg-mail text-mail-foreground shadow-sm outline-none hover:bg-mail/90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PenSquare className="size-[18px]" />
      </a>
      {(folders ?? [])
        .filter((f) => f.well_known)
        .map((f) => {
          const Icon = folderIcon(f)
          const key = f.well_known ?? f.id
          const on = active === key
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onOpen(key)}
              title={folderLabel(f) + (f.unread ? ` (${f.unread})` : '')}
              aria-label={folderLabel(f)}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative flex size-10 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-mail-soft text-mail-ink' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
              )}
            >
              <Icon className="size-[18px]" />
              {f.unread > 0 && f.well_known !== 'drafts' && (
                <span className="absolute -right-0.5 top-0.5 min-w-4 rounded-full bg-mail px-1 text-[10px] font-semibold leading-4 text-mail-foreground">
                  {f.unread > 99 ? '99+' : f.unread}
                </span>
              )}
            </button>
          )
        })}
      <button
        type="button"
        onClick={onExpand}
        title={tr('Показать папки')}
        aria-label={tr('Показать папки')}
        className="mt-auto hidden size-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring xl:flex dark:hover:bg-white/5"
      >
        <PanelLeftOpen className="size-[18px]" />
      </button>
    </nav>
  )
}

function IconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5 [&_svg]:size-4',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Список
// ---------------------------------------------------------------------------
function ListHeader({
  title,
  unread,
  folders,
  folder,
  onFolder,
}: {
  title: string
  unread: number
  folders: MailFolder[] | undefined
  folder: string
  onFolder: (key: string) => void
}) {
  const queryClient = useQueryClient()
  const fetching = useIsFetching({ queryKey: ['mail', 'messages'] }) > 0
  return (
    <div className="flex min-h-14 items-center gap-2 border-b px-4 py-2">
      {/* На телефоне и планшете папка выбирается здесь */}
      <div className="min-w-0 flex-1 lg:hidden">
        <Select value={folder} onValueChange={onFolder}>
          <SelectTrigger className="h-10 w-full border-0 bg-transparent px-0 text-lg font-semibold shadow-none" aria-label={tr('Папка')}>
            <SelectValue placeholder={title} />
          </SelectTrigger>
          <SelectContent>
            {(folders ?? []).map((f) => (
              <SelectItem key={f.id} value={f.well_known ?? f.id}>
                {folderLabel(f)}
                {f.unread > 0 ? ` (${f.unread})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="hidden min-w-0 flex-1 lg:block">
        <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>
        {unread > 0 && <p className="text-xs font-medium text-mail-ink">{tr('Непрочитанных: {{n}}', { n: unread })}</p>}
      </div>
      <IconButton label={tr('Обновить')} onClick={() => void queryClient.invalidateQueries({ queryKey: ['mail'] })}>
        <RefreshCw className={cn(fetching && 'animate-spin motion-reduce:animate-none')} />
      </IconButton>
    </div>
  )
}

function SearchBox({ initial, onSearch, children }: { initial: string; onSearch: (text: string) => void; children?: ReactNode }) {
  const [draft, setDraft] = useState(initial)
  function submit(e: FormEvent) {
    e.preventDefault()
    onSearch(draft.trim())
  }
  return (
    <form onSubmit={submit} role="search" className="flex gap-2 p-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tr('Поиск по письмам')}
          aria-label={tr('Поиск по письмам')}
          maxLength={100}
          className="h-10 w-full rounded-md border bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-mail focus-visible:ring-2 focus-visible:ring-mail/25 sm:h-9"
        />
        {(draft || initial) && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              onSearch('')
            }}
            aria-label={tr('Очистить поиск')}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {children}
    </form>
  )
}

const FILTER_ICONS: Record<MailFilter, LucideIcon> = { all: Inbox, unread: Mail, attachments: Paperclip, important: Star, flagged: Flag }

/** Быстрые фильтры — выпадающим списком рядом с поиском (рядом кнопок они не помещались в колонку) */
function FilterMenu({ value, onChange }: { value: MailFilter; onChange: (v: MailFilter) => void }) {
  const on = value !== 'all'
  const Icon = on ? FILTER_ICONS[value] : ListFilter
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${tr('Фильтр писем')}: ${filterLabel(value)}`}
          title={tr('Фильтр писем')}
          className={cn(
            'flex h-10 max-w-[45%] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:h-9',
            on ? 'border-mail bg-mail-soft font-medium text-mail-ink' : 'bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className={cn('truncate', !on && 'max-sm:sr-only')}>{on ? filterLabel(value) : tr('Фильтр')}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr('Показать')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as MailFilter)}>
          {MAIL_FILTERS.map((f) => {
            const FIcon = FILTER_ICONS[f]
            return (
              <DropdownMenuRadioItem key={f} value={f}>
                <FIcon className="size-4 text-muted-foreground" aria-hidden />
                {filterLabel(f)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(currentLocale()) + s.slice(1)
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Группа по дате, как в Outlook: Сегодня · Вчера · Последние 7 дней · Ранее в этом месяце · Октябрь · Сентябрь 2025… */
function dayGroup(iso: string, now: Date): { key: string; label: string } {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days <= 0) return { key: 'today', label: tr('Сегодня') }
  if (days === 1) return { key: 'yesterday', label: tr('Вчера') }
  if (days < 7) return { key: 'week', label: tr('Последние 7 дней') }
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return { key: 'month', label: tr('Ранее в этом месяце') }
  const month = capitalize(new Intl.DateTimeFormat(currentLocale(), { month: 'long' }).format(d))
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.getFullYear() === now.getFullYear() ? month : `${month} ${d.getFullYear()}` }
}

/** Время в строке: сегодня — часы, на этой неделе — день и часы, раньше — дата */
function rowDate(iso: string, now: Date): string {
  const d = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  const loc = currentLocale()
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
  if (days <= 0) return time
  if (days < 7) return `${capitalize(d.toLocaleDateString(loc, { weekday: 'short' }))} ${time}`
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

const who = (a: MailAddress) => a.name || a.address || tr('Без отправителя')

/** Ветка: письма одной переписки в этой папке, сверху — самое свежее */
interface Thread {
  head: MailListItem
  members: MailListItem[]
}

// «Re:», «FW:», «Ynt:», «Отв:»… в начале темы: у ветки показываем тему без них, как Outlook
const REPLY_RE = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|vs|tr|rv|ynt|отв|пересл)\s*(?:\[\d+\])?\s*:\s*)+/i
const topic = (s: string) => s.replace(REPLY_RE, '')

function MessageList({
  folder,
  search,
  filter,
  wide,
  sent,
  selected,
  folderName,
  onOpen,
  onClose,
}: {
  folder: string
  search: string
  filter: MailFilter
  wide: boolean
  sent: boolean
  selected?: string
  folderName: (id: string | null | undefined) => string | null
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const query = useInfiniteQuery(mailMessagesQuery(folder, search, filter))
  const items = useMemo(() => (query.data?.pages.flatMap((p) => p.messages) ?? []).filter((it) => matchesFilter(it, filter)), [query.data, filter])
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage, dataUpdatedAt } = query
  // Свёрнутые дни («Сегодня», «Вчера»…) и раскрытые ветки
  const [closedDays, setClosedDays] = useState<Set<string>>(() => new Set())
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set())
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  // Ветки и группы по дням считаются от момента загрузки списка (обновляется раз в минуту вместе с ним)
  const { now, groups } = useMemo(() => {
    const at = new Date(dataUpdatedAt)
    const threads: Thread[] = []
    const byConversation = new Map<string, Thread>()
    for (const it of items) {
      const t = it.conversation_id ? byConversation.get(it.conversation_id) : undefined
      if (t) {
        t.members.push(it)
        continue
      }
      const fresh: Thread = { head: it, members: [it] }
      threads.push(fresh)
      if (it.conversation_id) byConversation.set(it.conversation_id, fresh)
    }
    const out: { key: string; label: string; threads: Thread[] }[] = []
    for (const t of threads) {
      const g = dayGroup(t.head.received_at, at)
      const last = out[out.length - 1]
      if (last && last.key === g.key) last.threads.push(t)
      else out.push({ ...g, threads: [t] })
    }
    return { now: at, groups: out }
  }, [items, dataUpdatedAt])

  // Подгрузка при прокрутке до конца списка
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // j / k — следующая и предыдущая ветка, Esc — закрыть письмо (как в почтовых программах)
  const heads = useMemo(() => groups.filter((g) => !closedDays.has(g.key)).flatMap((g) => g.threads.map((t) => t.head)), [groups, closedDays])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      if (e.key === 'Escape' && selected) return onClose()
      if (e.key !== 'j' && e.key !== 'k') return
      const i = heads.findIndex((it) => it.id === selected)
      const next = heads[e.key === 'j' ? i + 1 : Math.max(0, i - 1)]
      if (next) {
        e.preventDefault()
        onOpen(next.id)
        document.getElementById(`mail-${next.id}`)?.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [heads, selected, onOpen, onClose])

  if (query.isPending) {
    return (
      <div className="flex flex-col border-t" aria-busy="true" aria-label={tr('Загружаем письма…')}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3 border-b py-3 pl-7 pr-4">
            <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (query.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 border-t p-4 text-sm">
        <p>{mailErrorText(query.error)}</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          {tr('Повторить')}
        </Button>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 border-t px-6 py-12 text-center text-sm text-muted-foreground">
        <Inbox className="size-8" aria-hidden />
        {search ? tr('По запросу ничего не найдено.') : filter !== 'all' ? tr('Таких писем в этой папке нет.') : tr('В этой папке пусто.')}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto border-t [scrollbar-width:thin]">
      {groups.map((g) => {
        const closed = closedDays.has(g.key)
        return (
          <section key={g.key} aria-label={g.label}>
            <h3 className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <button
                type="button"
                onClick={() => setClosedDays((s) => toggle(s, g.key))}
                aria-expanded={!closed}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13px] font-semibold outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', closed && '-rotate-90')} aria-hidden />
                {g.label}
                {closed && <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{g.threads.length}</span>}
              </button>
            </h3>
            {!closed && (
              <ul>
                {g.threads.map((t) => {
                  const key = t.head.conversation_id ?? t.head.id
                  return (
                    <ThreadRow
                      key={t.head.id}
                      thread={t}
                      sent={sent}
                      wide={wide}
                      now={now}
                      selected={selected}
                      open={openThreads.has(key)}
                      onToggle={() => setOpenThreads((s) => toggle(s, key))}
                      folder={folder}
                      folderName={folderName}
                      onOpen={onOpen}
                    />
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
      <div ref={sentinel} className="flex justify-center p-3">
        {query.hasNextPage && (
          <Button type="button" variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? tr('Загружаем…') : tr('Показать ещё')}
          </Button>
        )}
      </div>
    </div>
  )
}

function RowIcons({ it }: { it: MailListItem }) {
  return (
    <>
      {it.meeting === 'request' && <CalendarPlus className="size-3.5 shrink-0 text-mail-ink" aria-label={tr('Приглашение на встречу')} />}
      {it.meeting === 'cancel' && <CalendarX className="size-3.5 shrink-0 text-destructive" aria-label={tr('Встреча отменена')} />}
      {it.has_attachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label={tr('Есть вложения')} />}
      {it.flagged && <Flag className="size-3.5 shrink-0 fill-destructive text-destructive" aria-label={tr('С флажком')} />}
    </>
  )
}

/** Плашки вложений под строкой письма, как в Outlook: значок типа и название */
function FileChips({ files }: { files: { name: string; size: number }[] }) {
  if (files.length === 0) return null
  return (
    <span className="mt-1.5 flex min-w-0 gap-1.5">
      {files.slice(0, 2).map((f, i) => {
        const look = fileLook(f.name)
        return (
          <span key={i} className="inline-flex min-w-0 max-w-[11rem] items-center gap-1.5 rounded border bg-background px-1.5 py-1 text-xs">
            <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm', look.color)}>
              <look.icon className="size-3" aria-hidden />
            </span>
            <span className="truncate">{f.name}</span>
          </span>
        )
      })}
      {files.length > 2 && <span className="self-center text-xs text-muted-foreground">+{files.length - 2}</span>}
    </span>
  )
}

/**
 * Строка ветки: самое свежее письмо, участники через «;», тема без «Re:». Стрелка слева раскрывает всю переписку
 * (из всех папок, вместе с вашими ответами) — каждое письмо отдельной строкой.
 */
function ThreadRow({
  thread,
  sent,
  wide,
  now,
  selected,
  open,
  onToggle,
  folder,
  folderName,
  onOpen,
}: {
  thread: Thread
  sent: boolean
  wide: boolean
  now: Date
  selected?: string
  open: boolean
  onToggle: () => void
  folder: string
  folderName: (id: string | null | undefined) => string | null
  onOpen: (id: string) => void
}) {
  const it = thread.head
  // Писем в переписке по всем папкам (сервер считает вместе с вашими ответами из «Отправленных»).
  // Одно письмо — обычная строка: без стрелки, без счётчика, тема как есть.
  const total = Math.max(thread.members.length, it.thread_count ?? 1)
  const expandable = !!it.conversation_id && total > 1
  const unread = thread.members.some((m) => !m.is_read)
  const people = sent && it.to?.length ? it.to.map(who) : [...new Set(thread.members.map((m) => who(m.from)))]
  const person = people.join('; ')
  const avatarName = sent && it.to?.[0] ? who(it.to[0]) : who(it.from)
  const subject = (expandable ? topic(it.subject) : it.subject) || tr('(без темы)')
  const isSelected = it.id === selected
  const files = thread.members.flatMap((m) => m.files ?? [])

  const bar = (unread || isSelected) && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', isSelected ? 'bg-mail' : 'bg-mail/70')} />
  const rowClass = cn(
    'relative w-full text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    isSelected ? 'bg-mail-soft' : 'hover:bg-muted/60',
  )
  const date = (
    <time dateTime={it.received_at} className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-semibold text-mail-ink' : 'text-muted-foreground', wide && 'lg:w-24 lg:text-right')}>
      {rowDate(it.received_at, now)}
    </time>
  )
  const who_ = (
    <>
      {sent && <span className="font-normal text-muted-foreground">{tr('Кому:')} </span>}
      {person}
    </>
  )

  return (
    <li id={`mail-${it.id}`} className="relative border-b last:border-b-0">
      {expandable && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? tr('Свернуть переписку') : tr('Показать переписку')}
          title={open ? tr('Свернуть переписку') : tr('Показать переписку')}
          className="absolute left-1 top-3.5 z-[1] flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
        >
          <ChevronRight className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
        </button>
      )}

      {/* Колонка (и телефон): три строки с плашками вложений */}
      <button type="button" onClick={() => onOpen(it.id)} aria-current={isSelected ? 'true' : undefined} className={cn(rowClass, 'flex gap-3 py-3 pl-7 pr-4', wide && 'lg:hidden')}>
        {bar}
        <UserAvatar name={avatarName} className="mt-0.5 size-9 text-xs" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-semibold' : 'text-foreground/85')}>{who_}</span>
            <span className="flex shrink-0 items-center gap-1.5 self-center">
              <RowIcons it={it} />
            </span>
          </span>
          <span className="flex items-baseline gap-2">
            {it.important && <AlertCircle className="size-3.5 shrink-0 self-center text-destructive" aria-label={tr('Важное')} />}
            <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold text-mail-ink' : 'text-foreground/85')}>{subject}</span>
            {expandable && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{total}</span>}
            {date}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">{it.preview || ' '}</span>
          <FileChips files={files} />
        </span>
      </button>

      {/* Во всю ширину (письмо не открыто, десктоп): одна строка — отправитель · тема — начало текста · дата */}
      {wide && (
        <button type="button" onClick={() => onOpen(it.id)} className={cn(rowClass, 'hidden h-12 items-center gap-3 pl-8 pr-4 lg:flex')}>
          {bar}
          <UserAvatar name={avatarName} className="size-8 text-[11px]" />
          <span className={cn('w-56 shrink-0 truncate text-sm', unread ? 'font-semibold' : 'text-foreground/85')}>{who_}</span>
          {it.important && <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-label={tr('Важное')} />}
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className={cn(unread ? 'font-semibold text-mail-ink' : 'text-foreground/90')}>{subject}</span>
            {expandable && <span className="text-muted-foreground"> ({total})</span>}
            {it.preview && <span className="text-muted-foreground"> — {it.preview}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <RowIcons it={it} />
          </span>
          {date}
        </button>
      )}

      {open && it.conversation_id && (
        <ThreadMessages conversationId={it.conversation_id} fallback={thread.members} folder={folder} folderName={folderName} now={now} selected={selected} onOpen={onOpen} />
      )}
    </li>
  )
}

/** Письма раскрытой ветки: каждое отдельной строкой, с папкой, если оно не из открытой (например, ваш ответ из «Отправленных») */
function ThreadMessages({
  conversationId,
  fallback,
  folder,
  folderName,
  now,
  selected,
  onOpen,
}: {
  conversationId: string
  fallback: MailListItem[]
  folder: string
  folderName: (id: string | null | undefined) => string | null
  now: Date
  selected?: string
  onOpen: (id: string) => void
}) {
  const { data, isPending, error } = useQuery(mailConversationQuery(conversationId))
  const list = data ?? fallback
  const here = folderName(folder)
  return (
    <ul aria-label={tr('Переписка')} className="border-t bg-muted/25">
      {isPending && <li className="py-1.5 pl-16 text-xs text-muted-foreground">{tr('Загружаем переписку…')}</li>}
      {error && <li className="py-1.5 pl-16 text-xs text-destructive">{mailErrorText(error)}</li>}
      {list.map((m) => {
        const place = m.folder_id ? folderName(m.folder_id) : null
        const isSelected = m.id === selected
        return (
          <li key={m.id} className="border-b border-border/60 last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(m.id)}
              aria-current={isSelected ? 'true' : undefined}
              className={cn(
                'relative flex w-full flex-col gap-0.5 py-2 pl-16 pr-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                isSelected ? 'bg-mail-soft' : 'hover:bg-muted/60',
              )}
            >
              {isSelected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-mail" />}
              <span className="flex items-baseline gap-2">
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', m.is_read ? 'text-foreground/85' : 'font-semibold')}>{who(m.from)}</span>
                <span className="flex shrink-0 items-center gap-1.5 self-center">
                  <RowIcons it={m} />
                </span>
                <time dateTime={m.received_at} className={cn('shrink-0 text-xs tabular-nums', m.is_read ? 'text-muted-foreground' : 'font-semibold text-mail-ink')}>
                  {rowDate(m.received_at, now)}
                </time>
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {place && place !== here && <span className="mr-1.5 rounded bg-muted px-1 py-px font-medium text-foreground/70">{place}</span>}
                {m.preview || topic(m.subject) || tr('(без темы)')}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Письмо
// ---------------------------------------------------------------------------
const full = (a: MailAddress) => (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address)
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ${tr('КБ')}` : `${(n / 1024 / 1024).toFixed(1)} ${tr('МБ')}`)

function fileLook(name: string): { icon: LucideIcon; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return { icon: FileText, color: 'text-red-600 bg-red-500/10 dark:text-red-400' }
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { icon: FileSpreadsheet, color: 'text-green-700 bg-green-600/10 dark:text-green-400' }
  if (['doc', 'docx', 'rtf', 'txt'].includes(ext)) return { icon: FileText, color: 'text-blue-700 bg-blue-600/10 dark:text-blue-400' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff'].includes(ext)) return { icon: FileImage, color: 'text-violet-700 bg-violet-600/10 dark:text-violet-400' }
  if (['zip', 'rar', '7z'].includes(ext)) return { icon: FileArchive, color: 'text-amber-700 bg-amber-500/10 dark:text-amber-400' }
  return { icon: Paperclip, color: 'text-muted-foreground bg-muted' }
}

function Reader({
  id,
  wide,
  onWide,
  onClose,
  folderName,
  focus,
  inTrash,
  neighbour,
  onDeleted,
}: {
  id: string
  wide: boolean
  onWide: () => void
  onClose: () => void
  folderName: (id: string | null | undefined) => string | null
  /** Письмо переписки, к которому прокрутить (выбрано в списке) */
  focus: { id: string; n: number } | null
  /** Открыта папка «Удалённые»: удаление окончательное, нужно подтверждение */
  inTrash: boolean
  /** Следующее письмо списка (откроется после удаления) */
  neighbour: (id: string) => string | undefined
  onDeleted: (next: string | undefined) => void
}) {
  const { data: msg, isPending, error, refetch } = useQuery(mailMessageQuery(id))

  // Приглашение уже разложено в личный календарь функцией — обновляем календарь на сайте
  const queryClient = useQueryClient()
  const meetingItem = msg?.meeting?.item_id ?? null
  useEffect(() => {
    if (msg?.meeting) void queryClient.invalidateQueries({ queryKey: ['personal'] })
  }, [msg?.meeting, meetingItem, queryClient])

  const [acting, setActing] = useState<'read' | 'delete' | null>(null)
  // Второе нажатие «Удалить навсегда» в течение 3 секунд подтверждает удаление из «Удалённых»
  const [armed, setArmed] = useState(false)

  const refreshCounts = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', 'unread'] })
  }

  const needWrite = () =>
    toast.error(mailErrorText(new MailError('write_not_granted')), {
      action: { label: tr('Переподключить'), onClick: () => void mailReconnect().catch((e) => toast.error(mailErrorText(e))) },
    })

  async function setRead(read: boolean, quiet = false) {
    if (!msg) return
    if (!msg.can_write) return quiet ? undefined : needWrite()
    setActing('read')
    try {
      await mailMarkRead(id, read)
      queryClient.setQueryData(mailMessageQuery(id).queryKey, (old) => (old ? { ...old, is_read: read } : old))
      patchMailLists(queryClient, id, (m) => ({ ...m, is_read: read }))
      refreshCounts()
      // уведомление о письме в колокольчике тоже прочитано
      if (read) {
        await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('group_key', `mail:${id}`).is('read_at', null)
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }
    } catch (e) {
      if (!quiet) toast.error(mailErrorText(e))
    } finally {
      setActing(null)
    }
  }

  // Открыли непрочитанное — отмечаем прочитанным в Outlook (как сам Outlook), один раз на письмо
  const autoRead = useRef(false)
  useEffect(() => {
    if (!msg || msg.is_read || !msg.can_write || autoRead.current) return
    autoRead.current = true
    void setRead(true, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg])

  async function remove() {
    if (!msg || acting) return
    if (!msg.can_write) return needWrite()
    if (inTrash && !armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 3000)
      return
    }
    setActing('delete')
    const next = neighbour(id)
    try {
      const r = await mailDelete(id)
      patchMailLists(queryClient, id, () => null)
      refreshCounts()
      onDeleted(next)
      if (!r.permanent && r.id && r.from_folder) {
        const movedId = r.id
        const back = r.from_folder
        toast.success(tr('Письмо перемещено в «Удалённые»'), {
          action: {
            label: tr('Отменить'),
            onClick: () =>
              void mailMove(movedId, back)
                .then(() => {
                  void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] })
                  refreshCounts()
                })
                .catch((e) => toast.error(mailErrorText(e))),
          },
        })
      } else {
        toast.success(tr('Письмо удалено окончательно'))
      }
    } catch (e) {
      toast.error(mailErrorText(e))
      setActing(null)
    }
  }

  // Delete — удалить открытое письмо (не в поле ввода)
  const removeRef = useRef(remove)
  removeRef.current = remove
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Delete' || e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      e.preventDefault()
      void removeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Панель действий */}
      <div className="flex min-h-12 items-center gap-1 border-b px-2 py-1.5 sm:px-3">
        <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden">
          <ArrowLeft />
          {tr('К списку')}
        </Button>
        {msg?.web_link && (
          <>
            <Button asChild size="sm" variant="ghost" className="max-sm:px-2">
              <a href={msg.web_link} target="_blank" rel="noopener noreferrer" title={tr('Ответить можно в Outlook: откроется в новой вкладке')}>
                <Reply />
                <span className="max-sm:sr-only">{tr('Ответить в Outlook')}</span>
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost" className="max-sm:px-2">
              <a href={msg.web_link} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                <span className="max-sm:sr-only">{tr('Открыть в Outlook')}</span>
              </a>
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center">
          {msg && (
            <>
              <IconButton
                label={msg.is_read ? tr('Отметить как непрочитанное') : tr('Отметить как прочитанное')}
                onClick={() => void setRead(!msg.is_read)}
                className={cn(acting === 'read' && 'pointer-events-none opacity-60')}
              >
                {msg.is_read ? <Mail /> : <MailOpen />}
              </IconButton>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={acting === 'delete'}
                title={inTrash ? tr('Удалить навсегда (Delete)') : tr('Удалить (Delete)')}
                aria-label={inTrash ? tr('Удалить навсегда') : tr('Удалить')}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&_svg]:size-4',
                  armed ? 'bg-destructive text-white' : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
                )}
              >
                <Trash2 />
                <span className={cn(!armed && 'max-sm:sr-only')}>{armed ? tr('Точно удалить?') : inTrash ? tr('Удалить навсегда') : tr('Удалить')}</span>
              </button>
              <span aria-hidden className="mx-1 hidden h-5 w-px bg-border lg:block" />
            </>
          )}
          <IconButton label={wide ? tr('Показать список') : tr('Во весь экран')} onClick={onWide} className="hidden lg:flex">
            {wide ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
          <IconButton label={tr('Закрыть письмо')} onClick={onClose} className="hidden lg:flex">
            <X />
          </IconButton>
        </div>
      </div>

      {isPending && (
        <div className="flex flex-col gap-3 p-6" aria-busy="true" aria-label={tr('Открываем письмо…')}>
          <div className="h-6 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="flex gap-3">
            <div className="size-10 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          </div>
          <div className="mt-4 h-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
          <p>{mailErrorText(error)}</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {tr('Повторить')}
          </Button>
        </div>
      )}
      {msg && (
        <article className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          <div className={cn('mx-auto flex w-full flex-col gap-4 px-4 py-5 sm:px-6', wide ? 'max-w-5xl' : 'max-w-4xl')}>
            <h2 className="break-words text-xl font-semibold leading-snug">
              {msg.important && <AlertCircle className="mr-1.5 inline size-5 -translate-y-0.5 text-destructive" aria-label={tr('Важное')} />}
              {msg.subject || tr('(без темы)')}
            </h2>

            {msg.meeting && <MeetingCard meeting={msg.meeting} />}

            {msg.thread.length > 1 ? (
              <ThreadView msg={msg} folderName={folderName} focus={focus} />
            ) : (
              <>
                <SenderHeader item={msg} />
                {msg.attachments.length > 0 && <AttachmentGrid messageId={msg.id} attachments={msg.attachments} />}
                <div className="border-t pt-4">
                  <MailBody html={msg.body_type === 'html' ? msg.body : null} text={msg.body} />
                </div>
              </>
            )}
          </div>
        </article>
      )}
    </div>
  )
}

/**
 * Правка письма во всех загруженных списках (папки, поиск, фильтры, раскрытые ветки) без перезагрузки:
 * fn возвращает новое письмо или null — убрать из списка.
 */
function patchMailLists(queryClient: QueryClient, id: string, fn: (m: MailListItem) => MailListItem | null) {
  const apply = (list: MailListItem[]) => list.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m]))
  queryClient.setQueriesData<InfiniteData<{ messages: MailListItem[]; next: string | null }> | MailListItem[]>({ queryKey: ['mail', 'messages'] }, (old) => {
    if (!old) return old
    if (Array.isArray(old)) return apply(old)
    return { ...old, pages: old.pages.map((p) => ({ ...p, messages: apply(p.messages) })) }
  })
}

const longDate = (iso: string) => new Date(iso).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })

/** Кто, кому, когда — шапка письма (у одиночного письма и у каждого блока переписки) */
function SenderHeader({ item, compact = false, aside }: { item: MailThreadItem | MailMessage; compact?: boolean; aside?: ReactNode }) {
  const [details, setDetails] = useState(false)
  const recipients = [...item.to, ...item.cc]
  const shown = (item.to.length ? item.to : item.cc).slice(0, 3)
  const sender = useKnownPerson(item.from.address)
  // Имена — с карточкой человека при наведении (в CONMAX — его профиль, иначе адрес и компания по домену)
  const names = (list: MailAddress[]) =>
    list.map((a, i) => (
      <Fragment key={`${a.address}-${i}`}>
        {i > 0 && ', '}
        <PersonCard person={a}>{who(a)}</PersonCard>
      </Fragment>
    ))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <UserAvatar name={sender?.full_name || who(item.from)} path={sender?.avatar_path} className={compact ? 'size-9 text-xs' : 'size-10 text-sm'} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <PersonCard person={item.from} className="font-semibold">
              {who(item.from)}
            </PersonCard>
            {item.from.address && item.from.address !== item.from.name && <span className="break-all text-sm text-muted-foreground">&lt;{item.from.address}&gt;</span>}
            {aside}
          </p>
          {recipients.length > 0 && (
            <div className="flex max-w-full items-center gap-1 text-sm text-muted-foreground">
              <span className="min-w-0 truncate">
                {tr('Кому:')} {names(shown)}
                {recipients.length > shown.length ? ` +${recipients.length - shown.length}` : ''}
              </span>
              <button
                type="button"
                onClick={() => setDetails((v) => !v)}
                aria-expanded={details}
                aria-label={details ? tr('Скрыть получателей') : tr('Все получатели')}
                title={details ? tr('Скрыть получателей') : tr('Все получатели')}
                className="flex size-6 shrink-0 items-center justify-center rounded outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className={cn('size-3.5 transition-transform motion-reduce:transition-none', details && 'rotate-90')} />
              </button>
            </div>
          )}
        </div>
        <time dateTime={item.received_at} className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground sm:text-sm">
          {longDate(item.received_at)}
        </time>
      </div>
      {details && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-sm">
          <dt className="text-muted-foreground">{tr('От')}</dt>
          <dd className="break-words">
            <PersonCard person={item.from}>{full(item.from) || who(item.from)}</PersonCard>
          </dd>
          {item.to.length > 0 && (
            <>
              <dt className="text-muted-foreground">{tr('Кому')}</dt>
              <dd className="break-words">{names(item.to)}</dd>
            </>
          )}
          {item.cc.length > 0 && (
            <>
              <dt className="text-muted-foreground">{tr('Копия')}</dt>
              <dd className="break-words">{names(item.cc)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{tr('Дата')}</dt>
          <dd>{new Date(item.received_at).toLocaleString(currentLocale(), { dateStyle: 'long', timeStyle: 'short' })}</dd>
        </dl>
      )}
    </div>
  )
}

/** Вложения письма карточками; скачиваются через функцию (токен Microsoft в браузер не попадает) */
function AttachmentGrid({ messageId, attachments }: { messageId: string; attachments: MailAttachment[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  async function download(a: MailAttachment) {
    setBusy(a.id)
    try {
      await downloadAttachment(messageId, a)
    } catch (e) {
      toast.error(mailErrorText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-label={tr('Вложения')} className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Paperclip className="size-3.5" aria-hidden />
        {tr('Вложений: {{n}}', { n: attachments.length })}
      </p>
      <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {attachments.map((a) => {
          const look = fileLook(a.name)
          return (
            <li key={a.id}>
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => void download(a)}
                title={tr('Скачать')}
                className="group flex w-full items-center gap-3 rounded-lg border bg-background p-2.5 text-left outline-none transition-colors hover:border-mail/50 hover:bg-mail-soft/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', look.color)}>
                  <look.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">{busy === a.id ? tr('Скачиваем…') : size(a.size)}</span>
                </span>
                <Download className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-mail-ink" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Начало текста письма для свёрнутого блока */
const plainPreview = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)

/**
 * Переписка в письме: вместо одного длинного письма с цитатами — отдельный блок на каждое письмо (открытое и все более ранние),
 * сверху самое новое. В блоке только собственный текст письма (без цитаты предыдущих). Старые блоки свёрнуты — по щелчку раскрываются.
 */
function ThreadView({
  msg,
  folderName,
  focus,
}: {
  msg: MailMessage
  folderName: (id: string | null | undefined) => string | null
  focus: { id: string; n: number } | null
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(msg.thread.slice(0, 3).map((t) => t.id)))
  const [whole, setWhole] = useState(false)

  // Выбрали в списке более раннее письмо этой переписки — плавно прокручиваем к его блоку (он раскрывается сам)
  const focusId = focus?.id ?? null
  const focusN = focus?.n ?? 0
  // Сразу и ещё дважды: тексты писем выше догружаются и меняют высоту, блок съезжает — выравниваем снова
  useEffect(() => {
    if (!focusId) return
    const go = () => document.getElementById(`thread-${focusId}`)?.scrollIntoView({ block: 'start' })
    const raf = requestAnimationFrame(go)
    const t1 = window.setTimeout(go, 350)
    const t2 = window.setTimeout(go, 1200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [focusId, focusN])
  const toggle = (tid: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(tid)) next.delete(tid)
      else next.add(tid)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">{tr('Писем в переписке: {{n}}', { n: msg.thread.length })}</p>
      {msg.thread.map((t, i) => {
        const isOpen = open.has(t.id) || t.id === focusId
        const current = i === 0
        // подсвечено письмо, выбранное в списке; по умолчанию — открытое (верхнее)
        const marked = focusId ? t.id === focusId : current
        // папку подписываем, только если письмо не из той же папки, что открытое (например, ваш ответ из «Отправленных»)
        const where = folderName(t.folder_id)
        const place = where && where !== folderName(msg.thread[0]?.folder_id) ? where : null
        const empty = !plainPreview(t.body)
        return (
          <section
            key={t.id}
            id={`thread-${t.id}`}
            aria-label={who(t.from)}
            className={cn('scroll-mt-3 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow', marked && 'border-mail ring-2 ring-mail/30')}
          >
            {isOpen ? (
              <div className="flex flex-col gap-4 p-3 sm:p-4">
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <SenderHeader
                      item={t}
                      compact
                      aside={place && <span className="rounded bg-muted px-1.5 py-px text-xs font-medium text-foreground/70">{place}</span>}
                    />
                  </div>
                  {!current && t.id !== focusId && (
                    <IconButton label={tr('Свернуть письмо')} onClick={() => toggle(t.id)} className="-mr-1 -mt-1 size-8">
                      <ChevronDown className="rotate-180" />
                    </IconButton>
                  )}
                </div>
                {t.attachments.length > 0 && <AttachmentGrid messageId={t.id} attachments={t.attachments} />}
                {current && whole ? (
                  <MailBody html={msg.body_type === 'html' ? msg.body : null} text={msg.body} />
                ) : empty && current ? (
                  <MailBody html={msg.body_type === 'html' ? msg.body : null} text={msg.body} />
                ) : empty ? (
                  <p className="text-sm text-muted-foreground">{tr('В письме нет своего текста.')}</p>
                ) : (
                  <MailBody html={t.body_type === 'html' ? t.body : null} text={t.body} />
                )}
                {current && !empty && (
                  <button
                    type="button"
                    onClick={() => setWhole((v) => !v)}
                    className="self-start rounded text-xs font-medium text-mail-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {whole ? tr('Показать только это письмо') : tr('Показать письмо целиком, с цитатами')}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => toggle(t.id)}
                aria-expanded={false}
                className="flex w-full items-start gap-3 p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
              >
                <UserAvatar name={who(t.from)} className="size-9 text-xs" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">{who(t.from)}</span>
                    {place && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-xs font-medium text-foreground/70">{place}</span>}
                    {t.attachments.length > 0 && <Paperclip className="size-3.5 shrink-0 self-center text-muted-foreground" aria-label={tr('Есть вложения')} />}
                    <time dateTime={t.received_at} className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {longDate(t.received_at)}
                    </time>
                  </span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{plainPreview(t.body) || tr('В письме нет своего текста.')}</span>
                </span>
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Приглашение на встречу: когда, где, кто зовёт — и что встреча уже в личном календаре (или убрана после отмены). */
function MeetingCard({ meeting }: { meeting: MailMeeting }) {
  const loc = currentLocale()
  const start = new Date(meeting.start)
  const day = capitalize(start.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' }))
  const time = meeting.all_day
    ? tr('Весь день')
    : [start, meeting.end ? new Date(meeting.end) : null]
        .filter((d): d is Date => !!d)
        .map((d) => d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }))
        .join(' – ')
  const cancelled = meeting.kind === 'cancel'
  const added = !cancelled && !!meeting.item_id

  return (
    <section
      aria-label={cancelled ? tr('Встреча отменена') : tr('Приглашение на встречу')}
      className={cn('flex gap-3 rounded-lg border p-3 sm:p-4', cancelled ? 'border-destructive/30 bg-destructive/5' : 'border-mail/30 bg-mail-soft/60')}
    >
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', cancelled ? 'bg-destructive/10 text-destructive' : 'bg-mail text-mail-foreground')}>
        {cancelled ? <CalendarX className="size-5" aria-hidden /> : <CalendarCheck className="size-5" aria-hidden />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn('text-sm font-semibold', cancelled ? 'text-destructive' : 'text-mail-ink')}>
          {cancelled
            ? tr('Встреча отменена — убрана из вашего календаря')
            : added
              ? meeting.repeats > 1
                ? tr('Добавлено в ваш календарь: встреч — {{n}}', { n: meeting.repeats })
                : tr('Добавлено в ваш календарь')
              : tr('Встреча уже прошла')}
        </p>
        <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm', cancelled && 'line-through decoration-destructive/50')}>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted-foreground" aria-hidden />
            {day}, {time}
          </span>
          {meeting.location && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{meeting.location}</span>
            </span>
          )}
        </p>
        {meeting.organizer && <p className="text-xs text-muted-foreground">{tr('Организатор: {{name}}', { name: meeting.organizer })}</p>}
      </div>
      {added && meeting.event_date && (
        <Button asChild size="sm" variant="outline" className="shrink-0 self-center bg-background">
          <Link to="/personal" search={{ tab: 'calendar', item: meeting.item_id!, d: meeting.event_date }}>
            <CalendarPlus />
            <span className="max-sm:sr-only">{tr('В календаре')}</span>
          </Link>
        </Button>
      )}
    </section>
  )
}
