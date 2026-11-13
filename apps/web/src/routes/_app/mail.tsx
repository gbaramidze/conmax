import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Download, ExternalLink, Folder, Inbox, Mail, Paperclip, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import {
  downloadAttachment,
  folderLabel,
  mailAccountQuery,
  mailConnect,
  mailErrorText,
  mailFoldersQuery,
  mailMessageQuery,
  mailMessagesQuery,
  type MailAddress,
  type MailAttachment,
  type MailFolder,
  type MailListItem,
} from '@/features/mail/api'
import { MailBody } from '@/features/mail/mail-body'

export const Route = createFileRoute('/_app/mail')({
  validateSearch: z.object({
    folder: z.string().optional().catch(undefined),
    m: z.string().optional().catch(undefined),
    q: z.string().optional().catch(undefined),
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
  if (isPending) return <p className="text-sm text-muted-foreground">{tr('Загружаем почту…')}</p>
  if (!account) return <NotConnected />
  return <Mailbox email={account.email} />
}

// ---------------------------------------------------------------------------
// Подключение
// ---------------------------------------------------------------------------
function NotConnected() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 rounded-lg border bg-card p-5 shadow-soft">
      <Mail className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">{tr('Почта не подключена')}</h1>
      <p className="text-sm text-muted-foreground">{tr('Подключите рабочий Outlook в профиле: письма появятся здесь. Видите их только вы.')}</p>
      <Button asChild>
        <Link to="/profile">{tr('Перейти в профиль')}</Link>
      </Button>
    </div>
  )
}

/** Microsoft вернул пользователя с кодом: меняем его на токены (код одноразовый, поэтому только один раз). */
function Callback({ code, state, error, description }: { code?: string; state?: string; error?: string; description?: string }) {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const started = useRef(false)
  const [failure, setFailure] = useState<string | null>(() => {
    if (!error) return null
    // 65001 / consent_required: администратор организации не разрешил приложению читать почту
    if (/AADSTS(65001|90094|90095|650056|650051)|consent|admin/i.test(`${error} ${description ?? ''}`)) {
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
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 rounded-lg border bg-card p-5 shadow-soft">
      {failure ? (
        <>
          <TriangleAlert className="size-6 text-destructive" aria-hidden />
          <h1 className="text-xl font-semibold">{tr('Не удалось подключить почту')}</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {failure}
          </p>
          <Button asChild>
            <Link to="/profile">{tr('Вернуться в профиль')}</Link>
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {tr('Подключаем Outlook…')}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ящик: папки · список · письмо
// ---------------------------------------------------------------------------
function Mailbox({ email }: { email: string }) {
  const { folder: folderParam, m, q } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const folders = useQuery(mailFoldersQuery)
  // Системные папки Graph принимает по имени (inbox, sentitems…): так список не запрашивается дважды, пока грузятся папки
  const folder = folderParam ?? 'inbox'
  const keyOf = (f: MailFolder) => f.well_known ?? f.id
  const [draft, setDraft] = useState(q ?? '')

  const go = (next: { folder?: string; m?: string; q?: string }) => void navigate({ to: '/mail', search: { folder: next.folder ?? folder, m: next.m, q: next.q } })

  function submit(e: FormEvent) {
    e.preventDefault()
    go({ q: draft.trim() || undefined })
  }

  // Письма и папки читаются «вживую»: если доступ отозван, показываем это одним сообщением
  const authError = folders.error
  if (authError) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 rounded-lg border bg-card p-5 shadow-soft">
        <TriangleAlert className="size-6 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">{tr('Почта недоступна')}</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {mailErrorText(authError)}
        </p>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/profile">{tr('Открыть профиль')}</Link>
          </Button>
          <Button variant="outline" onClick={() => void folders.refetch()}>
            {tr('Повторить')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className={m ? 'max-lg:hidden' : ''}>
          <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Почта')}</h1>
          <p className="break-all text-sm text-muted-foreground">{email}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className={m ? 'max-lg:hidden' : ''}
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['mail'] })}
        >
          <RefreshCw />
          {tr('Обновить')}
        </Button>
      </div>

      <div className="grid min-h-0 gap-3 lg:h-[calc(100svh-11rem)] lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,22rem)_minmax(0,1fr)]">
        {/* Папки: колонкой от 1280 px, ниже — выпадающим списком над письмами */}
        <nav aria-label={tr('Папки')} className="hidden min-h-0 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-card p-2 shadow-soft xl:flex">
          {folders.isPending && <p className="p-2 text-sm text-muted-foreground">{tr('Загружаем…')}</p>}
          {(folders.data ?? []).map((f) => (
            <FolderRow key={f.id} f={f} active={keyOf(f) === folder} onOpen={() => go({ folder: keyOf(f) })} />
          ))}
        </nav>

        {/* Список */}
        <section aria-label={tr('Письма')} className={`min-h-0 flex-col gap-2 ${m ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex gap-2 xl:hidden">
            <Select value={folder} onValueChange={(v) => go({ folder: v })}>
              <SelectTrigger className="w-full" aria-label={tr('Папка')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(folders.data ?? []).map((f) => (
                  <SelectItem key={f.id} value={keyOf(f)}>
                    {folderLabel(f)}
                    {f.unread > 0 ? ` (${f.unread})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <form onSubmit={submit} role="search" className="flex gap-2">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr('Поиск по письмам')} aria-label={tr('Поиск по письмам')} maxLength={100} />
            <Button type="submit" size="icon" variant="secondary" aria-label={tr('Искать')}>
              <Search />
            </Button>
          </form>
          <MessageList folder={folder} search={q ?? ''} selected={m} onOpen={(id) => go({ m: id, q })} />
        </section>

        {/* Письмо */}
        <section aria-label={tr('Письмо')} className={`min-h-0 flex-col rounded-lg border bg-card shadow-soft ${m ? 'flex' : 'hidden lg:flex'}`}>
          {m ? (
            <Reader id={m} onBack={() => go({ m: undefined, q })} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Inbox className="size-8" aria-hidden />
              {tr('Выберите письмо слева')}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function FolderRow({ f, active, onOpen }: { f: MailFolder; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-primary/10 font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {f.well_known === 'inbox' ? <Inbox className="size-4 shrink-0" aria-hidden /> : <Folder className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{folderLabel(f)}</span>
      {f.unread > 0 && <span className="rounded-full bg-signal px-1.5 text-xs font-medium text-signal-foreground">{f.unread}</span>}
    </button>
  )
}

const shortDate = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', ...(d.getFullYear() === today.getFullYear() ? {} : { year: '2-digit' }) })
}
const who = (a: MailAddress) => a.name || a.address || tr('Без отправителя')

function MessageList({ folder, search, selected, onOpen }: { folder: string; search: string; selected?: string; onOpen: (id: string) => void }) {
  const query = useInfiniteQuery(mailMessagesQuery(folder, search))
  const items: MailListItem[] = query.data?.pages.flatMap((p) => p.messages) ?? []

  if (query.isPending) return <p className="p-2 text-sm text-muted-foreground">{tr('Загружаем письма…')}</p>
  if (query.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-sm shadow-soft">
        <p>{mailErrorText(query.error)}</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          {tr('Повторить')}
        </Button>
      </div>
    )
  }
  if (items.length === 0) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{search ? tr('По запросу ничего не найдено.') : tr('В этой папке пусто.')}</div>
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpen(it.id)}
              aria-current={it.id === selected ? 'true' : undefined}
              className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                it.id === selected ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm ${it.is_read ? '' : 'font-semibold'}`}>{who(it.from)}</span>
                {it.has_attachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label={tr('Есть вложения')} />}
                <time dateTime={it.received_at} className="shrink-0 text-xs text-muted-foreground">
                  {shortDate(it.received_at)}
                </time>
              </span>
              <span className={`truncate text-sm ${it.is_read ? 'text-muted-foreground' : 'font-medium'}`}>
                {!it.is_read && <span className="mr-1.5 inline-block size-2 rounded-full bg-signal align-middle" role="img" aria-label={tr('Не прочитано')} />}
                {it.subject || tr('(без темы)')}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">{it.preview}</span>
            </button>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button type="button" variant="outline" className="h-11 w-full sm:h-9 sm:w-auto sm:self-center" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? tr('Загружаем…') : tr('Показать ещё')}
        </Button>
      )}
    </div>
  )
}

const people = (list: MailAddress[]) => list.map((a) => (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address)).join(', ')
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ${tr('КБ')}` : `${(n / 1024 / 1024).toFixed(1)} ${tr('МБ')}`)

function Reader({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: msg, isPending, error, refetch } = useQuery(mailMessageQuery(id))
  const [busy, setBusy] = useState<string | null>(null)

  async function download(a: MailAttachment) {
    setBusy(a.id)
    try {
      await downloadAttachment(id, a)
    } catch (e) {
      toast.error(mailErrorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {tr('К списку')}
        </Button>
      </div>
      {isPending && <p className="p-4 text-sm text-muted-foreground">{tr('Открываем письмо…')}</p>}
      {error && (
        <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
          <p>{mailErrorText(error)}</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {tr('Повторить')}
          </Button>
        </div>
      )}
      {msg && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <header className="flex flex-col gap-1.5 border-b pb-3">
            <h2 className="break-words text-lg font-semibold leading-snug">{msg.subject || tr('(без темы)')}</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">{tr('От')}</dt>
              <dd className="break-words">{people([msg.from])}</dd>
              {msg.to.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{tr('Кому')}</dt>
                  <dd className="break-words">{people(msg.to)}</dd>
                </>
              )}
              {msg.cc.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{tr('Копия')}</dt>
                  <dd className="break-words">{people(msg.cc)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{tr('Дата')}</dt>
              <dd>{new Date(msg.received_at).toLocaleString(currentLocale(), { dateStyle: 'long', timeStyle: 'short' })}</dd>
            </dl>
            {msg.web_link && (
              <div>
                <Button asChild size="sm" variant="outline">
                  <a href={msg.web_link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    {tr('Открыть в Outlook')}
                  </a>
                </Button>
              </div>
            )}
          </header>
          {msg.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={tr('Вложения')}>
              {msg.attachments.map((a) => (
                <li key={a.id}>
                  <Button type="button" size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void download(a)} className="max-w-full">
                    <Download />
                    <span className="truncate">{a.name}</span>
                    <span className="text-muted-foreground">{size(a.size)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <MailBody html={msg.body_type === 'html' ? msg.body : null} text={msg.body} />
        </div>
      )}
    </div>
  )
}
