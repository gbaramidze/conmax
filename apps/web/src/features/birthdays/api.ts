import { queryOptions } from '@tanstack/react-query'
import { currentLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/**
 * Дни рождения сотрудников (миграция 158). Дата лежит в `user_birthdays`: строку целиком видят только сам человек и
 * staff.manage. Остальным сотрудникам — `birthdays()`: день и месяц, возраст только если человек разрешил показывать год.
 * Внешним участникам список приходит пустым.
 */
export interface Birthday {
  user_id: string
  full_name: string
  job_title: string | null
  avatar_path: string | null
  birth_month: number
  birth_day: number
  /** ближайший день рождения (сегодня или позже) по часовому поясу смотрящего */
  next_date: string
  /** сколько исполнится в ближайший день рождения — только если год открыт */
  turns: number | null
}

export const birthdaysQuery = queryOptions({
  queryKey: ['birthdays'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('birthdays')
    if (error) throw error
    return (data ?? []) as Birthday[]
  },
  staleTime: 10 * 60_000,
})

/** Полная дата (с годом) — для себя и для того, у кого staff.manage. У остальных строка не придёт. */
export const birthdayRowQuery = (userId: string) =>
  queryOptions({
    queryKey: ['birthdays', 'row', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_birthdays').select('birth_date, show_year').eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data
    },
  })

export async function setBirthday(userId: string, date: string | null, showYear: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_birthday', { p_user: userId, p_date: (date || null) as never, p_show_year: showYear })
  if (error) throw error
}

const dayMonthFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', timeZone: 'UTC' })
const fullFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** «12 марта» */
export const formatDayMonth = (month: number, day: number) => dayMonthFmt.format(new Date(Date.UTC(2000, month - 1, day)))
/** «12 марта 1990» */
export const formatBirthDate = (iso: string) => fullFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))

/** Сколько дней до ближайшего дня рождения (0 — сегодня) */
export function daysUntil(nextDate: string): number {
  const today = new Date().toLocaleDateString('sv')
  return Math.round((Date.parse(`${nextDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
}

/** «сегодня», «завтра», «через 5 дн.» или дата */
export function whenLabel(b: Birthday): string {
  const n = daysUntil(b.next_date)
  if (n <= 0) return tr('сегодня')
  if (n === 1) return tr('завтра')
  if (n <= 7) return tr('через {{n}} дн.', { n })
  return formatDayMonth(b.birth_month, b.birth_day)
}

/** «исполнится 35» / «исполнилось 35» — если год открыт */
export const turnsLabel = (b: Birthday) => (b.turns == null ? '' : daysUntil(b.next_date) <= 0 ? tr('исполнилось {{n}}', { n: b.turns }) : tr('исполнится {{n}}', { n: b.turns }))
