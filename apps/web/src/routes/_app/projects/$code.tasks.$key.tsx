import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { activityLoader } from '@/features/activity/loader'
import { projectByCodeQuery } from '@/features/projects/api'
import { taskByKeyQuery } from '@/features/tasks/api'
import { TaskPanel } from '@/features/tasks/task-panel'

export const Route = createFileRoute('/_app/projects/$code/tasks/$key')({
  loader: async ({ context: { queryClient }, params }) => {
    const task = await queryClient.ensureQueryData(taskByKeyQuery(params.key))
    if (!task) throw notFound()
    await activityLoader(queryClient, { type: 'task', id: task.id })
  },
  notFoundComponent: () => (
    <Sheet open>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{tr('Задача не найдена')}</SheetTitle>
          <SheetDescription>{tr('Возможно, она удалена или у вас нет к ней доступа.')}</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
  component: TaskSheet,
})

function TaskSheet() {
  const { code, key } = Route.useParams()
  const navigate = useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const { data: task } = useSuspenseQuery(taskByKeyQuery(key))
  const search = Route.useSearch() // параметры списка наследуются: закрыв карточку, возвращаемся к тому же виду списка
  const close = () => void navigate({ to: '/projects/$code/tasks', params: { code }, search })

  if (!task || !project) return null

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      {/* Широкая панель: поля стоят справа от содержимого; на узком экране панель на всю ширину */}
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl data-[side=right]:lg:max-w-4xl data-[side=right]:xl:max-w-5xl">
        <SheetHeader>
          <SheetTitle className="sr-only">{task.key}</SheetTitle>
          <SheetDescription className="sr-only">{tr('Карточка задачи')}{' '}{task.key}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <TaskPanel task={task} projectId={project.id} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
