import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Box, Building2, Check, ChevronDown, ChevronUp, DoorOpen, Layers, Link2, ListChecks, Loader2, MoreHorizontal, NotebookPen, Search, Upload } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/auth-provider'
import { locationsQuery, orderKey, type LocationRow } from '@/features/locations/api'
import { searchLocations } from '@/features/locations/location-jump'
import {
  convertIfcFile,
  isIfcFile,
  modelFileQuery,
  modelFloorStatsQuery,
  prepareGlbFile,
  projectModelQuery,
  setModelStoreys,
  suggestStoreyMapping,
  uploadModel,
  type FloorStats,
  type ModelStorey,
  type PreparePhase,
} from '@/features/model/api'
import type { ViewerFloor } from '@/features/model/building-viewer'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// three.js тяжёлый: грузим его только на этой странице
const BuildingViewer = lazy(() => import('@/features/model/building-viewer').then((m) => ({ default: m.BuildingViewer })))

const COLOR_MODES = ['none', 'tasks', 'notes'] as const
type ColorMode = (typeof COLOR_MODES)[number]

const searchSchema = z.object({
  /** GlobalId выбранного этажа модели */
  floor: z.string().optional().catch(undefined),
  /** путь места (этаж или номер): выбрать его этаж — так возвращаются из карточки места */
  place: z.string().optional().catch(undefined),
  color: z.enum(COLOR_MODES).optional().catch(undefined),
})

