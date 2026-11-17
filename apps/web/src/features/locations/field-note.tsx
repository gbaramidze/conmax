import { tr } from '@/lib/tr'
import type { JSONContent } from '@tiptap/react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Camera, Image as ImageIcon, Send } from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { copyNoteToEntity, MAX_FILE_BYTES, postComment } from '@/features/activity/api'
import { PickedFile } from '@/features/activity/picked-file'
import { useAuth } from '@/features/auth/auth-provider'
import { orgMembersQuery } from '@/features/contractors/api'
import { LocationPicker, readRecentLocations, rememberLocation } from '@/features/locations/location-picker'
import { AddresseePicker } from '@/features/notes/addressee-picker'
import { NearbyNotes } from '@/features/notes/nearby-notes'
import { addresseeIds, addresseeReady, NO_ADDRESSEE, registerNote, type Addressee } from '@/features/notes/api'
import { EXTERNAL_PROJECT_ROLE_CODES, myPermissionsQuery } from '@/features/projects/api'
import { createTask } from '@/features/tasks/api'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent

function toDoc(text: string): JSONContent {
  const t = text.trim()
  return t ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } : EMPTY_DOC
}

/**
 * Заметка с площадки: «Снять» → место → фото → пара слов → кому (сотруднику или подрядчику) → «Отправить».
 * Сохраняется как комментарий к месту (виден в ленте этажа/помещения) и попадает в раздел «Заметки»; при желании сразу создаётся задача или замечание.
 */
