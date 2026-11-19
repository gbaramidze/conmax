import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, MoreHorizontal, Star, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { refreshBoard, setStar, updateBoard, type BoardCard, type BoardData } from '@/features/boards/api'
import { BoardCanvas, InlineInput } from '@/features/boards/board-canvas'
import { BoardMenu, EMPTY_FILTER, FilterPopover, filterCount, matchesFilter, MembersDialog, type BoardFilter } from '@/features/boards/board-dialogs'
import { CardDialog } from '@/features/boards/card-dialog'
import { cardGuestCandidates, cardMemberCandidates, iAmBoardMember, usePeople } from '@/features/boards/people'
import { myPermissionsQuery } from '@/features/projects/api'
import { UserAvatar } from '@/features/profile/avatar'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const BOARD_TABLES = ['board_lists', 'board_cards', 'board_labels', 'board_card_labels', 'board_card_members', 'board_card_viewers', 'board_checklists', 'board_checklist_items', 'board_comments', 'board_card_attachments']

/** Живое обновление: чужие правки на доске появляются сразу (с небольшой задержкой, чтобы пачка изменений дала один запрос). */
export function useBoardRealtime(boardId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!boardId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const bump = (cardId?: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['board', boardId] })
        if (cardId) void qc.invalidateQueries({ queryKey: ['board-card', cardId] })
        else void qc.invalidateQueries({ queryKey: ['board-card'] })
      }, 250)
    }
    let channel = supabase.channel(`board:${boardId}`)
    for (const table of BOARD_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `board_id=eq.${boardId}` }, (p) => {
        const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { card_id?: string; id?: string } | undefined
        bump(table === 'board_cards' ? row?.id : row?.card_id)
      })
    }
    channel.subscribe()
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [boardId, qc])
}

export const headerBtn = 'border-0 bg-white/20 text-white hover:bg-white/30 hover:text-white'

/**
 * Открытая доска: шапка (название, звёздочка, фильтр, участники, меню), колонки и окна карточки, участников, меню.
 * Фон и вкладки досок рисует страница «Доски».
 */
