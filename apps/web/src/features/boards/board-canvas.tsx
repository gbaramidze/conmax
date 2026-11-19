import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Tag, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ComponentType, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  archiveListCards,
  createCard,
  createList,
  positionBetween,
  refreshBoard,
  updateCard,
  updateList,
  type BoardCard,
  type BoardData,
  type BoardLabel,
  type BoardList,
} from '@/features/boards/api'
import { CardContextMenu, keepNativeMenu, noContextMenu } from '@/features/boards/card-context-menu'
import { CardFace, useLabelsExpanded } from '@/features/boards/card-face'
import type { BoardPerson } from '@/features/boards/people'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

interface Order {
  lists: string[]
  cards: Record<string, string[]>
}

function buildOrder(data: BoardData, visible: (c: BoardCard) => boolean): Order {
  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const cards: Record<string, string[]> = {}
  for (const l of lists) cards[l.id] = []
  for (const c of [...data.cards].sort((a, b) => a.position - b.position)) {
    if (c.archived_at || !cards[c.list_id] || !visible(c)) continue
    cards[c.list_id]!.push(c.id)
  }
  return { lists: lists.map((l) => l.id), cards }
}

const errText = () => tr('Не удалось сохранить. Обновили доску — попробуйте ещё раз.')

/** Поле ввода из пункта меню открываем, когда меню уже закрылось, — иначе меню при закрытии забирает фокус и поле его не получает. */
const afterMenuClose = (fn: () => void) => void setTimeout(fn, 0)

/**
 * Холст доски: колонки слева направо, карточки сверху вниз. Перетаскивание карточек — внутри колонки и между колонками,
 * колонок — по горизонтали (только тем, кто управляет доской). Порядок сохраняется дробной позицией между соседями.
 */
