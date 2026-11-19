import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { CalendarPlus, ClipboardList, FileUp, FolderUp, GanttChart, Layers, ListPlus, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@/components/app-shell/brand'
import { toggleSidebar, useSidebarHidden } from '@/components/app-shell/sidebar-state'
import { tr } from '@/lib/tr'
import { UserMenu } from '@/components/app-shell/user-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationsPopover } from '@/features/notifications/bell'
import { myPermissionsQuery, projectsQuery } from '@/features/projects/api'
import { openSearch } from '@/features/search/command-palette'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

/**
 * Верхняя панель на десктопе (от 1024 px): поиск, быстрое создание, уведомления и профиль.
 * Вся навигация (проекты и их разделы) — в боковой панели.
 */
export function DesktopHeader() {
  const { t } = useTranslation()
  const { data: projects } = useQuery(projectsQuery)
  const { code } = useParams({ strict: false }) as { code?: string }
  const navigate = useNavigate()
  const openProject = (projects ?? []).find((p) => p.code === code)
  const { data: perms } = useQuery({ ...myPermissionsQuery(openProject?.id), enabled: !!openProject })
  const can = (permission: string) => !!perms?.includes(permission)
  const sidebarHidden = useSidebarHidden()

  const createItems = code
    ? ([
        can('task.create') && { key: 'task', icon: ListPlus, label: t('newTask'), go: () => void navigate({ to: '/projects/$code/tasks', params: { code }, search: { ...DEFAULT_TASK_SEARCH, create: 'task' } }) },
        can('task.create') && { key: 'template', icon: ClipboardList, label: t('taskFromTemplate'), go: () => void navigate({ to: '/projects/$code/tasks', params: { code }, search: { ...DEFAULT_TASK_SEARCH, create: 'template' } }) },
        can('meeting.create') && { key: 'meeting', icon: CalendarPlus, label: t('meeting'), go: () => void navigate({ to: '/projects/$code/meetings', params: { code }, search: { create: 'meeting' } }) },
        can('document.upload') && { key: 'folder', icon: FolderUp, label: t('uploadFolder'), go: () => void navigate({ to: '/projects/$code/documents', params: { code }, search: { create: 'folder' } }) },
        can('document.upload') && { key: 'doc', icon: FileUp, label: t('uploadDocument'), go: () => void navigate({ to: '/projects/$code/documents', params: { code }, search: { create: 'upload' } }) },
        can('schedule.edit') && { key: 'act', icon: GanttChart, label: t('scheduleWork'), go: () => void navigate({ to: '/projects/$code/schedule', params: { code }, search: { create: 'task' } }) },
        can('schedule.edit') && { key: 'floors', icon: Layers, label: t('floorWork'), go: () => void navigate({ to: '/projects/$code/schedule', params: { code }, search: { create: 'generate' } }) },
      ].filter(Boolean) as { key: string; icon: typeof Plus; label: string; go: () => void }[])
    : []

  return (
    <header className="print:!hidden sticky top-0 z-30 hidden h-14 items-center gap-1 border-b bg-card px-4 shadow-soft lg:flex">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-pressed={!sidebarHidden}
        aria-label={sidebarHidden ? tr('Показать боковую панель') : tr('Скрыть боковую панель')}
        title={`${sidebarHidden ? tr('Показать боковую панель') : tr('Скрыть боковую панель')} (Ctrl + \\)`}
        className="-ml-1.5 mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {sidebarHidden ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
      </button>
      {sidebarHidden && (
        <Link to="/projects" aria-label="CONMAX" className="mr-2 flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark className="h-6" />
        </Link>
      )}
      <button
        type="button"
        onClick={openSearch}
        className="flex h-9 w-full max-w-xl items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">{t('searchPlaceholder')}</span>
        <kbd className="ml-auto shrink-0 rounded border px-1.5 text-xs">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {createItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-md bg-signal px-3 text-sm font-semibold text-signal-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-4" /> {t('create')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('quickCreate', { code })}</DropdownMenuLabel>
              {createItems.map((it) => (
                <DropdownMenuItem key={it.key} onSelect={it.go}>
                  <it.icon /> {it.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <NotificationsPopover variant="header" />
        <UserMenu variant="header" />
      </div>
    </header>
  )
}
