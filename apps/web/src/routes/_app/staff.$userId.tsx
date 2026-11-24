import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Lock } from 'lucide-react'
import { Suspense } from 'react'
import { z } from 'zod'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { UserAvatar } from '@/features/profile/avatar'
import { skillsQuery, staffQuery } from '@/features/staff/api'
import { ManagerNotes } from '@/features/staff/notes'
import { PersonSkills, ProfileTab } from '@/features/staff/profile'
import { PersonReviews } from '@/features/staff/reviews'
import { useStaffAccess } from '@/features/staff/ui'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const TABS = ['profile', 'skills', 'reviews', 'notes'] as const
type Tab = (typeof TABS)[number]

// Паттерн «Detail / Record»: карточка сотрудника с вкладками; «Заметки руководителя» — только не самому сотруднику
export const Route = createFileRoute('/_app/staff/$userId')({
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(staffQuery), queryClient.ensureQueryData(myTenantPermissionsQuery), queryClient.ensureQueryData(skillsQuery)]),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем карточку…')}</p>,
  component: EmployeePage,
})

function EmployeePage() {
  const { userId } = Route.useParams()
  const { tab = 'profile' } = Route.useSearch()
  useSuspenseQuery(staffQuery)
  const { byId, seesNotes, departments, me } = useStaffAccess()
  const person = byId.get(userId)

  if (!person) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
        <p className="font-medium">{tr('Сотрудник не найден')}</p>
        <Link to="/staff" search={{}} className="text-sm font-medium underline underline-offset-4">
          {tr('К персоналу')}
        </Link>
      </div>
    )
  }

  const notesVisible = seesNotes(person.id)
  const tabs: [Tab, string][] = [
    ['profile', tr('Карточка')],
    ['skills', tr('Навыки')],
    ['reviews', tr('Оценки')],
    ...(notesVisible ? ([['notes', tr('Заметки руководителя')]] as [Tab, string][]) : []),
  ]
  const current = tab === 'notes' && !notesVisible ? 'profile' : tab
  const dept = departments.find((d) => d.id === person.profile?.department_id)

  return (
    <div className="flex flex-col gap-5">
      <Link to="/staff" search={{ tab: 'people' }} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {tr('Персонал')}
      </Link>
      <header className="flex items-center gap-4">
        <UserAvatar name={person.full_name} path={person.avatar_path} className="size-14 text-base" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {person.full_name}
            {person.id === me && <span className="ml-2 text-sm font-normal text-muted-foreground">{tr('(это вы)')}</span>}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{[person.job_title, dept?.name].filter(Boolean).join(' · ') || person.email}</p>
        </div>
      </header>
      <nav aria-label={tr('Разделы карточки')} className="flex gap-1 overflow-x-auto border-b">
        {tabs.map(([value, label]) => (
          <Link
            key={value}
            to="/staff/$userId"
            params={{ userId }}
            search={{ tab: value === 'profile' ? undefined : value }}
            aria-current={current === value ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {value === 'notes' && <Lock className="size-3.5" aria-hidden />}
            {label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}>
        {current === 'profile' && <ProfileTab person={person} />}
        {current === 'skills' && <PersonSkills person={person} />}
        {current === 'reviews' && <PersonReviews person={person} />}
        {current === 'notes' && <ManagerNotes person={person} />}
      </Suspense>
    </div>
  )
}