export function BoardCanvas({
  data,
  canManage,
  people,
  visible,
  filtering,
  candidates,
  guests,
  isMember,
  meId,
  onOpenCard,
  onOpenMenu,
}: {
  data: BoardData
  canManage: boolean
  people: Map<string, BoardPerson>
  visible: (c: BoardCard) => boolean
  filtering: boolean
  /** Кого можно сделать участником карточки — для меню правой кнопки */
  candidates: BoardPerson[]
  /** Люди проекта не с доски — их можно позвать в карточку гостем (с предупреждением) */
  guests: BoardPerson[]
  /** Участник доски; гость видит только свои колонки и карточки и не создаёт карточек */
  isMember: boolean
  meId: string | undefined
  onOpenCard: (id: string) => void
  onOpenMenu: () => void
}) {
  const qc = useQueryClient()
  const boardId = data.board.id
  const queryKey = ['board', boardId]
  const [order, setOrder] = useState<Order>(() => buildOrder(data, visible))
  const [active, setActive] = useState<{ id: string; type: 'card' | 'list' } | null>(null)
  const lastOver = useRef<UniqueIdentifier | null>(null)
  const [labelsExpanded, toggleLabels] = useLabelsExpanded()
  const [addingList, setAddingList] = useState(false)

  // Данные с сервера (свои правки, Realtime от других) пересобирают порядок, но не во время перетаскивания
  useEffect(() => {
    if (!active) setOrder(buildOrder(data, visible))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, visible])

  const cardsById = useMemo(() => new Map(data.cards.map((c) => [c.id, c])), [data.cards])
  const listsById = useMemo(() => new Map(data.lists.map((l) => [l.id, l])), [data.lists])
  const labels = useMemo(() => new Map(data.labels.map((l) => [l.id, l])), [data.labels])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }), // свайп по доске — прокрутка, долгое касание — перенос
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findList = (id: UniqueIdentifier | null | undefined): string | undefined => {
    if (id == null) return undefined
    const s = String(id)
    if (s in order.cards) return s
    return Object.keys(order.cards).find((l) => order.cards[l]!.includes(s))
  }

  // Колонку тянем — ищем ближайшую колонку; карточку — колонку под курсором и ближайшую карточку в ней
  const collision: CollisionDetection = (args) => {
    if (active?.type === 'list') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id) in order.cards) })
    }
    const pointer = pointerWithin(args)
    const hits = pointer.length > 0 ? pointer : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    if (overId != null) {
      if (String(overId) in order.cards) {
        const inList = order.cards[String(overId)]!
        if (inList.length > 0) {
          const closest = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => inList.includes(String(c.id))) })
          if (closest[0]) overId = closest[0].id
        }
      }
      lastOver.current = overId
      return [{ id: overId }]
    }
    return lastOver.current != null ? [{ id: lastOver.current }] : []
  }

  function onDragStart(e: DragStartEvent) {
    setActive({ id: String(e.active.id), type: e.active.data.current?.type === 'list' ? 'list' : 'card' })
  }

  function onDragOver(e: DragOverEvent) {
    if (active?.type !== 'card' || !e.over) return
    const activeId = String(e.active.id)
    const overId = String(e.over.id)
    const from = findList(activeId)
    const to = findList(overId)
    if (!from || !to || from === to) return
    setOrder((o) => {
      const fromIds = o.cards[from]!.filter((x) => x !== activeId)
      const toIds = [...o.cards[to]!]
      let index = overId === to ? toIds.length : toIds.indexOf(overId)
      const translated = e.active.rect.current.translated
      if (overId !== to && translated && translated.top > e.over!.rect.top + e.over!.rect.height / 2) index += 1
      toIds.splice(index < 0 ? toIds.length : index, 0, activeId)
      return { ...o, cards: { ...o.cards, [from]: fromIds, [to]: toIds } }
    })
  }

  async function onDragEnd(e: DragEndEvent) {
    const was = active
    setActive(null)
    lastOver.current = null
    if (!was || !e.over) {
      setOrder(buildOrder(data, visible))
      return
    }
    const activeId = String(e.active.id)
    const overId = String(e.over.id)

    if (was.type === 'list') {
      const oldIndex = order.lists.indexOf(activeId)
      const newIndex = order.lists.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const lists = arrayMove(order.lists, oldIndex, newIndex)
      setOrder((o) => ({ ...o, lists }))
      const i = lists.indexOf(activeId)
      const position = positionBetween(listsById.get(lists[i - 1]!)?.position, listsById.get(lists[i + 1]!)?.position)
      qc.setQueryData<BoardData | null>(queryKey, (d) => d && { ...d, lists: d.lists.map((l) => (l.id === activeId ? { ...l, position } : l)) })
      try {
        await updateList(activeId, { position })
      } catch {
        toast.error(errText())
        await refreshBoard(qc, boardId)
      }
      return
    }

    const listId = findList(activeId)
    if (!listId) return
    let ids = order.cards[listId]!
    if (findList(overId) === listId && overId !== activeId && overId !== listId) {
      ids = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId))
      setOrder((o) => ({ ...o, cards: { ...o.cards, [listId]: ids } }))
    }
    const i = ids.indexOf(activeId)
    const card = cardsById.get(activeId)!
    const prev = cardsById.get(ids[i - 1]!)?.position
    const next = cardsById.get(ids[i + 1]!)?.position
    // Уже стоит на месте — ничего не пишем
    if (card.list_id === listId && (prev === undefined || prev < card.position) && (next === undefined || card.position < next)) return
    const position = positionBetween(prev, next)
    qc.setQueryData<BoardData | null>(queryKey, (d) => d && { ...d, cards: d.cards.map((c) => (c.id === activeId ? { ...c, list_id: listId, position } : c)) })
    try {
      await updateCard(activeId, { list_id: listId, position })
    } catch {
      toast.error(errText())
    } finally {
      await refreshBoard(qc, boardId, activeId)
    }
  }

  const activeCard = active?.type === 'card' ? cardsById.get(active.id) : undefined
  const activeList = active?.type === 'list' ? listsById.get(active.id) : undefined
  const lastListPos = Math.max(0, ...data.lists.map((l) => l.position))

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => {
        setActive(null)
        setOrder(buildOrder(data, visible))
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable: tr('Чтобы перенести, нажмите пробел, стрелками выберите место и снова нажмите пробел. Esc — отмена.'),
        },
        announcements: {
          onDragStart: ({ active }) => tr('Взято: {{name}}', { name: active.data.current?.title }),
          onDragOver: ({ over }) => (over ? tr('Над: {{name}}', { name: over.data.current?.title }) : tr('Вне колонок')),
          onDragEnd: ({ over }) => (over ? tr('Перенесено') : tr('Перенос отменён')),
          onDragCancel: () => tr('Перенос отменён'),
        },
      }}
    >
      {/* Правая кнопка по фону доски — меню доски; по колонке и карточке — их собственные меню */}
      <ContextMenu>
      <ContextMenuTrigger asChild disabled={noContextMenu}>
      <div className="flex h-full items-start gap-3 overflow-x-auto overflow-y-hidden px-3 pb-3 pt-1 [scrollbar-color:rgba(255,255,255,0.5)_transparent] sm:px-4">
        <SortableContext items={order.lists} strategy={horizontalListSortingStrategy}>
          {order.lists.map((listId, listIndex) => {
            const list = listsById.get(listId)
            if (!list) return null
            const cardIds = order.cards[listId] ?? []
            const lastPos = Math.max(0, ...data.cards.filter((c) => c.list_id === listId).map((c) => c.position))
            return (
              <ListColumn
                key={listId}
                list={list}
                cardIds={cardIds}
                total={data.cards.filter((c) => c.list_id === listId && !c.archived_at).length}
                filtering={filtering}
                canManage={canManage}
                renderCard={(id) => {
                  const c = cardsById.get(id)
                  return c ? (
                    <CardContextMenu key={id} data={data} card={c} candidates={candidates} guests={guests} meId={meId} onOpen={() => onOpenCard(id)}>
                      <SortableCard
                        card={c}
                        labels={labels}
                        people={people}
                        labelsExpanded={labelsExpanded}
                        onToggleLabels={toggleLabels}
                        onOpen={() => onOpenCard(id)}
                      />
                    </CardContextMenu>
                  ) : null
                }}
                onAddCard={
                  isMember
                    ? async (title) => {
                        await createCard(boardId, listId, title, positionBetween(lastPos || undefined, undefined))
                        await refreshBoard(qc, boardId)
                      }
                    : undefined
                }
                onRename={async (title) => {
                  await updateList(listId, { title })
                  await refreshBoard(qc, boardId)
                }}
                onArchive={async () => {
                  await updateList(listId, { archived_at: new Date().toISOString() })
                  await refreshBoard(qc, boardId)
                  toast.success(tr('Колонка отправлена в архив'))
                }}
                onArchiveCards={
                  isMember
                    ? async () => {
                        await archiveListCards(listId)
                        await refreshBoard(qc, boardId)
                        toast.success(tr('Карточки колонки отправлены в архив'))
                      }
                    : undefined
                }
                onShift={
                  canManage
                    ? (dir) => {
                        const target = listIndex + dir
                        if (target < 0 || target >= order.lists.length) return undefined
                        return async () => {
                          // Встаём за соседнюю колонку: между ней и следующей за ней в ту же сторону
                          const a = listsById.get(order.lists[target]!)?.position
                          const b = listsById.get(order.lists[target + dir]!)?.position
                          const position = dir < 0 ? positionBetween(b, a) : positionBetween(a, b)
                          await updateList(listId, { position })
                          await refreshBoard(qc, boardId)
                        }
                      }
                    : undefined
                }
              />
            )
          })}
        </SortableContext>

        {canManage && (
          <AddList
            open={addingList}
            onOpenChange={setAddingList}
            onAdd={async (title) => {
              await createList(boardId, title, positionBetween(lastListPos || undefined, undefined))
              await refreshBoard(qc, boardId)
            }}
          />
        )}
        {!canManage && order.lists.length === 0 && (
          <p className="rounded-xl bg-black/30 px-4 py-3 text-sm text-white">{tr('Колонок пока нет. Их задаёт администратор доски.')}</p>
        )}
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
        {canManage && (
          <ContextMenuItem onSelect={() => afterMenuClose(() => setAddingList(true))}>
            <Plus /> {tr('Добавить колонку')}
          </ContextMenuItem>
        )}
        <ContextMenuCheckboxItem checked={labelsExpanded} onCheckedChange={toggleLabels}>
          <Tag /> {tr('Названия меток на карточках')}
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onOpenMenu}>
          <MoreHorizontal /> {tr('Меню доски')}
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activeCard && (
          <div className="w-[256px] cursor-grabbing">
            <CardFace card={activeCard} labels={labels} people={people} labelsExpanded={labelsExpanded} dragging />
          </div>
        )}
        {activeList && (
          <div className="w-[272px] rotate-2 cursor-grabbing rounded-xl bg-[var(--board-list)] p-3 text-sm font-semibold shadow-xl">{activeList.title}</div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ---------------------------------------------------------------------------
// Колонка
// ---------------------------------------------------------------------------
function ListColumn({
  list,
  cardIds,
  total,
  filtering,
  canManage,
  renderCard,
  onAddCard,
  onRename,
  onArchive,
  onArchiveCards,
  onShift,
}: {
  list: BoardList
  cardIds: string[]
  total: number
  filtering: boolean
  canManage: boolean
  renderCard: (id: string) => ReactNode
  /** undefined — гостю карточки не создавать */
  onAddCard?: (title: string) => Promise<void>
  onRename: (title: string) => Promise<void>
  onArchive: () => Promise<void>
  onArchiveCards?: () => Promise<void>
  /** Сдвиг колонки на одно место влево (−1) или вправо (+1); undefined — двигать нельзя */
  onShift?: (dir: -1 | 1) => (() => Promise<void>) | undefined
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: { type: 'list', title: list.title },
    disabled: { draggable: !canManage, droppable: false },
  })
  const [composing, setComposing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const scroller = useRef<HTMLOListElement>(null)
  const left = onShift?.(-1)
  const right = onShift?.(1)

  // Одни и те же пункты — в меню «…» и в меню правой кнопки
  const items = (Item: ComponentType<MenuItemProps>, Separator: ComponentType) => (
    <>
      {onAddCard && (
        <Item onSelect={() => afterMenuClose(() => setComposing(true))}>
          <Plus /> {tr('Добавить карточку')}
        </Item>
      )}
      {canManage && (
        <Item onSelect={() => afterMenuClose(() => setRenaming(true))}>
          <Pencil /> {tr('Переименовать')}
        </Item>
      )}
      {onShift && (
        <>
          <Item disabled={!left} onSelect={() => void left?.().catch(() => toast.error(errText()))}>
            <ArrowLeft /> {tr('Сдвинуть влево')}
          </Item>
          <Item disabled={!right} onSelect={() => void right?.().catch(() => toast.error(errText()))}>
            <ArrowRight /> {tr('Сдвинуть вправо')}
          </Item>
        </>
      )}
      {onArchiveCards && (
        <>
          <Separator />
          <Item
            disabled={total === 0}
            onSelect={() => {
              if (window.confirm(tr('Отправить в архив все карточки колонки «{{name}}» ({{n}})?', { name: list.title, n: total })))
                void onArchiveCards().catch(() => toast.error(errText()))
            }}
          >
            <Archive /> {tr('Архивировать все карточки')}
          </Item>
        </>
      )}
      {canManage && (
        <Item onSelect={() => void onArchive().catch(() => toast.error(errText()))}>
          <Archive /> {tr('Архивировать колонку')}
        </Item>
      )}
    </>
  )

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild disabled={noContextMenu}>
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={list.title}
      className={cn(
        'flex max-h-full w-[272px] shrink-0 flex-col rounded-xl bg-[var(--board-list)] text-[var(--board-list-fg)] shadow-[0_1px_1px_rgba(9,30,66,0.25)]',
        isDragging && 'opacity-40',
      )}
    >
      <header className={cn('flex items-start gap-1 px-2 pb-1 pt-2', canManage && 'cursor-grab active:cursor-grabbing')} {...attributes} {...listeners}>
        {renaming ? (
          <InlineInput
            initial={list.title}
            ariaLabel={tr('Название колонки')}
            onDone={async (v) => {
              setRenaming(false)
              if (v && v !== list.title) await onRename(v).catch(() => toast.error(errText()))
            }}
          />
        ) : (
          <h2
            className={cn('min-w-0 flex-1 break-words rounded px-1.5 py-1 text-sm font-semibold', canManage && 'cursor-pointer')}
            onClick={() => canManage && setRenaming(true)}
          >
            {list.title}
            {filtering && <span className="ml-1.5 font-normal text-muted-foreground">{cardIds.length}/{total}</span>}
          </h2>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={tr('Действия с колонкой «{{name}}»', { name: list.title })} onPointerDown={(e) => e.stopPropagation()}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
            {items(DropdownMenuItem, DropdownMenuSeparator)}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <ol ref={scroller} className="flex min-h-1 flex-col gap-2 overflow-y-auto px-2 pb-0.5 pt-0.5 [scrollbar-width:thin]">
          {cardIds.map((id) => (
            <li key={id}>{renderCard(id)}</li>
          ))}
          {composing && onAddCard && (
            <li>
              <CardComposer
                onAdd={async (title) => {
                  await onAddCard(title)
                  requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }))
                }}
                onClose={() => setComposing(false)}
              />
            </li>
          )}
        </ol>
      </SortableContext>

      {!composing && onAddCard && (
        <div className="px-2 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" /> {tr('Добавить карточку')}
          </button>
        </div>
      )}
      {(composing || !onAddCard) && <div className="h-2" />}
    </section>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-60" aria-label={tr('Действия с колонкой «{{name}}»', { name: list.title })} onCloseAutoFocus={(e) => e.preventDefault()}>
      {items(ContextMenuItem, ContextMenuSeparator)}
    </ContextMenuContent>
    </ContextMenu>
  )
}

