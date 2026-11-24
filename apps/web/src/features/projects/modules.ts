import { useQuery } from '@tanstack/react-query'
import { FileSignature, FolderOpen, GanttChart, HardHat, SearchCheck, ShoppingCart, Wallet, type LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { projectByCodeQuery } from '@/features/projects/api'

/**
 * Модули проекта. Каталог ключей совпадает с `private.project_module_keys()` в базе (миграция 156).
 * Включает и выключает их право `project.settings.manage` на странице «Настройки проекта». Выключенный модуль прячет
 * свои разделы в меню, плитках и на обзоре, а его страницы показывают «Модуль выключен»; данные не удаляются.
 * Личное (почта, календарь, чат, «Личное») и основа проекта (задачи, заметки, доски, совещания, структура) — не модули.
 */
export const MODULE_KEYS = ['contracts', 'schedule', 'budget', 'documents', 'staffing', 'procurement', 'reporting'] as const
export type ModuleKey = (typeof MODULE_KEYS)[number]

export interface ModuleDef {
  key: ModuleKey
  /** ключ названия из locales/*\/shell.json — тот же, что у группы разделов в меню */
  label: string
  icon: LucideIcon
  /** что делает модуль — одной строкой */
  summary: string
  /** что ещё модуль даёт помимо своих разделов в меню (вкладки, блоки обзора) */
  extras: string[]
  /** адреса страниц проекта (первый сегмент после кода), которые принадлежат модулю */
  segments: string[]
}

export const MODULES: ModuleDef[] = [
  {
    key: 'contracts',
    label: 'moduleContracts',
    icon: FileSignature,
    summary: tr('Договоры с подрядчиками и поставщиками, запросы на изменение объёма, срока и стоимости'),
    extras: [tr('Вкладка «Договоры» в бюджете — обязательства по статьям')],
    segments: ['changes'],
  },
  {
    key: 'schedule',
    label: 'moduleSchedule',
    icon: GanttChart,
    summary: tr('График работ, план недели, ежедневный факт и объёмы по местам'),
    extras: [tr('Вкладка «По работам» в бюджете — бюджет на работы графика')],
    segments: ['schedule', 'week', 'progress', 'volumes'],
  },
  {
    key: 'budget',
    label: 'moduleBudget',
    icon: Wallet,
    summary: tr('Бюджет по статьям и версиям, фактические затраты, освоенный объём и риски'),
    extras: [],
    segments: ['budget', 'evm', 'risks'],
  },
  {
    key: 'documents',
    label: 'moduleDocuments',
    icon: FolderOpen,
    summary: tr('Документы и их версии, сравнение версий, чертежи и планы с отметками'),
    extras: [],
    segments: ['documents', 'document', 'compare', 'plans', 'plan'],
  },
  {
    key: 'staffing',
    label: 'moduleStaffing',
    icon: HardHat,
    summary: tr('Организации на проекте, их направления и руководители направлений'),
    extras: [],
    segments: ['contractors', 'disciplines'],
  },
  {
    key: 'procurement',
    label: 'moduleProcurement',
    icon: ShoppingCart,
    summary: tr('Заявки на материалы, запросы цен поставщикам, мебель и оборудование'),
    extras: [tr('Вкладка «Номера и мебель» на обзоре проекта')],
    segments: ['requests', 'rfqs', 'ffe', 'equipment'],
  },
  {
    key: 'reporting',
    label: 'moduleReporting',
    icon: SearchCheck,
    summary: tr('Осмотры с отчётами, обходы и их проверка, сигналы и здоровье проекта'),
    extras: [tr('Блок «Здоровье проекта» на обзоре')],
    segments: ['inspections', 'inspection', 'walk', 'checks', 'signals'],
  },
]

export const moduleDef = (key: ModuleKey) => MODULES.find((m) => m.key === key)!

/**
 * Связи между модулями: что один модуль передаёт другому. Только те, что реально работают в коде.
 * Если один из двух модулей выключен, связь не действует (данные остаются, но не видны).
 */
export interface ModuleLink {
  from: ModuleKey
  to: ModuleKey
  text: string
}

export const MODULE_LINKS: ModuleLink[] = [
  { from: 'contracts', to: 'budget', text: tr('Договоры — обязательства по статьям бюджета; изменение оценивает влияние на стоимость') },
  { from: 'contracts', to: 'schedule', text: tr('Запрос на изменение оценивает влияние на срок') },
  { from: 'procurement', to: 'budget', text: tr('Заявка привязана к статье бюджета и проверяет её остаток') },
  { from: 'schedule', to: 'budget', text: tr('Работы графика с бюджетом дают освоенный объём (EVM) и прогноз') },
  { from: 'reporting', to: 'schedule', text: tr('Обход отмечает выполненные объёмы, проверка подтверждает факт') },
  { from: 'schedule', to: 'reporting', text: tr('Отставания графика становятся сигналами здоровья проекта') },
  { from: 'documents', to: 'reporting', text: tr('Чертежи и планы служат схемами для осмотров') },
  { from: 'staffing', to: 'schedule', text: tr('Подрядчики — исполнители объёмов по местам') },
]

/** Модуль, которому принадлежит страница проекта, по пути `/projects/{code}/{segment}/…` */
export function moduleOfPath(pathname: string): ModuleKey | null {
  const seg = /^\/projects\/[^/]+\/([^/?#]+)/.exec(pathname)?.[1]
  if (!seg) return null
  return MODULES.find((m) => m.segments.includes(seg))?.key ?? null
}

/** Включённые модули открытого проекта. Пока проект не загрузился — undefined (разделы модулей скрыты). */
export function useProjectModules(code: string | undefined): readonly string[] | undefined {
  const { data } = useQuery({ ...projectByCodeQuery(code ?? ''), enabled: !!code })
  return data?.modules
}

export async function setProjectModules(projectId: string, modules: ModuleKey[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_project_modules', { p_project: projectId, p_modules: modules })
  if (error) throw error
  return data
}
