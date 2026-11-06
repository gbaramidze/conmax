import { tr } from '@/lib/tr'
import type { JSONContent } from '@tiptap/react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Camera, Image as ImageIcon, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { copyNoteToEntity, MAX_FILE_BYTES, postComment } from '@/features/activity/api'
import { PickedFile } from '@/features/activity/picked-file'
import { useAuth } from '@/features/auth/auth-provider'
import { LocationPicker, readRecentLocations, rememberLocation } from '@/features/locations/location-picker'
import { myPermissionsQuery } from '@/features/projects/api'
import { createTask } from '@/features/tasks/api'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent

function toDoc(text: string): JSONContent {
  const t = text.trim()
  return t ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } : EMPTY_DOC
}

/**
 * Заметка с площадки: «Снять» → место → фото → пара слов → «Отправить».
 * Сохраняется как комментарий к месту (виден в ленте этажа/помещения); при желании сразу создаётся задача или замечание.
 */
export function FieldNoteSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canInternal = permissions.includes('comment.internal.create')
  const canTask = permissions.includes('task.create')

  const [location, setLocation] = useState<string | null>(() => readRecentLocations(projectId)[0] ?? null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [forExternal, setForExternal] = useState(false)
  const [asTask, setAsTask] = useState<'none' | 'task' | 'punch'>('none')
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  const visibility = !canInternal || forExternal ? 'external' : 'internal'
  const ready = !!location && (text.trim().length > 0 || files.length > 0)

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
      let taskKey: string | null = null
      if (asTask !== 'none') {
        const title = text.trim().replace(/\s+/g, ' ').slice(0, 120) || (asTask === 'punch' ? tr('Замечание по месту') : tr('Задача по месту'))
        const task = await createTask({ projectId, title, type: asTask, locationId: location })
        taskKey = task.key
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
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ['activity'] })
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
          <SheetDescription>{tr('Фото и пара слов к этажу или помещению. Коллеги увидят её в ленте места.')}</SheetDescription>
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

          {canTask && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{tr('Что сделать с заметкой')}</legend>
              {(
                [
                  ['none', tr('Только сохранить')],
                  ['punch', tr('Создать замечание')],
                  ['task', tr('Создать задачу')],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 has-[:checked]:border-foreground">
                  <input type="radio" name="as-task" className="size-4" checked={asTask === value} onChange={() => setAsTask(value)} />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </fieldset>
          )}

          {canInternal && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={forExternal} onChange={(e) => setForExternal(e.target.checked)} />{tr('Показать подрядчикам и заказчику')}</label>
          )}

          <Button type="submit" size="lg" disabled={!ready || send.isPending}>
            <Send /> {send.isPending ? tr('Отправляем…') : tr('Отправить')}
          </Button>
          {!ready && <p className="-mt-3 text-center text-xs text-muted-foreground">{tr('Выберите место и добавьте фото или описание.')}</p>}
        </form>
      </SheetContent>
    </Sheet>
  )
}