interface MenuItemProps {
  onSelect?: (e: Event) => void
  disabled?: boolean
  children?: ReactNode
}

// ---------------------------------------------------------------------------
// Карточка (перетаскиваемая)
// ---------------------------------------------------------------------------
function SortableCard({
  card,
  labels,
  people,
  labelsExpanded,
  onToggleLabels,
  onOpen,
  ref,
  ...rest
}: {
  card: BoardCard
  labels: Map<string, BoardLabel>
  people: Map<string, BoardPerson>
  labelsExpanded: boolean
  onToggleLabels: () => void
  onOpen: () => void
  ref?: Ref<HTMLDivElement>
} & Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onKeyDown'>) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card', title: card.title } })
  // ContextMenuTrigger (asChild) передаёт сюда свой ref и обработчики правой кнопки
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as { current: HTMLDivElement | null }).current = el
  }
  return (
    <div
      {...rest}
      ref={setRefs}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={card.title}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen()
      }}
      className={cn('group/card cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary', isDragging && 'opacity-0')}
    >
      {isDragging ? (
        <div className="h-full min-h-10 rounded-lg bg-foreground/10" />
      ) : (
        <CardFace card={card} labels={labels} people={people} labelsExpanded={labelsExpanded} onToggleLabels={onToggleLabels} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Добавление карточки и колонки
// ---------------------------------------------------------------------------
function CardComposer({ onAdd, onClose }: { onAdd: (title: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async () => {
    const title = value.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      await onAdd(title)
      setValue('') // как в Trello: поле остаётся открытым для следующей карточки
    } catch {
      toast.error(tr('Не удалось добавить карточку.'))
    } finally {
      setBusy(false)
      ref.current?.focus()
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && !value.trim()) onClose()
      }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') onClose()
        }}
        rows={3}
        maxLength={500}
        {...keepNativeMenu}
        placeholder={tr('Введите название или вставьте ссылку')}
        aria-label={tr('Название карточки')}
        className="w-full resize-none rounded-lg bg-card px-3 py-2 text-sm text-card-foreground shadow-[0_1px_1px_rgba(9,30,66,0.25)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" disabled={busy || !value.trim()} onClick={() => void submit()}>
          {tr('Добавить карточку')}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Отмена')} onClick={onClose}>
          <X />
        </Button>
      </div>
    </div>
  )
}

