import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useRouterState } from '@tanstack/react-router'
import { Building2, ChevronRight, Contact, Home, LayoutGrid, Lock, Mail, MessageCircle, ShieldCheck, ShoppingCart, Sun, UsersRound } from 'lucide-react'
import { useAuth } from '@/features/auth/auth-provider'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/app-shell/brand'
import { chatUnreadQuery } from '@/features/chat/api'
import { mailAccountQuery, mailUnreadQuery } from '@/features/mail/api'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { BadgeCount } from '@/features/notifications/bell'
import { myPermissionsQuery, projectsQuery } from '@/features/projects/api'
import { NavLink } from '@/components/app-shell/nav-link'
import { visibleNav, type NavGroup } from '@/components/app-shell/project-nav'
import { moduleDef } from '@/features/projects/modules'
import { cn } from '@/lib/utils'

// Строка раздела: 36 px, иконка приглушена и загорается при наведении; активный раздел — жёлтая полоска слева,
// мягкая жёлтая подложка и жёлтая иконка
const item =
  'group/item relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted outline-none transition-colors duration-150 motion-reduce:transition-none ' +
  'hover:bg-white/[0.045] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
  '[&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-sidebar-muted [&>svg]:transition-colors hover:[&>svg]:text-sidebar-foreground ' +
  'data-[status=active]:bg-sidebar-primary/[0.11] data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground data-[status=active]:[&>svg]:text-sidebar-primary ' +
  "data-[status=active]:before:absolute data-[status=active]:before:inset-y-2 data-[status=active]:before:-left-px data-[status=active]:before:w-[3px] data-[status=active]:before:rounded-full data-[status=active]:before:bg-sidebar-primary data-[status=active]:before:content-['']"

/** Тонкий разделитель между группами разделов: список будет расти, группы не дают ему слиться. */
const Gap = () => <li role="separator" aria-hidden className="mx-2 my-1.5 h-px bg-sidebar-border" />

const COLLAPSED_KEY = 'sidebar-collapsed-modules'

function readCollapsed(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.map(String) : [])
  } catch {
    return new Set()
  }
}

/** Какие модули свёрнуты — общий выбор для всех проектов, помнится в этом браузере */
function useCollapsedModules() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // хранилище недоступно (приватное окно) — просто не запоминаем
      }
      return next
    })
  return { collapsed, toggle }
}

/**
 * Модуль в боковой панели: заголовок с иконкой модуля сворачивает и разворачивает его разделы, разделы — под ним
 * с отступом. Модуль, в котором открыта страница, всегда развёрнут, чтобы текущий раздел был виден.
 */
