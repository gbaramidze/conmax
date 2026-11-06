import type { CalendarProvider } from '@/features/calendar/types'

/** Стирает тип данных источника, чтобы разные источники лежали в одном списке. */
export const defineProvider = <T>(p: CalendarProvider<T>) => p as unknown as CalendarProvider
