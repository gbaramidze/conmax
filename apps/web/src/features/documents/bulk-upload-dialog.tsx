import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, FileStack, FolderUp, Loader2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatBytes, MAX_FILE_BYTES } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { buildFolderTree, ensureFolderPath, foldersQuery } from '@/features/documents/folders-api'
import { createDocument, DOC_TYPE_LABELS, isViewableFile, titleFromFileName, type DocType } from '@/features/documents/api'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { FloorRangeButton } from '@/features/locations/floor-range'
import { LocationPicker } from '@/features/locations/location-picker'
import { myPermissionsQuery } from '@/features/projects/api'

const NONE = '__none__'
const MAX_FILES = 300
const CONCURRENCY = 2

/** Файл вместе с путём внутри выбранной папки (для сопоставления DWG и PDF и подсказки «откуда это») */
export interface Picked {
  file: File
  path: string
}

type Status = 'idle' | 'uploading' | 'done' | 'error'

interface Item {
  id: string
  path: string
  file: File
  /** PDF той же печати, если рядом лежит исходник, который на экране не открывается (DWG и др.) */
  preview: File | null
  title: string
  docType: DocType
  include: boolean
  status: Status
  error?: string
}

const IGNORED = /^(\.ds_store|thumbs\.db|desktop\.ini)$/i
const isIgnored = (name: string) => IGNORED.test(name) || name.startsWith('~$') || name.startsWith('.')
const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const baseOf = (path: string) => path.replace(/\.[^./]+$/, '').toLowerCase()
const DRAWING_EXT = new Set(['dwg', 'dxf', 'pdf', 'png', 'jpg', 'jpeg', 'webp'])

/** Рекурсивно читает перетащенные папки (работает в Chrome, Edge, Safari и Firefox). */
export async function collectDropped(items: DataTransferItemList): Promise<Picked[]> {
  const out: Picked[] = []
  const readAll = (reader: FileSystemDirectoryReader) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const acc: FileSystemEntry[] = []
      const next = () =>
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(acc)
          else {
            acc.push(...batch)
            next()
          }
        }, reject)
      next()
    })
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (out.length >= MAX_FILES * 2) return
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ file, path: entry.fullPath.replace(/^\//, '') })
    } else if (entry.isDirectory) {
      for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child)
    }
  }
  const entries = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e)
  for (const e of entries) await walk(e)
  return out
}

/**
 * Файлы → документы. Исходник, который на экране не открывается (DWG), и PDF с тем же именем в той же папке
 * объединяются в один документ: DWG для скачивания, PDF для просмотра на плане.
 */
function buildItems(picked: Picked[], defaultType: DocType): { items: Item[]; skipped: number } {
  const usable = picked.filter((p) => !isIgnored(p.file.name))
  const groups = new Map<string, Picked[]>()
  for (const p of usable) groups.set(baseOf(p.path), [...(groups.get(baseOf(p.path)) ?? []), p])

  const items: Item[] = []
  for (const group of groups.values()) {
    const viewable = group.filter((g) => isViewableFile(g.file.name, g.file.type))
    const raw = group.filter((g) => !isViewableFile(g.file.name, g.file.type))
    // ровно один исходник и ровно один просматриваемый файл с тем же именем — это пара «DWG + PDF»
    const paired = raw.length === 1 && viewable.length === 1 ? { main: raw[0], preview: viewable[0] } : null
    const make = (main: Picked, preview: File | null): Item => ({
      id: crypto.randomUUID?.() ?? `${main.path}:${Math.random()}`,
      path: main.path,
      file: main.file,
      preview,
      title: titleFromFileName(main.file.name),
      docType: DRAWING_EXT.has(extOf(main.file.name)) ? defaultType : 'other',
      include: main.file.size <= MAX_FILE_BYTES,
      status: 'idle',
      error: main.file.size > MAX_FILE_BYTES ? tr('Файл больше 150 МБ — не загрузить') : undefined,
    })
    if (paired) items.push(make(paired.main, paired.preview.file))
    else for (const g of group) items.push(make(g, null))
  }
  items.sort((a, b) => a.path.localeCompare(b.path, currentLocale(), { numeric: true }))
  return { items: items.slice(0, MAX_FILES), skipped: picked.length - usable.length + Math.max(0, items.length - MAX_FILES) }
}

