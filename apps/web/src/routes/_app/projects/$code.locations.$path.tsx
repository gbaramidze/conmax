import { tr } from '@/lib/tr'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import { ArrowUp, BedDouble, ChevronLeft, ChevronRight, FileText, Images, LayoutDashboard, LayoutGrid, ListChecks, MessagesSquare, Search, X } from 'lucide-react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { RenderGallery } from '@/features/renders/gallery'
import { entityImagesQuery } from '@/features/renders/api'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { activityLoader } from '@/features/activity/loader'
import { EntityDocuments } from '@/features/documents/entity-documents'
import { LOCATION_KIND_LABELS, locationLabel, locationsQuery, orderKey } from '@/features/locations/api'
import { LocationJump } from '@/features/locations/location-jump'
import { useAuth } from '@/features/auth/auth-provider'
import { LocationTasks, locationTasksQuery } from '@/features/locations/location-tasks'
import { PlaceOverview, type PlaceSection } from '@/features/locations/place-overview'
import { RoomSpec } from '@/features/ffe/room-spec'
import { RoomsComposition } from '@/features/locations/rooms-composition'
import { LocationEquipment } from '@/features/plans/location-equipment'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// «Страница места»: этаж или номер — обзор, рендеры, спецификация, задачи, чертежи и лента, по разделам
export const Route = createFileRoute('/_app/projects/$code/locations/$path')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const rows = await queryClient.ensureQueryData(locationsQuery(project.id))
    const loc = rows.find((r) => r.path === params.path)
    if (!loc) throw notFound()
    await Promise.all([activityLoader(queryClient, { type: 'location', id: loc.id }), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  notFoundComponent: () => (
    <Sheet open>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{tr('Место не найдено')}</SheetTitle>
          <SheetDescription>{tr('Возможно, оно удалено из структуры проекта.')}</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
  component: LocationSheet,
})

type PlaceTab = 'overview' | 'spec' | 'renders' | 'tasks' | 'plan' | 'rooms' | 'feed'
const NO_IMAGES: never[] = []

function LocationSheet() {
  const { code, path } = Route.useParams()
  const navigate = useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(locationsQuery(p.id))
  const loc = rows.find((r) => r.path === path)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { session } = useAuth()

  const { data: placeTasks } = useQuery({ ...locationTasksQuery(p.id, path), enabled: !!loc })
  // тип номера: его рендеры показываются в помещении (правят те, кому можно менять типы)
  const { data: roomType } = useQuery({
    queryKey: ['ffe', 'room-type-of', loc?.id],
    enabled: loc?.kind === 'room',
    queryFn: async () => {
      const { data, error } = await supabase.from('room_specs').select('type_id, type:room_types(name)').eq('location_id', loc!.id).maybeSingle()
      if (error) throw error
      return data as unknown as { type_id: string | null; type: { name: string } | null } | null
    },
  })
  // те же запросы, что у галерей: для обложки и счётчика в обзоре (кэш общий, второй раз не грузится)
  const { data: ownImages = NO_IMAGES } = useQuery({ ...entityImagesQuery(p.id, { type: 'location', id: loc?.id ?? '' }), enabled: !!loc })
  const { data: typeImages = NO_IMAGES } = useQuery({ ...entityImagesQuery(p.id, { type: 'room_type', id: roomType?.type_id ?? '' }), enabled: !!roomType?.type_id })

  // поиск места на телефоне прячется за значком: клавиатура выезжает только по нажатию
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => setSearchOpen(false), [path])
  const kind = loc?.kind
  const canEditType = permissions.includes('location.manage') || permissions.includes('schedule.edit')

  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const tasks = placeTasks ?? []
  const taskStats = {
    open: tasks.length,
    mine: tasks.filter((t) => t.assignee_id === session?.user.id).length,
    overdue: tasks.filter((t) => t.due_date && t.due_date < today).length,
  }
  const childRooms = kind === 'floor' ? rows.filter((r) => r.kind === 'room' && r.parent_id === loc?.id).length : 0
  const imageCount = ownImages.length + typeImages.length

  const sections: PlaceSection<PlaceTab>[] =
    kind === 'room'
      ? [
          { id: 'spec', label: tr('Номер'), icon: BedDouble, summary: roomType?.type?.name ?? tr('Тип, площадь, мебель и оборудование') },
          { id: 'renders', label: tr('Рендеры'), icon: Images, summary: imageCount > 0 ? tr('Изображений: {{n}}', { n: imageCount }) : tr('Пока нет') },
          { id: 'tasks', label: tr('Задачи'), icon: ListChecks, badge: taskStats.mine || undefined, summary: taskStats.open > 0 ? tr('Открытых задач: {{n}}', { n: taskStats.open }) : tr('Открытых задач нет') },
          { id: 'plan', label: tr('Чертежи'), icon: FileText, summary: tr('Файлы, чертежи и документы') },
          { id: 'feed', label: tr('Лента'), icon: MessagesSquare, summary: tr('Заметки и фото с площадки') },
        ]
      : [
          { id: 'tasks', label: tr('Задачи'), icon: ListChecks, badge: taskStats.mine || undefined, summary: taskStats.open > 0 ? tr('Открытых задач: {{n}}', { n: taskStats.open }) : tr('Открытых задач нет') },
          { id: 'plan', label: tr('Планы'), icon: FileText, summary: tr('Файлы, чертежи и документы') },
          { id: 'renders', label: tr('Рендеры'), icon: Images, summary: imageCount > 0 ? tr('Изображений: {{n}}', { n: imageCount }) : tr('Пока нет') },
          {
            id: 'rooms',
            label: kind === 'floor' ? tr('Номера') : tr('Этажи'),
            icon: LayoutGrid,
            summary: kind === 'floor' ? tr('Номеров: {{n}}', { n: childRooms }) : tr('Состав помещений'),
          },
          { id: 'feed', label: tr('Лента'), icon: MessagesSquare, summary: tr('Заметки и фото с площадки') },
        ]
  const tabs: PlaceSection<PlaceTab>[] = [{ id: 'overview', label: tr('Обзор'), icon: LayoutDashboard }, ...sections]

  // открытое место всегда начинается с обзора (там схема — ради неё сюда в основном и приходят);
  // при листании соседей ‹ › окно не пересоздаётся, и выбранный раздел остаётся прежним
  const [stored, pickTab] = useState<PlaceTab>('overview')
  const tab: PlaceTab = tabs.some((t) => t.id === stored) ? stored : 'overview'

  // новый раздел или другое место — к началу; активная вкладка на телефоне подъезжает в видимую часть ленты
  const scroller = useRef<HTMLDivElement>(null)
  const pills = useRef<HTMLElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    pills.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [tab, path])

  // соседи: места того же вида в том же родителе, в порядке дерева
  const siblings = useMemo(
    () =>
      loc
        ? rows
            .filter((r) => r.parent_id === loc.parent_id && r.kind === loc.kind)
            .sort((a, b) => orderKey(a) - orderKey(b) || a.code.localeCompare(b.code, undefined, { numeric: true }))
        : [],
    [rows, loc],
  )
  const index = loc ? siblings.findIndex((r) => r.id === loc.id) : -1
  const prev = index > 0 ? siblings[index - 1] : undefined
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined
  const parent = loc?.parent_id ? rows.find((r) => r.id === loc.parent_id) : undefined
  // путь сверху: все уровни выше, каждый — ссылка
  const ancestors = useMemo(
    () => (loc ? rows.filter((r) => r.id !== loc.id && loc.path.startsWith(r.path + '.')).sort((a, b) => a.path.length - b.path.length) : []),
    [rows, loc],
  )

  // ← и → листают соседние места, пока курсор не в поле ввода и не открыто другое окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      // в полях ввода стрелки нужны для текста; исключение — пустое поле перехода (после перехода фокус остаётся в нём)
      const emptyJump = t?.getAttribute('role') === 'combobox' && (t as HTMLInputElement).value === ''
      if (t && !emptyJump && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest('[role=listbox],[role=combobox]'))) return
      if (document.querySelectorAll('[role=dialog]').length > 1) return
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : undefined
      if (!target) return
      e.preventDefault()
      void navigate({ to: '/projects/$code/locations/$path', params: { code, path: target.path }, replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, navigate, code])

  if (!loc) return null
  const shortName = (name: string) => name.replace(/^(номер|помещение|квартира|room|ნომერი|ოთახი|ბინა)\s*/i, '') || name
  const close = () => void navigate({ to: '/projects/$code/locations', params: { code } })
  const iconBtn = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  const touchBtn = 'inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  const show = (id: PlaceTab) => (tab === id ? 'flex flex-col gap-4' : 'hidden')
  const parentLabel = parent ? locationLabel(parent.path, rows) : ''

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        // фокус не прыгает в поле перехода и не вызывает клавиатуру при открытии: он остаётся на самом окне
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
        className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-6xl"
      >
        {/* ───── шапка: путь, название, соседи, поиск ───── */}
        <header className="shrink-0 border-b bg-popover">
          <div className="flex items-center gap-2 px-4 py-3 max-sm:gap-1 max-sm:px-1.5 max-sm:pb-2 max-sm:pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button type="button" onClick={close} aria-label={tr('Назад к структуре')} className={`${touchBtn} sm:hidden`}>
              <ChevronLeft className="size-6" />
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <nav aria-label={tr('Путь к месту')} className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                <Link to="/projects/$code/locations" params={{ code }} className="shrink-0 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden">
                  {tr('Структура')}
                </Link>
                {ancestors.map((a, i) => (
                  <span key={a.id} className={cn('flex min-w-0 items-center gap-1', i < ancestors.length - 1 && 'max-sm:hidden')}>
                    <ChevronRight className="size-3 shrink-0 max-sm:hidden" aria-hidden />
                    <Link to="/projects/$code/locations/$path" params={{ code, path: a.path }} replace className="truncate rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {a.name}
                    </Link>
                  </span>
                ))}
                {index >= 0 && siblings.length > 1 && <span className="shrink-0 tabular-nums sm:hidden">{` · ${index + 1} ${tr('из')} ${siblings.length}`}</span>}
              </nav>
              <div className="flex min-w-0 items-center gap-2">
                <SheetTitle className="truncate text-lg font-semibold leading-tight sm:text-xl">{loc.name}</SheetTitle>
                <span className="ident shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground max-sm:hidden">{loc.code}</span>
                {roomType?.type?.name && <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground max-md:hidden">{roomType.type.name}</span>}
              </div>
              <SheetDescription className="sr-only">
                {LOCATION_KIND_LABELS[loc.kind]} · {locationLabel(loc.path, rows)}
              </SheetDescription>
            </div>

            {/* компьютер и планшет: переход к месту, соседи с номером по порядку, закрыть */}
            <LocationJump code={code} rows={rows} compact className="max-sm:hidden" />
            {siblings.length > 1 && (
              <div role="group" aria-label={tr('Соседние места')} className="flex shrink-0 items-center rounded-md border bg-background max-sm:hidden">
                {prev ? (
                  <Link to="/projects/$code/locations/$path" params={{ code, path: prev.path }} replace className={iconBtn} title={`${prev.name} (←)`} aria-label={tr('Предыдущее: {{name}}', { name: prev.name })}>
                    <ChevronLeft className="size-4" />
                  </Link>
                ) : (
                  <span className={`${iconBtn} pointer-events-none opacity-30`} aria-hidden>
                    <ChevronLeft className="size-4" />
                  </span>
                )}
                <span className="min-w-12 px-1 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1} / {siblings.length}
                </span>
                {next ? (
                  <Link to="/projects/$code/locations/$path" params={{ code, path: next.path }} replace className={iconBtn} title={`${next.name} (→)`} aria-label={tr('Следующее: {{name}}', { name: next.name })}>
                    <ChevronRight className="size-4" />
                  </Link>
                ) : (
                  <span className={`${iconBtn} pointer-events-none opacity-30`} aria-hidden>
                    <ChevronRight className="size-4" />
                  </span>
                )}
              </div>
            )}
            <button type="button" onClick={close} aria-label={tr('Закрыть')} className={`${iconBtn} max-sm:hidden`}>
              <X className="size-4" />
            </button>

            {/* телефон: поиск и «выше» — справа, под большим пальцем */}
            <button type="button" aria-pressed={searchOpen} aria-label={tr('Перейти к месту')} onClick={() => setSearchOpen((v) => !v)} className={cn(touchBtn, 'sm:hidden', searchOpen && 'bg-muted')}>
              <Search className="size-5" />
            </button>
            {parent && (
              <Link to="/projects/$code/locations/$path" params={{ code, path: parent.path }} replace aria-label={tr('Выше: {{name}}', { name: parent.name })} className={`${touchBtn} sm:hidden`}>
                <ArrowUp className="size-5" />
              </Link>
            )}
          </div>
          {searchOpen && (
            <div className="px-3 pb-2 sm:hidden">
              <LocationJump code={code} rows={rows} compact block hotkey={false} />
            </div>
          )}

          {/* телефон и планшет: разделы — лентой кнопок с прокруткой (на компьютере они слева столбцом) */}
          <nav ref={pills} aria-label={tr('Разделы места')} className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] max-sm:px-2 lg:hidden [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => pickTab(t.id)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t.id ? 'border-primary bg-primary font-medium text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
                {t.badge ? <span className={cn('rounded-full px-1.5 text-xs tabular-nums', tab === t.id ? 'bg-primary-foreground/15' : 'bg-muted')}>{t.badge}</span> : null}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ───── компьютер: разделы столбцом слева ───── */}
          <nav aria-label={tr('Разделы места')} className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-popover p-3 lg:flex">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => pickTab(t.id)}
                className={cn(
                  'flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t.id ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <t.icon className={cn('size-4 shrink-0', tab === t.id && 'text-foreground')} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {t.badge ? <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{t.badge}</span> : null}
              </button>
            ))}
            <p className="mt-auto px-3 pt-4 text-xs text-muted-foreground">{tr('← и → — соседние места')}</p>
          </nav>

          {/* ───── содержимое выбранного раздела ───── */}
          <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/40">
            {/* key: у каждого места своё состояние форм и черновиков, при переходе к соседнему оно не переносится.
                Разделы не размонтируются при переключении (только прячутся): черновик в ленте не теряется */}
            <div key={loc.id} className="mx-auto flex w-full max-w-4xl flex-col p-6 max-lg:p-4 max-sm:px-3 max-sm:pb-6 max-sm:pt-3">
              <div className={show('overview')}>
                <PlaceOverview loc={loc} parentLabel={parentLabel} typeName={roomType?.type?.name} cover={ownImages[0] ?? typeImages[0]} tasks={taskStats} sections={sections} onOpen={pickTab} />
              </div>

              <div className={cn(show('renders'), 'gap-8')}>
                {/* Рендеры номера обычно общие для типа: они идут первыми, а свои изображения у этого номера — только особенное (вид из окна, фото с объекта) */}
                {loc.kind === 'room' && roomType?.type_id && (
                  <RenderGallery
                    projectId={p.id}
                    entity={{ type: 'room_type', id: roomType.type_id }}
                    canEdit={canEditType}
                    title={tr('Рендеры типа «{{name}}»', { name: roomType.type?.name ?? '' })}
                    hint={canEditType ? tr('Общие для всех номеров этого типа: любое изменение здесь касается их всех.') : undefined}
                  />
                )}
                <RenderGallery
                  projectId={p.id}
                  entity={{ type: 'location', id: loc.id }}
                  canEdit={permissions.includes('location.manage')}
                  title={loc.kind === 'room' ? tr('Рендеры и фото именно этого номера') : tr('Рендеры и фото')}
                  hint={loc.kind === 'room' && roomType?.type_id ? tr('Общие рендеры типа показаны выше. Сюда добавляйте только то, что относится к этому номеру: вид из окна, фото с объекта.') : undefined}
                />
              </div>

              {loc.kind === 'room' && (
                <div className={show('spec')}>
                  <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем спецификацию…')}</p>}>
                    <RoomSpec projectId={p.id} code={code} loc={loc} canEdit={canEditType} canBudget={permissions.includes('budget.view')} />
                  </Suspense>
                  <div className="empty:hidden">
                    <LocationEquipment projectId={p.id} code={code} loc={loc} rows={rows} />
                  </div>
                </div>
              )}

              {loc.kind !== 'room' && (
                <div className={show('rooms')}>
                  <RoomsComposition projectId={p.id} code={code} loc={loc} rows={rows} canManage={permissions.includes('location.manage')} />
                  {(loc.kind === 'floor' || loc.kind === 'zone') && (
                    <div className="empty:hidden">
                      <LocationEquipment projectId={p.id} code={code} loc={loc} rows={rows} />
                    </div>
                  )}
                </div>
              )}

              <div className={show('plan')}>
                <EntityDocuments
                  entity={{ type: 'location', id: loc.id }}
                  inherited={[
                    // технический план типа номера общий для всех номеров этого типа
                    ...(loc.kind === 'room' && roomType?.type_id ? [{ type: 'room_type' as const, id: roomType.type_id }] : []),
                    ...ancestors.map((r) => ({ type: 'location' as const, id: r.id })),
                  ]}
                  projectId={p.id}
                  code={code}
                  title={loc.kind === 'room' ? tr('Файлы и чертежи места') : tr('Планы и документы места')}
                />
              </div>

              <div className={show('tasks')}>
                <LocationTasks projectId={p.id} code={code} path={loc.path} />
              </div>

              <div className={show('feed')}>
                <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем ленту места…')}</p>}>
                  <ActivityFeed
                    entity={{ type: 'location', id: loc.id }}
                    projectId={p.id}
                    title={tr('Что здесь происходит')}
                    placeholder={tr('Опишите, что на месте. Фото можно снять прямо сейчас.')}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        </div>

        {/* Телефон: соседние места под большим пальцем, панель всегда у нижнего края */}
        {siblings.length > 1 && (
          <div role="group" aria-label={tr('Соседние места')} className="flex shrink-0 items-stretch gap-2 border-t bg-popover px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:hidden">
            {prev ? (
              <Link to="/projects/$code/locations/$path" params={{ code, path: prev.path }} replace aria-label={tr('Предыдущее: {{name}}', { name: prev.name })} className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border bg-background px-2 text-sm font-medium outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronLeft className="size-5 shrink-0" />
                <span className="truncate">{shortName(prev.name)}</span>
              </Link>
            ) : (
              <span className="min-h-12 flex-1" aria-hidden />
            )}
            <span className="flex shrink-0 items-center px-1 text-xs tabular-nums text-muted-foreground">
              {index + 1} / {siblings.length}
            </span>
            {next ? (
              <Link to="/projects/$code/locations/$path" params={{ code, path: next.path }} replace aria-label={tr('Следующее: {{name}}', { name: next.name })} className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border bg-background px-2 text-sm font-medium outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <span className="truncate">{shortName(next.name)}</span>
                <ChevronRight className="size-5 shrink-0" />
              </Link>
            ) : (
              <span className="min-h-12 flex-1" aria-hidden />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
