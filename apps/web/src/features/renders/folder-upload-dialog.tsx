import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, FolderUp, ImagePlus, Loader2, Search, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { collectDropped, type Picked } from '@/features/documents/bulk-upload-dialog'
import { searchLocations } from '@/features/locations/location-jump'
import { addImage, addImageVersion, projectImagesQuery } from '@/features/renders/api'
import { groupFiles, locationTarget, markRevisions, planGroup, type PickedFile, type PlannedFile, type Places, type Target } from '@/features/renders/match'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const MAX_FILES = 500
const CONCURRENCY = 3
const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp|heic)$/i

/** Сколько файлов группы станут версиями: все, если рендер уже есть у места, иначе все кроме первого. */
const versionCount = (items: PlannedFile[]) => items.reduce((n, i) => n + i.files.length - (i.versionOf ? 0 : 1), 0)
const fileCount = (items: PlannedFile[]) => items.reduce((n, i) => n + i.files.length, 0)

/** Путь выбранного файла → папки внутри выбранной папки (без имени файла). */
const toPicked = (p: Picked): PickedFile => ({ file: p.file, dirs: p.path.split('/').slice(0, -1).filter(Boolean) })

/**
 * Загрузка рендеров папкой с подпапками. Названия папок и файлов сопоставляются с местами и типами номеров
 * («Этаж 4 / 401 / ночь.jpg» → номер 401), то, что не нашлось, назначается вручную. Подпапки сохраняются как папки в галерее.
 * Если у места уже есть картинка с тем же названием, новый файл ложится её новой версией (можно отключить).
 * С `fixed` все файлы идут в одно место или тип номера (кнопка в галерее).
 */
