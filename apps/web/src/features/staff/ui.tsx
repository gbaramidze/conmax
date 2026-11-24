import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@/features/auth/auth-provider'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { UserAvatar } from '@/features/profile/avatar'
import { currentLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { isManagerOf, staffQuery, type Employee } from '@/features/staff/api'

export const selectCls = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60'

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')
export const todayIso = () => new Date().toLocaleDateString('sv')
/** Дата через n дней в формате ГГГГ-ММ-ДД */
export const isoInDays = (n: number) => new Date(Date.now() + n * 86400_000).toLocaleDateString('sv')

/** Кто я в разделе «Персонал»: права и связи с сотрудниками. Повторяет проверки базы (окончательно решает она). */
export function useStaffAccess() {
  const { session } = useAuth()
  const me = session!.user.id
  const { data: perms } = useQuery(myTenantPermissionsQuery)
  const { data } = useSuspenseQuery(staffQuery)
  const canManage = !!perms?.includes('staff.manage')
  const seesAllNotes = !!perms?.includes('staff.notes.view')
  const leads = (userId: string) => userId !== me && (canManage || isManagerOf(data.employees, me, userId))
  return {
    me,
    canManage,
    /** ведёт оценки и навыки сотрудника */
    leads,
    /** видит заметки руководителей о сотруднике — о себе никогда */
    seesNotes: (userId: string) => userId !== me && (seesAllNotes || isManagerOf(data.employees, me, userId)),
    employees: data.employees,
    departments: data.departments,
    positions: data.positions,
    byId: new Map(data.employees.map((e) => [e.id, e])),
  }
}

export function PersonChip({ person, sub, className }: { person: Employee | undefined; sub?: string | null; className?: string }) {
  if (!person) return <span className="text-muted-foreground">—</span>
  return (
    <Link
      to="/staff/$userId"
      params={{ userId: person.id }}
      search={{}}
      className={cn('group flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <UserAvatar name={person.full_name} path={person.avatar_path} className="size-7 shrink-0 text-[11px]" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium group-hover:underline">{person.full_name}</span>
        {sub !== undefined ? sub && <span className="truncate text-xs text-muted-foreground">{sub}</span> : person.job_title && <span className="truncate text-xs text-muted-foreground">{person.job_title}</span>}
      </span>
    </Link>
  )
}
