import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useRouterState } from '@tanstack/react-router'
import { Bell, Building2, Contact, CalendarDays, Footprints, LayoutGrid, ListChecks, Lock, Menu, MessageCircle, Search, Sun, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/app-shell/brand'
import { NavLink } from '@/components/app-shell/nav-link'
import { isStageOpen, visibleNav } from '@/components/app-shell/project-nav'
import { UserMenu } from '@/components/app-shell/user-menu'
import { BadgeCount, NotificationBell, useNotificationBadge } from '@/features/notifications/bell'
import { chatUnreadQuery } from '@/features/chat/api'
import { openSearch } from '@/features/search/command-palette'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { cn } from '@/lib/utils'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

/** Верхняя панель на телефоне: где я + уведомления + профиль. */
export function TopBar() {
  const { t } = useTranslation()
  const { code } = useParams({ strict: false }) as { code?: string }
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: project } = useQuery({ ...projectByCodeQuery(code ?? ''), enabled: !!code })
  const { data: chatUnread } = useQuery(chatUnreadQuery)

  let title: ReactNode = t('projects')
  if (code && project) {
    title = (
      <>
        <span className="ident mr-2 rounded bg-primary px-1.5 py-0.5 text-signal">{project.code}</span>
        <span className="truncate">{project.name}</span>
      </>
    )
  } else if (pathname.startsWith('/today')) title = t('myDay')
  else if (pathname.startsWith('/people')) title = t('people')
  else if (pathname.startsWith('/chat')) title = t('chat')
  else if (pathname.startsWith('/personal')) title = t('personal')
  else if (pathname.startsWith('/organizations')) title = t('people')
  else if (pathname.startsWith('/inbox')) title = t('notificationsTitle')
  else if (pathname.startsWith('/settings')) title = t('settings')
  else if (pathname.startsWith('/profile')) title = t('profileTitle')

  return (
    <header className="print:!hidden sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 pl-4 pr-1 backdrop-blur lg:hidden">
      <Link to="/projects" aria-label={t('toProjects')} className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring">
        <BrandMark className="h-8" />
      </Link>
      <h1 className="flex min-w-0 flex-1 items-center text-base font-semibold">{title}</h1>
      <button
        type="button"
        onClick={openSearch}
        aria-label={t('search')}
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-5" />
      </button>
      {(
        <Link
          to="/chat"
          search={{}}
          aria-label={chatUnread ? t('chatUnread', { count: chatUnread }) : t('chat')}
          className="relative flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircle className="size-5" />
          {!!chatUnread && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-signal ring-2 ring-background" aria-hidden />}
        </Link>
      )}
      <NotificationBell />
      <UserMenu variant="topbar" />
    </header>
  )
}

const tab =
  'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ' +
  'data-[status=active]:font-medium data-[status=active]:text-foreground ' +
  "data-[status=active]:before:absolute data-[status=active]:before:inset-x-4 data-[status=active]:before:top-0 data-[status=active]:before:h-[3px] data-[status=active]:before:rounded-b data-[status=active]:before:bg-signal data-[status=active]:before:content-['']"

/** Нижняя навигация на телефоне: внутри проекта — его разделы, снаружи — общие. Зоны нажатия не меньше 56×44. */
export function BottomNav() {
  const { t } = useTranslation()
  const { code } = useParams({ strict: false }) as { code?: string }
  const badge = useNotificationBadge()

  return (
    <nav
      aria-label={t('mainNav')}
      className="print:!hidden fixed inset-x-0 bottom-0 z-30 flex border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {code ? (
        <>
          <Link to="/projects/$code" params={{ code }} activeOptions={{ exact: true }} className={tab}>
            <LayoutGrid className="size-5" /> {t('overview')}
          </Link>
          {isStageOpen(2) && (
            <>
              <Link to="/projects/$code/tasks" params={{ code }} search={DEFAULT_TASK_SEARCH} className={tab}>
                <ListChecks className="size-5" /> {t('tasks')}
              </Link>
              <Link to="/projects/$code/calendar" params={{ code }} search={{}} className={tab}>
                <CalendarDays className="size-5" /> {t('calendar')}
              </Link>
            </>
          )}
          <Link to="/projects/$code/walk" params={{ code }} className={tab}>
            <Footprints className="size-5" /> {t('walk')}
          </Link>
          <MoreMenu code={code} />
        </>
      ) : (
        <>
          <Link to="/today" className={tab}>
            <Sun className="size-5" /> {t('myDay')}
          </Link>
          <Link to="/projects" activeOptions={{ exact: true }} className={tab}>
            <Building2 className="size-5" /> {t('projects')}
          </Link>
          <Link to="/people" search={{}} className={tab}>
            <Contact className="size-5" /> {t('people')}
          </Link>
          <Link to="/inbox" search={{ tab: 'all' }} className={tab}>
            <span className="relative">
              <Bell className="size-5" />
              <BadgeCount value={badge} className="absolute -right-3 -top-2 min-w-4 px-1 text-[11px] leading-4" />
            </span>
            {t('notificationsTitle')}
          </Link>
          <Link to="/profile" className={tab}>
            <UserRound className="size-5" /> {t('profileTitle')}
          </Link>
        </>
      )}
    </nav>
  )
}

