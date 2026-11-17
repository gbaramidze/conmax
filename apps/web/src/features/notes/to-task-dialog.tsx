import { tr } from '@/lib/tr'
import type { JSONContent } from '@tiptap/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyNoteToEntity } from '@/features/activity/api'
import { linkNoteTask, notePhotos, noteAddresseeName, type NoteRow } from '@/features/notes/api'
import { UserAvatar } from '@/features/profile/avatar'
import { projectMembersQuery } from '@/features/projects/api'
import { createTask } from '@/features/tasks/api'
import { cn } from '@/lib/utils'

type Kind = 'task' | 'punch'

function toDoc(text: string): JSONContent {
  const t = text.trim()
  return t ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } : { type: 'doc', content: [{ type: 'paragraph' }] }
}

/**
 * «Создать задачу из заметки»: решение принимают, когда заметку открыли и разобрались, а не в момент съёмки.
 * Название берётся из текста, исполнитель и организация — из адресата заметки; текст и фото переходят в задачу без повторной загрузки,
 * заметка запоминает созданную задачу.
 */
export function NoteToTaskDialog({ note, projectId, canAssign, canInternal, onClose, onCreated }: { note: NoteRow; projectId: string; canAssign: boolean; canInternal: boolean; onClose: () => void; onCreated: (key: string) => void }) {
  const queryClient = useQueryClient()
  const text = note.comment?.body_text.trim() ?? ''
  const [kind, setKind] = useState<Kind>('task')
  const [title, setTitle] = useState(() => text.replace(/\s+/g, ' ').slice(0, 120))
  const [assignee, setAssignee] = useState(note.addressee_user_id ?? '')
  const [due, setDue] = useState('')
  const { data: members = [] } = useQuery({ ...projectMembersQuery(projectId), enabled: canAssign })

  const create = useMutation({
    mutationFn: async () => {
      const t = title.trim() || (kind === 'punch' ? tr('Замечание по месту') : tr('Задача по месту'))
      const task = await createTask({
        projectId,
        title: t,
        type: kind,
        assigneeId: assignee || null,
        dueDate: due || null,
        locationId: note.location_id,
        organizationId: assignee ? null : note.addressee_org_id,
      })
      const fileIds = notePhotos(note).map((f) => f.id)
      // фото и текст заметки переходят в задачу; сбой копирования задачу не отменяет
      if (text || fileIds.length > 0) {
        await copyNoteToEntity({ entity: { type: 'task', id: task.id }, body: toDoc(text), fileIds, visibility: canInternal && note.comment?.visibility === 'internal' ? 'internal' : 'external' }).catch(() => toast.warning(tr('Задача создана, но текст и фото заметки в неё не скопировались.')))
      }
      await linkNoteTask(note.comment_id, task.id).catch(() => undefined)
      return task
    },
    onSuccess: async ({ key }) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks', projectId] }), queryClient.invalidateQueries({ queryKey: ['notes', projectId] })])
      toast.success(tr('Создана {{key}}', { key }))
      onCreated(key)
      onClose()
    },
    onError: () => toast.error(tr('Не удалось создать задачу. Попробуйте ещё раз.')),
  })

  const options = members.flatMap((m) =>
    m.user ? [{ value: m.user.id, label: m.user.full_name, hint: m.title ?? m.role?.name ?? m.organization?.name ?? undefined, avatar: <UserAvatar name={m.user.full_name} path={m.user.avatar_path} className="size-8 text-xs" /> }] : [],
  )
  const addressee = noteAddresseeName(note)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Создать из заметки')}</DialogTitle>
          <DialogDescription>{tr('Текст и фото заметки перейдут в задачу. Заметка запомнит, какая задача из неё создана.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!create.isPending) create.mutate()
          }}
        >
          <div role="radiogroup" aria-label={tr('Что создать')} className="grid grid-cols-2 gap-2">
            {(
              [
                ['task', tr('Задача')],
                ['punch', tr('Замечание')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn('min-h-11 rounded-lg border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', kind === k ? 'border-primary bg-primary font-semibold text-signal' : 'bg-card hover:bg-muted/60')}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-title">{tr('Название')}</Label>
            <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-11 text-base md:text-sm" placeholder={tr('Что нужно сделать')} />
          </div>
          {canAssign ? (
            <div className="flex flex-col gap-2">
              <Label>{tr('Исполнитель')}</Label>
              <SearchSelect value={assignee} onChange={setAssignee} options={options} noneLabel={addressee && !note.addressee_user_id ? tr('Не назначать (организация: {{name}})', { name: addressee }) : tr('Не назначать')} ariaLabel={tr('Исполнитель')} />
            </div>
          ) : addressee ? (
            <p className="text-sm text-muted-foreground">{tr('Адресат заметки: {{name}}', { name: addressee })}</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-due">{tr('Срок')}</Label>
            <DatePicker id="nt-due" value={due} onChange={setDue} />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? tr('Создаём…') : kind === 'punch' ? tr('Создать замечание') : tr('Создать задачу')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