export const Route = createFileRoute('/_app/projects/$code/model')({
  validateSearch: searchSchema,
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(projectModelQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем 3D-модель…')}</p>,
  component: ModelPage,
})

const RED = '#ef4444'
const AMBER = '#f59e0b'
const BLUE = '#3b82f6'

/** Этаж для кнопок «лифта»: этаж модели и (если сопоставлен) этаж структуры */
interface Floor {
  storey: ModelStorey
  loc: LocationRow | null
  /** короткая подпись на кнопке: «27», «P1», «M1» */
  short: string
  label: string
  stats: FloorStats | undefined
}

function ModelPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { tenantId } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(locationsQuery(p.id))
  const { data: model } = useSuspenseQuery(projectModelQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canManage = permissions.includes('location.manage')
  const { data: stats = [] } = useQuery({ ...modelFloorStatsQuery(p.id), enabled: !!model })
  const file = useQuery(modelFileQuery(model?.storage_key))
  const [ready, setReady] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const colorMode: ColorMode = search.color ?? 'none'

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const statsByLoc = useMemo(() => new Map(stats.map((s) => [s.location_id, s])), [stats])
  const mapped = !!model?.storeys.some((s) => s.location_id)

  // кнопки «лифта»: если этажи сопоставлены — только сопоставленные (служебные уровни модели вроде «Ground level» не нужны),
  // иначе — все этажи модели под их названиями из IFC
  const floors: Floor[] = useMemo(() => {
    if (!model) return []
    return model.storeys
      .filter((s) => !mapped || s.location_id)
      .map((s) => {
        const loc = s.location_id ? (byId.get(s.location_id) ?? null) : null
        return {
          storey: s,
          loc,
          short: loc ? shortFloor(loc) : (s.name.replace(/\.?\s*story$/i, '').trim() || s.name).slice(0, 6),
          label: loc ? loc.name : s.name,
          stats: loc ? statsByLoc.get(loc.id) : undefined,
        }
      })
      .sort((a, b) => b.storey.elevation - a.storey.elevation)
  }, [model, mapped, byId, statsByLoc])

  // возврат из карточки места: выбрать этаж этого места (у номера — этаж, в котором он)
  useEffect(() => {
    if (!search.place) return
    const loc = rows.find((r) => r.path === search.place)
    const target = loc && floors.find((f) => f.loc && (f.loc.id === loc.id || loc.path.startsWith(f.loc.path + '.')))
    void navigate({ search: (s) => ({ ...s, place: undefined, floor: target?.storey.gid ?? s.floor }), replace: true })
  }, [search.place, rows, floors, navigate])

  const selectedGid = floors.some((f) => f.storey.gid === search.floor) ? search.floor! : null
  const selected = floors.find((f) => f.storey.gid === selectedGid) ?? null
  const select = (gid: string | null) => void navigate({ search: (s) => ({ ...s, floor: gid ?? undefined }), replace: true })

  const viewerFloors: ViewerFloor[] = useMemo(
    () =>
      floors.map((f) => ({
        gid: f.storey.gid,
        y: f.storey.y,
        label: f.label,
        color: floorColor(f.stats, colorMode),
      })),
    [floors, colorMode],
  )

  // ↑ ↓ — соседний этаж, Esc — всё здание
  useEffect(() => {
    // Esc, которым закрыли карточку места, ещё всплывает, когда эта страница уже открылась, — его не считаем
    const since = performance.now()
    const onKey = (e: KeyboardEvent) => {
      if (e.timeStamp < since) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (document.querySelector('[role=dialog]')) return
      if (e.key === 'Escape' && selectedGid) {
        e.preventDefault()
        select(null)
        return
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (!floors.length) return
      e.preventDefault()
      const i = floors.findIndex((f) => f.storey.gid === selectedGid)
      // список сверху вниз: «вверх» — к меньшему индексу
      const next = i < 0 ? (e.key === 'ArrowUp' ? floors.length - 1 : 0) : Math.max(0, Math.min(floors.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)))
      select(floors[next].storey.gid)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, selectedGid])

  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  // ход загрузки: перевод IFC в браузере (чтение, разбор, геометрия, сжатие) и отправка готовой модели
  const [phase, setPhase] = useState<{ phase: PreparePhase | 'upload'; done: number; name: string } | null>(null)
  const upload = useMutation({
    mutationFn: async (f: File) => {
      setPhase({ phase: 'read', done: 0, name: f.name })
      const prepared = isIfcFile(f) ? await convertIfcFile(f, (ph, done) => setPhase({ phase: ph, done, name: f.name })) : await prepareGlbFile(f)
      setPhase({ phase: 'upload', done: 0, name: f.name })
      return { id: await uploadModel(tenantId!, p.id, prepared), mb: prepared.gz.byteLength / 1048576 }
    },
    onSuccess: async ({ mb }) => {
      await qc.invalidateQueries({ queryKey: ['project-model', p.id] })
      setReady(false)
      toast.success(tr('Модель загружена: {{mb}} МБ', { mb: mb.toFixed(1) }))
      setMappingOpen(true)
    },
    onError: (e: Error) =>
      toast.error(
        e.message === 'not_glb' || e.message === 'not_buildos_glb'
          ? tr('Это не модель BuildOS (.glb)')
          : e.message === 'ifczip_no_ifc'
            ? tr('В архиве нет файла .ifc')
            : /memory|allocation|out of bounds/i.test(e.message)
              ? tr('Браузеру не хватило памяти для этого IFC. Попросите архитекторов выгрузить модель без перил и объектов или переведите её с компьютера с большим объёмом памяти.')
              : tr('Не удалось загрузить модель: {{msg}}', { msg: e.message }),
        { duration: 10000 },
      ),
    onSettled: () => setPhase(null),
  })
  const pickFile = (f: File | undefined) => {
    if (!f) return
    // перевод IFC требует много памяти: на телефоне большой файл не осилить
    if (isIfcFile(f) && f.size > 60 * 1048576 && window.matchMedia('(pointer: coarse)').matches) {
      toast.error(tr('Большой IFC переводится в браузере компьютера — на телефоне не хватит памяти.'), { duration: 8000 })
      return
    }
    upload.mutate(f)
  }
  const uploadInput = (
    <input
      ref={fileInput}
      type="file"
      accept=".ifc,.ifczip,.glb,.gz"
      className="hidden"
      onChange={(e) => {
        pickFile(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  if (!model) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-muted">
          <Box className="size-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">{tr('3D-модель здания')}</h1>
        <p className="text-sm text-muted-foreground">
          {tr('Здесь будет дом в 3D: нажимаете на этаж — видите его разрез сверху, задачи и заметки на нём и сразу переходите к нужному номеру.')}
        </p>
        {canManage ? (
          <>
            <ol className="flex flex-col gap-2 text-left text-sm">
              <li>
                <b>1.</b> {tr('Попросите архитекторов выгрузить модель из ArchiCAD или Revit в IFC — с зонами помещений, у которых номер как в структуре (301, 412).')}
              </li>
              <li>
                <b>2.</b> {tr('Загрузите файл .ifc или .ifczip сюда — с компьютера. Браузер сам переведёт его в лёгкую модель (обычно меньше минуты), на сервер уйдут только несколько мегабайт.')}
              </li>
              <li>
                <b>3.</b> {tr('Проверьте, как этажи модели связались с этажами структуры.')}
              </li>
            </ol>
            <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              {upload.isPending ? tr('Загружаем…') : tr('Загрузить модель (IFC)')}
            </Button>
            {uploadInput}
            {phase && <UploadProgress {...phase} />}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{tr('Модель ещё не загружена. Её загружает тот, кто ведёт структуру проекта.')}</p>
        )}
      </div>
    )
  }

  const roomsOf = (loc: LocationRow | null) =>
    loc ? rows.filter((r) => r.parent_id === loc.id).sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code, undefined, { numeric: true })) : []

  return (
    <div className="-mx-4 -mb-24 -mt-5 flex h-[calc(100svh-3.5rem-4rem)] min-h-[26rem] flex-col overflow-hidden sm:-mx-6 lg:-mx-8 lg:-mb-10 lg:-mt-6 lg:h-[calc(100svh-3.5rem)]">
      {/* ───── верхняя строка: вид, окраска, переход, меню ───── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <h1 className="mr-1 flex items-center gap-2 text-base font-semibold">
          <Box className="size-5 text-muted-foreground" aria-hidden />
          {tr('3D-модель')}
        </h1>
        <div role="radiogroup" aria-label={tr('Окраска этажей')} className="flex rounded-lg border bg-muted/40 p-0.5 text-sm">
          {COLOR_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={colorMode === m}
              onClick={() => void navigate({ search: (s) => ({ ...s, color: m === 'none' ? undefined : m }), replace: true })}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                colorMode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'none' ? <Building2 className="size-4" /> : m === 'tasks' ? <ListChecks className="size-4" /> : <NotebookPen className="size-4" />}
              <span className="max-sm:sr-only">{m === 'none' ? tr('Без окраски') : m === 'tasks' ? tr('Задачи') : tr('Заметки')}</span>
            </button>
          ))}
        </div>
        <FloorSearch rows={rows} floors={floors} onFloor={(gid) => select(gid)} code={code} />
        <div className="ml-auto flex items-center gap-1">
          {selected && (
            <Button variant="outline" size="sm" onClick={() => select(null)}>
              <Building2 />
              <span className="max-sm:sr-only">{tr('Всё здание')}</span>
            </Button>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={tr('Действия с моделью')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setMappingOpen(true)}>
                  <Link2 />
                  {tr('Сопоставить этажи')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <Upload />
                  {tr('Загрузить новую версию')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {uploadInput}
        </div>
      </header>

      {!mapped && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{tr('Этажи модели ещё не связаны с этажами структуры — пока показаны названия из файла архитекторов.')}</span>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setMappingOpen(true)}>
              {tr('Сопоставить')}
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        {/* ───── «лифт»: этажи сверху вниз ───── */}
        <nav aria-label={tr('Этажи')} className="flex shrink-0 gap-1 overflow-auto border-r bg-background p-2 md:w-24 md:flex-col max-md:order-2 max-md:border-r-0 max-md:border-t">
          {floors.map((f) => {
            const active = f.storey.gid === selectedGid
            const dot = floorColor(f.stats, colorMode)
            return (
              <button
                key={f.storey.gid}
                type="button"
                onClick={() => select(active ? null : f.storey.gid)}
                aria-current={active ? 'true' : undefined}
                title={`${f.label} · ${fmtElevation(f.storey.elevation)}`}
                ref={(el) => {
                  if (active) el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                }}
                className={cn(
                  'relative flex h-10 min-w-12 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-full',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >
                {f.short}
                {dot && <span className="absolute right-1 top-1 size-2 rounded-full" style={{ background: dot }} aria-hidden />}
              </button>
            )
          })}
        </nav>

        {/* ───── сам дом ───── */}
        <div className="relative min-h-0 flex-1 bg-gradient-to-b from-sky-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
          {file.data ? (
            <Suspense fallback={null}>
              <BuildingViewer buffer={file.data} floors={viewerFloors} selected={selectedGid} onSelect={(gid) => select(gid)} onReady={() => setReady(true)} />
            </Suspense>
          ) : null}
          {(!ready || file.isLoading) && !file.isError && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-sm shadow">
                <Loader2 className="size-4 animate-spin" />
                {file.isLoading ? tr('Скачиваем модель ({{mb}} МБ)…', { mb: (model.size_bytes / 1048576).toFixed(0) }) : tr('Собираем здание…')}
              </div>
            </div>
          )}
          {file.isError && <p className="absolute inset-0 grid place-items-center text-sm text-destructive">{tr('Не удалось скачать модель')}</p>}
          {colorMode !== 'none' && <Legend mode={colorMode} />}
          {!selected && ready && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-3 py-1 text-xs text-muted-foreground shadow-sm max-sm:hidden">
              {tr('Нажмите на этаж в доме или в списке · ↑ ↓ — соседний этаж · колёсико — ближе')}
            </p>
          )}
        </div>

        {/* ───── выбранный этаж ───── */}
        {selected && <FloorPanel floor={selected} rooms={roomsOf(selected.loc)} code={code} spaces={model.spaces} floors={floors} onSelect={select} />}
      </div>

      {phase && <UploadProgress {...phase} />}
      {canManage && mappingOpen && (
        <MappingDialog
          modelId={model.id}
          storeys={model.storeys}
          rows={rows}
          onClose={() => setMappingOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['project-model', p.id] })
            void qc.invalidateQueries({ queryKey: ['locations', p.id] })
          }}
        />
      )}
    </div>
  )
}

