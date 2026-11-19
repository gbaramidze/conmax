import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Archive, KanbanSquare, Lock, Plus, Star, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  boardBackgroundStyle,
  boardBackgroundUrlQuery,
  boardQuery,
  boardsQuery,
  deleteBoard,
  updateBoard,
  type BoardKind,
  type BoardSummary,
} from '@/features/boards/api'
import { BoardSwatch, CreateBoardDialog } from '@/features/boards/board-dialogs'
import { BoardView, useBoardRealtime } from '@/features/boards/board-screen'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Доска / Board» с вкладками: сверху «Общие | Личные», вкладки досок и «+ Создать»; ниже — открытая доска на всю ширину.
// Вид, доска и открытая карточка живут в адресе (`?kind=&board=&card=`), ссылкой можно поделиться.
export const Route = createFileRoute('/_app/projects/$code/boards')({
  validateSearch: z.object({
    kind: z.enum(['shared', 'personal']).optional().catch(undefined),
    board: z.string().optional().catch(undefined),
    card: z.string().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    await Promise.all([queryClient.ensureQueryData(boardsQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем доски…')}</p>,
  component: BoardsPage,
})

// Последняя открытая доска каждого вида — чтобы раздел открывался там, где остановились
const lastKey = (projectId: string, kind: BoardKind) => `boards.last.${projectId}.${kind}`
function readLast(projectId: string, kind: BoardKind): string | null {
  try {
    return localStorage.getItem(lastKey(projectId, kind))
  } catch {
    return null
  }
}
function writeLast(projectId: string, kind: BoardKind, id: string) {
  try {
    localStorage.setItem(lastKey(projectId, kind), id)
  } catch {
    /* без хранилища — просто откроется первая доска */
  }
}

const byStarThenTitle = (a: BoardSummary, b: BoardSummary) => Number(b.starred) - Number(a.starred) || a.title.localeCompare(b.title)

function BoardsPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const projectId = project!.id
  const { data: boards } = useSuspenseQuery(boardsQuery(projectId))
  const { data: perms } = useQuery(myPermissionsQuery(projectId))
  const canShare = !!perms?.includes('board.manage')
  const [creating, setCreating] = useState(false)

  // Доска из адреса задаёт и вид; иначе вид из адреса, по умолчанию — общие
  const requested = boards.find((b) => b.id === search.board)
  const kind: BoardKind = requested?.kind ?? search.kind ?? 'shared'
  const tabs = useMemo(() => boards.filter((b) => b.kind === kind && !b.closed_at).sort(byStarThenTitle), [boards, kind])
  const closed = useMemo(() => boards.filter((b) => b.kind === kind && b.closed_at), [boards, kind])
  const last = readLast(projectId, kind)
  const active = requested ?? tabs.find((b) => b.id === last) ?? tabs[0]
  const canCreate = kind === 'personal' || canShare

  useEffect(() => {
    if (active) writeLast(projectId, active.kind, active.id)
  }, [projectId, active])

  const { data } = useQuery({ ...boardQuery(active?.id ?? ''), enabled: !!active })
  const shown = data && data.board.id === active?.id ? data : undefined
  useBoardRealtime(active?.id)
  const { data: bgUrl } = useQuery(boardBackgroundUrlQuery(active?.background_image))

  const go = (patch: { kind?: BoardKind; board?: string; card?: string }, replace = false) =>
    void navigate({ search: (p) => ({ ...p, card: undefined, ...patch }), replace })

  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (active) tabRefs.current.get(active.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const kindTab = (value: BoardKind, label: string, Icon: typeof Lock) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === value}
      onClick={() => go({ kind: value, board: undefined })}
      title={label}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white sm:px-3',
        kind === value ? 'bg-white text-[#172b4d] shadow-sm' : 'text-white/90 hover:bg-white/15',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {/* на телефоне подпись только у активной вкладки — экономим место */}
      <span className={cn(kind !== value && 'sr-only sm:not-sr-only')}>{label}</span>
    </button>
  )

  return (
    <div
      className="-mx-4 -mb-24 -mt-5 flex h-[calc(100svh-3.5rem-4rem)] min-h-[26rem] flex-col overflow-hidden sm:-mx-6 lg:-mx-8 lg:-mb-10 lg:-mt-6 lg:h-[calc(100svh-3.5rem)]"
      style={active ? boardBackgroundStyle(active.background, bgUrl) : { background: 'linear-gradient(135deg, #44546f 0%, #22272b 100%)' }}
    >
      {/* Вкладки: вид досок, доски, «+ Создать» */}
      <nav aria-label={tr('Доски проекта')} className="flex shrink-0 items-center gap-2 bg-black/40 px-3 py-1.5 text-white backdrop-blur-sm sm:px-4">
        <div role="tablist" aria-label={tr('Вид досок')} className="flex shrink-0 gap-0.5 rounded-lg bg-black/25 p-0.5">
          {kindTab('shared', tr('Общие'), Users)}
          {kindTab('personal', tr('Личные'), Lock)}
        </div>
        <span className="h-6 w-px shrink-0 bg-white/25" aria-hidden />
        <div role="tablist" aria-label={kind === 'shared' ? tr('Общие доски') : tr('Мои личные доски')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((b) => {
            const on = b.id === active?.id
            return (
              <button
                key={b.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(b.id, el)
                  else tabRefs.current.delete(b.id)
                }}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go({ kind: b.kind, board: b.id })}
                className={cn(
                  'flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white',
                  on ? 'bg-white/90 font-semibold text-[#172b4d] shadow-sm' : 'text-white/90 hover:bg-white/15',
                )}
              >
                <BoardSwatch board={b} className="size-4 rounded-sm ring-1 ring-black/10" />
                <span className="truncate">{b.title}</span>
                {b.starred && <Star className="size-3.5 shrink-0 fill-[#f5cd47] text-[#f5cd47]" aria-label={tr('Отмечена')} />}
              </button>
            )
          })}
          {active?.closed_at && (
            <span className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-white/90 px-2.5 text-sm font-semibold text-[#172b4d]">
              <Archive className="size-4" aria-hidden /> {active.title}
            </span>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-white/90 outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
            >
              <Plus className="size-4" /> {tr('Создать')}
            </button>
          )}
        </div>
        {closed.length > 0 && <ClosedBoards boards={closed} canManage={kind === 'personal' || canShare} onOpen={(id) => go({ board: id })} />}
      </nav>

      {shown ? (
        <BoardView
          data={shown}
          cardId={search.card}
          setCard={(card) => void navigate({ search: (p) => ({ ...p, board: shown.board.id, kind: shown.board.kind, card }), replace: !card })}
          onDeleted={() => go({ kind, board: undefined }, true)}
        />
      ) : active ? (
        <p className="p-6 text-sm text-white/90">{tr('Открываем доску…')}</p>
      ) : (
        <EmptyKind kind={kind} canCreate={canCreate} onCreate={() => setCreating(true)} />
      )}

      {creating && (
        <CreateBoardDialog
          projectId={projectId}
          canShare={canShare}
          defaultKind={kind}
          onClose={() => setCreating(false)}
          onCreated={(id, k) => go({ kind: k, board: id })}
        />
      )}
    </div>
  )
}

function EmptyKind({ kind, canCreate, onCreate }: { kind: BoardKind; canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl bg-card p-6 text-center shadow-lg">
        <KanbanSquare className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-base font-semibold">{kind === 'shared' ? tr('Общих досок пока нет') : tr('Личных досок пока нет')}</h1>
        <p className="text-sm text-muted-foreground">
          {kind === 'shared'
            ? canCreate
              ? tr('Создайте доску для команды проекта: колонки задаёте вы, карточки ведут участники.')
              : tr('Общих досок проекта, где вы участник, пока нет. Их создаёт руководитель проекта.')
            : tr('Личная доска видна только вам: свои дела по проекту, напоминания, черновики.')}
        </p>
        {canCreate && (
          <Button type="button" onClick={onCreate}>
            <Plus /> {tr('Создать доску')}
          </Button>
        )}
      </div>
    </div>
  )
}

function ClosedBoards({ boards, canManage, onOpen }: { boards: BoardSummary[]; canManage: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))
    }
    await qc.invalidateQueries({ queryKey: ['boards'] })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-white/80 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
          aria-label={tr('Закрытые доски ({{n}})', { n: boards.length })}
        >
          <Archive className="size-4" /> <span className="hidden sm:inline">{boards.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <h3 className="px-2 pb-2 pt-1 text-sm font-semibold">{tr('Закрытые доски ({{n}})', { n: boards.length })}</h3>
        <ul className="flex flex-col">
          {boards.map((b) => (
            <li key={b.id} className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-muted">
              <BoardSwatch board={b} className="size-6 rounded" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                onClick={() => {
                  setOpen(false)
                  onOpen(b.id)
                }}
              >
                {b.title}
              </button>
              {canManage && (
                <>
                  <Button type="button" size="xs" variant="secondary" onClick={() => void run(() => updateBoard(b.id, { closed_at: null }))}>
                    {tr('Открыть снова')}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() =>
                      window.confirm(tr('Удалить доску «{{title}}» со всеми колонками и карточками? Это нельзя отменить.', { title: b.title })) &&
                      void run(() => deleteBoard(b.id, b.background_image))
                    }
                  >
                    {tr('Удалить')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
