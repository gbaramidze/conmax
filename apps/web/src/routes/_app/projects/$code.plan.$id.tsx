import { BackButton } from '@/components/app-shell/back-button'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ChevronLeft, Crosshair, Armchair, Eye, EyeOff, Download, ExternalLink, FileImage, Info, ListTree, MapPin, Maximize, Move, Pencil, Ruler, Square, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { openFile } from '@/features/activity/api'
import { documentQuery, documentsQuery, linksQuery, versionsQuery } from '@/features/documents/api'
import { DocumentDetails } from '@/features/documents/details'
import { FileKindBadge } from '@/features/documents/file-kind'
import { activityLoader } from '@/features/activity/loader'
import { OFFICE_LABELS, OFFICE_MAX_BYTES, officeKind, type OfficeKind } from '@/features/documents/office'
import { useOfficeEditAccess } from '@/features/documents/edit/access'
import { DWG_VIEWER_ENABLED, DwgViewer } from '@/features/documents/dwg-viewer'
import { OfficeViewer } from '@/features/documents/office-viewer'
import { formatBytes } from '@/features/activity/api'
import { applyRoomType, ffeDocsQuery, ffeItemsQuery, roomLinesQuery, roomTypesQuery } from '@/features/ffe/api'
import { FurnitureDialog, PickFurnitureDialog, type FurnitureContext } from '@/features/ffe/plan-furniture'
import { ItemAvatar } from '@/features/ffe/item-avatar'
import { addFurnitureMark, deleteFurnitureMark, marksError, planMarksQuery } from '@/features/ffe/plan-marks'
import { createLocation, locationLabel, locationsQuery, orderKey, setLocationPurpose, type LocationPurpose } from '@/features/locations/api'
import { typeColors } from '@/features/locations/type-colors'
import { downloadFile, pinsQuery, pinTask, planUrlQuery, unpinTask, versionSource, viewSource, type PinRow } from '@/features/plans/api'
import { NewPinDialog } from '@/features/plans/new-pin-dialog'
import { OBJECT_TYPES } from '@/features/plans/object-types'
import { ObjectsPanel } from '@/features/plans/objects-panel'
import { deleteObject, pathWidths, planObjectsQuery, planScalesQuery, saveObject, setPlanScale, type PlanObject } from '@/features/plans/objects'
import type { ObjectPatch } from '@/features/plans/objects-panel'
import { ZonesPanel } from '@/features/plans/zones-panel'
import { deleteZone, planZonesQuery, setZone, setZonesMany, zoneColor, type PlanZone, type Point, type ZoneColorMode } from '@/features/plans/zones'
import { PlanCanvas, pinTone, type PlanHandle, type PlanMode, type PlanSpot, type PlanTool } from '@/features/plans/plan-canvas'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { CATEGORY_STYLES, DEFAULT_TASK_SEARCH, PRIORITY_LABELS } from '@/features/tasks/api'

// правка документов подгружается только по кнопке «Править»: в ней Tiptap, docx и exceljs
const OfficeEditor = lazy(() => import('@/features/documents/edit/office-edit').then((m) => ({ default: m.OfficeEditor })))

