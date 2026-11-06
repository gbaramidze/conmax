import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Building2, ChevronDown, ChevronRight, DoorOpen, FolderUp, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { RenderFolderUploadDialog } from '@/features/renders/folder-upload-dialog'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  archiveLocation,
  createLocation,
  flattenTree,
  floorsUnder,
  generateBuilding,
  generateRooms,
  LOCATION_KIND_LABELS,
  locationsQuery,
  NEXT_KIND,
  PURPOSE_LABELS,
  PURPOSES,
  orderKey,
  reorderLocations,
  roomSummary,
  setLocationKind,
  siblingsOf,
  summaryText,
  updateLocation,
  type LocationKind,
  type LocationNode,
  type LocationPurpose,
  type LocationRow,
} from '@/features/locations/api'
import { roomSpecsQuery, roomTypesQuery } from '@/features/ffe/api'
import { LocationJump } from '@/features/locations/location-jump'
import { typeColors } from '@/features/locations/type-colors'
import { imageUrlsQuery, locationCoversQuery, typeCoversQuery } from '@/features/renders/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

export const Route = createFileRoute('/_app/projects/$code/locations')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await queryClient.ensureQueryData(locationsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем структуру…')}</p>,
  component: LocationsPage,
})

/** Назначение помещений по типу объекта: отель — номера, офис — офисы и т. д. */
const DEFAULT_PURPOSE: Record<string, LocationPurpose> = { residential: 'apartment', hotel: 'hotel_room', office: 'office', commercial: 'commercial', mixed: 'apartment' }

const CODE_HINT = tr('Код — латиница и цифры, до 20 символов, например K2')