function AddList({ open, onOpenChange: setOpen, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (title: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  const submit = async () => {
    const title = value.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      await onAdd(title)
      setValue('')
    } catch {
      toast.error(tr('Не удалось добавить колонку.'))
    } finally {
      setBusy(false)
      ref.current?.focus()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-[272px] shrink-0 items-center gap-2 rounded-xl bg-white/25 px-3 text-sm font-medium text-white outline-none backdrop-blur-sm transition-colors hover:bg-white/35 focus-visible:ring-2 focus-visible:ring-white"
      >
        <Plus className="size-4" /> {tr('Добавить ещё одну колонку')}
      </button>
    )
  }
  return (
    <div className="flex w-[272px] shrink-0 flex-col gap-2 rounded-xl bg-[var(--board-list)] p-2">
      <input
        ref={ref}
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        {...keepNativeMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={tr('Введите название колонки…')}
        aria-label={tr('Название колонки')}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" disabled={busy || !value.trim()} onClick={() => void submit()}>
          {tr('Добавить колонку')}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Отмена')} onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
    </div>
  )
}

/** Поле для переименования на месте: Enter или уход фокуса — сохранить, Esc — отменить. */
export function InlineInput({
  initial,
  ariaLabel,
  onDone,
  className,
  maxLength = 200,
}: {
  initial: string
  ariaLabel: string
  onDone: (value: string | null) => void
  className?: string
  maxLength?: number
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={maxLength}
      aria-label={ariaLabel}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      {...keepNativeMenu}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value.trim() || null)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value.trim() || null)}
      className={cn('h-8 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm font-semibold text-foreground outline-none ring-2 ring-primary/30', className)}
    />
  )
}