function ModuleGroup({ group, code, store }: { group: NavGroup; code: string; store: ReturnType<typeof useCollapsedModules> }) {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const m = moduleDef(group.module!)
  const hasActive = group.items.some((it) => {
    const href = it.to.replace('$code', code)
    return pathname === href || pathname.startsWith(`${href}/`)
  })
  const open = hasActive || !store.collapsed.has(group.id)
  const listId = `sidebar-module-${group.id}`

  return (
    <li className="mt-1 flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !hasActive && store.toggle(group.id)}
        title={hasActive ? t(m.label) : undefined}
        className={cn(
          'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-tight text-sidebar-foreground/90 outline-none transition-colors hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          hasActive && 'cursor-default',
        )}
      >
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md ring-1 ring-inset',
            hasActive ? 'bg-sidebar-primary/15 text-sidebar-primary ring-sidebar-primary/25' : 'bg-white/[0.04] text-sidebar-muted ring-white/[0.06]',
          )}
        >
          <m.icon className="size-3.5" aria-hidden />
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 break-words">{t(m.label)}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 text-sidebar-muted transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90', hasActive && 'opacity-40')} aria-hidden />
      </button>
      {open && (
        <ul id={listId} className="ml-[1.1875rem] mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
          {group.items.map((it) => (
            <li key={it.id}>
              <NavLink to={it.to} params={{ code }} search={it.search} className={item}>
                <it.icon className="size-4" /> {t(it.label)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Боковая панель на десктопе (от 1024 px): вся навигация — «Мой день», проекты и разделы открытого проекта.
 * Компактная: строки по 32 px, разделы собраны в группы. Поиск, создание, уведомления и профиль — в верхней панели.
 */
export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation()
  const { data: projects } = useQuery(projectsQuery)
  const { code } = useParams({ strict: false }) as { code?: string }
  const collapsedModules = useCollapsedModules()
  const { isExternal } = useAuth()
  const openProject = (projects ?? []).find((p) => p.code === code)
  const { data: perms } = useQuery({ ...myPermissionsQuery(openProject?.id), enabled: !!openProject })
  const { data: chatUnread } = useQuery(chatUnreadQuery)
  const { data: tenantPerms } = useQuery(myTenantPermissionsQuery)
  const canMail = !!tenantPerms?.includes('mail.connect')
  const { data: mailAccount } = useQuery({ ...mailAccountQuery, enabled: canMail })
  const { data: mailUnread } = useQuery(mailUnreadQuery(canMail && !!mailAccount))

  // «Общее и личное» (мой день, чат, почта, люди…) сворачивается само, когда открыт проект, и раскрывается вне проекта.
  // Вручную можно открыть или закрыть в любой момент — до следующего входа в проект или выхода из него.
  const inProject = !!code
  const [generalOpen, setGeneralOpen] = useState(!inProject)
  const [wasInProject, setWasInProject] = useState(inProject)
  if (wasInProject !== inProject) {
    setWasInProject(inProject)
    setGeneralOpen(!inProject)
  }
  const unreadTotal = (chatUnread ?? 0) + (canMail ? (mailUnread ?? 0) : 0)
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:!hidden',
        // едва заметный свет сверху: панель не выглядит плоской заливкой
        'bg-[radial-gradient(120%_40%_at_0%_0%,rgb(255_194_14/0.07),transparent_60%),linear-gradient(180deg,rgb(255_255_255/0.025),transparent_35%)]',
        !hidden && 'lg:flex',
      )}
    >
      <Link
        to="/projects"
        className="mx-2 mt-2 mb-1 flex h-12 shrink-0 items-center gap-3 rounded-lg px-2.5 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <BrandMark className="h-8" />
        <span className="flex flex-col leading-none">
          <span className="text-base font-semibold tracking-tight text-white">CONMAX</span>
          <span className="mt-1 h-0.5 w-6 rounded-full bg-sidebar-primary" aria-hidden />
        </span>
      </Link>
      <div className="mx-4 mb-2 h-px bg-gradient-to-r from-sidebar-border via-sidebar-border to-transparent" aria-hidden />

      <nav aria-label={t('mainNav')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4 [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]">
        <button
          type="button"
          aria-expanded={generalOpen}
          aria-controls="sidebar-general"
          onClick={() => setGeneralOpen((v) => !v)}
          className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-tight text-sidebar-foreground/90 outline-none transition-colors hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/[0.04] text-sidebar-muted ring-1 ring-inset ring-white/[0.06]">
            <Home className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">{t('generalSection')}</span>
          {!generalOpen && <BadgeCount value={unreadTotal} className="min-w-4 px-1 text-[11px] leading-4" />}
          <ChevronRight className={cn('size-3.5 shrink-0 text-sidebar-muted transition-transform duration-150 motion-reduce:transition-none', generalOpen && 'rotate-90')} aria-hidden />
        </button>
        {generalOpen && (
          <div id="sidebar-general" className="mb-1 ml-[1.1875rem] flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
            <Link to="/today" className={item}>
              <Sun className="size-4" /> {t('myDay')}
            </Link>
            <Link to="/chat" search={{}} className={item}>
              <MessageCircle className="size-4" /> {t('chat')}
              <BadgeCount value={chatUnread ?? 0} className="ml-auto min-w-4 px-1 text-[11px] leading-4" />
            </Link>
            {canMail && (
              <Link to="/mail" search={{}} className={item}>
                <Mail className="size-4" /> {t('mail')}
                <BadgeCount value={mailUnread ?? 0} className="ml-auto min-w-4 px-1 text-[11px] leading-4" />
              </Link>
            )}
            <Link to="/people" search={{}} className={item}>
              <Contact className="size-4" /> {t('people')}
            </Link>
            {!isExternal && (
              <Link to="/staff" search={{}} className={item}>
                <UsersRound className="size-4" /> {t('staff')}
              </Link>
            )}
            {!isExternal && (
              <Link to="/procurement" search={{}} className={item}>
                <ShoppingCart className="size-4" /> {t('procurement')}
              </Link>
            )}
            {tenantPerms?.includes('admin.roles') && (
              <Link to="/roles" search={{}} className={item}>
                <ShieldCheck className="size-4" /> {t('roles')}
              </Link>
            )}
            <Link to="/personal" search={{}} className={item}>
              <Lock className="size-4" /> {t('personal')}
            </Link>
          </div>
        )}
        <div role="separator" aria-hidden className="mx-2 my-1.5 h-px bg-sidebar-border" />
        <Link to="/projects" activeOptions={{ exact: true }} className={item}>
          <Building2 className="size-4" /> {t('projects')}
        </Link>

        <ul className="mt-1 flex flex-col gap-0.5">
          {(projects ?? []).map((p) => {
            const open = p.code === code
            return (
              <li key={p.id} className={cn(open && 'my-1 rounded-xl bg-white/[0.025] p-1 ring-1 ring-inset ring-white/[0.05]')}>
                <Link
                  to="/projects/$code"
                  params={{ code: p.code }}
                  activeOptions={{ exact: true }}
                  className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm text-sidebar-muted outline-none transition-colors hover:bg-white/[0.045] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  aria-current={open ? 'location' : undefined}
                >
                  <span
                    className={cn(
                      'ident inline-flex h-5 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold',
                      open ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'bg-white/[0.06] text-sidebar-foreground/80',
                    )}
                  >
                    {p.code}
                  </span>
                  <span className={cn('truncate', open && 'font-medium text-sidebar-accent-foreground')}>{p.name}</span>
                </Link>
                {open && (
                  <ul className="mb-0.5 ml-[1.375rem] mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
                    <li>
                      <Link to="/projects/$code" params={{ code: p.code }} activeOptions={{ exact: true }} className={item}>
                        <LayoutGrid className="size-4" /> {t('overview')}
                      </Link>
                    </li>

                    {visibleNav(perms, openProject?.modules).map((g) =>
                      g.module ? (
                        <ModuleGroup key={g.id} group={g} code={p.code} store={collapsedModules} />
                      ) : (
                        <Fragment key={g.id}>
                          <Gap />
                          {g.items.map((it) => (
                            <li key={it.id}>
                              <NavLink to={it.to} params={{ code: p.code }} search={it.search} className={item}>
                                <it.icon className="size-4" /> {t(it.label)}
                              </NavLink>
                            </li>
                          ))}
                        </Fragment>
                      ),
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
