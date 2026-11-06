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
  HardHat,
  Layers,
  ListChecks,
  LocateFixed,
  MapPinned,
  Network,
  Ruler,
  Scale,
  SearchCheck,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'

/**
 * Разделы проекта в одном месте: из них строятся боковая панель на компьютере, кнопка «Ещё» в нижнем меню на телефоне
 * и плитки разделов на обзоре. Название — ключ из locales/*\/shell.json. Права проверяются здесь же, чтобы везде
 * показывалось одно и то же.
 */
export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  to: string
  search?: Record<string, unknown>
  show?: (perms: readonly string[]) => boolean
}

export interface NavGroup {
  id: 'work' | 'field' | 'structure'
  title: string
  items: NavItem[]
}

const any = (...p: string[]) => (perms: readonly string[]) => p.some((x) => perms.includes(x))

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'work',
    title: 'groupWork',
    items: [
      { id: 'tasks', label: 'tasks', icon: ListChecks, to: '/projects/$code/tasks', search: DEFAULT_TASK_SEARCH },
      { id: 'calendar', label: 'calendar', icon: CalendarDays, to: '/projects/$code/calendar', search: {} },
      { id: 'schedule', label: 'schedule', icon: GanttChart, to: '/projects/$code/schedule', show: any('schedule.view') },
      { id: 'week', label: 'week', icon: CalendarCheck, to: '/projects/$code/week', search: {}, show: any('schedule.view') },
      { id: 'progress', label: 'progress', icon: ClipboardCheck, to: '/projects/$code/progress', search: {}, show: any('schedule.view') },
      { id: 'signals', label: 'signals', icon: BellRing, to: '/projects/$code/signals', search: {}, show: any('signal.view') },
      { id: 'inspections', label: 'inspections', icon: SearchCheck, to: '/projects/$code/inspections', show: any('inspection.view', 'inspection.conduct') },
      { id: 'risks', label: 'risks', icon: TriangleAlert, to: '/projects/$code/risks', show: any('risk.view', 'risk.manage') },
      { id: 'requests', label: 'requests', icon: ShoppingCart, to: '/projects/$code/requests', show: any('procurement.view', 'procurement.request', 'procurement.approve') },
      { id: 'rfqs', label: 'rfqs', icon: Scale, to: '/projects/$code/rfqs', show: any('procurement.view', 'procurement.request', 'procurement.approve') },
      { id: 'changes', label: 'changes', icon: FileDiff, to: '/projects/$code/changes', show: any('change.create', 'change.assess', 'change.approve') },
      { id: 'control', label: 'control', icon: Gauge, to: '/projects/$code/evm', show: any('budget.view') },
      { id: 'budget', label: 'budget', icon: Wallet, to: '/projects/$code/budget', search: {}, show: any('budget.view') },
      { id: 'meetings', label: 'meetings', icon: Users, to: '/projects/$code/meetings', search: {} },
      { id: 'documents', label: 'documents', icon: FileText, to: '/projects/$code/documents', search: {} },
      { id: 'plans', label: 'plans', icon: MapPinned, to: '/projects/$code/plans' },
    ],
  },
  {
    id: 'field',
    title: 'groupField',
    items: [
      { id: 'walk', label: 'walk', icon: Footprints, to: '/projects/$code/walk' },
      { id: 'volumes', label: 'volumes', icon: Ruler, to: '/projects/$code/volumes' },
      { id: 'checks', label: 'checks', icon: ShieldCheck, to: '/projects/$code/checks', show: any('walk.verify', 'walk.approve') },
      { id: 'whereami', label: 'whereAmI', icon: LocateFixed, to: '/projects/$code/whereami' },
    ],
  },
  {
    id: 'structure',
    title: 'groupStructure',
    items: [
      { id: 'structure', label: 'structure', icon: Layers, to: '/projects/$code/locations' },
      { id: 'furniture', label: 'furniture', icon: Armchair, to: '/projects/$code/ffe', search: {} },
      { id: 'equipment', label: 'equipment', icon: Boxes, to: '/projects/$code/equipment' },
      { id: 'disciplines', label: 'disciplines', icon: Network, to: '/projects/$code/disciplines' },
      { id: 'contractors', label: 'contractors', icon: HardHat, to: '/projects/$code/contractors', search: {} },
    ],
  },
]

/** Разделы, доступные по правам. Пока права не загрузились, пункты с проверкой прав скрыты, остальные видны. */
export function visibleNav(perms: readonly string[] | undefined): NavGroup[] {
  const p = perms ?? []
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.show || (perms !== undefined && i.show(p))) })).filter((g) => g.items.length > 0)
}
