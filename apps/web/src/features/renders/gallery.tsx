import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Folder, FolderUp, History, ImagePlus, Images, Map as MapIcon, Pencil, Star, Trash2, X } from 'lucide-react'
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

/** Сколько плиток видно сразу; остальные — по кнопке «Показать все» */
const FIRST_TILES = 11

/**
 * Рендеры и фото места или типа номера: сетка плиток (первая — крупно), просмотр на весь экран с листанием.
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
  const [all, setAll] = useState(false)
  const [folderUpload, setFolderUpload] = useState(false)
  const [folderDialog, setFolderDialog] = useState<'move' | 'delete' | null>(null)
  // на телефоне и планшете фото открывается как нативная галерея (на весь экран, жестами); «Подробнее» открывает окно с правкой
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
  const inFolder = (f: string) => images.filter((i) => i.folder === f || i.folder.startsWith(`${f}/`)).length
  const shown = activeFolder === null ? images : images.filter((i) => i.folder === activeFolder || i.folder.startsWith(`${activeFolder}/`))
  const tiles = all ? shown : shown.slice(0, FIRST_TILES)
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
  const pickFolder = (f: string | null) => {
    setFolder(f)
    setAll(false)
  }

  return (
    <section className="@container flex flex-col gap-3" aria-label={title ?? tr('Рендеры и фото')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Images className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">{title ?? tr('Рендеры и фото')}</span>
            {images.length > 0 && <span className="rounded-full bg-muted px-1.5 text-xs font-normal tabular-nums text-muted-foreground">{images.length}</span>}
          </h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
              <ImagePlus /> {upload.isPending ? tr('Загружаем…') : tr('Добавить')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => setFolderUpload(true)} title={tr('Загрузить папку с подпапками')} aria-label={tr('Загрузить папку с подпапками')}>
              <FolderUp /> <span className="max-sm:hidden">{tr('Папкой')}</span>
            </Button>
          </div>
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

      {/* папки — одной строкой с прокруткой, чтобы не занимать пол-экрана на телефоне */}
      {folders.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={tr('Папки')}>
          {[null, ...folders].map((f) => (
            <button
              key={f ?? '__all__'}
              type="button"
              aria-pressed={activeFolder === f}
              onClick={() => pickFolder(f)}
              className={cn(
                'inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-background px-3 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                activeFolder === f && 'border-primary bg-primary/15 font-medium hover:bg-primary/20',
              )}
            >
              {f !== null && <Folder className="size-3.5 text-muted-foreground" aria-hidden />}
              {f === null ? tr('Все') : f.replace(/\//g, ' › ')}
              <span className="tabular-nums text-muted-foreground">{f === null ? images.length : inFolder(f)}</span>
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
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-background px-4 py-6 text-center text-xs text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ImagePlus className="size-6" aria-hidden />
          {tr('Рендеров пока нет. Добавьте изображения.')}
        </button>
      ) : (
        <>
          {/* сетка: первая плитка крупно (2×2), остальные — ровными плитками; число колонок — по ширине самой галереи */}
          <ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @3xl:grid-cols-4" aria-label={tr('Изображения')}>
            {tiles.map((im, i) => (
              <li key={im.id} className={cn(i === 0 && 'col-span-2 row-span-2')}>
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={tr('Открыть изображение: {{name}}', { name: im.caption ?? im.file.name })}
                  className="group relative block aspect-[4/3] size-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {urls?.get(im.file.storage_key) && (
                    <img src={urls.get(im.file.storage_key)} alt="" loading={i < 3 ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  )}
                  {im.is_plan && <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">{tr('Схема')}</span>}
                  {im.versions > 1 && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">{`v${im.versions}`}</span>}
                  {im.caption && (
                    <span className={cn('absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 text-left text-white', i === 0 ? 'text-sm' : 'text-[11px]')}>{im.caption}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {shown.length > FIRST_TILES && (
            <Button type="button" variant="outline" size="sm" className="self-center" onClick={() => setAll((v) => !v)}>
              {all ? tr('Свернуть') : tr('Показать все ({{n}})', { n: shown.length })}
            </Button>
          )}
        </>
      )}

      {open !== null && shown[open] && touch && !details && (
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
            // на телефоне «Подробнее» закрывается обратно в полноэкранный просмотр того же фото
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
  const strip = useRef<HTMLUListElement>(null)
  useEffect(() => {
    setCaption(images[index]?.caption ?? '')
    setFolder(images[index]?.folder ?? '')
    setConfirming(false)
    // активная миниатюра всегда видна в ленте
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index, images])

  const go = (d: number) => onIndex((index + d + images.length) % images.length)
  // ← и → листают, где бы ни стоял фокус, кроме полей ввода (там стрелки нужны для текста) и окна версий поверх.
  // Раньше фокус при открытии попадал в поле подписи, и стрелки не работали вовсе.
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })
  useEffect(() => {
    if (versionsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      goRef.current(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [versionsOpen])

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
  const navBtn = 'absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white outline-none backdrop-blur transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        // grid-cols-1 = minmax(0, 1fr): без него колонка окна растягивалась по ленте миниатюр (30 фото — шире экрана),
        // и картинка уезжала вправо, а стрелка «дальше», крестик и края полей оказывались за окном
        className="grid-cols-1 gap-0 overflow-hidden p-0 sm:max-w-6xl"
        // фокус остаётся на самом окне, а не в поле подписи: стрелки сразу листают
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
      >
        <DialogTitle className="sr-only">{im.caption ?? im.file.name}</DialogTitle>
        <DialogDescription className="sr-only">{tr('Изображение {{n}} из {{total}}', { n: index + 1, total: images.length })}</DialogDescription>

        <div className="min-w-0 bg-neutral-950">
          <div className="relative flex h-[min(68svh,720px)] touch-pan-y items-center justify-center max-sm:h-[45svh]" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {urls?.get(im.file.storage_key) ? (
              <img src={urls.get(im.file.storage_key)} alt={im.caption ?? im.file.name} className="max-h-full max-w-full select-none object-contain" draggable={false} />
            ) : (
              <span className="text-sm text-white/60">{tr('Загружаем…')}</span>
            )}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-3 text-white">
              <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-xs tabular-nums">
                {index + 1} / {images.length}
              </span>
              <button type="button" onClick={onClose} aria-label={tr('Закрыть')} className="pointer-events-auto grid size-9 place-items-center rounded-full bg-black/40 outline-none hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white">
                <X className="size-5" />
              </button>
            </div>
            {images.length > 1 && (
              <>
                <button type="button" className={`${navBtn} left-3`} onClick={() => go(-1)} aria-label={tr('Предыдущее')} title="←">
                  <ChevronLeft className="size-6" />
                </button>
                <button type="button" className={`${navBtn} right-3`} onClick={() => go(1)} aria-label={tr('Следующее')} title="→">
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>
          {/* лента миниатюр: перейти к любому изображению одним нажатием */}
          {images.length > 1 && (
            <ul ref={strip} className="flex gap-1.5 overflow-x-auto px-3 pb-3 pt-1 [scrollbar-width:thin]" aria-label={tr('Изображения')}>
              {images.map((x, i) => (
                <li key={x.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={i === index}
                    onClick={() => onIndex(i)}
                    aria-label={tr('Открыть изображение: {{name}}', { name: x.caption ?? x.file.name })}
                    className={cn('block h-12 w-[4.5rem] overflow-hidden rounded-md bg-neutral-800 outline-none ring-offset-2 ring-offset-neutral-950 transition-opacity focus-visible:ring-2 focus-visible:ring-white', i === index ? 'opacity-100 ring-2 ring-primary' : 'opacity-50 hover:opacity-90')}
                  >
                    {urls?.get(x.file.storage_key) && <img src={urls.get(x.file.storage_key)} alt="" loading="lazy" className="size-full object-cover" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
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
              <span className="min-w-0 flex-1 truncate text-sm">{im.caption ?? im.file.name}</span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setVersionsOpen(true)} title={tr('История версий этого изображения')}>
              <History /> {tr('Версии')}
              {im.versions > 1 && <span className="tabular-nums text-muted-foreground">{im.versions}</span>}
            </Button>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {!confirming ? (
                <>
                  <Button type="button" variant={im.is_cover ? 'secondary' : 'outline'} size="sm" disabled={im.is_cover || save.isPending} onClick={() => save.mutate({ caption, cover: true })}>
                    <Star className={cn(im.is_cover && 'fill-current')} /> {im.is_cover ? tr('Обложка') : tr('Сделать обложкой')}
                  </Button>
                  <Button type="button" variant={im.is_plan ? 'secondary' : 'outline'} size="sm" disabled={plan.isPending} aria-pressed={im.is_plan} title={tr('Схемы подставляются в отчёты об инспекции; рендеры не подставляются')} onClick={() => plan.mutate()}>
                    <MapIcon /> {im.is_plan ? tr('Это схема') : tr('Отметить как схему')}
                  </Button>
                  <div className="flex min-w-48 flex-1 items-center gap-2">
                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Input
                      value={folder}
                      onChange={(e) => setFolder(e.target.value)}
                      onBlur={() => folder.trim() !== im.folder && move.mutate(folder)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      maxLength={200}
                      placeholder={tr('Папка, например: Спальня/Ночь')}
                      aria-label={tr('Папка изображения')}
                      className="h-8 flex-1"
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
                    <Trash2 /> {tr('Удалить')}
                  </Button>
                </>
              ) : (
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
          )}
        </div>
        {versionsOpen && <VersionsDialog projectId={projectId} image={im} canEdit={canEdit} onClose={() => setVersionsOpen(false)} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  )
}
