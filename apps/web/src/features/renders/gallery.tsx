import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Folder, FolderUp, History, ImagePlus, Map as MapIcon, Pencil, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { addImage, deleteImage, entityImagesQuery, imageUrlsQuery, mergeFolders, moveImage, setImage, setImagePlan, type EntityImage, type ImageEntity } from '@/features/renders/api'
import { DeleteFolderDialog, RenameMoveDialog } from '@/features/renders/folder-actions'
import { revisionGroups, type RevisionGroup } from '@/features/renders/match'
import { RenderFolderUploadDialog } from '@/features/renders/folder-upload-dialog'
import { PhotoViewer, useTouchGallery } from '@/features/renders/photo-viewer'
import { VersionsDialog } from '@/features/renders/versions-dialog'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Рендеры и фото места или типа номера: обложка крупно, остальные лентой, просмотр на весь экран с подписью.
 * Добавлять, подписывать, менять обложку и убирать могут только те, кому `canEdit`.
 */
export function RenderGallery({ projectId, entity, canEdit, title, hint }: { projectId: string; entity: ImageEntity; canEdit: boolean; title?: string; hint?: string }) {
  const queryClient = useQueryClient()
  const { tenantId } = useAuth()
  const { data: images = [] } = useQuery(entityImagesQuery(projectId, entity))
  const keys = images.map((i) => i.file.storage_key)
  const { data: urls } = useQuery(imageUrlsQuery(keys))
  const [open, setOpen] = useState<number | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [folderUpload, setFolderUpload] = useState(false)
  const [folderDialog, setFolderDialog] = useState<'move' | 'delete' | null>(null)
  // на телефоне фото открывается как нативная галерея (на весь экран, жестами); «Подробнее» открывает окно с правкой
  const touch = useTouchGallery()
  const [details, setDetails] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['renders'] }), queryClient.invalidateQueries({ queryKey: ['floor-board'] })])
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let failed = 0
      for (const f of files) {
        try {
          await addImage(projectId, tenantId!, entity, f)
        } catch {
          failed += 1
        }
      }
      if (failed > 0) throw new Error(String(failed))
    },
    onSettled: () => void refresh(),
    onError: (e) => toast.error(tr('Не загрузилось файлов: {{n}}. Проверьте соединение и повторите.', { n: (e as Error).message })),
  })

  // папки изображений: «Спальня» и «Спальня/Ночь»; выбранная папка показывает и всё, что лежит в её подпапках
  const folders = useMemo(() => [...new Set(images.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [images])
  const activeFolder = folder && folders.includes(folder) ? folder : null
  const shown = activeFolder === null ? images : images.filter((i) => i.folder === activeFolder || i.folder.startsWith(`${activeFolder}/`))
  const cover = shown[0]
  const rest = shown.slice(1)
  // соседние папки «… 01.1», «… 01.2» — ревизии одного набора: их можно свести в версии одной папки
  const revisions = useMemo(() => revisionGroups(folders), [folders])
  const merge = useMutation({
    mutationFn: (g: RevisionGroup) => mergeFolders(projectId, entity, g.folders, g.parent),
    onSuccess: async (n) => {
      toast.success(tr('Ревизии сведены, версий добавлено: {{n}}', { n }))
      setFolder(null)
      await refresh()
    },
    onError: () => toast.error(tr('Не удалось свести ревизии.')),
  })

  if (images.length === 0 && !canEdit) return null

  return (
    <section className="flex flex-col gap-1.5" aria-label={title ?? tr('Рендеры и фото')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">{title ?? tr('Рендеры и фото')}</h3>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <ImagePlus /> {upload.isPending ? tr('Загружаем…') : tr('Добавить')}
          </Button>
        )}
        {canEdit && (
          <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => setFolderUpload(true)} title={tr('Загрузить папку с подпапками')}>
            <FolderUp /> {tr('Папкой')}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length > 0) upload.mutate(files)
          }}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={tr('Папки')}>
          {[null, ...folders].map((f) => (
            <button
              key={f ?? '__all__'}
              type="button"
              aria-pressed={activeFolder === f}
              onClick={() => setFolder(f)}
              className={cn('inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', activeFolder === f && 'border-primary bg-primary/10 font-medium')}
            >
              {f !== null && <Folder className="size-3" aria-hidden />}
              {f === null ? tr('Все') : f.replace(/\//g, ' › ')}
            </button>
          ))}
        </div>
      )}

      {canEdit && activeFolder !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setFolderDialog('move')}>
            <Pencil /> {tr('Переименовать или перенести папку')}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setFolderDialog('delete')}>
            <Trash2 /> {tr('Удалить папку')}
          </Button>
        </div>
      )}
      {canEdit &&
        revisions.map((g) => {
          const last = (p: string) => p.slice(p.lastIndexOf('/') + 1)
          return (
            <div key={g.folders.join('|')} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <History className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {tr('Ревизии одного набора: {{names}}. Свести в «{{target}}»: одноимённые файлы станут версиями, текущей будет новейшая ({{last}}).', {
                  names: g.folders.map(last).join(', '),
                  target: g.parent || tr('корень'),
                  last: last(g.folders[g.folders.length - 1]!),
                })}
              </span>
              <Button type="button" size="sm" variant="outline" disabled={merge.isPending} onClick={() => merge.mutate(g)}>
                {merge.isPending ? tr('Сводим…') : tr('Свести ревизии')}
              </Button>
            </div>
          )
        })}

      {images.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr('Рендеров пока нет. Добавьте изображения.')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen(0)}
            aria-label={tr('Открыть изображение: {{name}}', { name: cover!.caption ?? cover!.file.name })}
            className="group relative aspect-[3/1] max-h-40 w-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {urls?.get(cover!.file.storage_key) && <img src={urls.get(cover!.file.storage_key)} alt={cover!.caption ?? cover!.file.name} className="size-full object-cover transition-transform group-hover:scale-[1.02]" />}
            {cover!.is_plan && <span className="absolute left-2 top-2 rounded bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">{tr('Схема')}</span>}
            {cover!.versions > 1 && <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">{`v${cover!.versions}`}</span>}
            {cover!.caption && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6 text-left text-sm text-white">{cover!.caption}</span>}
          </button>
          {rest.length > 0 && (
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={tr('Остальные изображения')}>
              {rest.map((im, i) => (
                <li key={im.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpen(i + 1)}
                    aria-label={tr('Открыть изображение: {{name}}', { name: im.caption ?? im.file.name })}
                    className="relative block h-11 w-16 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {urls?.get(im.file.storage_key) && <img src={urls.get(im.file.storage_key)} alt="" loading="lazy" className="size-full object-cover" />}
                    {im.is_plan && <span className="absolute bottom-0.5 left-0.5 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">{tr('Схема')}</span>}
                    {im.versions > 1 && <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] font-medium tabular-nums text-white">{`v${im.versions}`}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open !== null && shown[open] && touch && (
        <PhotoViewer images={shown} urls={urls} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onMore={() => setDetails(true)} />
      )}
      {open !== null && shown[open] && (!touch || details) && (
        <Lightbox
          projectId={projectId}
          images={shown}
          urls={urls}
          index={open}
          canEdit={canEdit}
          onIndex={setOpen}
          onClose={() => {
            setDetails(false)
            if (!touch) setOpen(null)
          }}
          onChanged={refresh}
        />
      )}
      {folderDialog === 'move' && activeFolder !== null && (
        <RenameMoveDialog projectId={projectId} entity={entity} folder={activeFolder} count={shown.length} onClose={() => setFolderDialog(null)} onDone={async () => { setFolder(null); await refresh() }} />
      )}
      {folderDialog === 'delete' && activeFolder !== null && (
        <DeleteFolderDialog projectId={projectId} entity={entity} folder={activeFolder} count={shown.length} onClose={() => setFolderDialog(null)} onDone={async () => { setFolder(null); await refresh() }} />
      )}
      {folderUpload && <RenderFolderUploadDialog projectId={projectId} places={{ rows: [], types: [] }} fixed={{ ...entity, label: title ?? tr('Рендеры и фото') }} onClose={() => setFolderUpload(false)} />}
    </section>
  )
}

function Lightbox({
  projectId,
  images,
  urls,
  index,
  canEdit,
  onIndex,
  onClose,
  onChanged,
}: {
  projectId: string
  images: EntityImage[]
  urls?: Map<string, string>
  index: number
  canEdit: boolean
  onIndex: (i: number) => void
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const im = images[index]!
  const [caption, setCaption] = useState(im.caption ?? '')
  const [confirming, setConfirming] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [folder, setFolder] = useState(im.folder)
  useEffect(() => {
    setCaption(images[index]?.caption ?? '')
    setFolder(images[index]?.folder ?? '')
    setConfirming(false)
  }, [index, images])

  const go = (d: number) => onIndex((index + d + images.length) % images.length)
  // на телефоне картинки листаются свайпом: влево — следующая, вправо — предыдущая (вертикальное движение не считается)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!
    swipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s || images.length < 2) return
    const t = e.changedTouches[0]!
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) >= 50 && Math.abs(dy) < Math.abs(dx) * 0.6) go(dx < 0 ? 1 : -1)
  }
  const save = useMutation({
    mutationFn: (v: { caption: string; cover: boolean }) => setImage(im.id, v.caption, v.cover),
    onSuccess: async () => void (await onChanged()),
    onError: () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.')),
  })
  const plan = useMutation({
    mutationFn: () => setImagePlan(im.id, !im.is_plan),
    onSuccess: async () => void (await onChanged()),
    onError: () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.')),
  })
  const move = useMutation({
    mutationFn: (f: string) => moveImage(im.id, f.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')),
    onSuccess: async () => void (await onChanged()),
    onError: () => toast.error(tr('Не удалось сохранить папку. Проверьте название.')),
  })
  const remove = useMutation({
    mutationFn: () => deleteImage(im.id),
    onSuccess: async () => {
      await onChanged()
      if (images.length <= 1) onClose()
      else onIndex(Math.min(index, images.length - 2))
    },
    onError: () => toast.error(tr('Не удалось удалить. Попробуйте ещё раз.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="gap-3 sm:max-w-5xl"
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return
          if (e.key === 'ArrowLeft') go(-1)
          if (e.key === 'ArrowRight') go(1)
        }}
      >
        <DialogTitle className="sr-only">{im.caption ?? im.file.name}</DialogTitle>
        <DialogDescription className="sr-only">{tr('Изображение {{n}} из {{total}}', { n: index + 1, total: images.length })}</DialogDescription>
        <div className="relative flex min-h-[50vh] touch-pan-y items-center justify-center rounded-lg bg-muted" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {urls?.get(im.file.storage_key) ? <img src={urls.get(im.file.storage_key)} alt={im.caption ?? im.file.name} className="max-h-[70vh] max-w-full rounded-lg object-contain" /> : <span className="text-sm text-muted-foreground">{tr('Загружаем…')}</span>}
          {images.length > 1 && (
            <>
              <Button type="button" variant="secondary" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2" onClick={() => go(-1)} aria-label={tr('Предыдущее')}>
                <ChevronLeft />
              </Button>
              <Button type="button" variant="secondary" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => go(1)} aria-label={tr('Следующее')}>
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} / {images.length}
          </span>
          {canEdit ? (
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => caption.trim() !== (im.caption ?? '') && save.mutate({ caption, cover: im.is_cover })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              maxLength={300}
              placeholder={tr('Подпись к изображению')}
              aria-label={tr('Подпись к изображению')}
              className="min-w-48 flex-1"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm">{im.caption}</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setVersionsOpen(true)} title={tr('История версий этого изображения')}>
            <History /> {tr('Версии')}
            {im.versions > 1 && <span className="tabular-nums text-muted-foreground">{im.versions}</span>}
          </Button>
          {canEdit && !confirming && (
            <>
              <Button type="button" variant={im.is_cover ? 'secondary' : 'outline'} size="sm" disabled={im.is_cover || save.isPending} onClick={() => save.mutate({ caption, cover: true })}>
                <Star className={cn(im.is_cover && 'fill-current')} /> {im.is_cover ? tr('Обложка') : tr('Сделать обложкой')}
              </Button>
              <Button type="button" variant={im.is_plan ? 'secondary' : 'outline'} size="sm" disabled={plan.isPending} aria-pressed={im.is_plan} title={tr('Схемы подставляются в отчёты об инспекции; рендеры не подставляются')} onClick={() => plan.mutate()}>
                <MapIcon /> {im.is_plan ? tr('Это схема') : tr('Отметить как схему')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
                <Trash2 /> {tr('Удалить')}
              </Button>
            </>
          )}
          {canEdit && confirming && (
            <>
              <span className="text-sm">{tr('Удалить это изображение?')}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
                {tr('Отмена')}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {tr('Удалить')}
              </Button>
            </>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onBlur={() => folder.trim() !== im.folder && move.mutate(folder)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              maxLength={200}
              placeholder={tr('Папка, например: Спальня/Ночь')}
              aria-label={tr('Папка изображения')}
              className="min-w-48 flex-1"
            />
          </div>
        )}
        {versionsOpen && <VersionsDialog projectId={projectId} image={im} canEdit={canEdit} onClose={() => setVersionsOpen(false)} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  )
}