export function BoardView({
  data,
  cardId,
  setCard,
  onDeleted,
}: {
  data: BoardData
  cardId: string | undefined
  setCard: (id: string | undefined) => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const b = data.board
  const { data: perms } = useQuery(myPermissionsQuery(b.project_id))
  const { people, projectIds, meId } = usePeople(b.project_id)
  // Гость (позвали только в карточку) видит лишь свои колонки и карточки: не создаёт карточек и ничего не настраивает
  const isMember = iAmBoardMember(data, people, projectIds, meId)
  const canManage = b.kind === 'personal' || (isMember && !!perms?.includes('board.manage'))
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER)
  const [renaming, setRenaming] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // При переключении доски фильтр сбрасывается
  useEffect(() => setFilter(EMPTY_FILTER), [b.id])

  const filtering = filterCount(filter) > 0
  // Функция фильтра стабильна, пока не меняется фильтр: от неё зависит пересборка порядка на холсте
  const filterKey = JSON.stringify(filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visible = useCallback((c: BoardCard) => matchesFilter(c, filter, Date.now()), [filterKey])

  const candidates = useMemo(() => cardMemberCandidates(data, people, projectIds, meId), [data, people, projectIds, meId])
  const guests = useMemo(() => cardGuestCandidates(data, people, projectIds, meId), [data, people, projectIds, meId])
  const avatars = useMemo(() => data.member_ids.map((id) => people.get(id)).filter((p) => !!p).slice(0, 6), [data.member_ids, people])

  const toggleStar = async () => {
    qc.setQueryData<BoardData | null>(['board', b.id], (d) => d && { ...d, board: { ...d.board, starred: !d.board.starred } })
    try {
      await setStar(b.id, !b.starred)
    } catch {
      toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))
    }
    await refreshBoard(qc, b.id)
    await qc.invalidateQueries({ queryKey: ['boards'] })
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 bg-black/20 px-3 py-2 text-white backdrop-blur-sm sm:px-4">
        {renaming ? (
          <InlineInput
            initial={b.title}
            ariaLabel={tr('Название доски')}
            maxLength={120}
            className="h-8 max-w-sm text-lg"
            onDone={(v) => {
              setRenaming(false)
              if (v && v !== b.title)
                void updateBoard(b.id, { title: v }).then(
                  () => refreshBoard(qc, b.id).then(() => qc.invalidateQueries({ queryKey: ['boards'] })),
                  () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.')),
                )
            }}
          />
        ) : (
          <h1>
            <button
              type="button"
              disabled={!canManage}
              onClick={() => setRenaming(true)}
              className="max-w-[60vw] truncate rounded px-2 py-1 text-lg font-bold outline-none enabled:hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
            >
              {b.title}
            </button>
          </h1>
        )}
        <Button type="button" size="icon-sm" className={headerBtn} aria-pressed={b.starred} aria-label={b.starred ? tr('Снять отметку с доски') : tr('Отметить доску')} onClick={() => void toggleStar()}>
          <Star className={cn(b.starred && 'fill-[#f5cd47] text-[#f5cd47]')} />
        </Button>
        {/* на телефоне — только значок, подпись в подсказке и для экранного диктора */}
        <span
          title={b.kind === 'personal' ? tr('Личная') : b.all_staff ? tr('Весь проект') : tr('Общая')}
          className="flex h-8 items-center gap-1 rounded bg-white/20 px-2 text-xs font-medium"
        >
          {b.kind === 'personal' ? <Lock className="size-3.5" aria-hidden /> : <Users className="size-3.5" aria-hidden />}
          <span className="sr-only sm:not-sr-only">{b.kind === 'personal' ? tr('Личная') : b.all_staff ? tr('Весь проект') : tr('Общая')}</span>
        </span>
        {b.closed_at && <span className="rounded bg-[#f5cd47] px-2 py-1 text-xs font-semibold text-[#533f04]">{tr('Доска закрыта')}</span>}

        <div className="ml-auto flex items-center gap-1.5">
          <FilterPopover data={data} people={people} meId={meId} filter={filter} onChange={setFilter} />
          {b.kind === 'shared' && (
            <>
              <button type="button" onClick={() => setMembersOpen(true)} className="hidden -space-x-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex" aria-label={tr('Участники доски')}>
                {avatars.map((p) => (
                  <span key={p!.id} title={p!.full_name} className="rounded-full ring-2 ring-black/20">
                    <UserAvatar name={p!.full_name} path={p!.avatar_path} className="size-7 text-[11px]" />
                  </span>
                ))}
              </button>
              <Button type="button" size="sm" className={cn(headerBtn, canManage && 'bg-white text-[#172b4d] hover:bg-white/90 hover:text-[#172b4d]')} onClick={() => setMembersOpen(true)}>
                <Users /> <span className="hidden sm:inline">{canManage ? tr('Поделиться') : tr('Участники')}</span>
              </Button>
            </>
          )}
          <Button type="button" size="icon-sm" className={headerBtn} aria-label={tr('Меню доски')} onClick={() => setMenuOpen(true)}>
            <MoreHorizontal />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 pt-2">
        <BoardCanvas data={data} canManage={canManage} people={people} visible={visible} filtering={filtering}
          candidates={candidates}
          guests={guests}
          isMember={isMember}
          meId={meId}
          onOpenCard={(id) => setCard(id)}
          onOpenMenu={() => setMenuOpen(true)}
        />
      </div>

      {cardId && <CardDialog data={data} cardId={cardId} people={people} projectIds={projectIds} meId={meId} onClose={() => setCard(undefined)} />}
      {membersOpen && <MembersDialog data={data} people={people} projectIds={projectIds} canManage={canManage} onClose={() => setMembersOpen(false)} />}
      <BoardMenu
        data={data}
        canManage={canManage}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onDeleted={onDeleted}
        onOpenCard={(id) => {
          setMenuOpen(false)
          setCard(id)
        }}
      />
    </>
  )
}
