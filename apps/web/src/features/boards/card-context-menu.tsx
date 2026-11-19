import { useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  CalendarClock,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Lock,
  Image as ImageIcon,
  Link2,
  Tag,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  canInviteTo,
  copyCard,
  LABEL_COLORS,
  LABEL_STYLE,
  labelColorName,
  positionBetween,
  refreshBoard,
  toggleCardLabel,
  toggleCardMember,
  toggleCardViewer,
  updateCard,
  type BoardCard,
  type BoardData,
  type CardPatch,
  type CardVisibility,
  type LabelColor,
} from '@/features/boards/api'
import { cardGuests, guestWarning, type BoardPerson } from '@/features/boards/people'
import { UserAvatar } from '@/features/profile/avatar'
import { tr } from '@/lib/tr'

const fail = () => toast.error(tr('Не удалось сохранить. Обновили доску — попробуйте ещё раз.'))

/** На сенсорных экранах долгое касание — перенос карточки, поэтому меню правой кнопки там не показываем. */
export const noContextMenu = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches

/** В полях ввода оставляем обычное меню браузера (вставить, проверка орфографии). */
export const keepNativeMenu = { onContextMenu: (e: { stopPropagation: () => void }) => e.stopPropagation() }

/** Срок через `days` дней в 18:00 по местному времени. */
function dueIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(18, 0, 0, 0)
  return d.toISOString()
}

function cardLink(cardId: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('card', cardId)
  return url.toString()
}

function copyText(text: string, ok: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(ok),
    () => toast.error(tr('Не удалось скопировать ссылку.')),
  )
}

/**
 * Меню правой кнопки на карточке — как «быстрое редактирование» в Trello: открыть, метки, участники, обложка, даты,
 * перемещение, копия, ссылка, выполнено, архив. Всё сохраняется сразу, без открытия карточки.
 */
