import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlignLeft,
  Archive,
  ArrowRight,
  CheckSquare,
  Clock,
  Copy,
  CreditCard,
  EyeOff,
  Link2,
  List as ListIcon,
  PaintBucket,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/features/profile/avatar'
import {
  addComment,
  cardDetailQuery,
  copyCard,
  createChecklist,
  createChecklistItem,
  deleteCard,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  dueState,
  editComment,
  LABEL_STYLE,
  positionBetween,
  POS_STEP,
  refreshBoard,
  toggleCardLabel,
  toggleCardMember,
  updateCard,
  updateChecklist,
  updateChecklistItem,
  type BoardCard,
  type BoardData,
  type CardActivity,
  type CardComment,
  type CardPatch,
  type Checklist,
} from '@/features/boards/api'
import { DUE_CLASS, dueTitle, formatDue, formatDay, LabelPill } from '@/features/boards/card-face'
import { MentionText, MentionTextarea } from '@/features/boards/mention-textarea'
import { cardMemberCandidates, type BoardPerson } from '@/features/boards/people'
import { CoverPicker, DatesPicker, LabelsPicker, PeoplePicker, PickerPopover } from '@/features/boards/pickers'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const fail = () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))
const timeFmt = () => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Обратная сторона карточки: всё о ней в одном окне, как в Trello. Открывается по `?card=` в адресе доски. */
export function CardDialog({
  data,
  cardId,
  people,
  projectIds,
  meId,
  onClose,
}: {
  data: BoardData
  cardId: string
  people: Map<string, BoardPerson>
  projectIds: Set<string>
  meId: string | undefined
  onClose: () => void
}) {
  const card = data.cards.find((c) => c.id === cardId)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[calc(100%-1rem)] gap-0 overflow-x-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
        // Esc в поле ввода отменяет ввод, а не закрывает карточку (как в Trello); второй Esc закроет окно
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.('textarea, input, select, [contenteditable="true"]')) e.preventDefault()
        }}
      >
        {card ? (
          <CardBody data={data} card={card} people={people} projectIds={projectIds} meId={meId} onClose={onClose} />
        ) : (
          <div className="p-6">
            <DialogTitle>{tr('Карточка не найдена')}</DialogTitle>
            <DialogDescription className="mt-2">{tr('Её удалили или у вас нет доступа к этой доске.')}</DialogDescription>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CardBody({
  data,
  card,
  people,
  projectIds,
  meId,
  onClose,
}: {
  data: BoardData
  card: BoardCard
  people: Map<string, BoardPerson>
  projectIds: Set<string>
  meId: string | undefined
  onClose: () => void
}) {
  const qc = useQueryClient()
  const boardId = data.board.id
  const { data: detail } = useQuery(cardDetailQuery(card.id))
  const list = data.lists.find((l) => l.id === card.list_id)
  const labelsById = useMemo(() => new Map(data.labels.map((l) => [l.id, l])), [data.labels])
  const cardLabels = card.label_ids.map((id) => labelsById.get(id)).filter((l) => !!l).sort((a, b) => a!.position - b!.position)
  const candidates = useMemo(() => cardMemberCandidates(data, people, projectIds, meId), [data, people, projectIds, meId])
  // Кого можно упомянуть через «@»: все, кто видит доску, кроме меня
  const mentionable = useMemo(() => candidates.filter((p) => p.id !== meId), [candidates, meId])
  const isShared = data.board.kind === 'shared'
  const refresh = () => refreshBoard(qc, boardId, card.id)

  const patch = async (p: CardPatch, optimistic = true) => {
    if (optimistic) {
      qc.setQueryData<BoardData | null>(['board', boardId], (d) => d && { ...d, cards: d.cards.map((c) => (c.id === card.id ? { ...c, ...p } : c)) })
    }
    try {
      await updateCard(card.id, p)
    } catch {
      fail()
    } finally {
      await refresh()
    }
  }
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      fail()
    } finally {
      await refresh()
    }
  }

  const labelsSet = new Set(card.label_ids)
  const membersSet = new Set(card.member_ids)
  const due = dueState(card)
  const sidebarBtn = 'h-8 w-full justify-start gap-2 bg-muted/80 px-2.5 font-medium text-foreground hover:bg-muted md:h-8'

  const labelsPicker = (trigger: ReactNode) => (
    <LabelsPicker boardId={boardId} labels={data.labels} selected={labelsSet} onToggle={(id, on) => run(() => toggleCardLabel(card, id, on))} trigger={trigger} />
  )
  const membersPicker = (trigger: ReactNode) => (
    <PeoplePicker people={candidates} selected={membersSet} onToggle={(id, on) => run(() => toggleCardMember(card, id, on))} trigger={trigger} />
  )
  const datesPicker = (trigger: ReactNode) => (
    <DatesPicker startDate={card.start_date} dueAt={card.due_at} onSave={(v) => patch({ ...v, due_done: v.due_at ? card.due_done : false })} trigger={trigger} />
  )

  return (
    <>
      {card.cover && (
        <div className="relative h-28 shrink-0" style={{ background: LABEL_STYLE[card.cover].bg }}>
          <CoverPicker
            value={card.cover}
            onChange={(c) => void patch({ cover: c })}
            trigger={
              <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-12">
                <PaintBucket /> {tr('Обложка')}
              </Button>
            }
          />
        </div>
      )}
      {card.archived_at && (
        <div className="flex flex-wrap items-center gap-2 bg-[#f5cd47]/80 px-5 py-3 pr-12 text-sm text-[#533f04]">
          <Archive className="size-4" /> {tr('Карточка в архиве.')}
        </div>
      )}

      <div className="flex flex-col gap-1 px-5 pb-2 pr-12 pt-5">
        <div className="flex items-start gap-3">
          <CreditCard className="mt-1.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle asChild>
              <TitleEditor key={card.title} value={card.title} onSave={(title) => patch({ title })} />
            </DialogTitle>
            <DialogDescription className="mt-0.5 px-1.5 text-sm text-muted-foreground">
              {tr('в колонке')}{' '}
              <MovePopover data={data} card={card} trigger={<button type="button" className="underline underline-offset-2 hover:text-foreground">{list?.title}</button>} />
            </DialogDescription>
            {isShared && (
              <p className="mt-1 flex items-start gap-1.5 px-1.5 text-xs text-muted-foreground">
                <EyeOff className="mt-px size-3.5 shrink-0" aria-hidden />
                {card.member_ids.length > 0
                  ? tr('Карточку видят только её участники, автор и руководитель доски.')
                  : tr('Участников нет — карточку видят только автор и руководитель доски. Добавьте участников, чтобы её увидели другие.')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-5 pb-6 md:grid-cols-[minmax(0,1fr)_168px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Метки, участники, даты */}
          {(cardLabels.length > 0 || card.member_ids.length > 0 || card.due_at || card.start_date) && (
            <div className="flex flex-wrap gap-x-6 gap-y-4 pl-8">
              {card.member_ids.length > 0 && (
                <Field label={tr('Участники')}>
                  <div className="flex flex-wrap items-center gap-1">
                    {card.member_ids.map((id) => {
                      const p = people.get(id)
                      return (
                        <span key={id} title={p?.full_name}>
                          <UserAvatar name={p?.full_name ?? '?'} path={p?.avatar_path} className="size-8 text-xs" />
                        </span>
                      )
                    })}
                    {membersPicker(
                      <Button type="button" variant="secondary" size="icon-sm" className="rounded-full" aria-label={tr('Изменить участников')}>
                        <Plus />
                      </Button>,
                    )}
                  </div>
                </Field>
              )}
              {cardLabels.length > 0 && (
                <Field label={tr('Метки')}>
                  <div className="flex flex-wrap items-center gap-1">
                    {cardLabels.map((l) => (
                      <LabelPill key={l!.id} label={l!} className="h-8 px-3 text-sm" />
                    ))}
                    {labelsPicker(
                      <Button type="button" variant="secondary" size="icon-sm" aria-label={tr('Изменить метки')}>
                        <Plus />
                      </Button>,
                    )}
                  </div>
                </Field>
              )}
              {(card.due_at || card.start_date) && (
                <Field label={card.due_at ? tr('Срок') : tr('Начало')}>
                  <div className="flex items-center gap-2">
                    {card.due_at && (
                      <input
                        type="checkbox"
                        checked={card.due_done}
                        onChange={(e) => void patch({ due_done: e.target.checked })}
                        aria-label={tr('Выполнено')}
                        className="size-4 accent-[#1f845a]"
                      />
                    )}
                    {datesPicker(
                      <Button type="button" variant="secondary" size="sm" className="font-normal">
                        {card.start_date && formatDay(card.start_date)}
                        {card.start_date && card.due_at && ' – '}
                        {card.due_at && formatDue(card.due_at)}
                        {due && due !== 'later' && <span className={cn('ml-1 rounded px-1 text-xs font-medium', DUE_CLASS[due])}>{dueTitle(due)}</span>}
                      </Button>,
                    )}
                  </div>
                </Field>
              )}
            </div>
          )}

          {/* Описание */}
          <Section icon={<AlignLeft />} title={tr('Описание')}>
            {detail ? (
              <DescriptionEditor
                key={detail.description}
                value={detail.description}
                people={candidates}
                mentionable={mentionable}
                onSave={(description) => patch({ description }, false)}
              />
            ) : (
              <div className="h-14 animate-pulse rounded-md bg-muted" />
            )}
          </Section>

          {/* Чек-листы */}
          {detail?.checklists.map((cl) => (
            <ChecklistBlock key={cl.id} checklist={cl} card={card} run={run} />
          ))}

          {/* Комментарии и действия */}
          <ActivityBlock card={card} comments={detail?.comments} activity={detail?.activity} people={people} mentionable={mentionable} meId={meId} run={run} />
        </div>

        {/* Боковая колонка действий */}
        <aside className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{tr('Добавить на карточку')}</p>
            {(isShared || !membersSet.size) &&
              membersPicker(
                <Button type="button" variant="ghost" className={sidebarBtn}>
                  <UserRound /> {tr('Участники')}
                </Button>,
              )}
            {labelsPicker(
              <Button type="button" variant="ghost" className={sidebarBtn}>
                <Tag /> {tr('Метки')}
              </Button>,
            )}
            <ChecklistAdd
              onAdd={(title) => run(() => createChecklist(card, title, Math.max(0, ...(detail?.checklists ?? []).map((c) => c.position)) + POS_STEP))}
              trigger={
                <Button type="button" variant="ghost" className={sidebarBtn}>
                  <CheckSquare /> {tr('Чек-лист')}
                </Button>
              }
            />
            {datesPicker(
              <Button type="button" variant="ghost" className={sidebarBtn}>
                <Clock /> {tr('Даты')}
              </Button>,
            )}
            {!card.cover && (
              <CoverPicker
                value={card.cover}
                onChange={(c) => void patch({ cover: c })}
                trigger={
                  <Button type="button" variant="ghost" className={sidebarBtn}>
                    <PaintBucket /> {tr('Обложка')}
                  </Button>
                }
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{tr('Действия')}</p>
            <MovePopover
              data={data}
              card={card}
              trigger={
                <Button type="button" variant="ghost" className={sidebarBtn}>
                  <ArrowRight /> {tr('Переместить')}
                </Button>
              }
            />
            <CopyPopover
              data={data}
              card={card}
              trigger={
                <Button type="button" variant="ghost" className={sidebarBtn}>
                  <Copy /> {tr('Копировать')}
                </Button>
              }
            />
            <Button
              type="button"
              variant="ghost"
              className={sidebarBtn}
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).then(
                  () => toast.success(tr('Ссылка на карточку скопирована')),
                  () => toast.error(tr('Не удалось скопировать ссылку.')),
                )
              }}
            >
              <Link2 /> {tr('Ссылка')}
            </Button>
            {card.archived_at ? (
              <>
                <Button type="button" variant="ghost" className={sidebarBtn} onClick={() => void patch({ archived_at: null })}>
                  <RotateCcw /> {tr('Вернуть из архива')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-8 w-full justify-start gap-2 px-2.5 md:h-8"
                  onClick={async () => {
                    if (!window.confirm(tr('Удалить карточку «{{title}}»? Все её данные пропадут. Это нельзя отменить.', { title: card.title }))) return
                    try {
                      await deleteCard(card.id)
                      onClose()
                      await refreshBoard(qc, boardId)
                      toast.success(tr('Карточка удалена'))
                    } catch {
                      fail()
                    }
                  }}
                >
                  <Trash2 /> {tr('Удалить')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" className={sidebarBtn} onClick={() => void patch({ archived_at: new Date().toISOString() })}>
                <Archive /> {tr('Архивировать')}
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Section({ icon, title, actions, children }: { icon: ReactNode; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-3">
        <span className="text-muted-foreground [&_svg]:size-5">{icon}</span>
        <h3 className="flex-1 text-base font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="pl-8">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Название и описание
// ---------------------------------------------------------------------------
function TitleEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [v])
  const commit = () => {
    const t = v.trim()
    if (t && t !== value) onSave(t)
    else setV(value)
  }
  return (
    <textarea
      ref={ref}
      value={v}
      rows={1}
      maxLength={500}
      aria-label={tr('Название карточки')}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          e.stopPropagation()
          setV(value)
          requestAnimationFrame(() => ref.current?.blur())
        }
      }}
      onBlur={commit}
      className="w-full resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-0.5 text-xl font-semibold leading-7 outline-none focus:bg-background focus:ring-2 focus:ring-primary"
    />
  )
}

function DescriptionEditor({
  value,
  people,
  mentionable,
  onSave,
}: {
  value: string
  people: BoardPerson[]
  mentionable: BoardPerson[]
  onSave: (v: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const [busy, setBusy] = useState(false)
  if (!editing) {
    return value.trim() ? (
      <button type="button" onClick={() => setEditing(true)} className="w-full whitespace-pre-wrap break-words rounded-md text-left text-sm leading-6 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
        <MentionText text={value} people={people} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-h-14 w-full rounded-md bg-muted px-3 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tr('Добавьте более подробное описание…')}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <MentionTextarea
        autoFocus
        value={v}
        onValueChange={setV}
        people={mentionable}
        rows={8}
        maxLength={20000}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setV(value)
            setEditing(false)
          }
        }}
        aria-label={tr('Описание')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onSave(v)
            setBusy(false)
            setEditing(false)
          }}
        >
          {tr('Сохранить')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setV(value)
            setEditing(false)
          }}
        >
          {tr('Отмена')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Чек-листы
// ---------------------------------------------------------------------------
function ChecklistAdd({ onAdd, trigger }: { onAdd: (title: string) => Promise<void>; trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(tr('Чек-лист'))
  return (
    <PickerPopover trigger={trigger} title={tr('Добавить чек-лист')} open={open} onOpenChange={setOpen}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim()) return
          await onAdd(title)
          setOpen(false)
          setTitle(tr('Чек-лист'))
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Название')}
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus onFocus={(e) => e.currentTarget.select()} className="h-9" />
        </label>
        <Button type="submit" disabled={!title.trim()}>
          {tr('Добавить')}
        </Button>
      </form>
    </PickerPopover>
  )
}

function ChecklistBlock({ checklist, card, run }: { checklist: Checklist; card: BoardCard; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const qc = useQueryClient()
  const [hideDone, setHideDone] = useState(false)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const items = checklist.items
  const done = items.filter((i) => i.done).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0
  const shown = hideDone ? items.filter((i) => !i.done) : items

  const toggle = async (id: string, value: boolean) => {
    qc.setQueryData(cardDetailQuery(card.id).queryKey, (d) =>
      d && { ...d, checklists: d.checklists.map((c) => (c.id === checklist.id ? { ...c, items: c.items.map((i) => (i.id === id ? { ...i, done: value } : i)) } : c)) },
    )
    await run(() => updateChecklistItem(id, { done: value }))
  }

  return (
    <Section
      icon={<CheckSquare />}
      title={checklist.title}
      actions={
        <div className="flex gap-1">
          {done > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setHideDone((v) => !v)}>
              {hideDone ? tr('Показать отмеченные ({{n}})', { n: done }) : tr('Скрыть отмеченные')}
            </Button>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(true)}>
            {tr('Изменить')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              if (window.confirm(tr('Удалить чек-лист «{{title}}»? Это нельзя отменить.', { title: checklist.title }))) void run(() => deleteChecklist(checklist.id))
            }}
          >
            {tr('Удалить')}
          </Button>
        </div>
      }
    >
      {renaming && (
        <InlineText
          initial={checklist.title}
          ariaLabel={tr('Название чек-листа')}
          onDone={(v) => {
            setRenaming(false)
            if (v && v !== checklist.title) void run(() => updateChecklist(checklist.id, v))
          }}
        />
      )}
      <div className="-ml-8 mb-2 flex items-center gap-3">
        <span className="w-6 text-right text-xs text-muted-foreground">{pct}%</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full transition-[width] duration-300', pct === 100 ? 'bg-[#1f845a]' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="-ml-8 flex flex-col">
        {shown.map((item) => (
          <ChecklistRow key={item.id} item={item} onToggle={(v) => void toggle(item.id, v)} run={run} />
        ))}
      </ul>
      {hideDone && done === items.length && items.length > 0 && <p className="text-sm text-muted-foreground">{tr('Все пункты выполнены!')}</p>}
      {adding ? (
        <ItemComposer
          onAdd={(title) => run(() => createChecklistItem(card, checklist.id, title, positionBetween(items.at(-1)?.position, undefined)))}
          onClose={() => setAdding(false)}
        />
      ) : (
        <Button type="button" size="sm" variant="secondary" className="mt-1" onClick={() => setAdding(true)}>
          {tr('Добавить элемент')}
        </Button>
      )}
    </Section>
  )
}

function ChecklistRow({
  item,
  onToggle,
  run,
}: {
  item: Checklist['items'][number]
  onToggle: (v: boolean) => void
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  return (
    <li className="group flex min-h-9 items-start gap-3 rounded-md py-1 pl-1.5 hover:bg-muted/60">
      <input type="checkbox" checked={item.done} onChange={(e) => onToggle(e.target.checked)} aria-label={item.title} className="mt-1 size-4 shrink-0 accent-primary" />
      {editing ? (
        <InlineText
          initial={item.title}
          ariaLabel={tr('Пункт чек-листа')}
          onDone={(v) => {
            setEditing(false)
            if (v && v !== item.title) void run(() => updateChecklistItem(item.id, { title: v }))
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={cn('min-w-0 flex-1 break-words text-left text-sm leading-6 outline-none', item.done && 'text-muted-foreground line-through')}>
          {item.title}
        </button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="opacity-60 group-hover:opacity-100 md:opacity-0 md:focus-visible:opacity-100"
        aria-label={tr('Удалить пункт «{{title}}»', { title: item.title })}
        onClick={() => void run(() => deleteChecklistItem(item.id))}
      >
        <X />
      </Button>
    </li>
  )
}

function ItemComposer({ onAdd, onClose }: { onAdd: (title: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = async () => {
    if (!v.trim()) return
    const t = v
    setV('')
    await onAdd(t)
    ref.current?.focus()
  }
  return (
    <div className="mt-1 flex flex-col gap-2">
      <textarea
        ref={ref}
        autoFocus
        value={v}
        rows={2}
        maxLength={500}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder={tr('Добавить элемент')}
        aria-label={tr('Новый пункт чек-листа')}
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!v.trim()} onClick={() => void submit()}>
          {tr('Добавить')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {tr('Отмена')}
        </Button>
      </div>
    </div>
  )
}

function InlineText({ initial, ariaLabel, onDone }: { initial: string; ariaLabel: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (x: string | null) => {
    if (done.current) return
    done.current = true
    onDone(x)
  }
  return (
    <input
      autoFocus
      value={v}
      maxLength={500}
      aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(v.trim() || null)
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(v.trim() || null)}
      className="mb-2 h-9 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm outline-none ring-2 ring-primary/30"
    />
  )
}

// ---------------------------------------------------------------------------
// Комментарии и история
// ---------------------------------------------------------------------------
function activityText(a: CardActivity): string {
  switch (a.kind) {
    case 'created':
      return tr('добавлена карточка в колонку «{{list}}»', { list: a.data.list ?? '' })
    case 'moved':
      return tr('перенесено из «{{from}}» в «{{to}}»', { from: a.data.from ?? '', to: a.data.to ?? '' })
    case 'archived':
      return tr('карточка отправлена в архив')
    case 'restored':
      return tr('карточка возвращена из архива')
    case 'due_done':
      return tr('срок отмечен выполненным')
    case 'due_undone':
      return tr('снята отметка о выполнении срока')
  }
}

function ActivityBlock({
  card,
  comments,
  activity,
  people,
  mentionable,
  meId,
  run,
}: {
  card: BoardCard
  comments: CardComment[] | undefined
  activity: CardActivity[] | undefined
  people: Map<string, BoardPerson>
  mentionable: BoardPerson[]
  meId: string | undefined
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [details, setDetails] = useState(true)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const me = meId ? people.get(meId) : undefined
  const everyone = useMemo(() => [...people.values()], [people])

  const feed = useMemo(() => {
    const rows: ({ type: 'comment'; at: string; c: CardComment } | { type: 'activity'; at: string; a: CardActivity })[] = [
      ...(comments ?? []).map((c) => ({ type: 'comment' as const, at: c.created_at, c })),
      ...(details ? (activity ?? []) : []).map((a) => ({ type: 'activity' as const, at: a.created_at, a })),
    ]
    return rows.sort((x, y) => y.at.localeCompare(x.at))
  }, [comments, activity, details])

  const submit = async () => {
    if (!draft.trim()) return
    const body = draft
    setDraft('')
    setFocused(false)
    await run(() => addComment(card, body))
  }

  return (
    <Section
      icon={<ListIcon />}
      title={tr('Комментарии и события')}
      actions={
        <Button type="button" size="sm" variant="secondary" onClick={() => setDetails((v) => !v)}>
          {details ? tr('Скрыть подробности') : tr('Показать подробности')}
        </Button>
      }
    >
      <div className="-ml-11 flex gap-3">
        <UserAvatar name={me?.full_name ?? '?'} path={me?.avatar_path} className="size-8 text-xs" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <MentionTextarea
            value={draft}
            onValueChange={setDraft}
            people={mentionable}
            rows={focused || draft ? 3 : 1}
            maxLength={10000}
            onFocus={() => setFocused(true)}
            onBlur={() => !draft && setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
            placeholder={mentionable.length ? tr('Напишите комментарий… @ — упомянуть коллегу') : tr('Напишите комментарий…')}
            aria-label={tr('Комментарий')}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {(focused || draft) && (
            <div>
              <Button type="button" size="sm" disabled={!draft.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()}>
                {tr('Сохранить')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ul className="-ml-11 mt-4 flex flex-col gap-4">
        {feed.map((row) =>
          row.type === 'comment' ? (
            <CommentRow key={row.c.id} c={row.c} people={people} everyone={everyone} mentionable={mentionable} mine={row.c.author_id === meId} run={run} />
          ) : (
            <li key={row.a.id} className="flex gap-3">
              <UserAvatar name={people.get(row.a.actor_id ?? '')?.full_name ?? '?'} path={people.get(row.a.actor_id ?? '')?.avatar_path} className="size-8 text-xs" />
              <div className="min-w-0 flex-1 pt-0.5 text-sm">
                <span className="font-semibold">{people.get(row.a.actor_id ?? '')?.full_name ?? tr('Кто-то')}</span> {activityText(row.a)}
                <div className="text-xs text-muted-foreground">{timeFmt().format(new Date(row.a.created_at))}</div>
              </div>
            </li>
          ),
        )}
      </ul>
    </Section>
  )
}

function CommentRow({
  c,
  people,
  everyone,
  mentionable,
  mine,
  run,
}: {
  c: CardComment
  people: Map<string, BoardPerson>
  everyone: BoardPerson[]
  mentionable: BoardPerson[]
  mine: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(c.body)
  const author = people.get(c.author_id ?? '')
  return (
    <li className="flex gap-3">
      <UserAvatar name={author?.full_name ?? '?'} path={author?.avatar_path} className="size-8 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{author?.full_name ?? tr('Удалённый пользователь')}</span>
          <span className="text-xs text-muted-foreground">
            {timeFmt().format(new Date(c.created_at))}
            {c.edited_at && ` · ${tr('изменён')}`}
          </span>
        </div>
        {editing ? (
          <div className="mt-1 flex flex-col gap-2">
            <MentionTextarea
              autoFocus
              value={v}
              onValueChange={setV}
              people={mentionable}
              rows={3}
              maxLength={10000}
              aria-label={tr('Комментарий')}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!v.trim()}
                onClick={() => {
                  setEditing(false)
                  void run(() => editComment(c.id, v))
                }}
              >
                {tr('Сохранить')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setV(c.body)
                  setEditing(false)
                }}
              >
                {tr('Отмена')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-card px-3 py-2 text-sm shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]"><MentionText text={c.body} people={everyone} /></div>
        )}
        {mine && !editing && (
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setEditing(true)}>
              {tr('Изменить')}
            </button>
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => window.confirm(tr('Удалить комментарий? Это нельзя отменить.')) && void run(() => deleteComment(c.id))}
            >
              {tr('Удалить')}
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Переместить и копировать
// ---------------------------------------------------------------------------
function targetPosition(data: BoardData, listId: string, index: number, exceptId?: string): number {
  const cards = data.cards.filter((c) => c.list_id === listId && !c.archived_at && c.id !== exceptId).sort((a, b) => a.position - b.position)
  return positionBetween(cards[index - 1]?.position, cards[index]?.position)
}

function MovePopover({ data, card, trigger }: { data: BoardData; card: BoardCard; trigger: ReactNode }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const [listId, setListId] = useState(card.list_id)
  const inTarget = data.cards.filter((c) => c.list_id === listId && !c.archived_at && c.id !== card.id).sort((a, b) => a.position - b.position)
  const [index, setIndex] = useState<number | null>(null)
  // По умолчанию — текущее место карточки (в своей колонке) или конец другой колонки
  const idx = index ?? (listId === card.list_id ? inTarget.filter((c) => c.position < card.position).length : inTarget.length)

  return (
    <PickerPopover
      trigger={trigger}
      title={tr('Перемещение карточки')}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setListId(card.list_id)
          setIndex(null)
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Колонка')}
          <select
            value={listId}
            onChange={(e) => {
              setListId(e.target.value)
              setIndex(null)
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
                {l.id === card.list_id ? ` (${tr('текущая')})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Позиция')}
          <select value={idx} onChange={(e) => setIndex(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {Array.from({ length: inTarget.length + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          onClick={async () => {
            const position = targetPosition(data, listId, idx, card.id)
            setOpen(false)
            try {
              await updateCard(card.id, { list_id: listId, position })
            } catch {
              fail()
            }
            await refreshBoard(qc, data.board.id, card.id)
          }}
        >
          {tr('Переместить')}
        </Button>
      </div>
    </PickerPopover>
  )
}

function CopyPopover({ data, card, trigger }: { data: BoardData; card: BoardCard; trigger: ReactNode }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const [title, setTitle] = useState(card.title)
  const [listId, setListId] = useState(card.list_id)
  const [keep, setKeep] = useState({ checklists: true, labels: true, members: true })
  const [busy, setBusy] = useState(false)
  const box = (key: keyof typeof keep, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={keep[key]} onChange={(e) => setKeep((k) => ({ ...k, [key]: e.target.checked }))} className="size-4 accent-primary" />
      {label}
    </label>
  )
  return (
    <PickerPopover
      trigger={trigger}
      title={tr('Копирование карточки')}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setTitle(card.title)
          setListId(card.list_id)
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Название')}
          <textarea value={title} maxLength={500} rows={2} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">{tr('Сохранить')}</span>
          {box('checklists', tr('Чек-листы'))}
          {box('labels', tr('Метки'))}
          {box('members', tr('Участников'))}
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {tr('Колонка')}
          <select value={listId} onChange={(e) => setListId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={busy || !title.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              const count = data.cards.filter((c) => c.list_id === listId && !c.archived_at).length
              await copyCard({ cardId: card.id, listId, title, position: targetPosition(data, listId, count), ...keep })
              await refreshBoard(qc, data.board.id)
              setOpen(false)
              toast.success(tr('Копия карточки создана'))
            } catch {
              fail()
            } finally {
              setBusy(false)
            }
          }}
        >
          {tr('Создать карточку')}
        </Button>
      </div>
    </PickerPopover>
  )
}
