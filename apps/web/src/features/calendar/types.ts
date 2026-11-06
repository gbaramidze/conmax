import type { QueryFunction, QueryKey } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'

/** Тип события: по нему считаются цвет, значок и чекбоксы фильтра. */
export type KindId =
  | 'task_due'
  | 'task_need'
  | 'meeting'
  | 'milestone'
  | 'activity_critical'
  | 'activity_start'
  | 'activity_finish'
  | 'week_plan'
  | 'doc_ack'
  | 'doc_issued'
  | 'inspection'
  | 'inspection_due'
  | 'personal'

/** Куда ведёт событие. Новый источник добавляет свой вариант и строку в `EventLink`. */
export type EventTarget =
  | { to: 'task'; key: string }
  | { to: 'meeting'; id: string }
  | { to: 'meetings' }
  | { to: 'schedule' }
  | { to: 'week'; w: string }
  | { to: 'document'; id: string }
  | { to: 'inspection'; id: string }
  | { to: 'inspection_schedule' }
  | { to: 'personal'; id: string }

export type EventTone = 'overdue' | 'done' | 'planned'

export interface CalendarEvent {
  id: string
  kind: KindId
  /** день события «YYYY-MM-DD» (для совещаний — по часовому поясу проекта) */
  date: string
  /** «HH:MM» по часовому поясу проекта; у событий на весь день не задано */
  time?: string
  endTime?: string
  title: string
  /** вторая строка: ключ, место, исполнитель */
  meta?: string
  /** относится ли событие к текущему пользователю (фильтр «Только мои») */
  mine: boolean
  tone?: EventTone
  target: EventTarget
}

export interface CalendarRange {
  from: string
  to: string
}

/** Всё, что нужно источнику, чтобы запросить и разобрать свои данные. */
export interface CalendarContext {
  projectId: string
  code: string
  /** часовой пояс проекта (projects.timezone) */
  timezone: string
  userId: string
  permissions: string[]
  /** сетка месяца, в которую попадает открытая дата, — включая «хвосты» соседних месяцев */
  range: CalendarRange
}

export interface KindInfo {
  label: string
  icon: LucideIcon
  /** фон и левая кромка плашки */
  chip: string
  /** цвет точки в компактных видах */
  dot: string
  /** показывается ли тип, пока пользователь не выбрал свой набор */
  defaultOn: boolean
}

export interface CalendarProvider<T = unknown> {
  id: string
  /** название группы в фильтре */
  label: string
  kinds: KindId[]
  /** право, без которого источник не запрашивается; сами строки всё равно отбирает RLS */
  permission?: string
  /** ключ кэша (включайте диапазон, только если запрос от него зависит) и запрос под правами пользователя */
  query: (ctx: CalendarContext) => { queryKey: QueryKey; queryFn?: QueryFunction<T, any> }
  /** данные запроса → события (диапазон отбирает вызывающий) */
  events: (data: T, ctx: CalendarContext) => CalendarEvent[]
}