// Паттерн «Split Pane»: слева документ с булавками, справа список замечаний на нём. Открывает любой PDF и картинку:
// план, чертёж, спецификацию, договор; конкретную версию — по ?version=, сразу на весь экран — по ?full=1
export const Route = createFileRoute('/_app/projects/$code/plan/$id')({
  validateSearch: z.object({
    page: z.number().int().min(1).optional().catch(undefined),
    pin: z.string().optional().catch(undefined),
    obj: z.string().optional().catch(undefined), // объект слоя из реестра оборудования: откроется вкладка «Слои» с выбранным объектом
    version: z.string().optional().catch(undefined),
    full: z.boolean().optional().catch(undefined),
    dwg: z.boolean().optional().catch(undefined), // DWG/DXF: открыть сам чертёж (Autodesk), а не его PDF-печать
    q: z.string().optional().catch(undefined), // слово из поиска по реестру: сведения откроются с подсветкой найденного
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const [docs] = await Promise.all([
      queryClient.ensureQueryData(documentsQuery(project.id)),
      queryClient.ensureQueryData(pinsQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
    if (!docs.some((d) => d.id === params.id)) throw notFound()
    // сведения о документе для боковой панели
    await Promise.all([
      queryClient.ensureQueryData(documentQuery(params.id)),
      queryClient.ensureQueryData(versionsQuery(params.id)),
      queryClient.ensureQueryData(linksQuery(params.id)),
      activityLoader(queryClient, { type: 'document', id: params.id }),
    ])
  },
  notFoundComponent: () => (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
      <p className="font-medium">{tr('План не найден')}</p>
      <p className="text-sm text-muted-foreground">{tr('Возможно, он удалён или у вас нет к нему доступа.')}</p>
    </div>
  ),
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем план…')}</p>,
  component: PlanPage,
})

const STATUS_LABELS: Record<string, string> = {
  backlog: tr('Не начато'),
  todo: tr('К выполнению'),
  in_progress: tr('В работе'),
  blocked: tr('Заблокировано'),
  review: tr('На проверке'),
  done: tr('Выполнено'),
  cancelled: tr('Отменено'),
}

function PlanPage() {
  const { code, id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: docs } = useSuspenseQuery(documentsQuery(p.id))
  const { data: allPins } = useSuspenseQuery(pinsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const doc = docs.find((d) => d.id === id)!

  // выбранная версия (?version=) или действующая; файл версии или, если он не открывается (DWG), приложенный PDF для просмотра
  const askedVersion = search.version ?? null
  const { data: versions } = useQuery({ ...versionsQuery(id), enabled: !!askedVersion })
  const viewVersion = askedVersion ? (versions?.find((v) => v.id === askedVersion) ?? null) : null
  const versionLoading = !!askedVersion && !versions
  const isOldVersion = !!viewVersion && viewVersion.id !== doc.current_version_id
  const source = askedVersion ? (viewVersion ? versionSource(viewVersion) : null) : viewSource(doc)
  const isPlanKind = doc.doc_type === 'plan' || doc.doc_type === 'drawing'
  // таблицы, Word и текст: свой просмотрщик вместо плана с замечаниями
  const officeFile = askedVersion
    ? viewVersion?.file
      ? { key: viewVersion.file.storage_key, name: viewVersion.file.name, mime: viewVersion.file.mime, size: viewVersion.file.size_bytes }
      : null
    : doc.storage_key
      ? { key: doc.storage_key, name: doc.file_name ?? '', mime: doc.file_mime ?? '', size: doc.file_size ?? 0 }
      : null
  const office = officeFile && !source ? officeKind(officeFile.name, officeFile.mime) : null
  // DWG и DXF открываются просмотрщиком Autodesk: сам по себе, если PDF-печати нет, или по просьбе (?dwg=1), если она есть
  const dwgFile = DWG_VIEWER_ENABLED && officeFile && /\.(dwg|dxf)$/i.test(officeFile.name) ? officeFile : null
  const showDwg = !!dwgFile && (!source || !!search.dwg)
  const viewedRevision = viewVersion ? (viewVersion.revision || `№${viewVersion.version_no}`) : doc.current_revision
  const { data: url, isError } = useQuery(planUrlQuery(source?.key))
  // на прежних версиях замечания только смотрим: ставить и переносить можно на действующей
  const canCreate = permissions.includes('task.create') && !isOldVersion
  const canEdit = (permissions.includes('task.edit.any') || permissions.includes('task.edit.own')) && !isOldVersion

  const [panelTab, setPanelTab] = useState<'pins' | 'zones' | 'layers' | 'doc'>('pins')
  const [pages, setPages] = useState(1)
  const page = Math.min(search.page ?? 1, Math.max(pages, 1))
  const [mode, setMode] = useState<PlanMode>('view')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<PlanSpot | null>(null)
  const [tool, setTool] = useState<PlanTool>('point')

  // ---- зоны мест на плане ----
  const { data: allZones = [] } = useQuery(planZonesQuery(id))
  const { data: typeData } = useQuery(roomTypesQuery(p.id))

  // ---- план комнаты: коды мебели на листе (CM-TV-01) открывают позицию каталога ----
  // комнатный план — тот, что привязан к номеру или к типу номера (этажные и общие планы кодов не размечают)
  const { data: docLinks = [] } = useQuery(linksQuery(id))
  const planRooms = useMemo(
    () => docLinks.flatMap((l) => (l.entity_type === 'location' ? locations.filter((x) => x.id === l.entity_id && x.kind === 'room') : [])),
    [docLinks, locations],
  )
  const planTypes = useMemo(() => (typeData?.types ?? []).filter((t) => docLinks.some((l) => l.entity_type === 'room_type' && l.entity_id === t.id)), [docLinks, typeData])
  const isRoomPlan = isPlanKind && (planRooms.length > 0 || planTypes.length > 0)
  const { data: ffeItems = [] } = useQuery({ ...ffeItemsQuery(p.id), enabled: isRoomPlan })
  const { data: ffeDocs } = useQuery({ ...ffeDocsQuery(p.id), enabled: isRoomPlan })
  const singleRoom = planRooms.length === 1 && planTypes.length === 0 ? planRooms[0]! : null
  const { data: roomLines = [] } = useQuery({ ...roomLinesQuery(p.id, singleRoom?.id ?? ''), enabled: !!singleRoom })
  const { data: planMarks = [] } = useQuery({ ...planMarksQuery(id), enabled: isRoomPlan })
  const canMarks = isRoomPlan && !isOldVersion && (permissions.includes('location.manage') || permissions.includes('schedule.edit'))
  /** Что известно о позиции в номере или типе, к которому привязан план (null — состав неизвестен: план общий для нескольких номеров) */
  const furnitureContext = (itemId: string): FurnitureContext | null => {
    if (singleRoom) {
      const line = roomLines.find((l) => l.item_id === itemId)
      return { scope: tr('В этом номере: {{name}}', { name: singleRoom.name }), qty: line ? line.qty : null, status: line?.status }
    }
    if (planTypes.length === 1) {
      const row = typeData?.items.find((r) => r.type_id === planTypes[0]!.id && r.item_id === itemId)
      return { scope: tr('В типе «{{name}}»', { name: planTypes[0]!.name }), qty: row ? row.qty : null }
    }
    return null
  }
  // ручная отметка: нажали точку или обвели зону, потом выбрали, какая там мебель
  const [markArmed, setMarkArmed] = useState(false)
  // слой мебели по умолчанию выключен: план открывается чистым; включается кнопкой, при постановке отметки включается сам
  const [showFurniture, setShowFurniture] = useState(false)
  const [markTool, setMarkTool] = useState<'point' | 'area'>('point')
  const [markSpot, setMarkSpot] = useState<{ page: number; x: number; y: number; x2?: number; y2?: number } | null>(null)
  const [openMark, setOpenMark] = useState<string | null>(null)
  const addMark = useMutation({
    mutationFn: (v: { spot: NonNullable<typeof markSpot>; itemId: string }) => addFurnitureMark(p.id, id, v.spot.page, v.itemId, v.spot),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plan-furniture-marks', id] })
      setShowFurniture(true)
      setMarkSpot(null)
      toast.success(tr('Отметка поставлена'))
    },
    onError: (e) => toast.error(marksError(e)),
  })
  const removeMark = useMutation({
    mutationFn: (markId: string) => deleteFurnitureMark(markId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plan-furniture-marks', id] })
      setOpenMark(null)
      toast.success(tr('Отметка убрана'))
    },
    onError: (e) => toast.error(marksError(e)),
  })
  const openedMark = openMark ? planMarks.find((m) => m.id === openMark) : undefined
  const openItem = openedMark ? ffeItems.find((i) => i.id === openedMark.item_id) : undefined
  // позиции для выбора: сначала те, что входят в состав этого номера или типа
  const pickOptions = useMemo(() => {
    const rows = ffeItems.map((i) => {
      const c = furnitureContext(i.id)
      return { item: i, inside: !!c && c.qty !== null, qty: c?.qty ?? null }
    })
    return rows.sort((a, b) => Number(b.inside) - Number(a.inside))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ffeItems, roomLines, typeData, planTypes, singleRoom])
  const typeColor = useMemo(() => {
    const f = typeColors((typeData?.types ?? []).map((t) => t.name))
    return (n: string | null) => f(n)
  }, [typeData])
  const [colorMode, setColorMode] = useState<ZoneColorMode>('ffe')
  const [showZones, setShowZones] = useState(true)
  const [zoneSelId, setZoneSelId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [zoneTool, setZoneTool] = useState<'rect' | 'poly'>('rect')
  const [parentId, setParentId] = useState<string | null>(null)
  const canZones = permissions.includes('location.manage') && !isOldVersion
  const childrenOf = (parent: string | null) =>
    parent ? locations.filter((l) => l.parent_id === parent).sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code, undefined, { numeric: true })) : []

  // типовой план: один чертёж привязан к нескольким этажам (например, 13–18) — номер обводится один раз и ставится на все этажи группы
  const linkedFloors = useMemo(
    () =>
      doc.location_paths
        .map((path) => locations.find((l) => l.path === path))
        .filter((l): l is (typeof locations)[number] => !!l && l.kind === 'floor')
        .sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code, undefined, { numeric: true })),
    [doc.location_paths, locations],
  )
  const isTypical = linkedFloors.length >= 2
  const [viewFloorId, setViewFloorId] = useState<string | null>(null)
  const [applyAll, setApplyAll] = useState(true)
  const viewFloor = isTypical ? (linkedFloors.find((f) => f.id === viewFloorId) ?? linkedFloors[0]!) : null
  // на листе видны зоны выбранного этажа (и зоны мест вне группы этажей); у остальных этажей контуры те же, и они бы лежали друг на друге
  const zones = useMemo(() => {
    if (!viewFloor) return allZones
    const paths = linkedFloors.map((f) => f.path)
    return allZones.filter((z) => {
      const fp = paths.find((x) => z.path === x || z.path.startsWith(x + '.'))
      return !fp || fp === viewFloor.path
    })
  }, [allZones, linkedFloors, viewFloor])

  // где размечать: типовой план (помещения выбранного этажа), места, к которым привязан план, затем остальные корпуса, секции, этажи и места с зонами
  const parentOptions = useMemo(() => {
    const linked = doc.location_paths.map((path) => locations.find((l) => l.path === path)).filter((l): l is (typeof locations)[number] => !!l)
    const typicalIds = new Set(linkedFloors.map((f) => f.id))
    const head = isTypical ? [{ id: linkedFloors[0]!.id, label: tr('Типовой план: помещения этажа') }] : []
    const zonedRooms = new Set(zones.map((z) => z.location_id))
    const rest = locations.filter(
      (l) => (l.kind === 'building' || l.kind === 'section' || l.kind === 'floor' || l.kind === 'zone' || zonedRooms.has(l.id)) && !linked.includes(l) && !typicalIds.has(l.id),
    )
    const base = [...linked.filter((l) => !typicalIds.has(l.id)), ...rest].map((l) => ({ id: l.id, label: locationLabel(l.path, locations) }))
    const cur = parentId && !typicalIds.has(parentId) && !base.some((o) => o.id === parentId) ? locations.find((l) => l.id === parentId) : undefined
    return [...head, ...base, ...(cur ? [{ id: cur.id, label: locationLabel(cur.path, locations) }] : [])]
  }, [doc.location_paths, locations, linkedFloors, isTypical, zones, parentId])
  useEffect(() => {
    if (parentId === null && parentOptions.length > 0) setParentId(parentOptions[0]!.id)
  }, [parentOptions, parentId])
  // в типовом плане «типовой» родитель — это выбранный для просмотра этаж
  const effParentId = isTypical && viewFloor && parentId === linkedFloors[0]!.id ? viewFloor.id : parentId
  const candidates = useMemo(() => childrenOf(effParentId), [locations, effParentId]) // eslint-disable-line react-hooks/exhaustive-deps
  const parentKind = locations.find((l) => l.id === effParentId)?.kind ?? null
  /** Те же по порядку помещения на остальных этажах группы (вместе с самим): их зоны ставятся и убираются вместе */
  const matesOf = (locationId: string): string[] => {
    if (!isTypical || !applyAll || !viewFloor) return [locationId]
    const room = locations.find((l) => l.id === locationId)
    if (!room || room.parent_id !== viewFloor.id) return [locationId]
    const idx = childrenOf(viewFloor.id).findIndex((c) => c.id === locationId)
    const others = linkedFloors
      .filter((f) => f.id !== viewFloor.id)
      .map((f) => childrenOf(f.id)[idx])
      .filter((l): l is (typeof locations)[number] => !!l && l.kind === room.kind)
    return [locationId, ...others.map((l) => l.id)]
  }
  const zoneSel = zones.find((z) => z.id === zoneSelId) ?? null
  const armedLoc = locations.find((l) => l.id === armedId)
  const refreshZones = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['plan-zones', id] }), queryClient.invalidateQueries({ queryKey: ['plan-type-zones', id] })])
  const saveZone = useMutation({
    mutationFn: async (pts: Point[]) => {
      if (!armedId) return 1
      const ids = matesOf(armedId)
      if (ids.length > 1) return setZonesMany(p.id, id, page, ids, pts)
      await setZone(p.id, id, page, armedId, pts)
      return 1
    },
    onSuccess: async (n) => {
      await refreshZones()
      toast.success(n > 1 ? tr('Зона «{{name}}» сохранена на этажах: {{n}}', { name: armedLoc?.name ?? '', n }) : tr('Зона «{{name}}» сохранена', { name: armedLoc?.name ?? '' }))
      // дальше — следующее помещение без зоны, по порядку
      const zoned = new Set([...zones.map((z) => z.location_id), armedId])
      const from = candidates.findIndex((c) => c.id === armedId)
      const next = candidates.slice(from + 1).find((c) => !zoned.has(c.id)) ?? candidates.find((c) => !zoned.has(c.id))
      setArmedId(next?.id ?? null)
    },
    onError: (e) => toast.error((e as { message?: string })?.message?.includes('42501') ? tr('Нет права рисовать зоны.') : tr('Не удалось сохранить зону.')),
  })
  const removeZone = useMutation({
    mutationFn: async (z: PlanZone) => {
      const ids = new Set(matesOf(z.location_id))
      await Promise.all(allZones.filter((x) => ids.has(x.location_id) && x.page === z.page).map((x) => deleteZone(x.id)))
    },
    onSuccess: async () => {
      await refreshZones()
      setZoneSelId(null)
      toast.success(tr('Зона убрана'))
    },
    onError: () => toast.error(tr('Не удалось убрать зону.')),
  })
  const setPurpose = useMutation({
    mutationFn: ({ z, purpose }: { z: PlanZone; purpose: LocationPurpose }) => setLocationPurpose(p.id, [z.location_id], purpose),
    onSuccess: async () => {
      await Promise.all([refreshZones(), queryClient.invalidateQueries({ queryKey: ['locations', p.id] })])
      toast.success(tr('Назначение сохранено'))
    },
    onError: () => toast.error(tr('Не удалось сменить назначение.')),
  })
  // тип номера для обведённого помещения: на типовом плане сразу для тех же номеров остальных этажей группы
  const setRoomType = useMutation({
    mutationFn: ({ z, typeId }: { z: PlanZone; typeId: string }) => applyRoomType(p.id, matesOf(z.location_id), typeId),
    onSuccess: async () => {
      await Promise.all([refreshZones(), queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'ffe' || q.queryKey[0] === 'locations' })])
      setColorMode('type')
      toast.success(tr('Тип номера назначен, состав мебели обновлён'))
    },
    onError: () => toast.error(tr('Не удалось назначить тип номера.')),
  })
  // новое место внутри выбранного (квартира на этаже, санузел в квартире) — и сразу к обводке
  const createPlace = useMutation({
    mutationFn: async (input: { name: string; kind: 'room' | 'zone'; purpose: LocationPurpose | null }) => {
      const sibs = locations.filter((l) => l.parent_id === effParentId)
      const used = new Set(sibs.map((l) => l.code))
      const prefix = input.kind === 'zone' ? 'Z' : 'R'
      let n = sibs.length + 1
      while (used.has(`${prefix}${n}`)) n += 1
      const sort = sibs.reduce((m, l) => Math.max(m, l.sort), 0) + 1
      const newId = await createLocation({ projectId: p.id, parentId: effParentId, kind: input.kind, code: `${prefix}${n}`, name: input.name, sort })
      if (input.kind === 'room' && input.purpose) await setLocationPurpose(p.id, [newId], input.purpose)
      return newId
    },
    onSuccess: async (newId) => {
      await queryClient.invalidateQueries({ queryKey: ['locations', p.id] })
      setObjArm(null)
      setArmedId(newId)
    },
    onError: () => toast.error(tr('Не удалось добавить место.')),
  })
  const enterZone = (z: PlanZone) => {
    setParentId(z.location_id)
    setArmedId(null)
  }
  // ---- слои объектов: камеры, щиты, гидранты, трассы ----
  const { data: objects = [] } = useQuery(planObjectsQuery(id))
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set())
  const [objSelId, setObjSelId] = useState<string | null>(null)
  const [objArm, setObjArm] = useState<string | null>(null)
  const canObjects = (permissions.includes('location.manage') || permissions.includes('schedule.edit')) && !isOldVersion
  // правка в карточке (подтип, направление, размер) видна на плане сразу, до сохранения
  const [preview, setPreview] = useState<{ id: string; patch: Pick<ObjectPatch, 'variant' | 'rotation' | 'size' | 'color' | 'specs'> } | null>(null)
  const shownObjects = useMemo(
    () => objects.filter((o) => !hiddenTypes.has(o.type_code)).map((o) => (preview && preview.id === o.id ? { ...o, ...preview.patch } : o)),
    [objects, hiddenTypes, preview],
  )
  // подтип, с которым ставим следующий объект (камера Dome, Bullet…)
  const [armVariant, setArmVariant] = useState<string | null>(null)
  // масштаб листа: метров в ширине листа; по нему считаются длины трасс и площади зон
  const { data: scales } = useQuery(planScalesQuery(id))
  const scale = scales?.get(page) ?? null
  const [aspect, setAspect] = useState(1.4)
  const [calib, setCalib] = useState<'idle' | 'draw' | 'ready'>('idle')
  const [calibPts, setCalibPts] = useState<Point[] | null>(null)
  const objSel = objects.find((o) => o.id === objSelId) ?? null
  const armedObjType = objArm ? OBJECT_TYPES.find((t) => t.code === objArm) : undefined
  const refreshObjects = () => queryClient.invalidateQueries({ queryKey: ['plan-objects', id] })
  const objError = (e: unknown) => toast.error((e as { message?: string })?.message?.includes('42501') ? tr('Нет права ставить объекты на план.') : tr('Не удалось сохранить объект.'))
  const placeObject = useMutation({
    mutationFn: (pts: Point[]) => saveObject({ projectId: p.id, documentId: id, page, type: armedObjType!.code, geometry: armedObjType!.geometry, points: pts, variant: armVariant }),
    onSuccess: async (newId) => {
      await refreshObjects()
      setObjSelId(newId)
      setPanelTab('layers')
      // точки ставятся подряд, трасса — по одной
      if (armedObjType?.geometry === 'line') setObjArm(null)
    },
    onError: objError,
  })
  const updateObject = useMutation({
    mutationFn: ({ o, patch }: { o: PlanObject; patch: ObjectPatch }) =>
      saveObject({ projectId: p.id, documentId: id, page: o.page, type: o.type_code, geometry: o.geometry, points: o.points, ...patch, id: o.id }),
    onSuccess: async () => {
      await refreshObjects()
      toast.success(tr('Объект сохранён'))
    },
    onError: objError,
  })
  const removeObject = useMutation({
    mutationFn: (o: PlanObject) => deleteObject(o.id),
    onSuccess: async () => {
      await refreshObjects()
      setObjSelId(null)
      toast.success(tr('Объект убран'))
    },
    onError: () => toast.error(tr('Не удалось убрать объект.')),
  })
  const moveObject = useMutation({
    mutationFn: ({ o, points }: { o: PlanObject; points: Point[] }) =>
      saveObject({ projectId: p.id, documentId: id, page: o.page, type: o.type_code, geometry: o.geometry, points, label: o.label, status: o.status, notes: o.notes, variant: o.variant, rotation: o.rotation, size: o.size, color: o.color, specs: o.specs, id: o.id }),
    onMutate: ({ o, points }) => {
      // сразу показываем новое положение, не дожидаясь ответа сервера
      queryClient.setQueryData<PlanObject[]>(['plan-objects', id], (old) => old?.map((x) => (x.id === o.id ? { ...x, points } : x)))
    },
    onSettled: () => void refreshObjects(),
    onError: objError,
  })
  const applyScale = useMutation({
    mutationFn: async (meters: number | null) => {
      if (meters === null) return setPlanScale(p.id, id, page, null)
      const d = calibPts ? pathWidths(calibPts, aspect) : 0
      if (d <= 0) throw new Error('empty')
      await setPlanScale(p.id, id, page, meters / d)
    },
    onSuccess: async (_r, meters) => {
      await queryClient.invalidateQueries({ queryKey: ['plan-scales', id] })
      setCalib('idle')
      setCalibPts(null)
      toast.success(meters === null ? tr('Масштаб сброшен') : tr('Масштаб задан'))
    },
    onError: objError,
  })
  const startCalib = () => {
    setObjArm(null)
    setArmedId(null)
    setMode('view')
    setObjSelId(null)
    setCalibPts(null)
    setCalib('draw')
    setPanelTab('layers')
  }
  const cancelCalib = () => {
    setCalib('idle')
    setCalibPts(null)
  }
  const armObject = (code: string | null) => {
    setObjArm(code)
    setArmVariant(null)
    cancelCalib()
    if (code) {
      setMode('view')
      setPending(null)
      setSelectedId(null)
      setZoneSelId(null)
      setArmedId(null)
      setObjSelId(null)
      setHiddenTypes((h) => {
        if (!h.has(code)) return h
        const n = new Set(h)
        n.delete(code)
        return n
      })
      setPanelTab('layers')
    }
  }
  const armZone = (locationId: string | null) => {
    setArmedId(locationId)
    if (locationId) {
      setObjArm(null)
      setMode('view')
      setPending(null)
      setSelectedId(null)
      setZoneSelId(null)
      setPanelTab('zones')
    }
  }
  useEffect(() => {
    if (mode !== 'view') {
      setArmedId(null)
      setObjArm(null)
      setCalib('idle')
    }
  }, [mode])
  // список замечаний можно спрятать, чтобы план занял всю ширину; выбор запоминается
  const [listOpen, setListOpen] = useState(() => {
    try {
      return localStorage.getItem('plan-list-open') !== '0'
    } catch {
      return true
    }
  })
  const toggleList = () => {
    setListOpen((v) => {
      try {
        localStorage.setItem('plan-list-open', v ? '0' : '1')
      } catch {
        /* хранилище недоступно — выбор не запомнится */
      }
      return !v
    })
  }
  const canvas = useRef<PlanHandle>(null)

  // полноэкранный режим: тот же просмотрщик (зум и выбор сохраняются), поверх всей страницы
  const openedFull = useRef(!!search.full)
  const [full, setFull] = useState(!!search.full)
  const [mobileList, setMobileList] = useState(false)
  const toggleFull = (on: boolean) => {
    setFull(on)
    setMobileList(false)
    setTimeout(() => canvas.current?.fit(), 60)
  }
  // открыто ссылкой сразу на весь экран — «Закрыть» возвращает туда, откуда пришли
  const closeFull = () => {
    if (!openedFull.current) return toggleFull(false)
    if (window.history.length > 1) window.history.back()
    else void navigate({ to: '/projects/$code/documents', params: { code }, search: {} })
  }
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) closeFull()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [full])

  const docPins = useMemo(() => allPins.filter((x) => x.document_id === id && (!askedVersion || x.version_id === askedVersion)), [allPins, id, askedVersion])
  const visible = useMemo(
    () => docPins.filter((x) => (x.page === page) && (!onlyOpen || (x.task!.status_category !== 'done' && x.task!.status_category !== 'cancelled'))),
    [docPins, page, onlyOpen],
  )
  const listed = useMemo(
    () => [...docPins].filter((x) => !onlyOpen || (x.task!.status_category !== 'done' && x.task!.status_category !== 'cancelled')).sort((a, b) => a.page - b.page || a.task!.key.localeCompare(b.task!.key, currentLocale(), { numeric: true })),
    [docPins, onlyOpen],
  )
  const selected = docPins.find((x) => x.id === selectedId) ?? null
  // типовой план привязан к нескольким этажам: место замечания выбирается при постановке
  const placeOptions = doc.location_paths
    .map((path) => ({ id: locations.find((l) => l.path === path)?.id ?? '', label: locationLabel(path, locations) }))
    .filter((o) => o.id)
  const placeLabel = doc.location_paths.length > 0 ? locationLabel(doc.location_paths[0], locations) : null
  const outdated = askedVersion ? 0 : docPins.filter((x) => x.version_id !== doc.current_version_id).length

  // переход из реестра оборудования: ?obj=<id> выбирает объект слоя и подводит к нему
  useEffect(() => {
    if (!search.obj) return
    const target = objects.find((o) => o.id === search.obj)
    if (!target) return
    setObjSelId(target.id)
    setPanelTab('layers')
    const xs = target.points.map((q) => q[0])
    const ys = target.points.map((q) => q[1])
    const t = setTimeout(() => canvas.current?.focus((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2), 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.obj, objects.length])

  // переход по ссылке с задачи: ?pin=ZK7-P-3 выбирает булавку и подводит к ней
  useEffect(() => {
    if (!search.pin) return
    const target = docPins.find((x) => x.task!.key === search.pin)
    if (!target) return
    setSelectedId(target.id)
    if (target.page !== page) void navigate({ search: (prev) => ({ ...prev, page: target.page }), replace: true })
    const t = setTimeout(() => canvas.current?.focus(Number(target.x), Number(target.y)), 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.pin, docPins.length])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plan-pins', p.id] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ])

  const move = useMutation({
    mutationFn: (v: { pin: PinRow; spot: PlanSpot }) => pinTask({ taskId: v.pin.task_id, documentId: id, page, ...v.spot }),
    onSuccess: async () => {
      await refresh()
      setMode('view')
      toast.success(tr('Отметка перенесена'))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr('Не удалось перенести.')),
  })
  const remove = useMutation({
    mutationFn: (pin: PinRow) => unpinTask(pin.task_id, id),
    onSuccess: async () => {
      await refresh()
      setSelectedId(null)
      toast.success(tr('Отметка убрана с плана, задача осталась'))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr('Не удалось убрать.')),
  })

  function placeSpot(spot: PlanSpot) {
    if (mode === 'add') setPending(spot)
    else if (mode === 'move' && selected) move.mutate({ pin: selected, spot })
  }

  /** При переносе область переносится областью, точка — точкой */
  function startMove() {
    if (!selected) return
    setTool(selected.x2 !== null ? 'area' : 'point')
    setMode(mode === 'move' ? 'view' : 'move')
  }

  const setPage = (n: number) => void navigate({ search: (prev) => ({ ...prev, page: n }), replace: true })

  if (showDwg && dwgFile && !versionLoading) {
    return <DwgScreen code={code} id={id} title={doc.title} revision={viewedRevision} file={dwgFile} hasPdf={!!source} startFull={!!search.full} isOld={isOldVersion} q={search.q} />
  }
  if (office && officeFile && !versionLoading) {
    return <OfficeScreen code={code} id={id} projectId={p.id} baseVersionId={viewVersion?.id ?? doc.current_version_id ?? doc.latest_version_id} title={doc.title} revision={viewedRevision} kind={office} file={officeFile} startFull={!!search.full} isOld={isOldVersion} q={search.q} />
  }

  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 sm:p-3' : 'flex flex-col gap-3'}>
      <div className="flex flex-wrap items-center gap-2">
        {full ? (
          <Button variant="outline" size="sm" onClick={closeFull} aria-label={tr('Закрыть полноэкранный режим')} title={tr('Закрыть (Esc)')}>
            <X /> <span className="hidden sm:inline">{tr('Закрыть')}</span>
          </Button>
        ) : (
          <BackButton fallback={
          <Button asChild variant="ghost" size="sm">
            {isPlanKind ? (
              <Link to="/projects/$code/plans" params={{ code }}>
                <ChevronLeft />{tr('Все планы')}</Link>
            ) : (
              <Link to="/projects/$code/documents" params={{ code }} search={{}}>
                <ChevronLeft />{tr('Все документы')}</Link>
            )}
          </Button>
} />
        )}
        <div className="min-w-36 flex-1">
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold leading-tight">
            <span className="truncate">{doc.title}</span>
            {viewedRevision && <span className="ident rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{viewedRevision}</span>}
          </h1>
          <p className={`items-center gap-1.5 text-xs text-muted-foreground ${full ? 'hidden sm:flex' : 'flex'}`}>
            <MapPin className="size-3" aria-hidden /> {placeLabel ?? tr('не привязан к месту')}
            <span aria-hidden>·</span>
            <FileKindBadge name={doc.file_name} mime={doc.file_mime} />
            {source?.viaPreview && doc.storage_key && (
              <>
                <span aria-hidden>·</span>
                <span>{tr('показан PDF для просмотра')}</span>
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void openFile(doc.storage_key!).catch(() => toast.error(tr('Не удалось скачать файл.')))}>{tr('скачать исходник (')}{doc.file_name?.split('.').pop()?.toUpperCase() ?? tr('файл')})
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dwgFile && source && (
            <Button variant="outline" onClick={() => void navigate({ search: (prev) => ({ ...prev, dwg: true }) })} title={tr('Открыть сам чертёж DWG: слои, листы, измерения')}>
              <Ruler /> <span className="hidden sm:inline">{tr('Открыть DWG')}</span>
            </Button>
          )}
          <Button variant="outline" size="icon" aria-pressed={listOpen} aria-label={listOpen ? tr('Скрыть список замечаний') : tr('Показать список замечаний')} title={listOpen ? tr('Скрыть список замечаний') : tr('Показать список замечаний')} onClick={toggleList} className="hidden lg:inline-flex">
            <ListTree />
          </Button>
          {full && (
            <Button variant="outline" size="icon" aria-pressed={mobileList} aria-label={tr('Список замечаний')} title={tr('Список замечаний')} onClick={() => setMobileList((v) => !v)} className="lg:hidden">
              <ListTree />
            </Button>
          )}
          {isRoomPlan && (planMarks.length > 0 || canMarks) && (
            <Button
              variant="outline"
              aria-pressed={showFurniture}
              title={showFurniture ? tr('Скрыть слой мебели') : tr('Показать слой мебели')}
              onClick={() => setShowFurniture((v) => !v)}
            >
              {showFurniture ? <Eye /> : <EyeOff />}{' '}
              <span className="max-sm:sr-only">{tr('Мебель')}</span>
              {planMarks.length > 0 && <span className="tabular-nums text-muted-foreground">{planMarks.length}</span>}
            </Button>
          )}
          {canMarks && (
            <>
              <Button
                variant={markArmed ? 'default' : 'outline'}
                aria-pressed={markArmed}
                title={tr('Отметить мебель на плане: укажите точку или зону, затем выберите мебель')}
                onClick={() => {
                  setMarkArmed((v) => !v)
                  setShowFurniture(true)
                  setMode('view')
                  setPending(null)
                }}
              >
                <Armchair /> {markArmed ? tr('Готово') : <span className="max-sm:sr-only">{tr('Отметить мебель')}</span>}
              </Button>
              {markArmed && (
                <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label={tr('Чем отметить')}>
                  <Button size="sm" variant={markTool === 'point' ? 'secondary' : 'ghost'} aria-pressed={markTool === 'point'} onClick={() => setMarkTool('point')}>
                    <MapPin /> {tr('Точка')}
                  </Button>
                  <Button size="sm" variant={markTool === 'area' ? 'secondary' : 'ghost'} aria-pressed={markTool === 'area'} onClick={() => setMarkTool('area')}>
                    <Square /> {tr('Зона')}
                  </Button>
                </div>
              )}
            </>
          )}
          {canCreate && (
            <Button
              variant={mode === 'add' ? 'default' : 'outline'}
              aria-pressed={mode === 'add'}
              onClick={() => {
                setMode(mode === 'add' ? 'view' : 'add')
                setMarkArmed(false)
                setPending(null)
              }}
            >
              <Crosshair />{' '}
              {mode === 'add' ? (
                tr('Готово')
              ) : full ? (
                <>
                  <span className="sm:hidden">{tr('Замечание')}</span>
                  <span className="hidden sm:inline">{tr('Поставить замечание')}</span>
                </>
              ) : (
                tr('Поставить замечание')
              )}
            </Button>
          )}
          {full ? (
            <>
              <Button variant="outline" disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener')} title={tr('Открыть файл в отдельной вкладке')}>
                <ExternalLink /> <span className="hidden sm:inline">{tr('Открыть отдельно')}</span>
              </Button>
              <Button
                variant="outline"
                disabled={!source}
                onClick={() => source && void downloadFile(source.key, (source.viaPreview ? doc.preview_name : doc.file_name) ?? null).catch(() => toast.error(tr('Не удалось скачать файл.')))}
                title={tr('Скачать файл')}
              >
                <Download /> <span className="hidden sm:inline">{tr('Скачать')}</span>
              </Button>
            </>
          ) : (
            source && (
              <Button variant="outline" onClick={() => toggleFull(true)} title={tr('Открыть на весь экран')}>
                <Maximize /> <span className="hidden sm:inline">{tr('На весь экран')}</span>
              </Button>
            )
          )}
        </div>
      </div>

      {isOldVersion && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Это прежняя версия (ревизия')}{' '}{viewedRevision}{tr('): замечания на ней можно только смотреть.')}{' '}
          <Link to="/projects/$code/plan/$id" params={{ code, id }} search={{ full: full || undefined }} className="font-medium underline underline-offset-2">{tr('Открыть действующую')}</Link>
        </p>
      )}
      {outdated > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('План обновлён до ревизии')}{' '}{doc.current_revision || `№${doc.current_version_no}`}{tr('. Отметок, поставленных на прежней ревизии:')}{' '}{outdated}{tr('. Проверьте, что они по-прежнему в нужных местах.')}</p>
      )}
      {mode === 'move' && selected && (
        <p className="rounded-lg border border-signal/60 bg-signal/15 px-3 py-2 text-sm">
          {selected.x2 !== null ? tr('Обведите на плане новую область для {{key}}.', { key: selected.task!.key }) : tr('Нажмите на плане новое место для {{key}}.', { key: selected.task!.key })}{' '}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => setMode('view')}>{tr('Отмена')}</button>
        </p>
      )}

      <div className={`grid min-h-0 gap-3 ${listOpen ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : ''} ${full ? 'flex-1 grid-rows-[minmax(0,1fr)]' : ''}`}>
        <div className={full ? 'h-full min-h-0' : 'h-[max(26rem,calc(100svh-10.5rem))] min-h-0'}>
          {versionLoading ? (
            <div className="grid h-full place-items-center rounded-lg border bg-card text-sm text-muted-foreground">{tr('Открываем документ…')}</div>
          ) : !source ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              <p className="max-w-md">{tr('Этот формат (')}{doc.file_name?.split('.').pop()?.toUpperCase() ?? tr('файл')}{tr(') на экране не открывается. Приложите к версии документа PDF-печать — и документ откроется здесь с отметками замечаний.')}</p>
              {/\.(xls|doc)$/i.test(doc.file_name ?? '') && (
                <p className="max-w-md">{tr('Старые форматы .xls и .doc в браузере не правятся. Скачайте файл, исправьте в Excel или Word и загрузите его заново кнопкой «Новая версия» в панели «Документ».')}</p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {doc.storage_key && (
                  <Button variant="outline" onClick={() => void downloadFile(doc.storage_key!, doc.file_name ?? null).catch(() => toast.error(tr('Не удалось скачать файл.')))}>
                    <Download />{tr('Скачать файл')}</Button>
                )}
                <Button variant="ghost" onClick={() => setPanelTab('doc')}>
                  <Info />{tr('Сведения и версии')}</Button>
              </div>
            </div>
          ) : isError ? (
            <div className="grid h-full place-items-center rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('Не удалось получить файл плана.')}</div>
          ) : !url ? (
            <div className="grid h-full place-items-center rounded-lg border bg-card text-sm text-muted-foreground">{tr('Открываем план…')}</div>
          ) : (
            <PlanCanvas
              highlight={search.q}
              furniture={
                isRoomPlan && showFurniture
                  ? {
                      onOpen: setOpenMark,
                      marks: planMarks.flatMap((m) => {
                        const it = ffeItems.find((i) => i.id === m.item_id)
                        if (!it) return []
                        const c = furnitureContext(it.id)
                        return [{ id: m.id, page: m.page, x: m.x, y: m.y, x2: m.x2, y2: m.y2, label: it.code, out: !!c && c.qty === null }]
                      }),
                    }
                  : undefined
              }
              placeMark={
                markArmed && canMarks
                  ? {
                      tool: markTool,
                      hint: markTool === 'point' ? tr('Нажмите на плане место, где стоит мебель') : tr('Обведите зону, удерживая кнопку'),
                      onPlace: (x, y) => setMarkSpot({ page, x, y }),
                      onPlaceArea: (x, y, x2, y2) => setMarkSpot({ page, x, y, x2, y2 }),
                    }
                  : null
              }
              handle={canvas}
              url={url}
              mime={source.mime}
              page={page}
              pages={pages}
              onPage={setPage}
              onPages={setPages}
              pins={visible}
              selectedId={selectedId}
              pending={pending}
              mode={mode}
              tool={tool}
              onTool={setTool}
              onPlace={(x, y) => placeSpot({ x, y })}
              onPlaceArea={(x, y, x2, y2) => placeSpot({ x, y, x2, y2 })}
              onSelect={setSelectedId}
              zones={showZones ? zones : []}
              zoneColor={(z) => zoneColor(z, colorMode, typeColor)}
              selectedZoneId={zoneSelId}
              onZoneSelect={(zid) => {
                setZoneSelId(zid)
                if (zid) setPanelTab('zones')
              }}
              zoneDraw={armedId && canZones && mode === 'view' ? zoneTool : null}
                            zoneHint={armedLoc ? (zoneTool === 'rect' ? tr('Обведите «{{name}}»: нажмите, потяните, отпустите', { name: armedLoc.name }) : tr('Нажимайте вершины «{{name}}»', { name: armedLoc.name })) : ''}
              onZoneDrawn={(pts) => saveZone.mutate(pts)}
              onZoneCancel={() => {
                setArmedId(null)
              }}
              objects={shownObjects}
              selectedObjectId={objSelId}
              onObjectSelect={(oid) => {
                setObjSelId(oid)
                if (oid) {
                  setZoneSelId(null)
                  setPanelTab('layers')
                }
              }}
              objectDraw={calib === 'draw' ? 'line' : armedObjType && canObjects && mode === 'view' ? armedObjType.geometry : null}
              objectHint={calib === 'draw' ? tr('Нажмите начало и конец известной длины, затем «Готово»') : armedObjType ? (armedObjType.geometry === 'point' ? tr('Поставьте «{{name}}»: нажмите на плане', { name: armedObjType.name }) : tr('Трасса «{{name}}»: нажимайте вершины, затем «Готово»', { name: armedObjType.name })) : ''}
              onObjectDrawn={(pts) => {
                if (calib === 'draw') {
                  setCalibPts(pts)
                  setCalib('ready')
                } else placeObject.mutate(pts)
              }}
              onObjectCancel={() => {
                setObjArm(null)
                if (calib === 'draw') cancelCalib()
              }}
              objectsEditable={canObjects}
              onObjectMove={(oid, pts) => {
                const o = objects.find((x) => x.id === oid)
                if (o) moveObject.mutate({ o, points: pts })
              }}
              ghostLine={calibPts}
              onAspect={setAspect}
            />
          )}
        </div>

        <aside
          className={
            full
              ? `min-h-0 flex-col gap-2 lg:static lg:z-auto lg:h-full lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ${
                  mobileList ? 'fixed inset-x-2 bottom-2 z-[60] flex h-[48svh] rounded-xl border bg-background p-3 shadow-2xl' : 'hidden'
                } ${listOpen ? 'lg:flex' : 'lg:hidden'}`
              : `min-h-0 flex-col gap-2 lg:h-[max(26rem,calc(100svh-10.5rem))] ${listOpen ? 'flex' : 'flex lg:hidden'}`
          }
          aria-label={tr('Панель документа')}
        >
          <PanelTabs tab={source ? panelTab : 'doc'} onTab={setPanelTab} pinsCount={source ? docPins.length : null} zonesCount={source ? zones.length : null} layersCount={source ? objects.length : null} />
          {(source ? panelTab : 'doc') === 'doc' ? (
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
              <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем сведения…')}</p>}>
                <DocumentDetails code={code} id={id} q={search.q} />
              </Suspense>
            </div>
          ) : panelTab === 'layers' ? (
            <ObjectsPanel
              objects={objects}
              canEdit={canObjects}
              hiddenTypes={hiddenTypes}
              onToggleType={(c) =>
                setHiddenTypes((h) => {
                  const n = new Set(h)
                  if (!n.delete(c)) n.add(c)
                  return n
                })
              }
              armedType={objArm}
              onArm={armObject}
              selected={objSel}
              onSelect={(oid) => {
                setObjSelId(oid)
                const o = objects.find((x) => x.id === oid)
                if (o) {
                  if (o.page !== page) setPage(o.page)
                  const xs = o.points.map((q) => q[0])
                  const ys = o.points.map((q) => q[1])
                  setTimeout(() => canvas.current?.focus((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2), o.page !== page ? 500 : 0)
                }
              }}
              onSave={(o, patch) => updateObject.mutate({ o, patch })}
              onPreview={(o, patch) => setPreview(patch ? { id: o.id, patch } : null)}
              armedVariant={armVariant}
              onArmVariant={setArmVariant}
              page={page}
              scale={scale}
              aspect={aspect}
              calibrating={calib === 'draw'}
              calibReady={calib === 'ready'}
              onCalibStart={startCalib}
              onCalibCancel={cancelCalib}
              onCalibApply={(m) => applyScale.mutate(m)}
              onScaleReset={() => applyScale.mutate(null)}
              onDelete={(o) => removeObject.mutate(o)}
              busy={updateObject.isPending || removeObject.isPending || applyScale.isPending}
            />
          ) : panelTab === 'zones' ? (
            <ZonesPanel
              code={code}
              locations={locations}
              zones={zones}
              canManage={canZones}
              colorMode={colorMode}
              onColorMode={setColorMode}
              showZones={showZones}
              onShowZones={setShowZones}
              selected={zoneSel}
              onSelect={(z) => {
                setZoneSelId(z?.id ?? null)
                if (z) {
                  if (z.page !== page) setPage(z.page)
                  const xs = z.points.map((q) => q[0])
                  const ys = z.points.map((q) => q[1])
                  setTimeout(() => canvas.current?.focus((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2), z.page !== page ? 500 : 0)
                }
              }}
              armedId={armedId}
              onArm={armZone}
              tool={zoneTool}
              onTool={setZoneTool}
              parentId={parentId}
              onParent={setParentId}
              parentOptions={parentOptions}
              candidates={candidates}
              typeColor={typeColor}
              onDelete={(z) => removeZone.mutate(z)}
              busy={removeZone.isPending || setPurpose.isPending || setRoomType.isPending || createPlace.isPending}
              page={page}
              scale={scale}
              aspect={aspect}
              roomTypes={(typeData?.types ?? []).map((t) => ({ id: t.id, name: t.name }))}
              onSetType={(z, typeId) => setRoomType.mutate({ z, typeId })}
              onSetPurpose={(z, purpose) => setPurpose.mutate({ z, purpose })}
              onEnter={enterZone}
              onCreatePlace={(input) => createPlace.mutate(input)}
              parentKind={parentKind}
              typical={
                isTypical && viewFloor && parentId === linkedFloors[0]!.id
                  ? { floors: linkedFloors.map((f) => ({ id: f.id, label: f.name })), viewFloorId: viewFloor.id, onViewFloor: setViewFloorId, applyAll, onApplyAll: setApplyAll }
                  : null
              }
            />
          ) : (
          <>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{tr('Замечания на плане')}{' '}<span className="font-normal text-muted-foreground">{docPins.length}</span>
            </h2>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="size-3.5" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />{tr('только открытые')}</label>
          </div>

          {selected && (
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${pinTone(selected.task!).className}`}>{selected.doc_no}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{selected.task!.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="ident">{selected.task!.key}</span> · {STATUS_LABELS[selected.task!.status_category]} · {PRIORITY_LABELS[selected.task!.priority as keyof typeof PRIORITY_LABELS] ?? selected.task!.priority}
                    {selected.task!.assignee && ` · ${selected.task!.assignee.full_name}`}
                    {selected.task!.due_date && tr(' · до {{v1}}', { v1: new Date(selected.task!.due_date).toLocaleDateString(currentLocale()) })}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button asChild size="sm" variant="secondary">
                  <Link to="/projects/$code/tasks/$key" params={{ code, key: selected.task!.key }} search={DEFAULT_TASK_SEARCH}>
                    <ExternalLink />{tr('Открыть задачу')}</Link>
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="outline" aria-pressed={mode === 'move'} onClick={startMove}>
                      <Move />{tr('Перенести')}</Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(selected)}>
                      <Trash2 />{tr('Убрать с плана')}</Button>
                  </>
                )}
              </div>
            </div>
          )}

          {listed.length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {docPins.length === 0
                ? canCreate
                  ? tr('Замечаний на плане пока нет. Нажмите «Поставить замечание», затем место на плане.')
                  : tr('Замечаний на плане пока нет.')
                : tr('Открытых замечаний нет.')}
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto rounded-lg border bg-card">
              {listed.map((x) => {
                const t = x.task!
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(x.id)
                        if (x.page !== page) setPage(x.page)
                        setTimeout(() => canvas.current?.focus(Number(x.x), Number(x.y)), x.page !== page ? 500 : 0)
                      }}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 ${x.id === selectedId ? 'bg-signal/15' : ''}`}
                    >
                      <span className={`mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${pinTone(t).className}`}>{x.doc_no}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{t.title}</span>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className={`rounded px-1 ${CATEGORY_STYLES[t.status_category]}`}>{STATUS_LABELS[t.status_category]}</span>
                          {x.x2 !== null && (
                            <span className="inline-flex items-center gap-0.5">
                              <Square className="size-3" aria-hidden />{tr('область')}</span>
                          )}
                          {pages > 1 && <span>{tr('стр.')}{' '}{x.page}</span>}
                          {t.assignee && <span className="truncate">{t.assignee.full_name}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          </>
          )}
        </aside>
      </div>

      {pending && (
        <NewPinDialog
          projectId={p.id}
          documentId={id}
          page={page}
          point={pending}
          placeLabel={placeLabel}
          placeOptions={placeOptions}
          onClose={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      )}
      {markSpot && (
        <PickFurnitureDialog
          options={pickOptions.map((o) => ({ value: o.item.id, label: o.item.code, avatar: <ItemAvatar docs={ffeDocs?.get(o.item.id)} canGenerate={permissions.includes('task.create')} />, hint: [o.item.name !== o.item.code ? o.item.name : null, o.inside ? tr('в составе: {{n}} {{unit}}', { n: o.qty, unit: o.item.unit }) : null].filter(Boolean).join(' · ') || undefined }))}
          busy={addMark.isPending}
          onPick={(itemId) => addMark.mutate({ spot: markSpot, itemId })}
          onClose={() => setMarkSpot(null)}
        />
      )}
      {openedMark && openItem && (
        <FurnitureDialog
          projectCode={code}
          item={openItem}
          docs={ffeDocs?.get(openItem.id) ?? []}
          context={furnitureContext(openItem.id)}
          canGenerate={permissions.includes('task.create')}
          onRemoveMark={canMarks ? () => removeMark.mutate(openedMark.id) : undefined}
          onClose={() => setOpenMark(null)}
        />
      )}
    </div>
  )
}

/** Экран просмотра таблицы, документа Word или текста: на странице или на весь экран, скачать исходник. */
function OfficeScreen({
  code,
  id,
  projectId,
  baseVersionId,
  title,
  revision,
  kind,
  file,
  startFull,
  isOld,
  q,
}: {
  code: string
  id: string
  projectId: string
  baseVersionId: string | null
  title: string
  revision: string | null | undefined
  kind: OfficeKind
  file: { key: string; name: string; mime: string; size: number }
  startFull: boolean
  isOld: boolean
  q?: string
}) {
  const navigate = Route.useNavigate()
  const openedFull = useRef(startFull)
  const [full, setFull] = useState(startFull)
  const tooBig = file.size > OFFICE_MAX_BYTES
  const [panel, setPanel] = useState(true)
  const [editing, setEditing] = useState(false)
  const access = useOfficeEditAccess(projectId, id, file, isOld)
  const close = () => {
    if (!openedFull.current) return setFull(false)
    if (window.history.length > 1) window.history.back()
    else void navigate({ to: '/projects/$code/documents', params: { code }, search: {} })
  }
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 sm:p-3' : 'flex flex-col gap-3'}>
      <div className="flex flex-wrap items-center gap-2">
        {full ? (
          <Button variant="outline" size="sm" onClick={close} aria-label={tr('Закрыть полноэкранный режим')} title={tr('Закрыть (Esc)')}>
            <X /> <span className="hidden sm:inline">{tr('Закрыть')}</span>
          </Button>
        ) : (
          <BackButton fallback={
          <Button asChild variant="ghost" size="sm">
            <Link to="/projects/$code/documents" params={{ code }} search={{}}>
              <ChevronLeft />{tr('Все документы')}</Link>
          </Button>
} />
        )}
        <div className="min-w-36 flex-1">
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold leading-tight">
            <span className="truncate">{title}</span>
            {revision && <span className="ident rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{revision}</span>}
          </h1>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <FileKindBadge name={file.name} mime={file.mime} /> {OFFICE_LABELS[kind]} · {file.name}
            {file.size > 0 && ` · ${formatBytes(file.size)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-pressed={panel} aria-label={panel ? tr('Скрыть сведения о документе') : tr('Показать сведения о документе')} title={panel ? tr('Скрыть сведения') : tr('Показать сведения')} onClick={() => setPanel((v) => !v)}>
            <Info />
          </Button>
          {access.visible && !editing && (
            <Button variant="outline" aria-disabled={!!access.reason} className={access.reason ? 'opacity-60' : undefined} onClick={() => (access.reason ? toast.error(access.reason) : setEditing(true))} title={tr('Править документ прямо здесь и сохранить новой версией')}>
              <Pencil /> <span className="hidden sm:inline">{tr('Править')}</span>
            </Button>
          )}
          {!full && (
            <Button variant="outline" onClick={() => setFull(true)} title={tr('Открыть на весь экран')}>
              <Maximize /> <span className="hidden sm:inline">{tr('На весь экран')}</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => void downloadFile(file.key, file.name).catch(() => toast.error(tr('Не удалось скачать файл.')))} title={tr('Скачать исходный файл')}>
            <Download /> <span className="hidden sm:inline">{tr('Скачать')}</span>
          </Button>
        </div>
      </div>
      {isOld && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{tr('Это прежняя версия (ревизия')}{' '}{revision}).{' '}
          <Link to="/projects/$code/plan/$id" params={{ code, id }} search={{ full: full || undefined }} className="font-medium underline underline-offset-2">{tr('Открыть действующую')}</Link>
        </p>
      )}
      <div className={`grid min-h-0 gap-3 ${panel ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : ''} ${full ? 'flex-1 grid-rows-[minmax(0,1fr)]' : ''}`}>
        <div className={`min-h-0 overflow-hidden rounded-lg border bg-card ${full ? 'h-full' : 'h-[max(26rem,calc(100svh-10.5rem))]'}`}>
          {editing ? (
            <Suspense fallback={<p className="grid h-full place-items-center text-sm text-muted-foreground">{tr('Открываем редактор…')}</p>}>
              <OfficeEditor projectId={projectId} documentId={id} baseVersionId={baseVersionId} file={file} kind={kind} onClose={() => setEditing(false)} />
            </Suspense>
          ) : tooBig ? (
            <p className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Файл больше')}{' '}{formatBytes(OFFICE_MAX_BYTES)}{tr(': в браузере он откроется медленно. Скачайте его и откройте в программе.')}</p>
          ) : (
            <OfficeViewer storageKey={file.key} name={file.name} kind={kind} highlight={q} />
          )}
        </div>
        {panel && (
          <aside aria-label={tr('Сведения о документе')} className={`min-h-0 overflow-y-auto pr-0.5 ${full ? 'h-full' : 'lg:h-[max(26rem,calc(100svh-10.5rem))]'}`}>
            <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем сведения…')}</p>}>
              <DocumentDetails code={code} id={id} q={q} />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  )
}

/** Экран просмотра DWG/DXF просмотрщиком Autodesk: на странице или на весь экран; если есть PDF-печать — переход к ней, скачать исходник. */
function DwgScreen({
  code,
  id,
  title,
  revision,
  file,
  hasPdf,
  startFull,
  isOld,
  q,
}: {
  code: string
  id: string
  title: string
  revision: string | null | undefined
  file: { key: string; name: string; mime: string; size: number }
  hasPdf: boolean
  startFull: boolean
  isOld: boolean
  q?: string
}) {
  const navigate = Route.useNavigate()
  const openedFull = useRef(startFull)
  const [full, setFull] = useState(startFull)
  const [panel, setPanel] = useState(true)
  const close = () => {
    if (!openedFull.current) return setFull(false)
    if (window.history.length > 1) window.history.back()
    else void navigate({ to: '/projects/$code/documents', params: { code }, search: {} })
  }
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 sm:p-3' : 'flex flex-col gap-3'}>
      <div className="flex flex-wrap items-center gap-2">
        {full ? (
          <Button variant="outline" size="sm" onClick={close} aria-label={tr('Закрыть полноэкранный режим')} title={tr('Закрыть (Esc)')}>
            <X /> <span className="hidden sm:inline">{tr('Закрыть')}</span>
          </Button>
        ) : (
          <BackButton
            fallback={
              <Button asChild variant="ghost" size="sm">
                <Link to="/projects/$code/documents" params={{ code }} search={{}}>
                  <ChevronLeft />
                  {tr('Все документы')}
                </Link>
              </Button>
            }
          />
        )}
        <div className="min-w-36 flex-1">
          <h1 className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold leading-tight">
            <span className="truncate">{title}</span>
            {revision && <span className="ident rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{revision}</span>}
          </h1>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <FileKindBadge name={file.name} mime={file.mime} /> {tr('Чертёж DWG в просмотрщике Autodesk')} · {file.name}
            {file.size > 0 && ` · ${formatBytes(file.size)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-pressed={panel} aria-label={panel ? tr('Скрыть сведения о документе') : tr('Показать сведения о документе')} title={panel ? tr('Скрыть сведения') : tr('Показать сведения')} onClick={() => setPanel((v) => !v)}>
            <Info />
          </Button>
          {hasPdf && (
            <Button variant="outline" onClick={() => void navigate({ search: (prev) => ({ ...prev, dwg: undefined }) })} title={tr('Вернуться к PDF-печати с замечаниями, зонами и слоями')}>
              <FileImage /> <span className="hidden sm:inline">{tr('PDF-печать')}</span>
            </Button>
          )}
          {!full && (
            <Button variant="outline" onClick={() => setFull(true)} title={tr('Открыть на весь экран')}>
              <Maximize /> <span className="hidden sm:inline">{tr('На весь экран')}</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => void downloadFile(file.key, file.name).catch(() => toast.error(tr('Не удалось скачать файл.')))} title={tr('Скачать исходный файл')}>
            <Download /> <span className="hidden sm:inline">{tr('Скачать')}</span>
          </Button>
        </div>
      </div>
      {isOld && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {tr('Это прежняя версия (ревизия')} {revision}).{' '}
          <Link to="/projects/$code/plan/$id" params={{ code, id }} search={{ full: full || undefined }} className="font-medium underline underline-offset-2">
            {tr('Открыть действующую')}
          </Link>
        </p>
      )}
      <div className={`grid min-h-0 gap-3 ${panel ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : ''} ${full ? 'flex-1 grid-rows-[minmax(0,1fr)]' : ''}`}>
        <div className={`min-h-0 overflow-hidden rounded-lg border bg-card ${full ? 'h-full' : 'h-[max(26rem,calc(100svh-10.5rem))]'}`}>
          <DwgViewer storageKey={file.key} />
        </div>
        {panel && (
          <aside aria-label={tr('Сведения о документе')} className={`min-h-0 overflow-y-auto pr-0.5 ${full ? 'h-full' : 'lg:h-[max(26rem,calc(100svh-10.5rem))]'}`}>
            <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем сведения…')}</p>}>
              <DocumentDetails code={code} id={id} q={q} />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  )
}

/** Вкладки боковой панели: замечания на плане (только для PDF и картинок) и сведения о документе. */
function PanelTabs({ tab, onTab, pinsCount, zonesCount, layersCount }: { tab: 'pins' | 'zones' | 'layers' | 'doc'; onTab: (t: 'pins' | 'zones' | 'layers' | 'doc') => void; pinsCount: number | null; zonesCount: number | null; layersCount: number | null }) {
  type Tab = 'pins' | 'zones' | 'layers' | 'doc'
  const items: [Tab, string, number | null][] = [
    ...(pinsCount !== null ? ([['pins', tr('Замечания'), pinsCount]] as [Tab, string, number | null][]) : []),
    ...(zonesCount !== null ? ([['zones', tr('Зоны'), zonesCount]] as [Tab, string, number | null][]) : []),
    ...(layersCount !== null ? ([['layers', tr('Слои'), layersCount]] as [Tab, string, number | null][]) : []),
    ['doc', tr('Документ'), null],
  ]
  return (
    <div role="tablist" aria-label={tr('Панель документа')} className="flex shrink-0 gap-1 overflow-x-auto rounded-lg bg-muted p-1">
      {items.map(([key, label, n]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => onTab(key)}
          className={`min-h-9 flex-1 shrink-0 whitespace-nowrap rounded-md px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-sm ${tab === key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:bg-background/60'}`}
        >
          {label}
          {n !== null && <span className="ml-1 text-xs tabular-nums text-muted-foreground sm:ml-1.5">{n}</span>}
        </button>
      ))}
    </div>
  )
}
