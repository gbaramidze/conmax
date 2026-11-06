import { tr } from '@/lib/tr'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import { ArrowUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RenderGallery } from '@/features/renders/gallery'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { activityLoader } from '@/features/activity/loader'
import { EntityDocuments } from '@/features/documents/entity-documents'
import { LOCATION_KIND_LABELS, locationLabel, locationsQuery, orderKey } from '@/features/locations/api'
import { LocationJump } from '@/features/locations/location-jump'
import { useAuth } from '@/features/auth/auth-provider'
import { LocationTasks, locationTasksQuery } from '@/features/locations/location-tasks'
import { RoomSpec } from '@/features/ffe/room-spec'
import { RoomsComposition } from '@/features/locations/rooms-composition'
import { LocationEquipment } from '@/features/plans/location-equipment'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// «Страница места»: дневник этажа или помещения — заметки с фото, задачи, что здесь происходит
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

type PlaceTab = 'tasks' | 'plan' | 'rooms' | 'spec' | 'feed' | 'renders'

function LocationSheet() {
  const { code, path } = Route.useParams()
  const navigate = useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(locationsQuery(p.id))
  const loc = rows.find((r) => r.path === path)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))

  const { data: placeTasks } = useQuery({ ...locationTasksQuery(p.id, path), enabled: !!loc })
  // тип номера: его рендеры показываются в помещении (только просмотр)
  const { data: roomType } = useQuery({
    queryKey: ['ffe', 'room-type-of', loc?.id],
    enabled: loc?.kind === 'room',
    queryFn: async () => {
      const { data, error } = await supabase.from('room_specs').select('type_id, type:room_types(name)').eq('location_id', loc!.id).maybeSingle()
      if (error) throw error
      return data as unknown as { type_id: string | null; type: { name: string } | null } | null
    },
  })
  const { session } = useAuth()
  // поиск места на телефоне прячется за значком: клавиатура выезжает только по нажатию
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => setSearchOpen(false), [path])
  const kind = loc?.kind
  const tabs: { id: PlaceTab; label: string; badge?: number }[] =
    kind === 'room'
      ? [
          { id: 'spec', label: tr('Номер') },
          { id: 'renders', label: tr('Рендеры') },
          { id: 'tasks', label: tr('Задачи'), badge: (placeTasks ?? []).filter((t) => t.assignee_id === session?.user.id).length || undefined },
          { id: 'plan', label: tr('Чертежи') },
          { id: 'feed', label: tr('Лента') },
        ]
      : [
          { id: 'tasks', label: tr('Задачи'), badge: (placeTasks ?? []).filter((t) => t.assignee_id === session?.user.id).length || undefined },
          { id: 'plan', label: tr('Планы') },
          { id: 'renders', label: tr('Рендеры') },
          { id: 'rooms', label: kind === 'floor' ? tr('Номера') : tr('Этажи'), badge: kind === 'floor' ? rows.filter((r) => r.kind === 'room' && r.parent_id === loc?.id).length || undefined : undefined },
          { id: 'feed', label: tr('Лента') },
        ]
  const readTab = (): PlaceTab | null => {
    try {
      return (sessionStorage.getItem(`place-tab:${path}`) as PlaceTab | null) ?? (sessionStorage.getItem(`place-tab-kind:${kind}`) as PlaceTab | null) ?? null
    } catch {
      return null
    }
  }
  const [stored, setStored] = useState<PlaceTab | null>(readTab)
  // другое место того же вида (соседний номер): вкладка остаётся прежней
  useEffect(() => setStored(readTab()), [path]) // eslint-disable-line react-hooks/exhaustive-deps
  const tab: PlaceTab = stored && tabs.some((t) => t.id === stored) ? stored : tabs[0].id === 'tasks' && kind === 'room' ? 'spec' : tabs[0].id
  const pickTab = (id: PlaceTab) => {
    setStored(id)
    try {
      sessionStorage.setItem(`place-tab:${path}`, id)
      sessionStorage.setItem(`place-tab-kind:${kind}`, id)
    } catch {
      // вкладка запомнится только до перехода
    }
  }

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
  const shortName = (name: string) => name.replace(/^(номер|помещение|квартира|room)\s*/i, '') || name
  const close = () => void navigate({ to: '/projects/$code/locations', params: { code } })
  const navBtn = 'inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-background outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  const navOff = 'pointer-events-none opacity-40'

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        showCloseButton={false}
        // фокус не прыгает в поле перехода и не вызывает клавиатуру при открытии: он остаётся на самом окне
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus()
        }}
        className={`overflow-y-auto max-sm:gap-0 data-[side=right]:w-full ${loc.kind === 'room' || loc.kind === 'floor' ? 'data-[side=right]:sm:max-w-5xl' : 'data-[side=right]:sm:max-w-3xl'}`}
      >
        {/* шапка и вкладки остаются на месте при прокрутке, как панель приложения */}
        <div className="sticky top-0 z-20 shrink-0 bg-popover max-sm:border-b">
        <button type="button" onClick={close} aria-label={tr('Закрыть')} className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-sm:hidden">
          <X className="size-4" />
        </button>
        <SheetHeader className="gap-1 pb-1 max-sm:gap-0 max-sm:px-2 max-sm:pb-2 max-sm:pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-1.5 sm:pr-8">
            <button type="button" onClick={close} aria-label={tr('Назад к структуре')} className="-ml-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:hidden">
              <ChevronLeft className="size-6" />
            </button>
            <span className="flex shrink-0 gap-1 max-sm:hidden" role="group" aria-label={tr('Соседние места')}>
              {/* на телефоне ‹ › живут внизу, под большим пальцем, а «выше» и поиск — справа в шапке */}
              {prev ? (
                <Link to="/projects/$code/locations/$path" params={{ code, path: prev.path }} replace className={`${navBtn} max-sm:hidden`} title={`${prev.name} (←)`} aria-label={tr('Предыдущее: {{name}}', { name: prev.name })}>
                  <ChevronLeft className="size-4" />
                </Link>
              ) : (
                <span className={`${navBtn} ${navOff} max-sm:hidden`} aria-hidden>
                  <ChevronLeft className="size-4" />
                </span>
              )}
              {next ? (
                <Link to="/projects/$code/locations/$path" params={{ code, path: next.path }} replace className={`${navBtn} max-sm:hidden`} title={`${next.name} (→)`} aria-label={tr('Следующее: {{name}}', { name: next.name })}>
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <span className={`${navBtn} ${navOff} max-sm:hidden`} aria-hidden>
                  <ChevronRight className="size-4" />
                </span>
              )}
              {parent && (
                <Link to="/projects/$code/locations/$path" params={{ code, path: parent.path }} replace className={navBtn} title={parent.name} aria-label={tr('Выше: {{name}}', { name: parent.name })}>
                  <ArrowUp className="size-4" />
                </Link>
              )}
            </span>
            <SheetTitle className="flex min-w-0 flex-1 items-center gap-2 text-base max-sm:text-lg max-sm:font-semibold">
              <span className="ident hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">{loc.code}</span>
              <span className="truncate">{loc.name}</span>
              {loc.kind === 'room' && roomType?.type?.name && <span className="hidden shrink-0 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground md:inline">{roomType.type.name}</span>}
            </SheetTitle>
            <LocationJump code={code} rows={rows} compact className="max-sm:hidden" />
            <button type="button" aria-pressed={searchOpen} aria-label={tr('Перейти к месту')} onClick={() => setSearchOpen((v) => !v)} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden ${searchOpen ? 'bg-muted' : 'active:bg-muted'}`}>
              <Search className="size-5" />
            </button>
            {parent && (
              <Link to="/projects/$code/locations/$path" params={{ code, path: parent.path }} replace aria-label={tr('Выше: {{name}}', { name: parent.name })} className="-mr-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:hidden">
                <ArrowUp className="size-5" />
              </Link>
            )}
          </div>
          {searchOpen && (
            <div className="px-1 pb-1 pt-2 sm:hidden">
              <LocationJump code={code} rows={rows} compact block hotkey={false} />
            </div>
          )}
          <SheetDescription className="truncate text-xs max-sm:pl-[3.125rem]">
            {index >= 0 && siblings.length > 1 ? `${index + 1} ${tr('из')} ${siblings.length} · ` : ''}
            {LOCATION_KIND_LABELS[loc.kind]} · {locationLabel(loc.path, rows)}
          </SheetDescription>
        </SheetHeader>

        {/* Телефон: вкладки вместо длинной ленты; широкий экран: всё сразу в две колонки */}
        <nav aria-label={tr('Разделы места')} className="flex shrink-0 gap-1 overflow-x-auto border-b bg-popover px-2 [scrollbar-width:none] max-sm:px-1 lg:hidden [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => pickTab(t.id)}
              className={`-mb-px flex min-h-12 shrink-0 items-center justify-center gap-1.5 border-b-2 px-3 text-sm outline-none max-sm:min-w-0 max-sm:shrink max-sm:flex-1 max-sm:px-1 max-sm:text-[13px] focus-visible:ring-2 focus-visible:ring-ring ${tab === t.id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
            >
              {t.label}
              {t.badge ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{t.badge}</span> : null}
            </button>
          ))}
        </nav>
        </div>

        {/* key: у каждого места своё состояние форм и черновиков, при переходе к соседнему оно не переносится */}
        <div key={loc.id} className="grid shrink-0 items-start gap-6 px-4 pb-8 max-sm:grow max-sm:content-start max-sm:gap-4 max-sm:bg-muted/40 max-sm:px-3 max-sm:pb-6 max-sm:pt-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <div className={`flex flex-col gap-4 ${tab === 'renders' ? '' : 'max-lg:hidden'}`}>
              {/* Рендеры номера обычно общие для типа: они идут первыми, а свои изображения у этого номера — только особенное (вид из окна, фото с объекта) */}
              {loc.kind === 'room' && roomType?.type_id && (
                <RenderGallery
                  projectId={p.id}
                  entity={{ type: 'room_type', id: roomType.type_id }}
                  canEdit={permissions.includes('location.manage') || permissions.includes('schedule.edit')}
                  title={tr('Рендеры типа «{{name}}»', { name: roomType.type?.name ?? '' })}
                  hint={permissions.includes('location.manage') || permissions.includes('schedule.edit') ? tr('Общие для всех номеров этого типа: любое изменение здесь касается их всех.') : undefined}
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
              <div className={tab === 'spec' ? '' : 'max-lg:hidden'}>
                <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем спецификацию…')}</p>}>
                  <RoomSpec projectId={p.id} code={code} loc={loc} canEdit={permissions.includes('location.manage') || permissions.includes('schedule.edit')} canBudget={permissions.includes('budget.view')} />
                </Suspense>
                <div className="mt-4 empty:hidden">
                  <LocationEquipment projectId={p.id} code={code} loc={loc} rows={rows} />
                </div>
              </div>
            )}

            {loc.kind !== 'room' && (
              <div className={tab === 'rooms' ? '' : 'max-lg:hidden'}>
                <RoomsComposition projectId={p.id} code={code} loc={loc} rows={rows} canManage={permissions.includes('location.manage')} />
                {(loc.kind === 'floor' || loc.kind === 'zone') && (
                  <div className="mt-4 empty:hidden">
                    <LocationEquipment projectId={p.id} code={code} loc={loc} rows={rows} />
                  </div>
                )}
              </div>
            )}

            <div className={tab === 'plan' ? '' : 'max-lg:hidden'}>
              <EntityDocuments
                entity={{ type: 'location', id: loc.id }}
                inherited={[
                  // технический план типа номера общий для всех номеров этого типа
                  ...(loc.kind === 'room' && roomType?.type_id ? [{ type: 'room_type' as const, id: roomType.type_id }] : []),
                  ...rows.filter((r) => r.id !== loc.id && (loc.path === r.path || loc.path.startsWith(r.path + '.'))).map((r) => ({ type: 'location' as const, id: r.id })),
                ]}
                projectId={p.id}
                code={code}
                title={loc.kind === 'room' ? tr('Файлы и чертежи места') : tr('Планы и документы места')}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <div className={tab === 'tasks' ? '' : 'max-lg:hidden'}>
              <LocationTasks projectId={p.id} code={code} path={loc.path} />
            </div>

            <div className={tab === 'feed' ? '' : 'max-lg:hidden'}>
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

        {/* Телефон: соседние места под большим пальцем, панель всегда у нижнего края */}
        {siblings.length > 1 && (
          <div role="group" aria-label={tr('Соседние места')} className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-stretch gap-2 border-t bg-popover/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden">
            {prev ? (
              <Link to="/projects/$code/locations/$path" params={{ code, path: prev.path }} replace aria-label={tr('Предыдущее: {{name}}', { name: prev.name })} className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border bg-background px-2 text-sm font-medium outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronLeft className="size-5 shrink-0" />
                <span className="truncate">{shortName(prev.name)}</span>
              </Link>
            ) : (
              <span className="min-h-12 flex-1" aria-hidden />
            )}
            <span className="flex shrink-0 items-center px-1 text-xs tabular-nums text-muted-foreground">
              {index + 1} {tr('из')} {siblings.length}
            </span>
            {next ? (
              <Link to="/projects/$code/locations/$path" params={{ code, path: next.path }} replace aria-label={tr('Следующее: {{name}}', { name: next.name })} className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border bg-background px-2 text-sm font-medium outline-none active:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
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