const PHASES: { id: PreparePhase | 'upload'; label: () => string; weight: number }[] = [
  { id: 'read', label: () => tr('Читаем файл'), weight: 0.08 },
  { id: 'parse', label: () => tr('Разбираем IFC'), weight: 0.12 },
  { id: 'geometry', label: () => tr('Собираем этажи и стены'), weight: 0.55 },
  { id: 'compress', label: () => tr('Упрощаем и сжимаем'), weight: 0.15 },
  { id: 'upload', label: () => tr('Отправляем модель'), weight: 0.1 },
]

/** Окно хода загрузки: шаги по порядку и общая полоса. Закрыть нельзя — перевод идёт, пока открыта вкладка. */
function UploadProgress({ phase, done, name }: { phase: PreparePhase | 'upload'; done: number; name: string }) {
  const at = PHASES.findIndex((x) => x.id === phase)
  const total = PHASES.slice(0, at).reduce((a, x) => a + x.weight, 0) + (PHASES[at]?.weight ?? 0) * Math.min(1, done)
  const pct = Math.round(total * 100)
  return (
    <Dialog open>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Загружаем модель')}</DialogTitle>
          <DialogDescription className="truncate">{name}</DialogDescription>
        </DialogHeader>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <ol className="flex flex-col gap-1.5 text-sm">
          {PHASES.map((x, i) => (
            <li key={x.id} className={cn('flex items-center gap-2', i > at && 'text-muted-foreground')}>
              {i < at ? <Check className="size-4 text-green-600" /> : i === at ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4" />}
              {x.label()}
              {i === at && x.id === 'geometry' && <span className="tabular-nums text-muted-foreground">{Math.round(done * 100)}%</span>}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{tr('Не закрывайте вкладку, пока идёт загрузка.')}</p>
      </DialogContent>
    </Dialog>
  )
}

function FloorPanel({ floor, rooms, code, spaces, floors, onSelect }: { floor: Floor; rooms: LocationRow[]; code: string; spaces: number; floors: Floor[]; onSelect: (gid: string) => void }) {
  const i = floors.findIndex((f) => f.storey.gid === floor.storey.gid)
  const up = i > 0 ? floors[i - 1] : undefined
  const down = i >= 0 && i < floors.length - 1 ? floors[i + 1] : undefined
  const s = floor.stats
  const stepBtn = 'inline-flex size-9 items-center justify-center rounded-md border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30'
  return (
    <aside aria-label={tr('Этаж')} className="flex shrink-0 flex-col gap-3 overflow-auto border-l bg-background p-4 md:w-80 max-md:order-3 max-md:max-h-[42%] max-md:border-l-0 max-md:border-t">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight">{floor.label}</h2>
          <p className="text-xs text-muted-foreground">
            {floor.loc && floor.loc.name !== floor.storey.name ? `${tr('В модели')}: ${floor.storey.name} · ` : ''}
            {tr('отметка')} {fmtElevation(floor.storey.elevation)}
          </p>
        </div>
        <div className="flex gap-1">
          <button type="button" className={stepBtn} disabled={!up} onClick={() => up && onSelect(up.storey.gid)} aria-label={tr('Этаж выше')} title={tr('Этаж выше (↑)')}>
            <ChevronUp className="size-4" />
          </button>
          <button type="button" className={stepBtn} disabled={!down} onClick={() => down && onSelect(down.storey.gid)} aria-label={tr('Этаж ниже')} title={tr('Этаж ниже (↓)')}>
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>

      {floor.loc ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={tr('Открытых задач')} value={s?.tasks_open ?? 0} />
            <Stat label={tr('Просрочено')} value={s?.tasks_overdue ?? 0} tone={(s?.tasks_overdue ?? 0) > 0 ? 'red' : undefined} />
            <Stat label={tr('Заметок')} value={s?.notes_open ?? 0} />
          </div>
          <Button asChild className="w-full">
            <Link to="/projects/$code/locations/$path" params={{ code, path: floor.loc.path }} search={{ from: 'model' }}>
              <Layers />
              {tr('Открыть этаж')}
            </Link>
          </Button>
          {rooms.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {tr('Номера на этаже')} <span className="text-muted-foreground tabular-nums">· {rooms.length}</span>
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5">
                {rooms.map((r) => (
                  <Link
                    key={r.id}
                    to="/projects/$code/locations/$path"
                    params={{ code, path: r.path }}
                    search={{ from: 'model' }}
                    title={r.name}
                    className="flex h-10 items-center justify-center gap-1 truncate rounded-md border px-1 text-sm font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <DoorOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    {shortRoom(r)}
                  </Link>
                ))}
              </div>
              {spaces === 0 && <p className="text-xs text-muted-foreground">{tr('В модели пока нет зон помещений, поэтому номер выбирается из списка, а не в самом доме.')}</p>}
            </section>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{tr('Этот этаж модели не связан с этажом структуры, поэтому задач и номеров здесь нет.')}</p>
      )}
    </aside>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded-lg border px-1 py-2">
      <div className={cn('text-xl font-semibold tabular-nums', tone === 'red' && 'text-red-600 dark:text-red-400')}>{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  )
}

function Legend({ mode }: { mode: ColorMode }) {
  const items =
    mode === 'tasks'
      ? [
          { color: RED, text: tr('есть просроченные задачи') },
          { color: AMBER, text: tr('есть открытые задачи') },
        ]
      : [{ color: BLUE, text: tr('есть открытые заметки') }]
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-background/90 px-3 py-2 text-xs shadow-sm">
      {items.map((i) => (
        <span key={i.text} className="flex items-center gap-2">
          <span className="size-3 rounded-sm" style={{ background: i.color }} />
          {i.text}
        </span>
      ))}
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="size-3 rounded-sm border bg-white" />
        {mode === 'tasks' ? tr('открытых задач нет') : tr('открытых заметок нет')}
      </span>
    </div>
  )
}

/** Переход к этажу или номеру по вводу: «12» — 12-й этаж, «1204» — этаж номера 1204 */
function FloorSearch({ rows, floors, onFloor, code }: { rows: LocationRow[]; floors: Floor[]; onFloor: (gid: string) => void; code: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const go = () => {
    const text = q.trim()
    if (!text) return
    const byShort = floors.find((f) => f.short.toLowerCase() === text.toLowerCase())
    if (byShort) {
      onFloor(byShort.storey.gid)
      setQ('')
      return
    }
    const [hit] = searchLocations(rows, text, 1)
    const floor = hit && floors.find((f) => f.loc && (f.loc.id === hit.id || hit.path.startsWith(f.loc.path + '.')))
    if (!hit) {
      toast.message(tr('Ничего не найдено: «{{q}}»', { q: text }))
      return
    }
    if (floor) onFloor(floor.storey.gid)
    setQ('')
    // номер: этаж выбран, сразу открываем карточку номера
    if (hit.kind === 'room') void navigate({ to: '/projects/$code/locations/$path', params: { code, path: hit.path }, search: { from: 'model' } })
  }
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
      className="relative flex items-center"
    >
      <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr('Этаж или номер')}
        aria-label={tr('Перейти к этажу или номеру')}
        inputMode="search"
        className="h-9 w-40 rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
      />
    </form>
  )
}

function MappingDialog({ modelId, storeys, rows, onClose, onSaved }: { modelId: string; storeys: ModelStorey[]; rows: LocationRow[]; onClose: () => void; onSaved: () => void }) {
  const places = useMemo(
    () => rows.filter((r) => r.kind === 'floor' || r.kind === 'zone' || r.kind === 'section').sort((a, b) => orderKey(a) - orderKey(b) || a.path.localeCompare(b.path, undefined, { numeric: true })),
    [rows],
  )
  const anyMapped = storeys.some((s) => s.location_id)
  const [value, setValue] = useState<Record<string, string | null>>(() =>
    anyMapped ? Object.fromEntries(storeys.map((s) => [s.gid, s.location_id])) : suggestStoreyMapping(storeys, rows),
  )
  const save = useMutation({
    mutationFn: () => setModelStoreys(modelId, storeys.map((s) => ({ gid: s.gid, location_id: value[s.gid] ?? null }))),
    onSuccess: () => {
      toast.success(tr('Этажи сопоставлены'))
      onSaved()
      onClose()
    },
    onError: (e: Error) => toast.error(tr('Не удалось сохранить: {{msg}}', { msg: e.message })),
  })
  const used = new Map<string, number>()
  for (const v of Object.values(value)) if (v) used.set(v, (used.get(v) ?? 0) + 1)
  const ordered = [...storeys].sort((a, b) => b.elevation - a.elevation)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Этажи модели и этажи структуры')}</DialogTitle>
          <DialogDescription>
            {anyMapped
              ? tr('Для каждого этажа из файла архитекторов выберите этаж структуры. Служебные уровни можно оставить без связи.')
              : tr('Мы предложили связи по номерам в названиях — проверьте их. Служебные уровни (кровля, технические) можно оставить без связи.')}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-auto px-6">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">{tr('В модели')}</th>
                <th className="py-2 text-right font-medium">{tr('Отметка')}</th>
                <th className="py-2 pl-3 font-medium">{tr('Этаж структуры')}</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => {
                const v = value[s.gid] ?? ''
                const dup = !!v && (used.get(v) ?? 0) > 1
                return (
                  <tr key={s.gid} className="border-t">
                    <td className="py-1.5 pr-2">{s.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtElevation(s.elevation)}</td>
                    <td className="py-1.5 pl-3">
                      <select
                        value={v}
                        onChange={(e) => setValue((cur) => ({ ...cur, [s.gid]: e.target.value || null }))}
                        aria-label={tr('Этаж структуры для «{{name}}»', { name: s.name })}
                        className={cn('h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', dup && 'border-red-500', !v && 'text-muted-foreground')}
                      >
                        <option value="">{tr('— без связи —')}</option>
                        {places.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      {dup && <p className="mt-0.5 text-xs text-red-600">{tr('Этот этаж уже выбран выше — останется только у нижнего')}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{tr('При сохранении отметки этажей из модели запишутся в структуру.')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function floorColor(s: FloorStats | undefined, mode: ColorMode): string | null {
  if (!s || mode === 'none') return null
  if (mode === 'tasks') return s.tasks_overdue > 0 ? RED : s.tasks_open > 0 ? AMBER : null
  return s.notes_open > 0 ? BLUE : null
}

function shortFloor(loc: LocationRow): string {
  const m = loc.code.match(/^F0*(\d+)$/i)
  return m ? m[1] : loc.code
}

function shortRoom(r: LocationRow): string {
  const fromName = r.name.replace(/^(номер|помещение|квартира|room|ნომერი|ოთახი|ბინა)\s*/i, '')
  return fromName.length <= 6 ? fromName : r.code.replace(/^R/i, '')
}

const fmtElevation = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : '±'}${Math.abs(m).toFixed(2).replace('.', ',')} ${tr('м')}`
