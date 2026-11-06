import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { FileUp, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MAX_FILE_BYTES, formatBytes } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { addVersion, createDocument, DOC_ERROR_TEXT, DOC_TYPE_LABELS, DocumentError, isViewableFile, titleFromFileName, type DocType } from '@/features/documents/api'
import { buildFolderTree, foldersQuery } from '@/features/documents/folders-api'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { FloorRangeButton } from '@/features/locations/floor-range'
import { LocationPicker } from '@/features/locations/location-picker'
import { myPermissionsQuery } from '@/features/projects/api'
import { organizationsListQuery } from '@/features/volumes/api'

const NONE = '__none__'

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['document'] }),
      queryClient.invalidateQueries({ queryKey: ['document-versions'] }),
      queryClient.invalidateQueries({ queryKey: ['entity-documents'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ])
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof DocumentError ? (DOC_ERROR_TEXT[e.code] ?? fallback) : fallback
}

function FilePicker({ file, onPick }: { file: File | null; onPick: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          if (f && f.size > MAX_FILE_BYTES) {
            toast.error(tr('Файл больше 150 МБ не загрузить.'))
            return
          }
          onPick(f)
          if (input.current) input.current.value = ''
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          <Button type="button" size="icon" variant="ghost" className="md:size-8" aria-label={tr('Убрать файл')} onClick={() => onPick(null)}>
            <X />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="h-14 border-dashed" onClick={() => input.current?.click()}>
          <FileUp />{tr('Выбрать файл (PDF, DWG, Excel, Word…)')}</Button>
      )}
    </div>
  )
}

/**
 * PDF для просмотра: нужен, когда сам файл (DWG и др.) на экране не открывается. Тогда на плане покажется эта печать,
 * а исходник останется для скачивания.
 */
export function PreviewPicker({ file, preview, onPick }: { file: File | null; preview: File | null; onPick: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  if (!file || isViewableFile(file.name, file.type)) return null
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{tr('PDF для просмотра на плане')}</p>
      <p className="text-xs text-muted-foreground">{tr('Этот формат на экране не открывается. Приложите PDF-печать чертежа: по ней можно смотреть план и ставить отметки замечаний, а')}{' '}{file.name.split('.').pop()?.toUpperCase() ?? tr('исходник')}{tr('останется для скачивания. Можно и позже, в самом документе.')}</p>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          if (input.current) input.current.value = ''
          if (f && f.size > MAX_FILE_BYTES) return void toast.error(tr('Файл больше 150 МБ не загрузить.'))
          onPick(f)
        }}
      />
      {preview ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{preview.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(preview.size)}</span>
          <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать PDF для просмотра')} onClick={() => onPick(null)}>
            <X />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}>
          <FileUp />{tr('Выбрать PDF')}</Button>
      )}
    </div>
  )
}

