import { currentLocale } from '@/lib/i18n'
import { useQueries } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'
import { CALENDAR_PROVIDERS } from '@/features/calendar/providers'
import type { CalendarContext, CalendarEvent, CalendarProvider, KindId } from '@/features/calendar/types'
import { KINDS } from '@/features/calendar/kinds'

/** Источники, которые пользователь вправе видеть: без нужного права источник даже не запрашивается. */
export const availableProviders = (permissions: string[]): CalendarProvider[] =>
  CALENDAR_PROVIDERS.filter((p) => !p.permission || permissions.includes(p.permission))

export const DEFAULT_KINDS = (Object.keys(KINDS) as KindId[]).filter((k) => KINDS[k].defaultOn)

/** События всех доступных источников за сетку месяца; ошибка одного источника не ломает остальные. */
export function useCalendarEvents(ctx: CalendarContext, only?: string[]) {
  const providers = useMemo(() => availableProviders(ctx.permissions).filter((p) => !only || only.includes(p.id)), [ctx.permissions, only])
  const results = useQueries({
    queries: providers.map((p) => ({
      ...p.query(ctx),
      // при переходе на другой месяц остаётся прежняя картина, пока грузится новая
      placeholderData: (prev: unknown) => prev,
    })),
  })

  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  const events = useMemo(() => {
    const out: CalendarEvent[] = []
    providers.forEach((p, i) => {
      const data = results[i]?.data
      if (data === undefined) return
      for (const e of p.events(data, ctx)) if (e.date >= ctx.range.from && e.date <= ctx.range.to) out.push(e)
    })
    return out
    // results — новый массив на каждый рендер; о смене данных говорит stamp
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, stamp, ctx.range.from, ctx.range.to, ctx.timezone, ctx.userId])

  return {
    providers,
    events,
    loading: results.some((r) => r.isPending),
    failed: providers.filter((_, i) => results[i]?.isError).map((p) => p.label),
    refetch: () => results.forEach((r) => r.isError && void r.refetch()),
  }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** События по дням, внутри дня: сначала на весь день, затем по времени. */
export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const kindOrder = Object.keys(KINDS)
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e])
  for (const list of map.values())
    list.sort((a, b) => {
      if (!a.time !== !b.time) return a.time ? 1 : -1
      return (a.time ?? '').localeCompare(b.time ?? '') || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.title.localeCompare(b.title, currentLocale())
    })
  return map
}