export function FieldNoteSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tenantId } = useAuth()
  const { code } = useParams({ strict: false }) as { code?: string }
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canInternal = permissions.includes('comment.internal.create')
  const canTask = permissions.includes('task.create')

  const [location, setLocation] = useState<string | null>(() => readRecentLocations(projectId)[0] ?? null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [forExternal, setForExternal] = useState(false)
  const [addressee, setAddressee] = useState<Addressee>(NO_ADDRESSEE)
  const { data: members = [] } = useQuery(orgMembersQuery(projectId))
  const [asTask, setAsTask] = useState<'none' | 'task' | 'punch'>('none')
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  // подрядчик и внешние участники не видят внутренние заметки: адресату-подрядчику заметка всегда открыта
  const addresseeIsExternal =
    !!addressee.org || (!!addressee.user && EXTERNAL_PROJECT_ROLE_CODES.includes(members.find((m) => m.user?.id === addressee.user)?.role?.code ?? ''))
  const visibility = !canInternal || forExternal || addresseeIsExternal ? 'external' : 'internal'
  const ready = !!location && addresseeReady(addressee) && (text.trim().length > 0 || files.length > 0)

  function addFiles(list: FileList | null, input: React.RefObject<HTMLInputElement | null>) {
    if (!list) return
    const picked = Array.from(list)
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES)
    if (tooBig.length > 0) toast.error(tr('Файл больше 150 МБ не загрузить: {{v1}}', { v1: tooBig.map((f) => f.name).join(', ') }))
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)])
    if (input.current) input.current.value = ''
  }

  const send = useMutation({
    mutationFn: async () => {
      const body = toDoc(text)
      const note = await postComment({
        entity: { type: 'location', id: location! },
        projectId,
        tenantId: tenantId!,
        body,
        visibility,
        files,
      })
      // заметка попадает в раздел «Заметки» вместе с адресатом
      const to = addresseeIds(addressee)
      await registerNote({ commentId: note.commentId, userId: to.user, orgId: to.org })
      // фото уже загружены — теперь можно разослать push всем на проекте (с фото в уведомлении); сбой рассылки заметку не отменяет
      await supabase.rpc('field_note_notify', { p_comment: note.commentId }).then(() => undefined, () => undefined)
      let taskKey: string | null = null
      if (asTask !== 'none') {
        const title = text.trim().replace(/\s+/g, ' ').slice(0, 120) || (asTask === 'punch' ? tr('Замечание по месту') : tr('Задача по месту'))
        const task = await createTask({ projectId, title, type: asTask, locationId: location })
        taskKey = task.key
        await registerNote({ commentId: note.commentId, userId: to.user, orgId: to.org, taskId: task.id }).catch(() => undefined)
        // фото и текст заметки переходят в задачу без повторной загрузки
        if (note.fileIds.length > 0 || text.trim()) {
          await copyNoteToEntity({ entity: { type: 'task', id: task.id }, body, fileIds: note.fileIds, visibility: canInternal ? 'internal' : 'external' })
        }
      }
      return { note, taskKey }
    },
    onSuccess: async ({ note, taskKey }) => {
      rememberLocation(projectId, location!)
      setText('')
      setFiles([])
      setAsTask('none')
      setAddressee(NO_ADDRESSEE)
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ['activity'] })
      await queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      if (note.failedFiles.length > 0) toast.error(tr('Заметка сохранена, но не загрузились: {{v1}}', { v1: note.failedFiles.join(', ') }))
      else toast.success(taskKey ? tr('Заметка сохранена, создана {{taskKey}}', { taskKey }) : tr('Заметка сохранена'))
    },
    onError: () => toast.error(tr('Не удалось сохранить заметку. Данные остались в форме — попробуйте ещё раз.')),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[94svh] gap-0 overflow-y-auto rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-lg">
        <SheetHeader className="gap-1 border-b p-4 pr-14">
          <SheetTitle>{tr('Заметка с площадки')}</SheetTitle>
          <SheetDescription>{tr('Фото и пара слов к этажу или помещению. Её увидят коллеги, она попадёт в раздел «Заметки».')}</SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-col gap-5 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !send.isPending) send.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label>{tr('Где')}</Label>
            <LocationPicker projectId={projectId} value={location} onChange={setLocation} />
            <NearbyNotes projectId={projectId} code={code} locationId={location} onNavigate={() => onOpenChange(false)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Фото')}</Label>
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files, camera)} />
            <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files, gallery)} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => camera.current?.click()}>
                <Camera />{tr('Снять')}</Button>
              <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => gallery.current?.click()}>
                <ImageIcon />{tr('Из галереи')}</Button>
            </div>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-3 pt-2">
                {files.map((f, i) => (
                  <PickedFile key={`${f.name}-${i}`} file={f} onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="note-text">{tr('Что здесь происходит')}</Label>
            <Textarea id="note-text" rows={3} placeholder={tr('Например: трещина в стяжке у окна, нужна проверка')} value={text} onChange={(e) => setText(e.target.value)} className="text-base md:text-sm" />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Кому')}</Label>
            <AddresseePicker projectId={projectId} value={addressee} onChange={setAddressee} />
          </div>

          {canTask && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{tr('Что сделать с заметкой')}</legend>
              {(
                [
                  ['none', tr('Только заметка'), tr('Останется в разделе «Заметки» и в ленте места, без задачи')],
                  ['punch', tr('Заметка и замечание'), tr('Ещё и замечание в задачах: у него есть статус, исполнитель и срок')],
                  ['task', tr('Заметка и задача'), tr('Ещё и задача в списке задач: у неё есть статус, исполнитель и срок')],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 has-[:checked]:border-foreground">
                  <input type="radio" name="as-task" className="size-4 shrink-0" checked={asTask === value} onChange={() => setAsTask(value)} />
                  <span className="flex flex-col">
                    <span className="text-sm">{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {canInternal && (
            <label className={`flex min-h-11 items-center gap-3 text-sm ${addresseeIsExternal ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="checkbox" className="size-5" checked={forExternal || addresseeIsExternal} disabled={addresseeIsExternal} onChange={(e) => setForExternal(e.target.checked)} />{tr('Показать подрядчикам и заказчику')}</label>
          )}

          <Button type="submit" size="lg" disabled={!ready || send.isPending}>
            <Send /> {send.isPending ? tr('Отправляем…') : tr('Отправить')}
          </Button>
          {!ready && <p className="-mt-3 text-center text-xs text-muted-foreground">{!location || !(text.trim().length > 0 || files.length > 0) ? tr('Выберите место и добавьте фото или описание.') : tr('Выберите, кому адресована заметка.')}</p>}
        </form>
      </SheetContent>
    </Sheet>
  )
}