/** Загрузка папки или нескольких файлов сразу: настройки общие, названия можно поправить по каждому файлу. */
export function BulkUploadDialog({ projectId, baseFolderId = null, onClose }: { projectId: string; baseFolderId?: string | null; onClose: () => void }) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const { data: folderRows } = useQuery(foldersQuery(projectId))
  const folderList = useMemo(() => buildFolderTree(folderRows ?? []).flat, [folderRows])
  const canPublish = permissions.includes('document.publish')
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])

  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [skipped, setSkipped] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)

  const [docType, setDocType] = useState<DocType>('plan')
  const [discipline, setDiscipline] = useState(NONE)
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [visibility, setVisibility] = useState<'internal' | 'external'>('internal')
  const [revision, setRevision] = useState('A')
  const [publish, setPublish] = useState(canPublish)
  const [keepStructure, setKeepStructure] = useState(true)
  const [targetFolder, setTargetFolder] = useState(baseFolderId ?? NONE)

  const patchItem = (id: string, patch: Partial<Item>) => setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  function accept(picked: Picked[]) {
    if (picked.length === 0) return void toast.error(tr('В выбранном нет файлов.'))
    const built = buildItems(picked, docType)
    setItems(built.items)
    setSkipped(built.skipped)
    setFinished(false)
    if (picked.length > MAX_FILES) toast.message(tr('Показаны первые {{MAX_FILES}} файлов. Остальные загрузите отдельно.', { MAX_FILES }))
  }

  const todo = items.filter((i) => i.include && i.status !== 'done')
  const done = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'error' && i.include).length

  async function upload() {
    setRunning(true)
    const queue = items.filter((i) => i.include && i.status !== 'done')
    const base = targetFolder === NONE ? null : targetFolder
    // папки создаём заранее и по очереди: параллельные загрузки не должны создавать одну и ту же дважды
    const folderOf = new Map<string, string | null>()
    if (keepStructure) {
      for (const it of queue) {
        const dirs = it.path.split('/').slice(0, -1)
        const key = dirs.join('/')
        if (folderOf.has(key)) continue
        try {
          folderOf.set(key, await ensureFolderPath(projectId, base, dirs))
        } catch {
          folderOf.set(key, base) // папку создать не вышло — документ всё равно загрузится, в выбранную папку
        }
      }
    }
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++]
        patchItem(item.id, { status: 'uploading', error: undefined })
        try {
          await createDocument({
            projectId,
            tenantId: tenantId!,
            file: item.file,
            preview: item.preview,
            title: item.title.trim() || titleFromFileName(item.file.name),
            code: '',
            docType: item.docType,
            disciplineId: discipline === NONE ? null : discipline,
            visibility,
            requiresAck: false,
            revision: revision.trim(),
            note: item.path.includes('/') ? tr('Из папки: {{v1}}', { v1: item.path.split('/').slice(0, -1).join('/') }) : '',
            locationIds,
            orgIds: [],
            publish: publish && canPublish,
            folderId: keepStructure ? (folderOf.get(item.path.split('/').slice(0, -1).join('/')) ?? base) : base,
          })
          patchItem(item.id, { status: 'done' })
        } catch (e) {
          patchItem(item.id, { status: 'error', error: e instanceof Error && e.message ? e.message : tr('Не удалось загрузить') })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
    setFinished(true)
    await Promise.all(['documents', 'document', 'entity-documents', 'plan-pins', 'document-folders'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr('Загрузить папку или несколько файлов')}</DialogTitle>
          <DialogDescription>{tr('Каждый файл станет документом. Если рядом лежат, например,')}{' '}<span className="ident">{tr('план.dwg')}</span>{tr('и')}{' '}<span className="ident">{tr('план.pdf')}</span>{tr(', они объединятся: DWG для скачивания, PDF для просмотра на плане.')}</DialogDescription>
        </DialogHeader>

        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '', directory: '' } as object)}
          onChange={(e) => {
            const list = [...(e.target.files ?? [])]
            if (folderInput.current) folderInput.current.value = ''
            accept(list.map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name })))
          }}
        />
        <input
          ref={filesInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const list = [...(e.target.files ?? [])]
            if (filesInput.current) filesInput.current.value = ''
            accept(list.map((file) => ({ file, path: file.name })))
          }}
        />

        {items.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={async (e) => {
              e.preventDefault()
              setDragging(false)
              try {
                accept(await collectDropped(e.dataTransfer.items))
              } catch {
                toast.error(tr('Не удалось прочитать папку. Выберите её кнопкой.'))
              }
            }}
            className={`flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? 'border-ring bg-muted/60' : ''}`}
          >
            <FolderUp className="size-8 text-muted-foreground" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{tr('Перетащите сюда папку с планами или выберите её. Подпапки тоже загрузятся.')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => folderInput.current?.click()}>
                <FolderUp />{tr('Выбрать папку')}</Button>
              <Button variant="outline" onClick={() => filesInput.current?.click()}>
                <FileStack />{tr('Выбрать файлы')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{tr('До')}{' '}{MAX_FILES}{tr('файлов за раз, каждый до 150 МБ. С телефона папку выбрать нельзя — выбирайте файлы.')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b-type">{tr('Тип для чертежей и планов')}</Label>
                <Select
                  value={docType}
                  disabled={running}
                  onValueChange={(v) => {
                    setDocType(v as DocType)
                    setItems((prev) => prev.map((x) => (DRAWING_EXT.has(extOf(x.file.name)) ? { ...x, docType: v as DocType } : x)))
                  }}
                >
                  <SelectTrigger id="b-type" className="w-full">
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b-disc">{tr('Направление')}</Label>
                <Select value={discipline} disabled={running} onValueChange={setDiscipline}>
                  <SelectTrigger id="b-disc" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>{tr('Не указано')}</SelectItem>
                    {disciplines.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <span style={{ paddingLeft: d.depth * 10 }}>
                          <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{tr('Места (для всех документов)')}</Label>
                {locationIds.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {locationIds.map((id) => {
                      const loc = locations.find((l) => l.id === id)
                      return (
                        <li key={id} className="flex items-center gap-1 rounded-md border bg-background py-0.5 pl-2 text-xs">
                          <span>{loc ? locationLabel(loc.path, locations) : id}</span>
                          <Button type="button" size="icon" variant="ghost" className="size-6" disabled={running} aria-label={tr('Убрать место')} onClick={() => setLocationIds((p) => p.filter((x) => x !== id))}>
                            <X />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {!running && (
                  <LocationPicker
                    projectId={projectId}
                    value={null}
                    placeholder={locationIds.length > 0 ? tr('Добавить ещё место') : tr('Привязать к этажу или помещению (необязательно)')}
                    onChange={(id) => setLocationIds((p) => (p.includes(id) ? p : [...p, id]))}
                  />
                )}
                {!running && <FloorRangeButton projectId={projectId} onPick={(ids) => setLocationIds((p) => [...p, ...ids.filter((x) => !p.includes(x))])} />}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="b-rev">{tr('Ревизия')}</Label>
                  <Input id="b-rev" value={revision} maxLength={20} disabled={running} onChange={(e) => setRevision(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="b-vis">{tr('Кому виден')}</Label>
                  <Select value={visibility} disabled={running} onValueChange={(v) => setVisibility(v as 'internal' | 'external')}>
                    <SelectTrigger id="b-vis" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">{tr('Только команде')}</SelectItem>
                      <SelectItem value="external">{tr('Команде и внешним участникам')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="b-folder">{tr('Куда положить')}</Label>
                <Select value={targetFolder} disabled={running} onValueChange={setTargetFolder}>
                  <SelectTrigger id="b-folder" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>{tr('В корень (без папки)')}</SelectItem>
                    {folderList.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <span style={{ paddingLeft: f.depth * 12 }}>{f.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {items.some((i) => i.path.includes('/')) && (
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="size-4" checked={keepStructure} disabled={running} onChange={(e) => setKeepStructure(e.target.checked)} />{tr('Повторить структуру папок (подпапки станут папками проекта)')}</label>
              )}
              {canPublish && (
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="size-4" checked={publish} disabled={running} onChange={(e) => setPublish(e.target.checked)} />{tr('Сразу выпустить и уведомить команду')}</label>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{tr('К загрузке:')}{' '}{todo.length}{tr('из')}{' '}{items.length}
                {skipped > 0 && <span className="font-normal text-muted-foreground">{tr('· служебных файлов пропущено:')}{' '}{skipped}</span>}
              </span>
              {!running && !finished && (
                <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setItems([])}>{tr('выбрать другое')}</button>
              )}
            </div>

            {(running || finished) && (
              <div className="flex flex-col gap-1.5" aria-live="polite">
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={done + todo.length} aria-valuenow={done}>
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(100 * done) / Math.max(1, done + todo.length)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{tr('Загружено:')}{' '}{done}
                  {failed > 0 && <span className="text-destructive">{tr('· с ошибкой:')}{' '}{failed}</span>}
                </p>
              </div>
            )}

            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={it.include}
                    disabled={running || it.status === 'done' || it.file.size > MAX_FILE_BYTES}
                    aria-label={tr('Загрузить: {{name}}', { name: it.file.name })}
                    onChange={(e) => patchItem(it.id, { include: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={tr('Название документа')}
                      className="h-8"
                      value={it.title}
                      maxLength={300}
                      disabled={running || it.status === 'done'}
                      onChange={(e) => patchItem(it.id, { title: e.target.value })}
                    />
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {it.path} · {formatBytes(it.file.size)}
                      {it.preview && <span className="ml-1 rounded bg-muted px-1 py-0.5 font-medium text-foreground">{tr('+ PDF для просмотра')}</span>}
                    </p>
                  </div>
                  <Select value={it.docType} disabled={running || it.status === 'done'} onValueChange={(v) => patchItem(it.id, { docType: v as DocType })}>
                    <SelectTrigger size="sm" className="w-32" aria-label={tr('Тип документа')}>
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
                  <span className="flex w-24 shrink-0 items-center justify-end gap-1 text-xs" role="status">
                    {it.status === 'uploading' && (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />{tr('грузим')}</>
                    )}
                    {it.status === 'done' && (
                      <span className="flex items-center gap-1 text-green-700 dark:text-green-300">
                        <CheckCircle2 className="size-3.5" aria-hidden />{tr('готово')}</span>
                    )}
                    {it.status === 'error' && (
                      <span className="flex items-center gap-1 text-destructive" title={it.error}>
                        <AlertCircle className="size-3.5" aria-hidden />{tr('ошибка')}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={running} onClick={onClose}>
            {finished && failed === 0 ? tr('Закрыть') : tr('Отмена')}
          </Button>
          {items.length > 0 && !(finished && failed === 0) && (
            <Button disabled={running || todo.length === 0} onClick={() => void upload()}>
              {running ? tr('Загружаем…') : failed > 0 && finished ? tr('Повторить для {{failed}}', { failed }) : tr('Загрузить документов: {{length}}', { length: todo.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
