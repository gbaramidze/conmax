import { BackButton } from '@/components/app-shell/back-button'
import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activityLoader } from '@/features/activity/loader'
import { projectByCodeQuery } from '@/features/projects/api'
import { DEFAULT_TASK_SEARCH, taskByKeyQuery } from '@/features/tasks/api'
import { TaskPanel } from '@/features/tasks/task-panel'

// Паттерн «Detail / Record»: вся задача на отдельной странице (та же карточка, что и в боковой панели)
export const Route = createFileRoute('/_app/projects/$code/task/$key')({
  loader: async ({ context: { queryClient }, params }) => {
    const task = await queryClient.ensureQueryData(taskByKeyQuery(params.key))
    if (!task) throw notFound()
    await activityLoader(queryClient, { type: 'task', id: task.id })
  },
  notFoundComponent: () => (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
      <p className="font-medium">{tr('Задача не найдена')}</p>
      <p className="text-sm text-muted-foreground">{tr('Возможно, она удалена или у вас нет к ней доступа.')}</p>
    </div>
  ),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем задачу…')}</p>,
  component: TaskPage,
})

function TaskPage() {
  const { code, key } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const { data: task } = useSuspenseQuery(taskByKeyQuery(key))
  if (!task || !project) return null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <div>
        <BackButton fallback={
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$code/tasks" params={{ code }} search={DEFAULT_TASK_SEARCH}>
            <ChevronLeft />{tr('Все задачи')}</Link>
        </Button>
} />
      </div>
      <div className="rounded-lg border bg-card p-4 shadow-soft md:p-6">
        <TaskPanel task={task} projectId={project.id} layout="page" />
      </div>
    </div>
  )
}
