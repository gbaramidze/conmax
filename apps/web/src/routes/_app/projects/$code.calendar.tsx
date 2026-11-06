import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useAuth } from '@/features/auth/auth-provider'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// Паттерн «Календарь»: события проекта из всех источников — задачи, совещания, график, недельные планы, документы.
// Вид, дата и фильтры живут в адресе: ссылкой на настроенный календарь можно поделиться.
export const Route = createFileRoute('/_app/projects/$code/calendar')({
  validateSearch: z.object({
    view: z.enum(['month', 'week', 'day', 'agenda']).optional().catch(undefined),
    d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    types: z.string().optional().catch(undefined),
    mine: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await queryClient.ensureQueryData(myPermissionsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем календарь…')}</p>,
  component: CalendarRoute,
})

function CalendarRoute() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { session } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))

  return (
    <CalendarPage
      project={{ id: p.id, code: p.code, timezone: p.timezone }}
      userId={session!.user.id}
      permissions={permissions}
      search={search}
      setSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
    />
  )
}