export function CardContextMenu({
  data,
  card,
  candidates,
  guests,
  meId,
  onOpen,
  children,
}: {
  data: BoardData
  card: BoardCard
  candidates: BoardPerson[]
  /** Люди проекта не с доски: позвать их в карточку — значит открыть им доску (только их колонки и карточки) */
  guests: BoardPerson[]
  meId: string | undefined
  onOpen: () => void
  children: ReactNode
}) {
  const qc = useQueryClient()
  const boardId = data.board.id

  const patch = async (p: CardPatch) => {
    qc.setQueryData<BoardData | null>(['board', boardId], (d) => d && { ...d, cards: d.cards.map((c) => (c.id === card.id ? { ...c, ...p } : c)) })
    try {
      await updateCard(card.id, p)
    } catch {
      fail()
    } finally {
      await refreshBoard(qc, boardId, card.id)
    }
  }
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      fail()
    } finally {
      await refreshBoard(qc, boardId, card.id)
    }
  }

  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const siblings = (listId: string) => data.cards.filter((c) => c.list_id === listId && !c.archived_at && c.id !== card.id).sort((a, b) => a.position - b.position)
  const here = siblings(card.list_id)
  const isFirst = !here.some((c) => c.position < card.position)
  const isLast = !here.some((c) => c.position > card.position)
  const labels = [...data.labels].sort((a, b) => a.position - b.position)
  const labelSet = new Set(card.label_ids)
  const memberSet = new Set(card.member_ids)
  const iAmMember = !!meId && memberSet.has(meId)
  // в скрытую карточку не автор зовёт только тех, кто её уже видит
  const inviteable = canInviteTo(card, candidates, meId)
  // гости этой карточки и те, кого можно позвать гостем (с предупреждением)
  const people = new Map([...candidates, ...guests].map((p) => [p.id, p]))
  const guestRows = canInviteTo(card, cardGuests(card, candidates, guests, people), meId)
  const canJoin = !!meId && (inviteable.some((p) => p.id === meId) || iAmMember)
  const isAuthor = !!meId && meId === card.created_by
  const viewerSet = new Set(card.viewer_ids)

  const archive = async () => {
    await patch({ archived_at: new Date().toISOString() })
    toast.success(tr('Карточка «{{title}}» в архиве', { title: card.title }), {
      action: { label: tr('Вернуть из архива'), onClick: () => void patch({ archived_at: null }) },
    })
  }

  const duplicate = async () => {
    const next = here.find((c) => c.position > card.position)
    try {
      await copyCard({
        cardId: card.id,
        listId: card.list_id,
        title: card.title,
        position: positionBetween(card.position, next?.position),
        checklists: true,
        labels: true,
        members: true,
      })
      toast.success(tr('Копия карточки создана'))
    } catch {
      fail()
    } finally {
      await refreshBoard(qc, boardId)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={noContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60" aria-label={tr('Действия с карточкой «{{title}}»', { title: card.title })}>
        <ContextMenuItem onSelect={onOpen}>
          <ExternalLink /> {tr('Открыть карточку')}
        </ContextMenuItem>
        <ContextMenuSeparator />

        {/* Метки */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Tag /> {tr('Метки')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-60">
            {labels.map((l) => (
              <ContextMenuCheckboxItem
                key={l.id}
                checked={labelSet.has(l.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => void run(() => toggleCardLabel(card, l.id, on))}
              >
                <span className="h-5 w-10 shrink-0 rounded" style={{ background: LABEL_STYLE[l.color].bg }} aria-hidden />
                <span className="truncate">{l.name || labelColorName(l.color)}</span>
              </ContextMenuCheckboxItem>
            ))}
            {labels.length === 0 && <ContextMenuLabel>{tr('На доске пока нет меток.')}</ContextMenuLabel>}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onOpen}>{tr('Создать или изменить метки…')}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Участники */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Users /> {tr('Участники')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-64">
            {canJoin && (
              <>
                <ContextMenuItem onSelect={() => void run(() => toggleCardMember(card, meId!, !iAmMember))}>
                  {iAmMember ? <UserMinus /> : <UserPlus />} {iAmMember ? tr('Покинуть карточку') : tr('Присоединиться')}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {inviteable.map((p) => (
              <ContextMenuCheckboxItem
                key={p.id}
                checked={memberSet.has(p.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(on) => void run(() => toggleCardMember(card, p.id, on))}
              >
                <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />
                <span className="truncate">{p.full_name}</span>
              </ContextMenuCheckboxItem>
            ))}
            {guestRows.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuLabel className="text-xs font-normal text-muted-foreground">{tr('Не на доске — увидят только свои карточки')}</ContextMenuLabel>
                {guestRows.map((p) => (
                  <ContextMenuCheckboxItem
                    key={p.id}
                    checked={memberSet.has(p.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) => {
                      if (on && !window.confirm(guestWarning(p.full_name))) return
                      void run(() => toggleCardMember(card, p.id, on))
                    }}
                  >
                    <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />
                    <span className="truncate">{p.full_name}</span>
                  </ContextMenuCheckboxItem>
                ))}
              </>
            )}
            {inviteable.length === 0 && guestRows.length === 0 && <ContextMenuLabel>{tr('Никого не нашли.')}</ContextMenuLabel>}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Кто видит — только автор карточки общей доски */}
        {isAuthor && data.board.kind === 'shared' && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              {card.visibility === 'selected' ? <Lock /> : <Eye />} {tr('Кто видит карточку')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
              <ContextMenuRadioGroup value={card.visibility} onValueChange={(v) => void patch({ visibility: v as CardVisibility })}>
                <ContextMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
                  <Eye /> {tr('Все участники доски')}
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="selected" onSelect={(e) => e.preventDefault()}>
                  <Lock /> {tr('Только выбранные')}
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
              {card.visibility === 'selected' && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuLabel>{tr('Кроме вас и участников карточки видят:')}</ContextMenuLabel>
                  {candidates
                    .filter((p) => p.id !== card.created_by)
                    .map((p) => {
                      const member = memberSet.has(p.id)
                      return (
                        <ContextMenuCheckboxItem
                          key={p.id}
                          checked={member || viewerSet.has(p.id)}
                          disabled={member}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={(on) => void run(() => toggleCardViewer(card, p.id, on))}
                        >
                          <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />
                          <span className="truncate">{p.full_name}</span>
                        </ContextMenuCheckboxItem>
                      )
                    })}
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* Обложка */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ImageIcon /> {tr('Обложка')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ContextMenuRadioGroup
              value={card.cover ?? (card.cover_attachment_id ? 'photo' : '')}
              onValueChange={(v) => void patch(v ? { cover: v as LabelColor, cover_attachment_id: null } : { cover: null, cover_attachment_id: null })}
            >
              <ContextMenuRadioItem value="">{tr('Без обложки')}</ContextMenuRadioItem>
              {card.cover_attachment_id && (
                <ContextMenuRadioItem value="photo" disabled>
                  <ImageIcon /> {tr('Фото из вложений')}
                </ContextMenuRadioItem>
              )}
              {LABEL_COLORS.map((c) => (
                <ContextMenuRadioItem key={c} value={c}>
                  <span className="h-4 w-8 shrink-0 rounded" style={{ background: LABEL_STYLE[c].bg }} aria-hidden />
                  {labelColorName(c)}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Даты */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Clock /> {tr('Даты')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuLabel>{tr('Срок')}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => void patch({ due_at: dueIn(0), due_done: false })}>{tr('Сегодня, 18:00')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => void patch({ due_at: dueIn(1), due_done: false })}>{tr('Завтра, 18:00')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => void patch({ due_at: dueIn(7), due_done: false })}>{tr('Через неделю')}</ContextMenuItem>
            <ContextMenuItem onSelect={onOpen}>
              <CalendarClock /> {tr('Другая дата…')}
            </ContextMenuItem>
            {(card.due_at || card.start_date) && (
              <>
                <ContextMenuSeparator />
                {card.due_at && (
                  <ContextMenuCheckboxItem checked={card.due_done} onCheckedChange={(on) => void patch({ due_done: on })}>
                    {tr('Срок выполнен')}
                  </ContextMenuCheckboxItem>
                )}
                <ContextMenuItem variant="destructive" onSelect={() => void patch({ start_date: null, due_at: null, due_done: false })}>
                  {tr('Удалить даты')}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Перемещение */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowRight /> {tr('Переместить')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-60">
            <ContextMenuItem disabled={isFirst} onSelect={() => void patch({ position: positionBetween(undefined, here[0]?.position) })}>
              <ArrowUpToLine /> {tr('В начало колонки')}
            </ContextMenuItem>
            <ContextMenuItem disabled={isLast} onSelect={() => void patch({ position: positionBetween(here.at(-1)?.position, undefined) })}>
              <ArrowDownToLine /> {tr('В конец колонки')}
            </ContextMenuItem>
            {lists.length > 1 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuLabel>{tr('В колонку')}</ContextMenuLabel>
                {lists
                  .filter((l) => l.id !== card.list_id)
                  .map((l) => (
                    <ContextMenuItem
                      key={l.id}
                      onSelect={() => void patch({ list_id: l.id, position: positionBetween(siblings(l.id).at(-1)?.position, undefined) })}
                    >
                      <span className="truncate">{l.title}</span>
                    </ContextMenuItem>
                  ))}
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => void duplicate()}>
          <Copy /> {tr('Создать копию')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(cardLink(card.id), tr('Ссылка на карточку скопирована'))}>
          <Link2 /> {tr('Копировать ссылку')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void patch({ completed: !card.completed })}>
          <CircleCheck /> {card.completed ? tr('Снять отметку «выполнено»') : tr('Отметить выполненной')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void archive()}>
          <Archive /> {tr('Архивировать')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