/**
 * Кнопка «Ещё» в нижнем меню проекта: открывает все разделы проекта (их больше, чем помещается в нижней полосе),
 * разложенные по группам плитками, и общие переходы (мой день, чат, люди, проекты).
 */
function MoreMenu({ code }: { code: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: project } = useQuery(projectByCodeQuery(code))
  const { data: perms } = useQuery({ ...myPermissionsQuery(project?.id), enabled: !!project })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const close = () => setOpen(false)
  const general: { to: string; label: string; icon: typeof Sun }[] = [
    { to: '/today', label: 'myDay', icon: Sun },
    { to: '/chat', label: 'chat', icon: MessageCircle },
    { to: '/people', label: 'people', icon: Contact },
    { to: '/personal', label: 'personal', icon: Lock },
    { to: '/projects', label: 'projects', icon: Building2 },
  ]
  const tile =
    'flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border bg-card px-1.5 py-2 text-center text-[12px] leading-tight outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={tab}>
        <Menu className="size-5" /> {t('more')}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88svh] gap-0 rounded-t-2xl p-0">
          <SheetHeader className="shrink-0 border-b px-4 pb-3 pt-4">
            <SheetTitle className="flex items-center gap-2 pr-10 text-base">
              <span className="ident rounded bg-primary px-1.5 py-0.5 text-signal">{code}</span>
              <span className="truncate">{project?.name ?? t('projectSections')}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">{t('projectSections')}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
            {visibleNav(perms).map((g) => (
              <section key={g.id} aria-label={t(g.title)} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t(g.title)}</h3>
                <ul className="grid grid-cols-3 gap-2">
                  {g.items.map((it) => {
                    const href = it.to.replace('$code', code)
                    const active = pathname === href || pathname.startsWith(`${href}/`)
                    return (
                      <li key={it.id}>
                        <NavLink to={it.to} params={{ code }} search={it.search} onClick={close} className={cn(tile, active && 'border-primary bg-primary/10 font-medium')}>
                          <it.icon className="size-5 text-muted-foreground" aria-hidden />
                          <span className="line-clamp-2 break-words">{t(it.label)}</span>
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            <section aria-label={t('generalSection')} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{t('generalSection')}</h3>
              <ul className="grid grid-cols-3 gap-2">
                {general.map((it) => (
                  <li key={it.to}>
                    <NavLink to={it.to} onClick={close} className={tile}>
                      <it.icon className="size-5 text-muted-foreground" aria-hidden />
                      <span className="line-clamp-2 break-words">{t(it.label)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
