import { createFileRoute, Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { BirthdaysList } from '@/features/birthdays/list'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { experienceMonths, formatMonths, reviewsQuery, skillsQuery, staffQuery } from '@/features/staff/api'
import { OrgChart } from '@/features/staff/org-chart'
import { ReviewsOverview } from '@/features/staff/reviews'
import { SkillMatrix } from '@/features/staff/skill-matrix'
import { fmtDate, PersonChip, selectCls, todayIso, useStaffAccess } from '@/features/staff/ui'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const TABS = ['org', 'people', 'skills', 'reviews', 'birthdays'] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = {
  org: tr('Оргструктура'),
  people: tr('Сотрудники'),
  skills: tr('Матрица навыков'),
  reviews: tr('Оценки'),
  birthdays: tr('Дни рождения'),
}

// Паттерн «Список / Index» с вкладками: оргструктура, сотрудники, матрица навыков, оценки эффективности
export const Route = createFileRoute('/_app/staff/')({
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(staffQuery),
      queryClient.ensureQueryData(myTenantPermissionsQuery),
      queryClient.ensureQueryData(skillsQuery),
      queryClient.ensureQueryData(reviewsQuery()),
    ]),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем персонал…')}</p>,
  component: StaffPage,
})

function StaffPage() {
  const { tab = 'org' } = Route.useSearch()
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Управление персоналом')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{tr('Структура компании, кто чей руководитель, навыки, опыт, оценки эффективности и дни рождения сотрудников.')}</p>
      </div>
      <nav aria-label={tr('Разделы персонала')} className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((value) => (
          <Link
            key={value}
            to="/staff"
            search={{ tab: value === 'org' ? undefined : value }}
            aria-current={tab === value ? 'page' : undefined}
            className={cn(
              '-mb-px min-h-11 shrink-0 content-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[value]}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}>
        {tab === 'org' && <OrgChart />}
        {tab === 'people' && <PeopleList />}
        {tab === 'skills' && <SkillMatrix />}
        {tab === 'reviews' && <ReviewsOverview />}
        {tab === 'birthdays' && <BirthdaysList />}
      </Suspense>
    </div>
  )
}

function PeopleList() {
  const { employees, departments, byId } = useStaffAccess()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return employees.filter(
      (e) =>
        (!dept || (dept === '-' ? !e.profile?.department_id : e.profile?.department_id === dept)) &&
        (!needle || [e.full_name, e.email, e.job_title].filter(Boolean).join(' ').toLowerCase().includes(needle)),
    )
  }, [employees, q, dept])
  const deptName = (id: string | null | undefined) => departments.find((d) => d.id === id)?.name ?? '—'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Имя, должность, почта')} className="pl-8" aria-label={tr('Поиск сотрудника')} />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={cn(selectCls, 'w-auto min-w-44')} aria-label={tr('Отдел')}>
          <option value="">{tr('Все отделы')}</option>
          <option value="-">{tr('Без отдела')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{tr('{{n}} чел.', { n: rows.length })}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{tr('Сотрудник')}</th>
              <th scope="col" className="px-3 py-2 font-medium">{tr('Отдел')}</th>
              <th scope="col" className="px-3 py-2 font-medium">{tr('Руководитель')}</th>
              <th scope="col" className="px-3 py-2 font-medium max-md:hidden">{tr('Стаж')}</th>
              <th scope="col" className="px-3 py-2 font-medium max-md:hidden">{tr('Следующая оценка')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((e) => {
              const ex = experienceMonths(e.profile)
              const mgr = e.profile?.manager_id ? byId.get(e.profile.manager_id) : undefined
              const late = e.profile?.next_review_on && e.profile.next_review_on < todayIso()
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2">
                    <PersonChip person={e} />
                  </td>
                  <td className="px-3 py-2">{deptName(e.profile?.department_id)}</td>
                  <td className="px-3 py-2">{mgr?.full_name ?? '—'}</td>
                  <td className="px-3 py-2 max-md:hidden">{ex.before + ex.inCompany ? formatMonths(ex.before + ex.inCompany) : '—'}</td>
                  <td className={cn('px-3 py-2 max-md:hidden', late && 'text-destructive')}>{fmtDate(e.profile?.next_review_on)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{tr('Никого не нашли.')}</p>}
      </div>
    </div>
  )
}
