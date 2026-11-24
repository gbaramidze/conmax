import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Cake } from 'lucide-react'
import { useMemo } from 'react'
import { birthdaysQuery, daysUntil, formatDayMonth, turnsLabel, whenLabel, type Birthday } from '@/features/birthdays/api'
import { UserAvatar } from '@/features/profile/avatar'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const monthFmt = new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: 'UTC' })

/** Вкладка «Дни рождения» в разделе «Персонал»: все, кто указал дату, по месяцам начиная с текущего */
export function BirthdaysList() {
  const { data } = useSuspenseQuery(birthdaysQuery)
  const months = useMemo(() => {
    const groups = new Map<number, Birthday[]>()
    for (const b of data) groups.set(b.birth_month, [...(groups.get(b.birth_month) ?? []), b])
    const start = new Date().getMonth() + 1
    return Array.from({ length: 12 }, (_, i) => ((start - 1 + i) % 12) + 1)
      .filter((m) => groups.has(m))
      .map((m) => ({ month: m, people: groups.get(m)!.sort((a, b) => a.birth_day - b.birth_day || a.full_name.localeCompare(b.full_name)) }))
  }, [data])

  if (data.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-card p-5 shadow-soft">
        <Cake className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">{tr('Пока никто не указал день рождения')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tr('Дату указывают в профиле. Коллеги увидят день и месяц, год — только если человек сам его откроет.')}</p>
          <Link to="/profile" className="mt-2 inline-block text-sm font-medium underline underline-offset-4">
            {tr('Указать свой')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {tr('Указали дату: {{n}} чел. Своя дата — в профиле.', { n: data.length })}{' '}
        <Link to="/profile" className="font-medium underline underline-offset-4">
          {tr('Открыть профиль')}
        </Link>
      </p>
      {months.map(({ month, people }) => (
        <section key={month} className="flex flex-col gap-2" aria-label={monthFmt.format(new Date(Date.UTC(2000, month - 1, 1)))}>
          <h3 className="text-sm font-semibold first-letter:uppercase">{monthFmt.format(new Date(Date.UTC(2000, month - 1, 1)))}</h3>
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
            {people.map((b) => {
              const n = daysUntil(b.next_date)
              return (
                <li key={b.user_id}>
                  <Link to="/staff/$userId" params={{ userId: b.user_id }} search={{}} className="flex min-h-12 items-center gap-3 px-4 py-1.5 hover:bg-muted/40">
                    <span className="w-24 shrink-0 text-sm tabular-nums">{formatDayMonth(b.birth_month, b.birth_day)}</span>
                    <UserAvatar name={b.full_name} path={b.avatar_path} className="size-8 shrink-0 text-xs" />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-sm font-medium">{b.full_name}</span>
                      {b.job_title && <span className="truncate text-xs text-muted-foreground">{b.job_title}</span>}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{turnsLabel(b)}</span>
                    {n <= 14 && (
                      <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-medium', n <= 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{whenLabel(b)}</span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