function errorText(e: unknown): string {
  const code = (e as { code?: string }).code
  const message = (e as { message?: string }).message ?? ''
  if (message.includes('floor_number_required')) return tr('Укажите номер этажа: целое число, не 0.')
  if (message.includes('floor_number_taken')) return tr('Этаж с таким номером уже есть')
  if (message.includes('children_do_not_fit')) return tr('Внутри есть узлы, которые не подходят новому типу. Сначала уберите или перенесите их.')
  if (message.includes('floor_needs_building_or_section')) return tr('Этаж может лежать только в корпусе или секции.')
  if (message.includes('kind_change_not_allowed')) return tr('Тип этого узла менять нельзя.')
  if (message.includes('floors_ordered_by_number')) return tr('Этажи идут по номерам и не переставляются. Измените номер этажа в окне «Изменить».')
  if (message.includes('order must list all siblings') || message.includes('invalid order')) return tr('Список изменился. Обновите страницу и повторите.')
  if (code === '23505') return tr('Такой код уже есть на этом уровне. Выберите другой.')
  if (code === '42501') return tr('У вас нет права управлять структурой проекта.')
  if (code === '22023' && message.includes('generator')) return tr('Слишком большая структура: не более 2000 помещений за раз.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}

function LocationsPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canManage = permissions.includes('location.manage')
  const canRenders = canManage || permissions.includes('schedule.edit')
  const [renderUpload, setRenderUpload] = useState(false)
  // «/» ставит фокус в поле перехода, пока не открыта карточка места (у неё своё поле)
  const sheetOpen = !!useMatchRoute()({ to: '/projects/$code/locations/$path', params: { code }, fuzzy: true })

  const nodes = useMemo(() => flattenTree(rows), [rows])
  const summary = useMemo(() => roomSummary(rows), [rows])
  // Корпуса и секции развёрнуты, этажи (с помещениями) свёрнуты: иначе дерево из сотен квартир не прочитать
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const isOpen = (n: LocationNode) => overrides[n.id] ?? n.kind !== 'floor'
  const [generating, setGenerating] = useState(false)
  const [roomsFor, setRoomsFor] = useState<LocationNode | null>(null)
  const [adding, setAdding] = useState<LocationNode | 'root' | null>(null)
  const [archiving, setArchiving] = useState<LocationNode | null>(null)
  const [editing, setEditing] = useState<LocationNode | null>(null)
  // Помещения этажа в дереве — компактные чипы; «Списком» возвращает строки с действиями для этого этажа
  const [listed, setListed] = useState<Set<string>>(new Set())
  const { data: specs } = useQuery(roomSpecsQuery(p.id))
  const { data: typeData } = useQuery(roomTypesQuery(p.id))
  const typeNameOf = useMemo(() => {
    const names = new Map((typeData?.types ?? []).map((t) => [t.id, t.name]))
    return new Map((specs ?? []).filter((x) => x.type_id).map((x) => [x.location_id, names.get(x.type_id!) ?? '']))
  }, [specs, typeData])
  const colorFor = useMemo(() => typeColors((typeData?.types ?? []).map((t) => t.name)), [typeData])
  const { data: covers } = useQuery(locationCoversQuery(p.id))
  const { data: typeCovers } = useQuery(typeCoversQuery(p.id))
  // Номер без своего изображения показывает обложку своего типа: рендеры номеров обычно общие для типа
  const typeIdOf = useMemo(() => new Map((specs ?? []).filter((x) => x.type_id).map((x) => [x.location_id, x.type_id!])), [specs])
  const coverKeyOf = (n: { id: string; kind: string }): string | undefined => covers?.get(n.id) ?? (n.kind === 'room' ? typeCovers?.get(typeIdOf.get(n.id) ?? '') : undefined)
  const coverKeys = useMemo(() => [...new Set([...(covers?.values() ?? []), ...(typeCovers?.values() ?? [])])], [covers, typeCovers])
  const { data: coverUrls } = useQuery(imageUrlsQuery(coverKeys))

  // Скрываем потомков свёрнутых узлов
  const visible = useMemo(() => {
    const hiddenUnder: string[] = []
    return nodes.filter((n) => {
      while (hiddenUnder.length && !n.path.startsWith(hiddenUnder[hiddenUnder.length - 1] + '.')) hiddenUnder.pop()
      if (hiddenUnder.length) return false
      if (n.hasChildren && !(overrides[n.id] ?? n.kind !== 'floor')) hiddenUnder.push(n.path)
      return true
    })
  }, [nodes, overrides])

  const toggle = (n: LocationNode) => setOverrides((prev) => ({ ...prev, [n.id]: !isOpen(n) }))

  // Подряд идущие помещения одного этажа собираем в одну строку-чипы
  type Item = { kind: 'node'; n: LocationNode } | { kind: 'rooms'; parent: string; depth: number; rooms: LocationNode[] } | { kind: 'listhead'; parent: string; depth: number }
  const items = useMemo(() => {
    const out: Item[] = []
    for (const n of visible) {
      const parent = n.parent_id ?? ''
      if (n.kind === 'room' && !listed.has(parent)) {
        const last = out[out.length - 1]
        if (last && last.kind === 'rooms' && last.parent === parent) last.rooms.push(n)
        else out.push({ kind: 'rooms', parent, depth: n.depth, rooms: [n] })
        continue
      }
      if (n.kind === 'room') {
        const last = out[out.length - 1]
        if (!(last && last.kind === 'listhead' && last.parent === parent) && !(last && last.kind === 'node' && last.n.kind === 'room' && last.n.parent_id === n.parent_id)) out.push({ kind: 'listhead', parent, depth: n.depth })
      }
      out.push({ kind: 'node', n })
    }
    return out
  }, [visible, listed])

  // Порядок: у этажей его задаёт номер, остальные узлы двигаются стрелками среди соседей
  const queryClient = useQueryClient()
  const move = useMutation({
    mutationFn: async ({ node, dir }: { node: LocationNode; dir: -1 | 1 }) => {
      const ids = siblingsOf(rows, node.parent_id).map((r) => r.id)
      const i = ids.indexOf(node.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ids.length) return
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      await reorderLocations(p.id, node.parent_id, ids)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['locations', p.id] }),
    onError: (e) => toast.error(errorText(e)),
  })
  const canMove = (n: LocationNode, dir: -1 | 1) => {
    if (n.kind === 'floor') return false
    const sib = siblingsOf(rows, n.parent_id)
    const i = sib.findIndex((r) => r.id === n.id)
    return i + dir >= 0 && i + dir < sib.length
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LocationJump code={code} rows={rows} hotkey={!sheetOpen} autoFocus={!sheetOpen} className="w-full sm:w-80" />
        {(canManage || canRenders) && (
          <div className="flex flex-wrap gap-2">
            {canRenders && (
              <Button size="sm" variant="outline" onClick={() => setRenderUpload(true)} title={tr('Загрузить папку с рендерами: типы номеров, этажи, подпапки')}>
                <FolderUp />{tr('Рендеры папкой')}</Button>
            )}
            {canManage && (
              <>
            <Button size="sm" variant="outline" onClick={() => setAdding('root')}>
              <Plus />{tr('Добавить узел')}</Button>
            <Button size="sm" onClick={() => setGenerating(true)}>
              <Building2 />{tr('Создать корпус')}</Button>
              </>
            )}
          </div>
        )}
      </div>
      {renderUpload && <RenderFolderUploadDialog projectId={p.id} places={{ rows, types: typeData?.types ?? [] }} onClose={() => setRenderUpload(false)} />}

      {nodes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="font-medium">{tr('Структура пока пуста')}</p>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? tr('Создайте корпус — секции и этажи сгенерируются сами, потом их можно поправить.')
              : tr('Руководитель проекта ещё не заполнил структуру объекта.')}
          </p>
          {canManage && (
            <Button onClick={() => setGenerating(true)}>
              <Building2 />{tr('Создать корпус')}</Button>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border bg-card shadow-soft" aria-label={tr('Структура проекта')}>
          {items.map((it) => {
            if (it.kind === 'rooms')
              return (
                <li key={`rooms-${it.parent}`} className="flex flex-wrap items-center gap-1.5 border-b px-2 py-2 last:border-b-0 md:px-3" style={{ paddingLeft: it.depth * 16 + 44 }}>
                  {it.rooms.map((r) => {
                    const t = typeNameOf.get(r.id)
                    return (
                      <Link
                        key={r.id}
                        to="/projects/$code/locations/$path"
                        params={{ code, path: r.path }}
                        title={t ? `${r.name} · ${t}` : r.name}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {coverKeyOf(r) && coverUrls?.get(coverKeyOf(r)!) ? (
                          <img src={coverUrls.get(coverKeyOf(r)!)} alt="" loading="lazy" className="-ml-1 size-6 shrink-0 rounded object-cover" style={{ boxShadow: `0 0 0 2px ${colorFor(t)}` }} />
                        ) : (
                          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorFor(t) }} />
                        )}
                        {r.name.replace(/^(номер|помещение|квартира|room)\s*/i, '') || r.name}
                      </Link>
                    )
                  })}
                  {canManage && (
                    <button type="button" onClick={() => setListed((prev) => new Set(prev).add(it.parent))} className="ml-auto min-h-8 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      {tr('Списком, с действиями')}
                    </button>
                  )}
                </li>
              )
            if (it.kind === 'listhead')
              return (
                <li key={`head-${it.parent}`} className="flex justify-end border-b px-3 py-1 last:border-b-0">
                  <button type="button" onClick={() => setListed((prev) => { const next = new Set(prev); next.delete(it.parent); return next })} className="min-h-8 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    {tr('Свернуть в плитки')}
                  </button>
                </li>
              )
            const n = it.n
            return (
            <li key={n.id} className="flex min-h-12 items-center gap-2 border-b px-2 py-1 text-sm last:border-b-0 md:min-h-10 md:px-3">
              <span style={{ paddingLeft: n.depth * 16 }} className="flex min-w-0 flex-1 items-center gap-1.5">
                {n.hasChildren ? (
                  <button
                    type="button"
                    className="flex size-10 shrink-0 items-center justify-center rounded hover:bg-accent md:size-6"
                    aria-expanded={isOpen(n)}
                    aria-label={`${isOpen(n) ? tr('Свернуть') : tr('Развернуть')} ${n.name}`}
                    onClick={() => toggle(n)}
                  >
                    {isOpen(n) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                ) : (
                  <span className="inline-block size-10 shrink-0 md:size-6" />
                )}
                {coverKeyOf(n) && coverUrls?.get(coverKeyOf(n)!) && (
                  <img src={coverUrls.get(coverKeyOf(n)!)} alt="" loading="lazy" className="size-8 shrink-0 rounded object-cover" />
                )}
                <span className="ident shrink-0 text-muted-foreground">{n.code}</span>
                {/* название ведёт на страницу места: заметки, фото, задачи */}
                <Link
                  to="/projects/$code/locations/$path"
                  params={{ code, path: n.path }}
                  className={`min-w-0 truncate hover:underline ${n.depth === 0 ? 'font-medium' : ''}`}
                >
                  {n.name}
                </Link>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{LOCATION_KIND_LABELS[n.kind]}</span>
                {n.kind !== 'room' && summary.get(n.path) && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground" title={tr('Помещения внутри')}>
                    {summaryText(summary.get(n.path))}
                  </span>
                )}
                {n.kind === 'room' && n.purpose && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">· {PURPOSE_LABELS[n.purpose]}</span>}
              </span>
              {canManage && (
                <>
                  <span className="hidden shrink-0 gap-0.5 md:flex">
                    {n.kind !== 'floor' && (
                      <>
                        <Button size="icon" variant="ghost" title={tr('Выше')} aria-label={tr('Поднять выше: {{name}}', { name: n.name })} disabled={!canMove(n, -1) || move.isPending} onClick={() => move.mutate({ node: n, dir: -1 })}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon" variant="ghost" title={tr('Ниже')} aria-label={tr('Опустить ниже: {{name}}', { name: n.name })} disabled={!canMove(n, 1) || move.isPending} onClick={() => move.mutate({ node: n, dir: 1 })}>
                          <ArrowDown />
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" title={n.kind === 'floor' ? tr('Изменить название и номер этажа') : tr('Изменить название')} aria-label={tr('Изменить: {{name}}', { name: n.name })} onClick={() => setEditing(n)}>
                      <Pencil />
                    </Button>
                    {(n.kind === 'building' || n.kind === 'section' || n.kind === 'floor') && (
                      <Button size="icon" variant="ghost" title={tr('Создать помещения')} aria-label={tr('Создать помещения: {{name}}', { name: n.name })} onClick={() => setRoomsFor(n)}>
                        <DoorOpen />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" title={tr('Добавить внутрь')} aria-label={tr('Добавить внутрь: {{name}}', { name: n.name })} onClick={() => setAdding(n)}>
                      <Plus />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={n.hasChildren ? tr('Сначала уберите вложенные узлы') : tr('Убрать')}
                      aria-label={tr('Убрать {{name}}', { name: n.name })}
                      disabled={n.hasChildren}
                      onClick={() => setArchiving(n)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                  <span className="md:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label={tr('Действия: {{name}}', { name: n.name })}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuItem onSelect={() => setEditing(n)}>
                          <Pencil />
                          {n.kind === 'floor' ? tr('Изменить название и номер этажа') : tr('Изменить название')}
                        </DropdownMenuItem>
                        {n.kind !== 'floor' && (
                          <>
                            <DropdownMenuItem disabled={!canMove(n, -1)} onSelect={() => move.mutate({ node: n, dir: -1 })}>
                              <ArrowUp />
                              {tr('Выше')}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!canMove(n, 1)} onSelect={() => move.mutate({ node: n, dir: 1 })}>
                              <ArrowDown />
                              {tr('Ниже')}
                            </DropdownMenuItem>
                          </>
                        )}
                        {(n.kind === 'building' || n.kind === 'section' || n.kind === 'floor') && (
                          <DropdownMenuItem onSelect={() => setRoomsFor(n)}>
                            <DoorOpen />{tr('Создать помещения')}</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setAdding(n)}>
                          <Plus />{tr('Добавить внутрь')}</DropdownMenuItem>
                        <DropdownMenuItem disabled={n.hasChildren} onSelect={() => setArchiving(n)}>
                          <Trash2 /> {n.hasChildren ? tr('Убрать (сначала вложенные)') : tr('Убрать')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </>
              )}
            </li>
            )
          })}
        </ul>
      )}

      {generating && <GenerateDialog projectId={p.id} onClose={() => setGenerating(false)} />}
      {roomsFor && <RoomsDialog projectId={p.id} parent={roomsFor} rows={rows} defaultPurpose={DEFAULT_PURPOSE[p.kind ?? ''] ?? 'other'} onClose={() => setRoomsFor(null)} />}
      <Outlet />
      {adding && (
        <AddDialog
          projectId={p.id}
          parent={adding === 'root' ? null : adding}
          siblings={siblingsOf(rows, adding === 'root' ? null : adding.id)}
          onClose={() => setAdding(null)}
        />
      )}
      {editing && <EditDialog projectId={p.id} node={editing} siblings={siblingsOf(rows, editing.parent_id)} onClose={() => setEditing(null)} />}
      {archiving && <ArchiveDialog projectId={p.id} node={archiving} onClose={() => setArchiving(null)} />}
    </div>
  )
}

/** Генератор помещений: на этажах выбранного узла (все или с … по …) — N помещений заданного назначения, нумерация по этажам или сквозная. */
function RoomsDialog({ projectId, parent, rows, defaultPurpose, onClose }: { projectId: string; parent: LocationNode; rows: LocationRow[]; defaultPurpose: LocationPurpose; onClose: () => void }) {
  const queryClient = useQueryClient()
  const floors = useMemo(() => floorsUnder(rows, parent), [rows, parent])
  const lowest = floors[0]?.sort ?? 1
  const highest = floors[floors.length - 1]?.sort ?? 1
  const [purpose, setPurpose] = useState<LocationPurpose>(defaultPurpose)
  const [perFloor, setPerFloor] = useState('4')
  const [scheme, setScheme] = useState<'floor' | 'sequential'>('floor')
  const [from, setFrom] = useState(String(lowest))
  const [to, setTo] = useState(String(highest))
  const showRange = parent.kind !== 'floor' && floors.length > 1

  const n = Number(perFloor)
  const f1 = Number(from)
  const f2 = Number(to)
  const inRange = floors.filter((f) => f.sort >= f1 && f.sort <= f2).length
  const perFloorError = !Number.isInteger(n) || n < 1 || n > 200 ? tr('От 1 до 200') : null
  const rangeError = showRange && (!Number.isInteger(f1) || !Number.isInteger(f2) || f1 > f2) ? tr('Проверьте границы этажей') : showRange && inRange === 0 ? tr('В этом диапазоне нет этажей') : null
  const total = (showRange ? inRange : floors.length) * (Number.isInteger(n) ? n : 0)

  const generate = useMutation({
    mutationFn: () => generateRooms({ projectId, parentId: parent.id, perFloor: n, scheme, purpose, floorFrom: showRange ? f1 : null, floorTo: showRange ? f2 : null }),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(count > 0 ? tr('Создано помещений: {{count_}}', { count_: count }) : tr('Все такие помещения уже есть'))
      onClose()
    },
    onError: (e) => {
      const code = (e as { code?: string }).code
      toast.error(code === '22023' ? tr('Нет этажей внутри этого узла или помещений слишком много (не более 5000 за раз).') : errorText(e))
    },
  })

  const example =
    scheme === 'floor'
      ? tr('{{v1}} (на 5 этаже)', { v1: n >= 100 ? '1001, 1002 …' : '501, 502 …' })
      : tr('1, 2, 3 … до последнего этажа без пропусков')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Создать помещения в «')}{parent.name}»</DialogTitle>
          <DialogDescription>{tr('На каждом выбранном этаже будет создано одинаковое число помещений одного назначения. Уже существующие не дублируются: новая партия продолжает нумерацию.')}</DialogDescription>
        </DialogHeader>
        <form
          id="rooms-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!perFloorError && !rangeError) generate.mutate()
          }}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-purpose">{tr('Назначение')}</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as LocationPurpose)}>
              <SelectTrigger id="r-purpose" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PURPOSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PURPOSE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showRange && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{tr('Этажи')}</span>
              <div className="flex items-center gap-2">
                <Label htmlFor="r-from" className="sr-only">{tr('С этажа')}</Label>
                <Input id="r-from" type="number" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr('С этажа')} />
                <span className="text-muted-foreground">—</span>
                <Label htmlFor="r-to" className="sr-only">{tr('По этаж')}</Label>
                <Input id="r-to" type="number" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} aria-label={tr('По этаж')} />
              </div>
              <p className="text-xs text-muted-foreground">
                {rangeError ?? tr('Этажи в узле: с {{lowest}} по {{highest}}. Для типового этажа — например, с 3 по 8.', { lowest, highest })}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-per">{tr('Помещений на этаже')}</Label>
            <Input id="r-per" type="number" inputMode="numeric" aria-invalid={!!perFloorError} value={perFloor} onChange={(e) => setPerFloor(e.target.value)} />
            {perFloorError && <p className="text-sm text-destructive">{perFloorError}</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{tr('Нумерация')}</legend>
            {(
              [
                ['floor', tr('По этажам'), tr('Номер начинается с номера этажа')],
                ['sequential', tr('Сквозная'), tr('Один порядок на весь узел')],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 has-[:checked]:border-foreground">
                <input type="radio" className="size-4" checked={scheme === value} onChange={() => setScheme(value)} />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {tr('Получится:')} {example}. {tr('Всего будет создано: {{total}}', { total })}
          </p>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="rooms-form" disabled={generate.isPending || !!perFloorError || !!rangeError}>{tr('Создать помещения')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const generateSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/, CODE_HINT),
    name: z.string().trim().min(1, tr('Укажите название')),
    sections: z.coerce.number().int().min(0, tr('От 0 до 50')).max(50, tr('От 0 до 50')),
    floorFrom: z.coerce.number().int().min(-10, tr('Не ниже −10')),
    floorTo: z.coerce.number().int().max(150, tr('Не выше 150')),
  })
  .refine((v) => v.floorFrom <= v.floorTo, { path: ['floorTo'], message: tr('Верхний этаж не может быть ниже нижнего') })

function GenerateDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(generateSchema),
    mode: 'onBlur',
    defaultValues: { code: '', name: '', sections: 1, floorFrom: 1, floorTo: 9 },
  })

  const v = watch()
  const floors = Math.max(0, Number(v.floorTo) - Number(v.floorFrom) + 1 - (Number(v.floorFrom) <= 0 && Number(v.floorTo) >= 0 ? 1 : 0))
  const total = 1 + (Number(v.sections) > 0 ? Number(v.sections) : 0) + Math.max(Number(v.sections), 1) * floors

  const generate = useMutation({
    mutationFn: (values: z.output<typeof generateSchema>) =>
      generateBuilding({ projectId, code: values.code, name: values.name, sections: values.sections, floorFrom: values.floorFrom, floorTo: values.floorTo }),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(tr('Создано узлов: {{count_}}', { count_: count }))
      onClose()
    },
    onError: (e) => toast.error(errorText(e)),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Создать корпус')}</DialogTitle>
          <DialogDescription>{tr('Секции и этажи создаются автоматически: например, K2 → S1 → F05. Подвалы — отрицательные этажи.')}</DialogDescription>
        </DialogHeader>
        <form id="generate-form" onSubmit={handleSubmit((values) => generate.mutate(values))} className="grid grid-cols-2 gap-4" noValidate>
          <Field id="g-code" label={tr('Код корпуса')} error={errors.code?.message}>
            <Input id="g-code" placeholder="K2" aria-invalid={!!errors.code} {...register('code')} />
          </Field>
          <Field id="g-name" label={tr('Название')} error={errors.name?.message}>
            <Input id="g-name" placeholder={tr('Корпус 2')} aria-invalid={!!errors.name} {...register('name')} />
          </Field>
          <Field id="g-sections" label={tr('Секций (0 — без секций)')} error={errors.sections?.message}>
            <Input id="g-sections" type="number" inputMode="numeric" aria-invalid={!!errors.sections} {...register('sections')} />
          </Field>
          <div />
          <Field id="g-from" label={tr('Нижний этаж')} error={errors.floorFrom?.message}>
            <Input id="g-from" type="number" inputMode="numeric" aria-invalid={!!errors.floorFrom} {...register('floorFrom')} />
          </Field>
          <Field id="g-to" label={tr('Верхний этаж')} error={errors.floorTo?.message}>
            <Input id="g-to" type="number" inputMode="numeric" aria-invalid={!!errors.floorTo} {...register('floorTo')} />
          </Field>
          <p className="col-span-2 text-xs text-muted-foreground">{tr('Будет создано узлов:')}{' '}{Number.isFinite(total) ? total : '—'}
          </p>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="generate-form" disabled={generate.isPending}>{tr('Создать корпус')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

const addSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}$/, CODE_HINT),
  name: z.string().trim().min(1, tr('Укажите название')),
})

