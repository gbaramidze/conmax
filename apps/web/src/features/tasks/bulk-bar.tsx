import { tr } from '@/lib/tr'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenDisciplines, type DisciplineRow } from '@/features/disciplines/api'
import { projectMembersQuery } from '@/features/projects/api'
import { PRIORITY_LABELS, updateTask, type Priority, type TaskPatch, type TaskRow } from '@/features/tasks/api'

const KEEP = '__keep__'
const NONE = '__none__'

/**
 * Массовые действия над выбранными задачами: исполнитель, срок, приоритет, направление.
 * Применяются к каждой задаче отдельно, с правами пользователя: то, что нельзя, пропускается и считается в итоге.
 */
export function BulkBar({
  projectId,
  selected,
  canAssign,
  disciplineRows,
  onClear,
}: {
  projectId: string
  selected: TaskRow[]
  canAssign: boolean
  disciplineRows: DisciplineRow[]
  onClear: () => void
}) {
  const queryClient = useQueryClient()
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState('')

  async function apply(patch: TaskPatch, label: string) {
    setBusy(true)
    let ok = 0
    let failed = 0
    // небольшими пачками, чтобы не перегружать сеть
    for (let i = 0; i < selected.length; i += 5) {
      const results = await Promise.allSettled(selected.slice(i, i + 5).map((t) => updateTask(t.id, patch)))
      for (const r of results) r.status === 'fulfilled' ? ok++ : failed++
    }
    await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['activity'] })
    setBusy(false)
    if (failed === 0) toast.success(`${label}: ${ok} ${ok === 1 ? tr('задача') : tr('задач')}`)
    else toast.error(tr('{{label}}: изменено {{ok}}, не удалось {{failed}} (нет прав или задача уже изменена)', { label, ok, failed }))
  }

  return (
    <div
      role="region"
      aria-label={tr('Действия над выбранными задачами')}
      className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-lg"
    >
      <span className="text-sm font-medium">{tr('Выбрано:')}{' '}{selected.length}</span>

      {canAssign && (
        <Select value={KEEP} disabled={busy} onValueChange={(v) => void apply({ assignee_id: v === NONE ? null : v }, tr('Исполнитель назначен'))}>
          <SelectTrigger size="sm" aria-label={tr('Назначить исполнителя')} className="w-48">
            <SelectValue placeholder={tr('Исполнитель')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KEEP} disabled>{tr('Исполнитель…')}</SelectItem>
            <SelectItem value={NONE}>{tr('Без исполнителя')}</SelectItem>
            {(members ?? []).map((m) => (m.user ? <SelectItem key={m.user.id} value={m.user.id}>{m.user.full_name}</SelectItem> : null))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1">
        <Calendar className="size-4 text-muted-foreground" aria-hidden />
        <DatePicker aria-label={tr('Срок для выбранных')} className="h-8 w-40" value={date} disabled={busy} onChange={(v) => setDate(v)} />
        <Button size="sm" variant="outline" disabled={busy || !date} onClick={() => void apply({ due_date: date }, tr('Срок изменён')).then(() => setDate(''))}>{tr('Назначить срок')}</Button>
      </div>

      <Select value={KEEP} disabled={busy} onValueChange={(v) => void apply({ priority: v as Priority }, tr('Приоритет изменён'))}>
        <SelectTrigger size="sm" aria-label={tr('Приоритет для выбранных')} className="w-40">
          <SelectValue placeholder={tr('Приоритет')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP} disabled>{tr('Приоритет…')}</SelectItem>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={KEEP} disabled={busy} onValueChange={(v) => void apply({ discipline_id: v === NONE ? null : v }, tr('Направление изменено'))}>
        <SelectTrigger size="sm" aria-label={tr('Направление для выбранных')} className="w-44">
          <SelectValue placeholder={tr('Направление')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={KEEP} disabled>{tr('Направление…')}</SelectItem>
          <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
          {flattenDisciplines(disciplineRows).map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span style={{ paddingLeft: d.depth * 12 }}>
                <span className="ident text-muted-foreground">{d.code}</span> {d.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear} disabled={busy}>
        <X />{tr('Снять выбор')}</Button>
    </div>
  )
}
