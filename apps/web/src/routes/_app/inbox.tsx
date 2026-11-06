import { tr, trData } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useShowMore } from '@/components/show-more'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Archive, Check, CheckCheck, Clock, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  archive,
  CATEGORY_LABELS,
  markAllRead,
  markRead,
  NOTIFICATION_TAB_LABELS,
  NOTIFICATION_TABS,
  notificationCountsQuery,
  notificationsQuery,
  snooze,
  snoozeOptions,
  type NotificationRow,
  type NotificationTab,
} from '@/features/notifications/api'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

// Паттерн «Inbox»: очередь, упорядоченная по времени, вкладки по смыслу
export const Route = createFileRoute('/_app/inbox')({
  validateSearch: z.object({ tab: z.enum(NOTIFICATION_TABS).catch('all') }),
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([queryClient.ensureQueryData(notificationsQuery(deps.tab)), queryClient.ensureQueryData(notificationCountsQuery)]),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем уведомления…')}</p>,
  component: InboxPage,
})

const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' })
function ago(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

function InboxPage() {
  const { tab } = Route.useSearch()
  const queryClient = useQueryClient()
  const { data: items } = useSuspenseQuery(notificationsQuery(tab))
  const { shown, more } = useShowMore(items, 30, tab)
  const { data: counts } = useQuery(notificationCountsQuery)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const readAll = useMutation({
    mutationFn: () => markAllRead(tab),
    onSuccess: refresh,
    onError: () => toast.error(tr('Не удалось отметить прочитанным. Попробуйте ещё раз.')),
  })

  const unreadHere = items.filter((n) => !n.read_at).length

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Уведомления')}</h1>
          <p className="text-sm text-muted-foreground">
            {unreadHere > 0 ? tr('Непрочитанных: {{unreadHere}}', { unreadHere }) : tr('Всё прочитано')}
          </p>
        </div>
        {tab !== 'snoozed' && (
          <Button size="sm" variant="outline" disabled={unreadHere === 0 || readAll.isPending} onClick={() => readAll.mutate()}>
            <CheckCheck />{tr('Прочитать всё')}</Button>
        )}
      </div>

      <nav
        aria-label={tr('Вкладки уведомлений')}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {NOTIFICATION_TABS.map((t) => {
          const n = counts?.[t] ?? 0
          const active = tab === t
          return (
            <Link
              key={t}
              to="/inbox"
              search={{ tab: t }}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm transition-colors md:min-h-8 md:px-3 ${
                active ? 'border-primary bg-primary font-medium text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {NOTIFICATION_TAB_LABELS[t]}
              {n > 0 && (
                <span className={`rounded-full px-1.5 text-xs ${active ? 'bg-signal text-signal-foreground' : 'bg-muted text-foreground'}`}>
                  {n}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {items.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {tab === 'snoozed'
            ? tr('Отложенных уведомлений нет.')
            : tr('Здесь пока тихо. Уведомления появятся, когда вас назначат на задачу или упомянут в комментарии.')}
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
          {shown.map((n) => (
            <NotificationItem key={n.id} n={n} tab={tab} onChanged={refresh} />
          ))}
        </ul>
      )}
      {more}
    </div>
  )
}

function NotificationItem({ n, tab, onChanged }: { n: NotificationRow; tab: NotificationTab; onChanged: () => void }) {
  const navigate = useNavigate()
  const unread = !n.read_at
  const run = (action: Promise<void>, error: string) => action.then(onChanged).catch(() => toast.error(error))

  async function open() {
    if (unread) await markRead([n.id]).then(onChanged).catch(() => undefined)
    if (n.payload.link) {
      const u = new URL(n.payload.link, window.location.origin)
      await navigate({ to: u.pathname as never, search: Object.fromEntries(u.searchParams) as never })
      return
    }
    const code = n.payload.project_code
    if (!code) return
    if (n.entity_type === 'document' && n.entity_id) {
      await navigate({ to: '/projects/$code/document/$id', params: { code, id: n.entity_id } })
    } else if (n.entity_type === 'meeting' && n.entity_id) {
      await navigate({ to: '/projects/$code/meeting/$id', params: { code, id: n.entity_id } })
    } else if (n.entity_type === 'signal' && n.entity_id) {
      await navigate({ to: '/projects/$code/signals', params: { code }, search: { s: n.entity_id } })
    } else if (n.entity_type === 'task' && n.payload.entity_key) {
      await navigate({ to: '/projects/$code/tasks/$key', params: { code, key: n.payload.entity_key }, search: DEFAULT_TASK_SEARCH })
    } else {
      await navigate({ to: '/projects/$code', params: { code } })
    }
  }

  const snoozeItems = snoozeOptions()

  return (
    <li className={`flex items-start gap-3 p-4 ${unread ? 'bg-signal/[0.06]' : ''}`}>
      <span
        role="img"
        aria-label={unread ? tr('Не прочитано') : tr('Прочитано')}
        className={`mt-1.5 size-2.5 shrink-0 rounded-full ${unread ? 'bg-signal ring-2 ring-signal/30' : 'bg-transparent'}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button type="button" onClick={() => void open()} className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={`block text-sm ${unread ? 'font-semibold' : 'font-medium'}`}>{trData(n.title)}</span>
          {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{trData(n.body)}</span>}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <time dateTime={n.updated_at}>{ago(n.updated_at)}</time>
          <span>{CATEGORY_LABELS[n.category]}</span>
          {n.payload.project_code && <span className="ident">{n.payload.project_code}</span>}
          {n.snoozed_until && tab === 'snoozed' && (
            <span>{tr('вернётся')}{' '}{new Date(n.snoozed_until).toLocaleString(currentLocale(), { dateStyle: 'short', timeStyle: 'short' })}</span>
          )}
        </div>
      </div>

      {/* Десктоп: быстрые действия */}
      <div className="hidden shrink-0 gap-1 md:flex">
        {unread && (
          <Button size="icon" variant="ghost" aria-label={tr('Отметить прочитанным')} title={tr('Отметить прочитанным')} onClick={() => void run(markRead([n.id]), tr('Не удалось отметить.'))}>
            <Check />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={tr('Отложить')} title={tr('Отложить')}>
              <Clock />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {snoozeItems.map((o) => (
              <DropdownMenuItem key={o.label} onSelect={() => void run(snooze(n.id, o.until), tr('Не удалось отложить.'))}>
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" aria-label={tr('Убрать из списка')} title={tr('Убрать из списка')} onClick={() => void run(archive(n.id), tr('Не удалось убрать.'))}>
          <Archive />
        </Button>
      </div>

      {/* Телефон: одно меню действий */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={tr('Действия с уведомлением')}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {unread && (
              <DropdownMenuItem onSelect={() => void run(markRead([n.id]), tr('Не удалось отметить.'))}>
                <Check />{tr('Отметить прочитанным')}</DropdownMenuItem>
            )}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr('Отложить')}</DropdownMenuLabel>
            {snoozeItems.map((o) => (
              <DropdownMenuItem key={o.label} onSelect={() => void run(snooze(n.id, o.until), tr('Не удалось отложить.'))}>
                <Clock /> {o.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void run(archive(n.id), tr('Не удалось убрать.'))}>
              <Archive />{tr('Убрать из списка')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
