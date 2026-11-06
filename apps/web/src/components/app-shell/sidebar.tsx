import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Building2, Contact, LayoutGrid, Lock, MessageCircle, ShieldCheck, Sun } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/app-shell/brand'
import { chatUnreadQuery } from '@/features/chat/api'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { BadgeCount } from '@/features/notifications/bell'
import { myPermissionsQuery, projectsQuery } from '@/features/projects/api'
import { NavLink } from '@/components/app-shell/nav-link'
import { visibleNav } from '@/components/app-shell/project-nav'

const item =
  'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-sidebar-muted outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
  'data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground ' +
  "data-[status=active]:before:absolute data-[status=active]:before:inset-y-1.5 data-[status=active]:before:left-0 data-[status=active]:before:w-[3px] data-[status=active]:before:rounded-r data-[status=active]:before:bg-sidebar-primary data-[status=active]:before:content-['']"

/** Тонкий разделитель между группами разделов: список будет расти, группы не дают ему слиться. */
const Gap = () => <li role="separator" aria-hidden className="my-1 h-px bg-sidebar-border/70" />

/**
 * Боковая панель на десктопе (от 1024 px): вся навигация — «Мой день», проекты и разделы открытого проекта.
 * Компактная: строки по 32 px, разделы собраны в группы. Поиск, создание, уведомления и профиль — в верхней панели.
 */
export function Sidebar() {
  const { t } = useTranslation()
  const { data: projects } = useQuery(projectsQuery)
  const { code } = useParams({ strict: false }) as { code?: string }
  const openProject = (projects ?? []).find((p) => p.code === code)
  const { data: perms } = useQuery({ ...myPermissionsQuery(openProject?.id), enabled: !!openProject })
  const { data: chatUnread } = useQuery(chatUnreadQuery)
  const { data: tenantPerms } = useQuery(myTenantPermissionsQuery)

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col print:!hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <Link to="/projects" className="flex h-14 shrink-0 items-center gap-2.5 px-4 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
        <BrandMark className="size-7" />
        <span className="text-[15px] font-semibold tracking-tight text-white">BuildOS</span>
      </Link>

      <nav aria-label={t('mainNav')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
        <Link to="/today" className={item}>
          <Sun className="size-4" /> {t('myDay')}
        </Link>
        <Link to="/chat" search={{}} className={item}>
          <MessageCircle className="size-4" /> {t('chat')}
          <BadgeCount value={chatUnread ?? 0} className="ml-auto min-w-4 px-1 text-[11px] leading-4" />
        </Link>
        <Link to="/people" search={{}} className={item}>
          <Contact className="size-4" /> {t('people')}
        </Link>
        {tenantPerms?.includes('admin.roles') && (
          <Link to="/roles" search={{}} className={item}>
            <ShieldCheck className="size-4" /> {t('roles')}
          </Link>
        )}
        <Link to="/personal" search={{}} className={item}>
          <Lock className="size-4" /> {t('personal')}
        </Link>
        <Link to="/projects" activeOptions={{ exact: true }} className={item}>
          <Building2 className="size-4" /> {t('projects')}
        </Link>

        <ul className="ml-2.5 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-1.5">
          {(projects ?? []).map((p) => {
            const open = p.code === code
            return (
              <li key={p.id}>
                <Link
                  to="/projects/$code"
                  params={{ code: p.code }}
                  activeOptions={{ exact: true }}
                  className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-muted outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  aria-current={open ? 'location' : undefined}
                >
                  <span className={`ident text-xs ${open ? 'text-sidebar-primary' : ''}`}>{p.code}</span>
                  <span className={`truncate ${open ? 'font-medium text-sidebar-accent-foreground' : ''}`}>{p.name}</span>
                </Link>
                {open && (
                  <ul className="mb-1 ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-1.5">
                    <li>
                      <Link to="/projects/$code" params={{ code: p.code }} activeOptions={{ exact: true }} className={item}>
                        <LayoutGrid className="size-4" /> {t('overview')}
                      </Link>
                    </li>

                    {visibleNav(perms).map((g) => (
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
                    ))}
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
