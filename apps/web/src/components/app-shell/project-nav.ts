import {
  Armchair,
  BellRing,
  Boxes,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileDiff,
  FileText,
  Footprints,
  Gauge,
  GanttChart,
  KanbanSquare,
  HardHat,
  Layers,
  ListChecks,
  LocateFixed,
  MapPinned,
  NotebookPen,
  Network,
  Ruler,
  Scale,
  SearchCheck,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey } from '@/features/projects/modules'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

/**
 * Разделы проекта в одном месте: из них строятся боковая панель на компьютере, кнопка «Ещё» в нижнем меню на телефоне
 * и плитки разделов на обзоре. Название — ключ из locales/*\/shell.json. Права и модули проверяются здесь же,
 * чтобы везде показывалось одно и то же.
 *
 * Группы: основа проекта (всегда), по группе на каждый модуль (видна, только если модуль включён в проекте —
 * см. features/projects/modules.ts), затем структура и настройки.
 */
export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  to: string
  search?: Record<string, unknown>
  show?: (perms: readonly string[]) => boolean
  /** кроме модуля своей группы раздел требует и эти модули (например, освоенный объём — графика) */
  needs?: ModuleKey[]
}

export interface NavGroup {
  id: string
  title: string
  /** модуль, которому принадлежит группа; без него — основа проекта */
  module?: ModuleKey
  items: NavItem[]
}

const any = (...p: string[]) => (perms: readonly string[]) => p.some((x) => perms.includes(x))
const procurementPerms = any('procurement.view', 'procurement.request', 'procurement.approve', 'procurement.manage')

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'work',
    title: 'groupWork',
    items: [
      { id: 'tasks', label: 'tasks', icon: ListChecks, to: '/projects/$code/tasks', search: DEFAULT_TASK_SEARCH },
      { id: 'notes', label: 'notes', icon: NotebookPen, to: '/projects/$code/notes', search: {} },
      { id: 'boards', label: 'boards', icon: KanbanSquare, to: '/projects/$code/boards' },
      { id: 'calendar', label: 'calendar', icon: CalendarDays, to: '/projects/$code/calendar', search: {} },
      { id: 'meetings', label: 'meetings', icon: Users, to: '/projects/$code/meetings', search: {} },
    ],
  },
  {
    id: 'contracts',
    title: 'moduleContracts',
    module: 'contracts',
    items: [{ id: 'changes', label: 'changes', icon: FileDiff, to: '/projects/$code/changes', show: any('change.create', 'change.assess', 'change.approve') }],
  },
  {
    id: 'schedule',
    title: 'moduleSchedule',
    module: 'schedule',
    items: [
      { id: 'schedule', label: 'schedule', icon: GanttChart, to: '/projects/$code/schedule', show: any('schedule.view') },
      { id: 'week', label: 'week', icon: CalendarCheck, to: '/projects/$code/week', search: {}, show: any('schedule.view') },
      { id: 'progress', label: 'progress', icon: ClipboardCheck, to: '/projects/$code/progress', search: {}, show: any('schedule.view') },
      { id: 'volumes', label: 'volumes', icon: Ruler, to: '/projects/$code/volumes' },
    ],
  },
  {
    id: 'budget',
    title: 'moduleBudget',
    module: 'budget',
    items: [
      { id: 'budget', label: 'budget', icon: Wallet, to: '/projects/$code/budget', search: {}, show: any('budget.view') },
      { id: 'control', label: 'control', icon: Gauge, to: '/projects/$code/evm', show: any('budget.view'), needs: ['schedule'] },
      { id: 'risks', label: 'risks', icon: TriangleAlert, to: '/projects/$code/risks', show: any('risk.view', 'risk.manage') },
    ],
  },
  {
    id: 'documents',
    title: 'moduleDocuments',
    module: 'documents',
    items: [
      { id: 'documents', label: 'documents', icon: FileText, to: '/projects/$code/documents', search: {} },
      { id: 'plans', label: 'plans', icon: MapPinned, to: '/projects/$code/plans' },
    ],
  },
  {
    id: 'staffing',
    title: 'moduleStaffing',
    module: 'staffing',
    items: [
      { id: 'contractors', label: 'contractors', icon: HardHat, to: '/projects/$code/contractors', search: {} },
      { id: 'disciplines', label: 'disciplines', icon: Network, to: '/projects/$code/disciplines' },
    ],
  },
  {
    id: 'procurement',
    title: 'moduleProcurement',
    module: 'procurement',
    items: [
      { id: 'requests', label: 'requests', icon: ShoppingCart, to: '/projects/$code/requests', show: procurementPerms },
      { id: 'rfqs', label: 'rfqs', icon: Scale, to: '/projects/$code/rfqs', show: procurementPerms },
      { id: 'suppliers', label: 'suppliers', icon: Store, to: '/projects/$code/suppliers', show: procurementPerms },
      { id: 'furniture', label: 'furniture', icon: Armchair, to: '/projects/$code/ffe', search: {} },
      { id: 'equipment', label: 'equipment', icon: Boxes, to: '/projects/$code/equipment' },
    ],
  },
  {
    id: 'reporting',
    title: 'moduleReporting',
    module: 'reporting',
    items: [
      { id: 'inspections', label: 'inspections', icon: SearchCheck, to: '/projects/$code/inspections', show: any('inspection.view', 'inspection.conduct') },
      { id: 'walk', label: 'walk', icon: Footprints, to: '/projects/$code/walk' },
      { id: 'checks', label: 'checks', icon: ShieldCheck, to: '/projects/$code/checks', show: any('walk.verify', 'walk.approve') },
      { id: 'signals', label: 'signals', icon: BellRing, to: '/projects/$code/signals', search: {}, show: any('signal.view') },
    ],
  },
  {
    id: 'structure',
    title: 'groupStructure',
    items: [
      { id: 'structure', label: 'structure', icon: Layers, to: '/projects/$code/locations' },
      { id: 'whereami', label: 'whereAmI', icon: LocateFixed, to: '/projects/$code/whereami' },
      { id: 'settings', label: 'projectSettings', icon: Settings2, to: '/projects/$code/settings', show: any('project.settings.manage', 'project.edit') },
    ],
  },
]

