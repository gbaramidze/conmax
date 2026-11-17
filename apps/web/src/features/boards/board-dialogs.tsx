import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, Filter, ImageUp, Lock, RotateCcw, Tag, Trash2, Users, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/features/profile/avatar'
import {
  addBoardMember,
  backgroundCss,
  BACKGROUNDS,
  boardBackgroundStyle,
  boardBackgroundUrlQuery,
  createBoard,
  deleteBoard,
  deleteCard,
  deleteList,
  LABEL_STYLE,
  labelColorName,
  refreshBoard,
  removeBoardMember,
  setBoardColor,
  updateBoard,
  updateCard,
  updateList,
  uploadBoardBackground,
  type Board,
  type BoardCard,
  type BoardData,
  type BoardKind,
} from '@/features/boards/api'
import { LabelPill } from '@/features/boards/card-face'
import type { BoardPerson } from '@/features/boards/people'
import { LabelsPicker } from '@/features/boards/pickers'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const fail = () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))

function BackgroundGrid({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={tr('Фон')}>
      {Object.keys(BACKGROUNDS).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={key}
          onClick={() => onChange(key)}
          className={cn('flex h-10 items-center justify-center rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-ring', value === key && 'ring-2 ring-primary ring-offset-2 ring-offset-popover')}
          style={{ background: backgroundCss(key) }}
        >
          {value === key && <Check className="size-4" />}
        </button>
      ))}
    </div>
  )
}

/** Маленький образец фона доски: фото или цвет. */
export function BoardSwatch({ board, className }: { board: Pick<Board, 'background' | 'background_image'>; className?: string }) {
  const { data: url } = useQuery(boardBackgroundUrlQuery(board.background_image))
  return <span className={cn('shrink-0', className)} style={boardBackgroundStyle(board.background, url)} aria-hidden />
}

