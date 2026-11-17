import { tr } from '@/lib/tr'
import type { JSONContent } from '@tiptap/react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Camera, Image as ImageIcon, MapPin, Send } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { MAX_FILE_BYTES, postComment } from '@/features/activity/api'
import { PickedFile } from '@/features/activity/picked-file'
import { useAuth } from '@/features/auth/auth-provider'
import { orgMembersQuery } from '@/features/contractors/api'
import { LocationPicker, readRecentLocations, rememberLocation } from '@/features/locations/location-picker'
import { AddresseePicker } from '@/features/notes/addressee-picker'
import { NearbyNotes } from '@/features/notes/nearby-notes'
import { schemeOptionsQuery } from '@/features/inspections/api'
import { SchemeView } from '@/features/inspections/scheme-view'
import { addresseeIds, addresseeReady, NO_ADDRESSEE, ownSchemes, registerNote, type Addressee, type NotePoint } from '@/features/notes/api'
import { SchemePointDialog } from '@/features/notes/scheme-point-dialog'
import { EXTERNAL_PROJECT_ROLE_CODES, myPermissionsQuery } from '@/features/projects/api'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent

function toDoc(text: string): JSONContent {
  const t = text.trim()
  return t ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } : EMPTY_DOC
}

/**
 * Заметка с площадки: «Снять» → место → фото → пара слов → кому (сотруднику или подрядчику) → «Отправить».
 * Сохраняется как комментарий к месту (виден в ленте этажа/помещения) и попадает в раздел «Заметки». Задачу из заметки создают позже, в её карточке.
 */
export function FieldNoteSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tenantId } = useAuth()
  const { code } = useParams({ strict: false }) as { code?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canInternal = permissions.includes('comment.internal.create')

  const [location, setLocation] = useState<string | null>(() => readRecentLocations(projectId)[0] ?? null)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [forExternal, setForExternal] = useState(false)
  const [addressee, setAddressee] = useState<Addressee>(NO_ADDRESSEE)
  // точка на схеме места (как в инспекции): кнопка есть, только если у места есть схема
  const [point, setPoint] = useState<NotePoint | null>(null)
  const [pointOpen, setPointOpen] = useState(false)
  const { data: schemeOptions = [], isFetched: schemesReady } = useQuery(schemeOptionsQuery(location))
  const schemes = ownSchemes(schemeOptions) // схема вышестоящего узла (план этажа для комнаты) не подходит
  const { data: members = [] } = useQuery(orgMembersQuery(projectId))
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
        isNote: true,
      })
      // заметка попадает в раздел «Заметки» вместе с адресатом
      const to = addresseeIds(addressee)
      await registerNote({ commentId: note.commentId, userId: to.user, orgId: to.org, point })
      // фото уже загружены — теперь можно разослать push всем на проекте (с фото в уведомлении); сбой рассылки заметку не отменяет
      await supabase.rpc('field_note_notify', { p_comment: note.commentId }).then(() => undefined, () => undefined)
      return { note }
    },
    onSuccess: async ({ note }) => {
      rememberLocation(projectId, location!)
      setText('')
      setFiles([])
      setAddressee(NO_ADDRESSEE)
      setPoint(null)
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ['activity'] })
      await queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
      if (note.failedFiles.length > 0) toast.error(tr('Заметка сохранена, но не загрузились: {{v1}}', { v1: note.failedFiles.join(', ') }))
      else
        toast.success(tr('Заметка сохранена'), {
          action: code ? { label: tr('Открыть'), onClick: () => void navigate({ to: '/projects/$code/note/$id', params: { code, id: note.commentId } }) } : undefined,
        })
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
            <LocationPicker
              projectId={projectId}
              value={location}
              onChange={(id) => {
                setLocation(id)
                setPoint(null) // точка относится к схеме прежнего места
              }}
            />
            {location && schemesReady && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant={point ? 'secondary' : 'outline'} size="lg" className="max-sm:flex-1" disabled={schemes.length === 0} onClick={() => setPointOpen(true)}>
                    <MapPin />{point ? tr('Изменить точку на схеме') : tr('Отметить на схеме')}</Button>
                  {point && (
                    <button type="button" onClick={() => setPoint(null)} className="min-h-11 px-1 text-sm font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-9">
                      {tr('Убрать точку')}
                    </button>
                  )}
                </div>
                {schemes.length === 0 && <p className="text-xs text-muted-foreground">{tr('У этого места нет своей схемы. Привяжите план к месту в документах, и здесь можно будет отметить точку.')}</p>}
                {/* миниатюра схемы с отмеченной точкой: нажатие открывает схему крупно */}
                {point?.source && (
                  <div className="flex flex-col gap-1">
                    <SchemeView source={point.source} alt={tr('Схема места')} markers={[]} draft={{ x: point.x, y: point.y }} onOpen={() => setPointOpen(true)} maxHeightClass="max-h-40" />
                    {point.title && <p className="truncate text-xs text-muted-foreground">{point.title}</p>}
                  </div>
                )}
              </div>
            )}
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

          {canInternal && (
            <label className={`flex min-h-11 items-center gap-3 text-sm ${addresseeIsExternal ? 'opacity-70' : 'cursor-pointer'}`}>
              <input type="checkbox" className="size-5" checked={forExternal || addresseeIsExternal} disabled={addresseeIsExternal} onChange={(e) => setForExternal(e.target.checked)} />{tr('Показать подрядчикам и заказчику')}</label>
          )}

          <Button type="submit" size="lg" disabled={!ready || send.isPending}>
            <Send /> {send.isPending ? tr('Отправляем…') : tr('Отправить')}
          </Button>
          {!ready && <p className="-mt-3 text-center text-xs text-muted-foreground">{!location || !(text.trim().length > 0 || files.length > 0) ? tr('Выберите место и добавьте фото или описание.') : tr('Выберите, кому адресована заметка.')}</p>}
        </form>
        {pointOpen && location && <SchemePointDialog locationId={location} value={point} onClose={() => setPointOpen(false)} onSave={setPoint} />}
      </SheetContent>
    </Sheet>
  )
}
