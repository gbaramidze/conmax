import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTask, DEFAULT_TASK_SEARCH, subtasksQuery, type TaskRow } from '@/features/tasks/api'
import { StatusBadge } from '@/features/tasks/status-badge'

/** Подзадачи: список со статусами, полоса прогресса и быстрое добавление. */
export function SubtasksSection({ task, projectId, canCreate }: { task: TaskRow; projectId: string; canCreate: boolean }) {
  const { code } = useParams({ strict: false }) as { code: string }
  const queryClient = useQueryClient()
  const { data: subs = [] } = useQuery(subtasksQuery(task.id))
  const [title, setTitle] = useState('')

  const counted = subs.filter((s) => s.status_category !== 'cancelled')
  const done = counted.filter((s) => s.status_category === 'done').length
  const percent = counted.length ? Math.round((done / counted.length) * 100) : 0

  const add = useMutation({
    mutationFn: () => createTask({ projectId, title: title.trim(), parentId: task.id }),
    onSuccess: async ({ key }) => {
      setTitle('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subtasks', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['task', task.key] }),
      ])
      toast.success(tr('Подзадача {{key}} создана', { key }))
    },
    onError: () => toast.error(tr('Не удалось создать подзадачу. Проверьте права и попробуйте ещё раз.')),
  })

  if (subs.length === 0 && !canCreate) return null

  return (
    <section className="flex flex-col gap-3" aria-labelledby="subtasks-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="subtasks-title" className="text-sm font-semibold">{tr('Подзадачи')}{' '}{counted.length > 0 && <span className="font-normal text-muted-foreground">{done}{tr('из')}{' '}{counted.length}</span>}
        </h3>
      </div>

      {counted.length > 0 && (
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={tr('Выполнено подзадач')}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}

      {subs.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {subs.map((s) => (
            <li key={s.id}>
              <Link
                to="/projects/$code/tasks/$key"
                params={{ code, key: s.key }}
                search={DEFAULT_TASK_SEARCH}
                className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-muted/50"
              >
                <span className="ident shrink-0 text-muted-foreground">{s.key}</span>
                <span className={`min-w-0 flex-1 truncate text-sm ${s.status_category === 'done' ? 'text-muted-foreground line-through' : ''}`}>
                  {s.title}
                </span>
                {s.status && <StatusBadge name={s.status.name} category={s.status.category} />}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canCreate && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && !add.isPending) add.mutate()
          }}
        >
          <Input aria-label={tr('Название подзадачи')} placeholder={tr('Добавить подзадачу')} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!title.trim() || add.isPending} aria-label={tr('Добавить подзадачу')}>
            <Plus />
          </Button>
        </form>
      )}
    </section>
  )
}