/** Фон доски: своё фото (загрузить, заменить, убрать) или один из цветов. */
function BackgroundPanel({ board, run }: { board: Board; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { data: url } = useQuery(boardBackgroundUrlQuery(board.background_image))
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(tr('Это не фото. Подойдут JPG, PNG или WebP.'))
      return
    }
    setBusy(true)
    try {
      await uploadBoardBackground(board, file)
      await run(async () => {})
      toast.success(tr('Фон доски обновлён'))
    } catch {
      toast.error(tr('Не удалось загрузить фото. Попробуйте другое — JPG, PNG или WebP.'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-4 p-1">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{tr('Фото')}</h3>
        <div className="flex h-32 items-center justify-center rounded-lg" style={boardBackgroundStyle(board.background, url)}>
          {!board.background_image && <span className="rounded bg-black/30 px-2 py-1 text-xs text-white">{tr('Сейчас фон — цвет')}</span>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} tabIndex={-1} aria-hidden />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp /> {busy ? tr('Загружаем…') : board.background_image ? tr('Заменить фото') : tr('Загрузить фото')}
          </Button>
          {board.background_image && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => setBoardColor(board, board.background))}>
              {tr('Убрать фото')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{tr('JPG, PNG или WebP. Большое фото уменьшим до 2560 пикселей по длинной стороне.')}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{tr('Цвета')}</h3>
        <BackgroundGrid value={board.background_image ? '' : board.background} onChange={(key) => void run(() => setBoardColor(board, key))} />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Создание доски
// ---------------------------------------------------------------------------
export function CreateBoardDialog({
  projectId,
  canShare,
  defaultKind,
  onClose,
  onCreated,
}: {
  projectId: string
  canShare: boolean
  defaultKind: BoardKind
  onClose: () => void
  /** Доска создана — открыть её во вкладке */
  onCreated: (id: string, kind: BoardKind) => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [background, setBackground] = useState('blue')
  const [kind, setKind] = useState<BoardKind>(canShare ? defaultKind : 'personal')
  const [allStaff, setAllStaff] = useState(true)
  const [starter, setStarter] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const id = await createBoard({
        projectId,
        kind,
        title,
        background,
        allStaff: kind === 'shared' && allStaff,
        lists: starter ? [tr('Нужно сделать'), tr('В работе'), tr('Готово')] : [],
      })
      await qc.invalidateQueries({ queryKey: ['boards'] })
      onClose()
      onCreated(id, kind)
    } catch {
      toast.error(tr('Не удалось создать доску.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Создать доску')}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Название, фон и вид новой доски')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex h-28 items-center justify-center rounded-lg" style={{ background: backgroundCss(background) }} aria-hidden>
            <div className="flex gap-1.5">
              {[0.9, 0.6, 0.75].map((h, i) => (
                <span key={i} className="w-14 rounded bg-white/85" style={{ height: `${h * 64}px` }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{tr('Фон')}</span>
            <BackgroundGrid value={background} onChange={setBackground} />
          </div>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
            {tr('Название доски')}
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus required aria-required />
          </label>

          {canShare && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">{tr('Вид')}</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(
                  [
                    ['personal', Lock, tr('Личная'), tr('Видите только вы')],
                    ['shared', Users, tr('Общая'), tr('Колонки задаёте вы, карточки ведут участники')],
                  ] as const
                ).map(([value, Icon, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => setKind(value)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      kind === value ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="size-4" /> {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {kind === 'shared' && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={allStaff} onChange={(e) => setAllStaff(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>
                {tr('Весь проект')}
                <span className="block text-xs text-muted-foreground">{tr('Доску видят все сотрудники на проекте. Внешних (субподрядчиков, заказчика) — только если добавить их отдельно.')}</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>
              {tr('Стартовые колонки')}
              <span className="block text-xs text-muted-foreground">{tr('«Нужно сделать», «В работе», «Готово» — потом можно переименовать')}</span>
            </span>
          </label>
          <Button type="submit" disabled={busy || !title.trim()}>
            {tr('Создать')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Участники общей доски
// ---------------------------------------------------------------------------
export function MembersDialog({
  data,
  people,
  projectIds,
  canManage,
  onClose,
}: {
  data: BoardData
  people: Map<string, BoardPerson>
  projectIds: Set<string>
  canManage: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const b = data.board
  const members = data.member_ids.map((id) => people.get(id)).filter((p): p is BoardPerson => !!p).sort((a, b) => a.full_name.localeCompare(b.full_name))
  // Добавить можно только участника проекта
  const options = [...projectIds]
    .map((id) => people.get(id))
    .filter((p): p is BoardPerson => !!p && !data.member_ids.includes(p.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((p) => ({
      value: p.id,
      label: p.full_name,
      hint: [p.hint, p.is_external ? tr('внешний') : null].filter(Boolean).join(' · ') || undefined,
      avatar: <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />,
    }))
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      fail()
    } finally {
      await refreshBoard(qc, b.id)
      await qc.invalidateQueries({ queryKey: ['boards'] })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Участники доски')}</DialogTitle>
          <DialogDescription>{tr('Участники видят колонки доски и карточки, в которые их добавили. Колонки и состав задаёт руководитель проекта.')}</DialogDescription>
        </DialogHeader>
        <label className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', !canManage && 'opacity-70')}>
          <input type="checkbox" checked={b.all_staff} disabled={!canManage} onChange={(e) => void run(() => updateBoard(b.id, { all_staff: e.target.checked }))} className="mt-0.5 size-4 accent-primary" />
          <span>
            {tr('Весь проект')}
            <span className="block text-xs text-muted-foreground">{tr('Доску видят все сотрудники на проекте. Внешних нужно добавить отдельно.')}</span>
          </span>
        </label>
        {canManage && (
          <SearchSelect value="" onChange={(id) => id && void run(() => addBoardMember(b.id, id))} options={options} ariaLabel={tr('Добавить участника')} placeholder={tr('Добавить участника…')} />
        )}
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {members.map((p) => (
            <li key={p.id} className="flex min-h-11 items-center gap-2 rounded-md px-1">
              <UserAvatar name={p.full_name} path={p.avatar_path} className="size-8 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.full_name}</span>
                {(p.hint || p.is_external) && (
                  <span className="block truncate text-xs text-muted-foreground">{[p.hint, p.is_external ? tr('внешний') : null].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              {canManage && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Убрать {{name}} из доски', { name: p.full_name })} onClick={() => void run(() => removeBoardMember(b.id, p.id))}>
                  <X />
                </Button>
              )}
            </li>
          ))}
          {members.length === 0 && (
            <li className="py-3 text-center text-sm text-muted-foreground">{b.all_staff ? tr('Отдельно никто не добавлен — доску видят все на проекте.') : tr('Пока никого. Добавьте людей, которые будут работать с доской.')}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Меню доски: о доске, фон, метки, архив, закрытие
// ---------------------------------------------------------------------------
type MenuView = 'main' | 'background' | 'labels' | 'archive'

export function BoardMenu({
  data,
  canManage,
  open,
  onOpenChange,
  onOpenCard,
  onDeleted,
}: {
  data: BoardData
  canManage: boolean
  open: boolean
  onOpenChange: (o: boolean) => void
  onOpenCard: (id: string) => void
  /** Доска удалена — показать другую */
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const b = data.board
  const [view, setView] = useState<MenuView>('main')
  const [desc, setDesc] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      fail()
    } finally {
      await refreshBoard(qc, b.id)
      await qc.invalidateQueries({ queryKey: ['boards'] })
    }
  }

  const titles: Record<MenuView, string> = { main: tr('Меню'), background: tr('Фон доски'), labels: tr('Метки'), archive: tr('Архив') }
  const item = 'flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setView('main')
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-center">{titles[view]}</SheetTitle>
          <SheetDescription className="sr-only">{tr('Настройки и архив доски')}</SheetDescription>
          {view !== 'main' && (
            <Button type="button" variant="ghost" size="sm" className="absolute left-2 top-2.5" onClick={() => setView('main')}>
              ← {tr('Назад')}
            </Button>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-1 p-3">
          {view === 'main' && (
            <>
              <section className="mb-2 flex flex-col gap-2 rounded-lg p-2">
                <h3 className="text-sm font-semibold">{tr('О доске')}</h3>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {b.kind === 'personal' ? <Lock className="size-3.5" /> : <Users className="size-3.5" />}
                  {b.kind === 'personal' ? tr('Личная доска — видите только вы.') : b.all_staff ? tr('Общая доска — видят все на проекте.') : tr('Общая доска — видят участники.')}
                </p>
                {desc !== null ? (
                  <div className="flex flex-col gap-2">
                    <Textarea value={desc} rows={5} maxLength={5000} autoFocus onChange={(e) => setDesc(e.target.value)} aria-label={tr('Описание доски')} />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          const v = desc
                          setDesc(null)
                          void run(() => updateBoard(b.id, { description: v }))
                        }}
                      >
                        {tr('Сохранить')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDesc(null)}>
                        {tr('Отмена')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDesc(b.description)}
                    className="min-h-12 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-left text-sm text-muted-foreground outline-none enabled:hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {b.description || (canManage ? tr('Расскажите, для чего эта доска и как ею пользоваться…') : tr('Описания нет.'))}
                  </button>
                )}
              </section>

              {canManage && (
                <button type="button" className={item} onClick={() => setView('background')}>
                  <BoardSwatch board={b} className="size-5 rounded" /> {tr('Сменить фон')}
                </button>
              )}
              <button type="button" className={item} onClick={() => setView('labels')}>
                <Tag className="size-4" /> {tr('Метки')}
              </button>
              <button type="button" className={item} onClick={() => setView('archive')}>
                <Archive className="size-4" /> {tr('Архив')}
              </button>

              {canManage && (
                <>
                  <div className="my-2 h-px bg-border" />
                  {b.closed_at ? (
                    <button type="button" className={item} onClick={() => void run(() => updateBoard(b.id, { closed_at: null }))}>
                      <RotateCcw className="size-4" /> {tr('Открыть доску снова')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={item}
                      onClick={() => {
                        if (window.confirm(tr('Закрыть доску «{{title}}»? Она уйдёт в «Закрытые доски», её можно будет открыть снова.', { title: b.title })))
                          void run(() => updateBoard(b.id, { closed_at: new Date().toISOString() }))
                      }}
                    >
                      <Archive className="size-4" /> {tr('Закрыть доску')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(item, 'text-destructive')}
                    onClick={async () => {
                      if (!window.confirm(tr('Удалить доску «{{title}}» со всеми колонками и карточками? Это нельзя отменить.', { title: b.title }))) return
                      try {
                        await deleteBoard(b.id, b.background_image)
                        await qc.invalidateQueries({ queryKey: ['boards'] })
                        onOpenChange(false)
                        onDeleted()
                        toast.success(tr('Доска удалена'))
                      } catch {
                        fail()
                      }
                    }}
                  >
                    <Trash2 className="size-4" /> {tr('Удалить доску')}
                  </button>
                </>
              )}
            </>
          )}

          {view === 'background' && (
            <BackgroundPanel board={b} run={run} />
          )}

          {view === 'labels' && (
            <div className="flex flex-col gap-2 p-1">
              <p className="text-xs text-muted-foreground">{tr('Метки помогают разбирать карточки по смыслу: срочно, ждём поставку, на согласовании…')}</p>
              <ul className="flex flex-col gap-1">
                {[...data.labels]
                  .sort((x, y) => x.position - y.position)
                  .map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <LabelPill label={l} className="h-8 flex-1 px-3 text-sm" />
                      <span className="w-16 text-right text-xs text-muted-foreground">{data.cards.filter((c) => c.label_ids.includes(l.id) && !c.archived_at).length}</span>
                    </li>
                  ))}
              </ul>
              <LabelsPicker
                boardId={b.id}
                labels={data.labels}
                selected={new Set()}
                onToggle={() => {}}
                title={tr('Изменить метки')}
                trigger={
                  <Button type="button" variant="secondary">
                    {tr('Изменить метки')}
                  </Button>
                }
              />
            </div>
          )}

          {view === 'archive' && <ArchiveView data={data} canManage={canManage} run={run} onOpenCard={onOpenCard} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ArchiveView({ data, canManage, run, onOpenCard }: { data: BoardData; canManage: boolean; run: (fn: () => Promise<unknown>) => Promise<void>; onOpenCard: (id: string) => void }) {
  const [tab, setTab] = useState<'cards' | 'lists'>('cards')
  const [q, setQ] = useState('')
  const cards = data.cards.filter((c) => c.archived_at && (!q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())))
  const lists = data.lists.filter((l) => l.archived_at && (!q.trim() || l.title.toLowerCase().includes(q.trim().toLowerCase())))
  const listTitle = (id: string) => data.lists.find((l) => l.id === id)?.title
  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск в архиве')} aria-label={tr('Поиск в архиве')} className="h-9 flex-1" />
        <Button type="button" variant="secondary" size="sm" className="h-9 md:h-9" onClick={() => setTab(tab === 'cards' ? 'lists' : 'cards')}>
          {tab === 'cards' ? tr('Колонки') : tr('Карточки')}
        </Button>
      </div>
      {tab === 'cards' ? (
        <ul className="flex flex-col gap-3">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-col gap-1">
              <button type="button" onClick={() => onOpenCard(c.id)} className="rounded-lg bg-card px-3 py-2 text-left text-sm shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] hover:bg-muted">
                {c.title}
                <span className="block text-xs text-muted-foreground">{listTitle(c.list_id)}</span>
              </button>
              <div className="flex gap-3 px-1 text-xs text-muted-foreground">
                <button type="button" className="hover:text-foreground hover:underline" onClick={() => void run(() => updateCard(c.id, { archived_at: null }))}>
                  {tr('Вернуть')}
                </button>
                <button
                  type="button"
                  className="hover:text-destructive hover:underline"
                  onClick={() => window.confirm(tr('Удалить карточку «{{title}}»? Это нельзя отменить.', { title: c.title })) && void run(() => deleteCard(c.id))}
                >
                  {tr('Удалить')}
                </button>
              </div>
            </li>
          ))}
          {cards.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">{tr('В архиве нет карточек.')}</li>}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((l) => (
            <li key={l.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.title}</span>
              {canManage && (
                <>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void run(() => updateList(l.id, { archived_at: null }))}>
                    {tr('Вернуть')}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={tr('Удалить колонку «{{title}}»', { title: l.title })}
                    onClick={() => window.confirm(tr('Удалить колонку «{{title}}» вместе с её карточками? Это нельзя отменить.', { title: l.title })) && void run(() => deleteList(l.id))}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
          {lists.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">{tr('В архиве нет колонок.')}</li>}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Фильтр карточек
// ---------------------------------------------------------------------------
export interface BoardFilter {
  q: string
  labels: string[]
  members: string[]
  noMembers: boolean
  due: ('overdue' | 'soon' | 'none' | 'done')[]
}
export const EMPTY_FILTER: BoardFilter = { q: '', labels: [], members: [], noMembers: false, due: [] }
export const filterCount = (f: BoardFilter) => (f.q.trim() ? 1 : 0) + f.labels.length + f.members.length + (f.noMembers ? 1 : 0) + f.due.length

export function matchesFilter(c: BoardCard, f: BoardFilter, now: number): boolean {
  const q = f.q.trim().toLowerCase()
  if (q && !c.title.toLowerCase().includes(q)) return false
  if (f.labels.length && !f.labels.some((id) => c.label_ids.includes(id))) return false
  if (f.members.length || f.noMembers) {
    const okMember = f.members.some((id) => c.member_ids.includes(id))
    const okNone = f.noMembers && c.member_ids.length === 0
    if (!okMember && !okNone) return false
  }
  if (f.due.length) {
    const t = c.due_at ? new Date(c.due_at).getTime() : null
    const ok = f.due.some((d) =>
      d === 'none' ? t === null : d === 'done' ? !!t && c.due_done : d === 'overdue' ? !!t && !c.due_done && t < now : !!t && !c.due_done && t >= now && t - now < 86400_000,
    )
    if (!ok) return false
  }
  return true
}

export function FilterPopover({ data, people, meId, filter, onChange }: { data: BoardData; people: Map<string, BoardPerson>; meId: string | undefined; filter: BoardFilter; onChange: (f: BoardFilter) => void }) {
  const n = filterCount(filter)
  const memberIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of data.cards) for (const id of c.member_ids) ids.add(id)
    return [...ids].map((id) => people.get(id)).filter((p): p is BoardPerson => !!p).sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.full_name.localeCompare(b.full_name)))
  }, [data.cards, people, meId])
  const toggle = <K extends 'labels' | 'members' | 'due'>(key: K, value: BoardFilter[K][number]) => {
    const arr = filter[key] as string[]
    onChange({ ...filter, [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] })
  }
  const box = (on: boolean, onClick: () => void, children: ReactNode) => (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{on && <Check className="size-3" />}</span>
      {children}
    </button>
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" className={cn('border-0 bg-white/20 text-white hover:bg-white/30', n > 0 && 'bg-white text-[#172b4d] hover:bg-white/90')}>
          <Filter /> {tr('Фильтр')}
          {n > 0 && <span className="rounded-full bg-[#0c66e4] px-1.5 text-xs text-white">{n}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(36rem,calc(100svh-6rem))] w-[320px] flex-col gap-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{tr('Фильтр карточек')}</h3>
          {n > 0 && (
            <Button type="button" size="xs" variant="ghost" onClick={() => onChange(EMPTY_FILTER)}>
              {tr('Сбросить')}
            </Button>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Ключевое слово')}
          <Input value={filter.q} onChange={(e) => onChange({ ...filter, q: e.target.value })} placeholder={tr('Введите слово…')} className="h-9" />
        </label>
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-semibold text-muted-foreground">{tr('Участники')}</span>
          {box(filter.noMembers, () => onChange({ ...filter, noMembers: !filter.noMembers }), tr('Без участников'))}
          {memberIds.map((p) =>
            box(
              filter.members.includes(p.id),
              () => toggle('members', p.id),
              <>
                <UserAvatar name={p.full_name} path={p.avatar_path} className="size-6 text-[10px]" />
                <span className="truncate">{p.id === meId ? tr('Карточки, назначенные мне') : p.full_name}</span>
              </>,
            ),
          )}
        </div>
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-semibold text-muted-foreground">{tr('Срок')}</span>
          {box(filter.due.includes('none'), () => toggle('due', 'none'), tr('Без срока'))}
          {box(filter.due.includes('overdue'), () => toggle('due', 'overdue'), <span className="text-[#c9372c]">{tr('Просрочено')}</span>)}
          {box(filter.due.includes('soon'), () => toggle('due', 'soon'), tr('Срок в ближайшие сутки'))}
          {box(filter.due.includes('done'), () => toggle('due', 'done'), tr('Выполнено'))}
        </div>
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-semibold text-muted-foreground">{tr('Метки')}</span>
          {[...data.labels]
            .sort((a, b) => a.position - b.position)
            .map((l) =>
              box(
                filter.labels.includes(l.id),
                () => toggle('labels', l.id),
                <span className="flex h-7 flex-1 items-center truncate rounded px-2 text-sm font-medium" style={{ background: LABEL_STYLE[l.color].bg, color: LABEL_STYLE[l.color].fg }}>
                  {l.name || labelColorName(l.color)}
                </span>,
              ),
            )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
