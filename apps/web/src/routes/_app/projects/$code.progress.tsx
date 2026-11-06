import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { JournalTab } from '@/features/progress/journal'
import { ProgressEntryTab } from '@/features/progress/entry'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// Паттерн «Форма / Список»: факт по работам графика и журнал дня
export const Route = createFileRoute('/_app/projects/$code/progress')({
  validateSearch: z.object({ tab: z.enum(['entry', 'journal']).optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await queryClient.ensureQueryData(myPermissionsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>,
  component: ProgressPage,
})

function ProgressPage() {
  const { code } = Route.useParams()
  const { tab = 'entry' } = Route.useSearch()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canReport = permissions.includes('progress.report') || permissions.includes('progress.approve')
  const canApprove = permissions.includes('progress.approve')

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">{tr('Факт по работам графика и журнал дня. Процент работ идёт в освоенный объём (EV), поэтому подтверждённый факт сразу виден в разделе «Контроль».')}</p>
      <nav aria-label={tr('Разделы')} className="flex gap-1 border-b">
        {(
          [
            ['entry', tr('Ввод факта')],
            ['journal', tr('Журнал дня')],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            to="/projects/$code/progress"
            params={{ code }}
            search={{ tab: value === 'entry' ? undefined : value }}
            aria-current={tab === value ? 'page' : undefined}
            className={`-mb-px min-h-11 content-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'journal' ? (
        <JournalTab projectId={p.id} canWrite={permissions.includes('daily_log.create') || permissions.includes('daily_log.approve')} canApprove={permissions.includes('daily_log.approve')} />
      ) : (
        <ProgressEntryTab projectId={p.id} canReport={canReport} canApprove={canApprove} canMethod={permissions.includes('schedule.edit')} />
      )}
    </div>
  )
}