/** Код и название этажа по его номеру: −1 → B1 / «Этаж -1», 5 → F05 / «Этаж 5». */
const floorCode = (n: number) => (n < 0 ? `B${Math.abs(n)}` : `F${String(n).padStart(2, '0')}`)
const floorNumberError = (v: string, siblings: LocationRow[], selfId?: string): string | null => {
  const n = Number(v)
  if (v.trim() === '' || !Number.isInteger(n) || n === 0 || Math.abs(n) > 150) return tr('Номер этажа — целое число, не 0 (подвал: −1, −2)')
  if (siblings.some((s) => s.id !== selfId && s.sort === n)) return tr('Этаж с таким номером уже есть')
  return null
}

const END = '__end__'
const START = '__start__'
const KEEP = '__keep__'

/** Куда поставить узел среди соседей: в начало, в конец или после выбранного. */
function PositionSelect({ id, value, onChange, siblings, keepLabel }: { id: string; value: string; onChange: (v: string) => void; siblings: LocationRow[]; keepLabel?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{tr('Расположить')}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {keepLabel && <SelectItem value={KEEP}>{keepLabel}</SelectItem>}
          <SelectItem value={END}>{tr('В конце списка')}</SelectItem>
          <SelectItem value={START}>{tr('В начале списка')}</SelectItem>
          {siblings.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {tr('После «{{name}}»', { name: s.name })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{tr('Этажи идут по своим номерам, остальные узлы можно поставить между ними. Потом порядок можно поменять стрелками в списке.')}</p>
    </div>
  )
}

function AddDialog({
  projectId,
  parent,
  siblings,
  onClose,
}: {
  projectId: string
  parent: LocationNode | null
  siblings: LocationRow[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const kind = parent ? NEXT_KIND[parent.kind] : 'building'
  const isFloor = kind === 'floor'
  const highest = siblings.reduce((m, s) => Math.max(m, s.sort), 0)
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm({ resolver: zodResolver(addSchema), mode: 'onBlur', defaultValues: { code: '', name: '' } })
  const [floorNo, setFloorNo] = useState(isFloor ? String(highest + 1) : '')
  const [floorError, setFloorError] = useState<string | null>(null)
  const [position, setPosition] = useState(END)

  const add = useMutation({
    mutationFn: async (v: z.output<typeof addSchema>) => {
      if (isFloor) {
        const err = floorNumberError(floorNo, siblings)
        if (err) {
          setFloorError(err)
          throw new Error('validation')
        }
        await createLocation({ projectId, parentId: parent?.id ?? null, kind, code: v.code, name: v.name, sort: Number(floorNo) })
        return
      }
      const last = siblings.reduce((m, r) => Math.max(m, orderKey(r)), 0)
      const id = await createLocation({ projectId, parentId: parent?.id ?? null, kind, code: v.code, name: v.name, sort: Math.floor(last) + 1 })
      if (position !== END && siblings.length > 0) {
        const ids = siblings.map((s) => s.id)
        const at = position === START ? 0 : ids.indexOf(position) + 1
        ids.splice(at, 0, id)
        await reorderLocations(projectId, parent?.id ?? null, ids)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(tr('Узел добавлен'))
      onClose()
    },
    onError: (e) => {
      if (e.message !== 'validation') toast.error(errorText(e))
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent ? tr('Добавить в «{{name}}»', { name: parent.name }) : tr('Добавить узел верхнего уровня')}</DialogTitle>
          <DialogDescription>{tr('Тип узла:')}{' '}{LOCATION_KIND_LABELS[kind].toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <form id="add-form" onSubmit={handleSubmit((v) => add.mutate(v))} className="flex flex-col gap-4" noValidate>
          {isFloor && (
            <Field id="a-floor" label={tr('Номер этажа')} error={floorError ?? undefined}>
              <Input
                id="a-floor"
                type="number"
                inputMode="numeric"
                value={floorNo}
                aria-invalid={!!floorError}
                onChange={(e) => {
                  setFloorNo(e.target.value)
                  setFloorError(null)
                }}
                onBlur={() => {
                  const n = Number(floorNo)
                  if (Number.isInteger(n) && n !== 0) {
                    if (!getValues('code')) setValue('code', floorCode(n))
                    if (!getValues('name')) setValue('name', tr('Этаж {{n}}', { n }))
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">{tr('Подвал и паркинг — отрицательные номера: −1, −2. Порядок этажей в списке идёт по номеру.')}</p>
            </Field>
          )}
          <Field id="a-code" label={tr('Код')} error={errors.code?.message}>
            <Input id="a-code" aria-invalid={!!errors.code} {...register('code')} />
          </Field>
          <Field id="a-name" label={tr('Название')} error={errors.name?.message}>
            <Input id="a-name" aria-invalid={!!errors.name} {...register('name')} />
          </Field>
          {!isFloor && siblings.length > 0 && <PositionSelect id="a-pos" value={position} onChange={setPosition} siblings={siblings} />}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="add-form" disabled={add.isPending}>{tr('Добавить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Правка названия; у этажа ещё и номер: от него зависит порядок и диапазоны «с … по …». Код не меняется: на нём держатся пути и привязки. */
function EditDialog({ projectId, node, siblings, onClose }: { projectId: string; node: LocationNode; siblings: LocationRow[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(node.name)
  const [floorNo, setFloorNo] = useState(node.kind === 'floor' ? String(node.sort) : '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [floorError, setFloorError] = useState<string | null>(null)
  const [position, setPosition] = useState(KEEP)
  const [kind, setKind] = useState<LocationKind>(node.kind)
  const canChangeKind = node.kind === 'section' || node.kind === 'floor' || node.kind === 'zone'
  const isFloor = kind === 'floor'
  const others = siblings.filter((r) => r.id !== node.id)

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        setNameError(tr('Укажите название'))
        throw new Error('validation')
      }
      if (isFloor) {
        const err = floorNumberError(floorNo, siblings, node.id)
        if (err) {
          setFloorError(err)
          throw new Error('validation')
        }
      }
      if (kind !== node.kind) await setLocationKind(projectId, node.id, kind, isFloor ? Number(floorNo) : null)
      await updateLocation(node.id, { name: name.trim(), ...(isFloor && node.kind === 'floor' ? { sort: Number(floorNo) } : {}) })
      if (!isFloor && position !== KEEP) {
        const ids = others.map((r) => r.id)
        ids.splice(position === START ? 0 : position === END ? ids.length : ids.indexOf(position) + 1, 0, node.id)
        await reorderLocations(projectId, node.parent_id, ids)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(tr('Сохранено'))
      onClose()
    },
    onError: (e) => {
      if (e.message !== 'validation') toast.error(errorText(e))
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Изменить «{{name}}»', { name: node.name })}</DialogTitle>
          <DialogDescription>{tr('Код {{code}} не меняется: на нём держатся пути и привязки.', { code: node.code })}</DialogDescription>
        </DialogHeader>
        <form
          id="edit-loc-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!save.isPending) save.mutate()
          }}
        >
          <Field id="e-name" label={tr('Название')} error={nameError ?? undefined}>
            <Input id="e-name" autoFocus value={name} maxLength={200} onChange={(e) => { setName(e.target.value); setNameError(null) }} />
          </Field>
          {canChangeKind && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-kind">{tr('Тип узла')}</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as LocationKind)
                  setFloorError(null)
                }}
              >
                <SelectTrigger id="e-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['section', 'floor', 'zone'] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {LOCATION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kind !== node.kind && <p className="text-xs text-muted-foreground">{tr('Код, место в дереве, задачи и документы сохраняются. Меняется только тип.')}</p>}
            </div>
          )}
          {isFloor && (
            <Field id="e-floor" label={tr('Номер этажа')} error={floorError ?? undefined}>
              <Input id="e-floor" type="number" inputMode="numeric" value={floorNo} onChange={(e) => { setFloorNo(e.target.value); setFloorError(null) }} />
              <p className="text-xs text-muted-foreground">{tr('Порядок этажей идёт по номеру: −1 будет выше первого этажа. Диапазоны «с … по …» тоже считаются по номеру.')}</p>
            </Field>
          )}
          {!isFloor && others.length > 0 && <PositionSelect id="e-pos" value={position} onChange={setPosition} siblings={others} keepLabel={tr('Оставить на месте')} />}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="edit-loc-form" disabled={save.isPending}>{tr('Сохранить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveDialog({ projectId, node, onClose }: { projectId: string; node: LocationNode; onClose: () => void }) {
  const queryClient = useQueryClient()
  const archive = useMutation({
    mutationFn: () => archiveLocation(node.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', projectId] })
      toast.success(tr('«{{name}}» убран', { name: node.name }))
      onClose()
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Убрать «')}{node.name}»?</DialogTitle>
          <DialogDescription>{tr('Узел исчезнет из выбора. Задачи, которые к нему уже привязаны, сохранят привязку.')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button variant="destructive" disabled={archive.isPending} onClick={() => archive.mutate()}>{tr('Убрать «')}{node.name}»
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