/** Новый документ: файл, название, шифр, направление, места, кому виден, нужно ли ознакомление. */
export function UploadDocumentDialog({
  projectId,
  presetLocationId,
  presetTaskId,
  presetFfeItemId,
  presetRoomTypeId,
  presetFolderId,
  onClose,
  onDone,
}: {
  projectId: string
  presetFolderId?: string | null
  presetLocationId?: string
  presetTaskId?: string
  presetFfeItemId?: string
  presetRoomTypeId?: string
  onClose: () => void
  onDone?: (documentId: string) => void
}) {
  const { tenantId } = useAuth()
  const refresh = useRefresh()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const externalOrgs = orgs.filter((o) => o.kind !== 'own')
  const canPublish = permissions.includes('document.publish')

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [docType, setDocType] = useState<DocType>('plan')
  const [discipline, setDiscipline] = useState(NONE)
  const { data: folderRows } = useQuery(foldersQuery(projectId))
  const folderList = useMemo(() => buildFolderTree(folderRows ?? []).flat, [folderRows])
  const [folder, setFolder] = useState(presetFolderId ?? NONE)
  const [locationIds, setLocationIds] = useState<string[]>(presetLocationId ? [presetLocationId] : [])
  const [visibility, setVisibility] = useState<'internal' | 'external'>('internal')
  const [orgIds, setOrgIds] = useState<string[]>([])
  const [requiresAck, setRequiresAck] = useState(false)
  const [revision, setRevision] = useState('A')
  const [note, setNote] = useState('')
  const [publish, setPublish] = useState(canPublish)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      createDocument({
        projectId,
        tenantId: tenantId!,
        file: file!,
        title: title.trim(),
        code: code.trim(),
        docType,
        disciplineId: discipline === NONE ? null : discipline,
        visibility,
        requiresAck,
        revision: revision.trim(),
        note: note.trim(),
        locationIds,
        orgIds,
        publish: publish && canPublish,
        taskId: presetTaskId,
        ffeItemId: presetFfeItemId,
        roomTypeId: presetRoomTypeId,
        preview,
        folderId: folder === NONE ? null : folder,
      }),
    onSuccess: async (id) => {
      await refresh()
      toast.success(publish && canPublish ? tr('Документ выпущен') : tr('Документ сохранён как черновик'))
      onDone?.(id)
      onClose()
    },
    onError: (e) => setError(errorText(e, tr('Не удалось сохранить документ. Попробуйте ещё раз.'))),
  })

  const submit = () => {
    setError(null)
    if (!file) return setError(tr('Выберите файл.'))
    if (!title.trim()) return setError(tr('Укажите название документа.'))
    save.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Новый документ')}</DialogTitle>
          <DialogDescription>{tr('Файл, к чему он относится и кто должен о нём узнать.')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FilePicker
            file={file}
            onPick={(f) => {
              setFile(f)
              setPreview(null)
              if (f && !title.trim()) setTitle(titleFromFileName(f.name))
            }}
          />
          <PreviewPicker file={file} preview={preview} onPick={setPreview} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="d-title">{tr('Название')}</Label>
            <Input id="d-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-code">{tr('Шифр')}</Label>
              <Input id="d-code" placeholder="ZK7-K1-AR-0005" value={code} maxLength={80} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-rev">{tr('Ревизия')}</Label>
              <Input id="d-rev" placeholder="A" value={revision} maxLength={20} onChange={(e) => setRevision(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-type">{tr('Тип')}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger id="d-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-disc">{tr('Направление')}</Label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger id="d-disc" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
                  {disciplines.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span style={{ paddingLeft: d.depth * 12 }}>
                        <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {folderList.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="d-folder">{tr('Папка')}</Label>
              <Select value={folder} onValueChange={setFolder}>
                <SelectTrigger id="d-folder" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Без папки')}</SelectItem>
                  {folderList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <span style={{ paddingLeft: f.depth * 12 }}>{f.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{tr('К каким местам относится')}</Label>
            {locationIds.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {locationIds.map((id) => {
                  const loc = locations.find((l) => l.id === id)
                  return (
                    <li key={id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-xs">
                      <span className="ident">{loc?.path}</span>
                      <span className="text-muted-foreground">{loc ? locationLabel(loc.path, locations) : ''}</span>
                      <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={tr('Убрать место')} onClick={() => setLocationIds((p) => p.filter((x) => x !== id))}>
                        <X />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <LocationPicker
              projectId={projectId}
              value={null}
              placeholder={locationIds.length > 0 ? tr('Добавить ещё место') : tr('Выбрать этаж, секцию или помещение')}
              onChange={(id) => setLocationIds((p) => (p.includes(id) ? p : [...p, id]))}
            />
            <FloorRangeButton projectId={projectId} onPick={(ids) => setLocationIds((p) => [...p, ...ids.filter((x) => !p.includes(x))])} />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{tr('Кому виден')}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="vis" className="size-5 md:size-4" checked={visibility === 'internal'} onChange={() => setVisibility('internal')} />{tr('Только команде проекта')}</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="vis" className="size-5 md:size-4" checked={visibility === 'external'} onChange={() => setVisibility('external')} />{tr('Команде, подрядчикам и заказчику')}</label>
            {visibility === 'external' && externalOrgs.length > 0 && (
              <div className="ml-8 flex flex-col gap-1 rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">{tr('Не выбрано ни одной организации — документ открыт всем внешним участникам проекта.')}</p>
                {externalOrgs.map((o) => (
                  <label key={o.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={orgIds.includes(o.id)}
                      onChange={(e) => setOrgIds((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 md:size-4" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
            <span>{tr('Требуется ознакомление')}<span className="block text-xs text-muted-foreground">{tr('Получатели увидят в уведомлении просьбу ознакомиться и поставят отметку; вы увидите, кто ещё не прочитал.')}</span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="d-note">{tr('Что в документе или что изменилось (необязательно)')}</Label>
            <Textarea id="d-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="text-base md:text-sm" />
          </div>

          {canPublish ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 md:size-4" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              <span>{tr('Сразу выпустить')}<span className="block text-xs text-muted-foreground">{tr('Документ станет действующим, команда получит уведомление. Иначе он останется черновиком.')}</span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">{tr('Документ сохранится как черновик. Выпустить его сможет ПТО, ГИП, РП или руководитель направления.')}</p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? tr('Загружаем…') : publish && canPublish ? tr('Загрузить и выпустить') : tr('Сохранить черновик')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Новая версия существующего документа. */
export function NewVersionDialog({
  documentId,
  projectId,
  nextRevisionHint,
  onClose,
}: {
  documentId: string
  projectId: string
  nextRevisionHint: string
  onClose: () => void
}) {
  const { tenantId } = useAuth()
  const refresh = useRefresh()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canPublish = permissions.includes('document.publish')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<File | null>(null)
  const [revision, setRevision] = useState(nextRevisionHint)
  const [note, setNote] = useState('')
  const [publish, setPublish] = useState(canPublish)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => addVersion({ documentId, projectId, tenantId: tenantId!, file: file!, revision: revision.trim(), note: note.trim(), publish: publish && canPublish, preview }),
    onSuccess: async () => {
      await refresh()
      toast.success(publish && canPublish ? tr('Новая версия выпущена') : tr('Версия сохранена как черновик'))
      onClose()
    },
    onError: (e) => setError(errorText(e, tr('Не удалось загрузить версию. Попробуйте ещё раз.'))),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Новая версия')}</DialogTitle>
          <DialogDescription>{tr('Прежние версии сохранятся. Действующей станет эта, когда её выпустят.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FilePicker
            file={file}
            onPick={(f) => {
              setFile(f)
              setPreview(null)
            }}
          />
          <PreviewPicker file={file} preview={preview} onPick={setPreview} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="v-rev">{tr('Ревизия')}</Label>
            <Input id="v-rev" value={revision} maxLength={20} onChange={(e) => setRevision(e.target.value)} className="sm:w-40" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="v-note">{tr('Что изменилось')}</Label>
            <Textarea id="v-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="text-base md:text-sm" />
          </div>
          {canPublish && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 md:size-4" checked={publish} onChange={(e) => setPublish(e.target.checked)} />{tr('Сразу выпустить и уведомить команду')}</label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>{tr('Отмена')}</Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setError(null)
              if (!file) return setError(tr('Выберите файл.'))
              save.mutate()
            }}
          >
            {save.isPending ? tr('Загружаем…') : tr('Загрузить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