/**
 * Этапы запуска — только для основы проекта: на первом этапе открыты задачи, заметки, доски, структура и настройки;
 * календарь, совещания и «Где я» — со второго (`VITE_APP_STAGE=2` при сборке, локально — в `.env.local`).
 * Разделы модулей этапами не прячутся: их открывает включение модуля в настройках проекта.
 */
export const APP_STAGE = Number(import.meta.env.VITE_APP_STAGE ?? 1) || 1

/** Разделы основы, которые открыты уже на первом этапе. */
const STAGE_1_ITEMS = new Set(['tasks', 'notes', 'boards', 'structure', 'settings'])

/** Открыт ли этап `stage` (1 — первый). */
export const isStageOpen = (stage: number) => stage <= APP_STAGE

/**
 * Разделы, доступные по модулям проекта, этапу и правам. Пока права или модули не загрузились, разделы с проверкой
 * прав и разделы модулей скрыты, остальные видны.
 */
export function visibleNav(perms: readonly string[] | undefined, modules: readonly string[] | undefined): NavGroup[] {
  const p = perms ?? []
  const on = (m: ModuleKey) => !!modules?.includes(m)
  return NAV_GROUPS.filter((g) => !g.module || on(g.module))
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => (!!g.module || isStageOpen(STAGE_1_ITEMS.has(i.id) ? 1 : 2)) && (i.needs ?? []).every(on) && (!i.show || (perms !== undefined && i.show(p))),
      ),
    }))
    .filter((g) => g.items.length > 0)
}
