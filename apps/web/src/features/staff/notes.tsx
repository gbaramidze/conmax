import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Award, BellRing, Check, EyeOff, Gift, MessageSquareWarning, NotebookPen, Trash2, TrendingUp, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Textarea } from '@/components/ui/textarea'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { addNote, deleteNote, NOTE_KIND_LABELS, notesQuery, staffError, updateNote, type Employee, type NoteKind } from '@/features/staff/api'
import { fmtDate, todayIso, useStaffAccess } from '@/features/staff/ui'

const KIND_ICONS: Record<NoteKind, LucideIcon> = {
  note: NotebookPen,
  achievement: Award,
  bonus: Gift,
  raise: TrendingUp,
  concern: MessageSquareWarning,
}

/** Конец года — частая дата для бонуса */
const yearEnd = () => `${new Date().getFullYear()}-12-20`

/**
 * Заметки руководителей о сотруднике: достижения, бонус, повышение, замечания. Видят автор, руководители сотрудника
 * по цепочке и право staff.notes.view. Сам сотрудник не видит их никогда (проверяет база), поэтому вкладку ему не показываем.
 * Дата напоминания — автору придёт уведомление и письмо в этот день (например, «начислить бонус в конце года»).
 */
export function ManagerNotes({ person }: { person: Employee }) {
  const qc = useQueryClient()
  const { data: notes } = useSuspenseQuery(notesQuery(person.id))
  const { me, byId } = useStaffAccess()
  const [kind, setKind] = useState<NoteKind>('note')
  const [body, setBody] = useState('')
  const [remind, setRemind] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff', 'notes', person.id] })

  const add = useMutation({
    mutationFn: () => addNote({ user_id: person.id, kind, body: body.trim(), remind_on: remind || null }),
    onSuccess: () => {
      setBody('')
      setRemind('')
      setKind('note')
      toast.success(remind ? tr('Заметка сохранена, напомним {{v1}}', { v1: fmtDate(remind) }) : tr('Заметка сохранена'))
      refresh()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const toggleDone = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => updateNote(v.id, { done_at: v.done ? new Date().toISOString() : null }),
    onSuccess: refresh,
    onError: (e) => toast.error(staffError(e)),
  })
  const remove = useMutation({ mutationFn: deleteNote, onSuccess: refresh, onError: (e) => toast.error(staffError(e)) })

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-signal/60 bg-signal/10 px-3 py-2.5 text-sm">
        <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{tr('{{v1}} не видит эти заметки. Их видят только авторы, руководители сотрудника и отдел кадров.', { v1: person.full_name })}</span>
      </p>

      <form
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) add.mutate()
        }}
      >
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tr('Тип заметки')}>
          {(Object.keys(NOTE_KIND_LABELS) as NoteKind[]).map((k) => {
            const Icon = KIND_ICONS[k]
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k)
                  if (k === 'bonus' && !remind) setRemind(yearEnd())
                }}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  kind === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                <Icon className="size-4" aria-hidden /> {NOTE_KIND_LABELS[k]}
              </button>
            )
          })}
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          aria-label={tr('Текст заметки')}
          placeholder={kind === 'bonus' ? tr('За что и какой бонус, например: «Добавил новые функции в систему — бонус в конце года»') : tr('Что важно помнить о сотруднике')}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {tr('Напомнить мне')}
            <DatePicker value={remind} onChange={setRemind} min={todayIso()} placeholder={tr('без напоминания')} className="w-48" aria-label={tr('Дата напоминания')} />
          </label>
          <Button type="submit" className="ml-auto" disabled={!body.trim() || add.isPending}>
            {tr('Сохранить заметку')}
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Заметок пока нет.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => {
            const Icon = KIND_ICONS[n.kind]
            const author = byId.get(n.author_id)
            const mine = n.author_id === me
            return (
              <li key={n.id} className={cn('flex gap-3 rounded-lg border bg-card p-3 shadow-soft', n.done_at && 'opacity-60')}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{NOTE_KIND_LABELS[n.kind]}</span>
                    <span>{author?.full_name ?? tr('бывший сотрудник')}</span>
                    <span>{fmtDate(n.created_at)}</span>
                    {n.remind_on && !n.done_at && (
                      <span className={cn('inline-flex items-center gap-1', n.reminded_at ? 'text-foreground' : '')}>
                        <BellRing className="size-3" aria-hidden />
                        {n.reminded_at ? tr('напомнили {{v1}}', { v1: fmtDate(n.remind_on) }) : tr('напомнить {{v1}}', { v1: fmtDate(n.remind_on) })}
                      </span>
                    )}
                    {n.done_at && <span>{tr('выполнено')}</span>}
                  </div>
                  <p className={cn('whitespace-pre-wrap text-sm', n.done_at && 'line-through')}>{n.body}</p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => toggleDone.mutate({ id: n.id, done: !n.done_at })}
                    aria-label={n.done_at ? tr('Вернуть в работу') : tr('Отметить выполненным')}
                    title={n.done_at ? tr('Вернуть в работу') : tr('Отметить выполненным')}
                  >
                    <Check />
                  </Button>
                  {mine && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => window.confirm(tr('Удалить заметку?')) && remove.mutate(n.id)}
                      aria-label={tr('Удалить заметку')}
                      title={tr('Удалить заметку')}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
