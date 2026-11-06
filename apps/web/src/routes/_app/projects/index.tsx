import { tr } from '@/lib/tr'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { MapPin, Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtPercent, projectsProgressQuery, type ProjectProgress } from '@/features/dashboard/api'
import { ProjectCover } from '@/features/projects/cover'
import { HEALTH_STYLES, portfolioHealthQuery } from '@/features/signals/api'
import { myPermissionsQuery, projectKindLabel, projectsQuery, projectStatusLabel } from '@/features/projects/api'

/** Готовность проекта: тонкая полоса + число; красная метка, если есть открытые расхождения с проверкой. */
function Readiness({ progress }: { progress: ProjectProgress | undefined }) {
  if (!progress || progress.items === 0) return <span className="text-sm text-muted-foreground">{tr('нет плана объёмов')}</span>
  return (
    <span className="flex items-center gap-3">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="presentation">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent ?? 0}%` }} />
      </span>
      <span className="text-sm font-medium tabular-nums">{fmtPercent(progress.percent)}</span>
      {progress.open_discrepancies > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-300" title={tr('Открытые расхождения с проверкой')}>
          <ShieldAlert className="size-3.5" aria-hidden /> {progress.open_discrepancies}
        </span>
      )}
    </span>
  )
}

export const Route = createFileRoute('/_app/projects/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(projectsQuery), queryClient.ensureQueryData(myPermissionsQuery())]),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем проекты…')}</p>,
  component: ProjectsPage,
})

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-500',
  draft: 'bg-muted-foreground/50',
  on_hold: 'bg-amber-500',
  completed: 'bg-blue-500',
  cancelled: 'bg-red-500',
  archived: 'bg-muted-foreground/40',
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${STATUS_DOT[status] ?? 'bg-muted-foreground/50'}`} aria-hidden />
      {projectStatusLabel(status)}
    </span>
  )
}

function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery())
  const canCreate = permissions.includes('project.create')
  const { data: progress } = useQuery(projectsProgressQuery)
  const { data: health } = useQuery(portfolioHealthQuery)

  const createButton = canCreate && (
    <Button asChild>
      <Link to="/projects/new">
        <Plus />{tr('Создать проект')}</Link>
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Проекты')}</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length === 0 ? tr('Пока ни одного') : tr('Доступно вам: {{length}}', { length: projects.length })}
          </p>
        </div>
        {projects.length > 0 && createButton}
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-soft">
          <p className="font-medium">{tr('Пока нет проектов')}</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {canCreate
              ? tr('Создайте первый проект — потом в нём появятся участники, график, задачи и бюджет.')
              : tr('Вас ещё не добавили ни в один проект. Попросите руководителя проекта пригласить вас.')}
          </p>
          {createButton}
        </div>
      ) : (
        <>
          {/* Карточки с фото: сразу видно, что за объект. Вся карточка нажимается */}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to="/projects/$code"
                  params={{ code: p.code }}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-soft outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                    <div className="size-full transition-transform duration-300 group-hover:scale-[1.03]">
                      <ProjectCover storageKey={p.cover?.storage_key} code={p.code} name={p.name} />
                    </div>
                    <span className="ident absolute left-3 top-3 rounded bg-primary px-2 py-1 text-xs text-signal shadow">{p.code}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <span className="truncate text-base font-semibold">{p.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <StatusDot status={p.status} />
                      <span>{projectKindLabel(p.kind)}</span>
                    </span>
                    <Readiness progress={progress?.get(p.id)} />
                    {health?.get(p.id) && (
                      <span className="flex items-center gap-2 text-sm" title={tr('Индекс здоровья проекта из 100')}>
                        <span className={`size-2.5 rounded-full ${HEALTH_STYLES[health.get(p.id)!.color].bg}`} aria-hidden />
                        <span className={`font-semibold tabular-nums ${HEALTH_STYLES[health.get(p.id)!.color].text}`}>{health.get(p.id)!.score}</span>
                        <span className="text-muted-foreground">{tr('здоровье')}</span>
                        {health.get(p.id)!.important > 0 && <span className="text-xs font-medium text-red-700 dark:text-red-300">{tr('· важных сигналов:')}{' '}{health.get(p.id)!.important}</span>}
                      </span>
                    )}
                    {p.address && (
                      <span className="mt-auto flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{p.address}</span>
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