export function RenderFolderUploadDialog({ projectId, places, fixed, onClose }: { projectId: string; places: Places; fixed?: Target; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { tenantId } = useAuth()
  const { data: existing = [] } = useQuery(projectImagesQuery(projectId))
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<PickedFile[]>([])
  const [skipped, setSkipped] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [asVersions, setAsVersions] = useState(true)
  // правки пользователя поверх автоматического сопоставления: ключ группы → место и папка
  const [edits, setEdits] = useState<Record<string, { target?: Target | null; folder?: string; removed?: boolean }>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: { name: string; error: string }[] } | null>(null)

  const accept = (items: Picked[]) => {
    const images = items.filter((i) => IMAGE.test(i.file.name) || i.file.type.startsWith('image/'))
    setSkipped(items.length - images.length)
    // соседние папки-ревизии («… 01.1», «… 01.2») сводятся в один набор: одноимённые файлы станут версиями, новейшая — текущая
    setPicked(markRevisions(images.slice(0, MAX_FILES).map(toPicked)))
    setEdits({})
    setProgress(null)
    if (images.length > MAX_FILES) toast.error(tr('Взяли первые {{n}} файлов: за один раз больше не загружается.', { n: MAX_FILES }))
  }

  const groups = useMemo(
    () =>
      groupFiles(places, picked, fixed ?? null)
        .filter((g) => !edits[g.key]?.removed)
        .map((g) => {
          const e = edits[g.key]
          const target = e && 'target' in e ? (e.target ?? null) : g.target
          const folder = e?.folder ?? g.folder
          return { ...g, target, folder }
        }),
    [places, picked, fixed, edits],
  )
  const plans = useMemo(() => groups.map((g) => ({ g, items: planGroup(g, existing, asVersions) })), [groups, existing, asVersions])
  const ready = plans.filter((p) => p.g.target)
  const readyFiles = ready.reduce((s, p) => s + fileCount(p.items), 0)
  const newVersions = ready.reduce((s, p) => s + versionCount(p.items), 0)
  const unassigned = plans.length - ready.length

  const patch = (key: string, v: { target?: Target | null; folder?: string; removed?: boolean }) => setEdits((cur) => ({ ...cur, [key]: { ...cur[key], ...v } }))

  async function start() {
    const queue = ready.flatMap(({ g, items }) => items.map((it) => ({ target: g.target!, folder: g.folder, ...it })))
    setRunning(true)
    const total = queue.reduce((n, j) => n + j.files.length, 0)
    setProgress({ done: 0, total, failed: [] })
    let next = 0
    let done = 0
    const failed: { name: string; error: string }[] = []
    // одна задача — один рендер: его файлы идут от старой ревизии к новой, новейшая становится текущей
    const worker = async () => {
      while (next < queue.length) {
        const job = queue[next++]!
        let imageId = job.versionOf
        for (const f of job.files) {
          try {
            if (imageId) await addImageVersion(projectId, tenantId!, imageId, f)
            else imageId = await addImage(projectId, tenantId!, job.target, f, job.folder)
          } catch (e) {
            failed.push({ name: f.name, error: (e as { message?: string })?.message?.includes('42501') ? tr('нет права') : tr('не загрузилось') })
          }
          done += 1
          setProgress({ done, total, failed: [...failed] })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['renders'] }), queryClient.invalidateQueries({ queryKey: ['floor-board'] })])
    if (failed.length === 0) toast.success(tr('Рендеры загружены: {{n}}', { n: total }))
  }

  const finished = !!progress && !running && progress.done === progress.total

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{fixed ? tr('Загрузить рендеры папкой: {{name}}', { name: fixed.label }) : tr('Загрузить рендеры папкой')}</DialogTitle>
          <DialogDescription>
            {fixed
              ? tr('Все изображения попадут в «{{name}}», подпапки станут папками в галерее.', { name: fixed.label })
              : tr('Рендеры номеров общие для типа номера, поэтому папку называйте по типу, например «STANDARD KING 2 / Ванная / день.jpg»: изображение попадёт в тип, а «Ванная» станет папкой в галерее. Название этажа или корпуса отправит рендеры туда. Отдельную комнату выберите вручную.')}
          </DialogDescription>
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
          accept="image/*"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])]
            if (filesInput.current) filesInput.current.value = ''
            accept(list.map((file) => ({ file, path: file.name })))
          }}
        />

        {picked.length === 0 ? (
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
            className={cn('flex flex-col items-center gap-4 rounded-lg border-2 border-dashed p-8 text-center', dragging && 'border-ring bg-muted/60')}
          >
            <FolderUp className="size-8 text-muted-foreground" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{tr('Перетащите сюда папку с рендерами или выберите её. Подпапки тоже загрузятся.')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => folderInput.current?.click()}>
                <FolderUp /> {tr('Выбрать папку')}
              </Button>
              <Button variant="outline" onClick={() => filesInput.current?.click()}>
                <ImagePlus /> {tr('Выбрать изображения')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{tr('До {{n}} изображений за раз. С телефона папку выбрать нельзя — выбирайте изображения.', { n: MAX_FILES })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={asVersions} disabled={running} onChange={(e) => setAsVersions(e.target.checked)} />
              <span>
                {tr('Если у места уже есть картинка с таким названием в этой папке — добавить как новую версию')}
                <span className="block text-xs text-muted-foreground">{tr('Прежняя версия останется в истории. «спальня_v2.jpg» считается версией «спальня.jpg».')}</span>
              </span>
            </label>

            <ul className="flex flex-col gap-2" aria-label={tr('Группы файлов')}>
              {plans.map(({ g, items }) => {
                const versions = versionCount(items)
                return (
                  <li key={g.key} className={cn('flex flex-col gap-2 rounded-lg border p-3', !g.target && 'border-amber-500/50 bg-amber-500/5')}>
                    <div className="flex items-start gap-2">
                      {g.target ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={g.source}>
                          {g.source}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tr('Изображений: {{n}}', { n: fileCount(items) })}
                          {versions > 0 && ` · ${tr('новых версий: {{n}}', { n: versions })}`}
                        </p>
                      </div>
                      {!running && (
                        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={tr('Не загружать эту группу')} onClick={() => patch(g.key, { removed: true })}>
                          <X />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {fixed ? (
                        <p className="flex min-h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{fixed.label}</p>
                      ) : (
                        <TargetPicker value={g.target} places={places} disabled={running} onChange={(t) => patch(g.key, { target: t })} />
                      )}
                      <Input
                        value={g.folder}
                        disabled={running}
                        maxLength={200}
                        onChange={(e) => patch(g.key, { folder: e.target.value.replace(/\\/g, '/') })}
                        placeholder={tr('Папка в галерее (необязательно)')}
                        aria-label={tr('Папка в галерее')}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>

            {skipped > 0 && <p className="text-xs text-muted-foreground">{tr('Пропущено файлов, которые не изображения: {{n}}', { n: skipped })}</p>}
            {unassigned > 0 && !running && <p className="text-sm text-amber-700 dark:text-amber-400">{tr('Не выбрано место у групп: {{n}}. Они не загрузятся, пока место не выбрано; ненужные уберите крестиком.', { n: unassigned })}</p>}

            {progress && (
              <div className="flex flex-col gap-1.5 rounded-lg border p-3" role="status">
                <p className="flex items-center gap-2 text-sm">
                  {running && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {tr('Загружено {{done}} из {{total}}', { done: progress.done, total: progress.total })}
                </p>
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
                </div>
                {progress.failed.length > 0 && (
                  <ul className="mt-1 text-xs text-destructive">
                    {progress.failed.slice(0, 8).map((f, i) => (
                      <li key={i}>
                        {f.name}: {f.error}
                      </li>
                    ))}
                    {progress.failed.length > 8 && <li>{tr('…и ещё {{n}}', { n: progress.failed.length - 8 })}</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {picked.length > 0 && !running && !finished && (
            <Button variant="outline" onClick={() => accept([])}>
              {tr('Выбрать другую папку')}
            </Button>
          )}
          {finished ? (
            <Button onClick={onClose}>{tr('Готово')}</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={running} onClick={onClose}>
                {tr('Отмена')}
              </Button>
              {picked.length > 0 && (
                <Button disabled={running || readyFiles === 0} onClick={() => void start()}>
                  {running ? tr('Загружаем…') : newVersions > 0 ? tr('Загрузить: {{n}} (из них версий {{v}})', { n: readyFiles, v: newVersions }) : tr('Загрузить: {{n}}', { n: readyFiles })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Выбор места или типа номера: поиск по названию, номеру и коду. */
export function TargetPicker({ value, places, disabled, onChange }: { value: Target | null; places: Places; disabled?: boolean; onChange: (t: Target | null) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo<Target[]>(() => {
    const text = q.trim().toLowerCase()
    if (!text) return []
    const locs = searchLocations(places.rows, q, 6).map((r) => locationTarget(r, places.rows))
    const types = places.types.filter((t) => t.name.toLowerCase().includes(text)).slice(0, 4).map((t): Target => ({ type: 'room_type', id: t.id, label: t.name }))
    return [...types, ...locs]
  }, [q, places])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={open ? q : (value?.label ?? q)}
        disabled={disabled}
        onFocus={() => {
          setOpen(true)
          setQ('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr('Место или тип номера…')}
        aria-label={tr('Место или тип номера')}
        autoComplete="off"
        className="pl-8"
      />
      {open && q.trim() !== '' && (
        <ul className="absolute left-0 right-0 top-10 z-30 max-h-56 overflow-y-auto rounded-md border bg-popover py-1 text-sm shadow-lg" role="listbox">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{tr('Ничего не нашли')}</li>
          ) : (
            results.map((t) => (
              <li key={`${t.type}:${t.id}`} role="option" aria-selected={value?.id === t.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(t)
                    setOpen(false)
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{t.type === 'room_type' ? tr('тип номера') : tr('место')}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
