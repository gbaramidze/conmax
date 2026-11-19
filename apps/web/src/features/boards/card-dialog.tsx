import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  AlignLeft,
  Archive,
  ArrowRight,
  Check,
  CircleCheck,
  CheckSquare,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File as FileIcon,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ImageOff,
  KanbanSquare,
  Link2,
  List as ListIcon,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { formatBytes, openFile, signedUrlQuery } from '@/features/activity/api'
import { UserAvatar } from '@/features/profile/avatar'
import { myPermissionsQuery } from '@/features/projects/api'
import {
  addComment,
  attachCard,
  attachDocument,
  attachProjectFile,
  attachUpload,
  canInviteTo,
  cardDetailQuery,
  copyCard,
  createChecklist,
  createChecklistItem,
  deleteAttachment,
  deleteCard,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  downloadFile,
  dueState,
  editComment,
  LABEL_STYLE,
  linkableCardsQuery,
  positionBetween,
  POS_STEP,
  refreshBoard,
  renameAttachment,
  toggleCardLabel,
  toggleCardMember,
  toggleCardViewer,
  updateCard,
  updateChecklist,
  updateChecklistItem,
  type BoardCard,
  type BoardData,
  type CardActivity,
  type CardAttachment,
  type CatalogItem,
  type CardComment,
  type CardPatch,
  type CommentAttachment,
  type Checklist,
} from '@/features/boards/api'
import { InlineInput } from '@/features/boards/board-canvas'
import { CoverPhoto, DUE_CLASS, dueTitle, formatDue, formatDay, LabelPill } from '@/features/boards/card-face'
import { MentionText, MentionTextarea } from '@/features/boards/mention-textarea'
import { AutomationBadge } from '@/features/boards/automations'
import { ProjectFilePicker } from '@/features/boards/project-file-picker'
import { cardGuestCandidates, cardGuests, cardMemberCandidates, iAmBoardMember, type BoardPerson } from '@/features/boards/people'
import { CoverPicker, DatesPicker, LabelsPicker, PeoplePicker, PickerPopover, VisibilityPicker } from '@/features/boards/pickers'
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
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
        aria-describedby={undefined}
        showCloseButton={!card}
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
  // Кого можно позвать в карточку и упомянуть через «@»: в скрытую карточку не автор зовёт только тех, кто её уже видит
  const inviteable = useMemo(() => canInviteTo(card, candidates, meId), [card, candidates, meId])
  // Люди проекта не с доски: позвать их можно гостем — после предупреждения (видят только свои колонки и карточки)
  const guests = useMemo(
    () => canInviteTo(card, cardGuests(card, candidates, cardGuestCandidates(data, people, projectIds, meId), people), meId),
    [card, candidates, data, people, projectIds, meId],
  )
  const mentionable = useMemo(() => inviteable.filter((p) => p.id !== meId), [inviteable, meId])
  const isShared = data.board.kind === 'shared'
  const isAuthor = !!meId && meId === card.created_by
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
  const { data: perms } = useQuery(myPermissionsQuery(data.board.project_id))
  const canManage = data.board.kind === 'personal' || (iAmBoardMember(data, people, projectIds, meId) && !!perms?.includes('board.manage'))
  const [descEditing, setDescEditing] = useState(false)
  const [commentSeed, setCommentSeed] = useState<{ attachment: CardAttachment; n: number } | null>(null)
  const actionBtn = 'h-8 gap-1.5 px-2.5 font-medium'

  const labelsPicker = (trigger: ReactNode) => (
    <LabelsPicker boardId={boardId} labels={data.labels} selected={labelsSet} onToggle={(id, on) => run(() => toggleCardLabel(card, id, on))} trigger={trigger} />
  )
  const membersPicker = (trigger: ReactNode) => (
    <PeoplePicker people={inviteable} guests={guests} selected={membersSet} onToggle={(id, on) => run(() => toggleCardMember(card, id, on))} trigger={trigger} />
  )
  const datesPicker = (trigger: ReactNode) => (
    <DatesPicker startDate={card.start_date} dueAt={card.due_at} onSave={(v) => patch({ ...v, due_done: v.due_at ? card.due_done : false })} trigger={trigger} />
  )
  const attachPicker = (trigger: ReactNode) => (
    <AttachmentPicker data={data} card={card} attached={detail?.attachments ?? []} onDone={refresh} trigger={trigger} />
  )

  return (
    <div className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col">
      {card.cover_attachment_id && card.cover_image ? (
        <div className="flex h-36 shrink-0 justify-center bg-muted sm:h-48">
          <CoverPhoto image={card.cover_image} full className="h-full w-auto max-w-full object-contain" />
        </div>
      ) : (
        card.cover && <div className="h-20 shrink-0 sm:h-24" style={{ background: LABEL_STYLE[card.cover].bg }} aria-hidden />
      )}

      {/* Шапка: колонка (перенос), обложка, меню, закрыть */}
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 sm:px-5">
        <MovePopover
          data={data}
          card={card}
          trigger={
            <Button type="button" size="sm" variant="secondary" className="h-7 min-w-0 max-w-[60%] gap-1 px-2 font-medium" aria-label={tr('Колонка карточки: {{list}}. Переместить', { list: list?.title ?? '' })}>
              <span className="truncate">{list?.title}</span>
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          }
        />
        <div className="ml-auto flex items-center gap-0.5">
          <CoverPicker
            value={card.cover}
            hasPhoto={!!card.cover_attachment_id}
            onChange={(c) => void patch(c ? { cover: c, cover_attachment_id: null } : { cover: null, cover_attachment_id: null })}
            trigger={
              <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Обложка')} title={tr('Обложка')}>
                <ImageIcon />
              </Button>
            }
          />
          <CardMenu data={data} card={card} patch={patch} onClose={onClose} />
          <DialogClose asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Закрыть')}>
              <X />
            </Button>
          </DialogClose>
        </div>
      </header>

      {card.archived_at && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 bg-[#f5cd47]/80 px-5 py-2.5 text-sm text-[#533f04]">
          <Archive className="size-4" /> {tr('Карточка в архиве.')}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:overflow-hidden">
        {/* Левая часть: всё о карточке */}
        <div className="flex min-w-0 flex-col gap-6 px-4 py-5 sm:px-6 md:overflow-y-auto">
          <div className="flex items-start gap-2.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={card.completed}
              aria-label={card.completed ? tr('Снять отметку «выполнено»') : tr('Отметить карточку выполненной')}
              title={card.completed ? tr('Снять отметку «выполнено»') : tr('Отметить карточку выполненной')}
              onClick={() => void patch({ completed: !card.completed })}
              className={cn(
                'mt-2 grid size-5 shrink-0 place-items-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                card.completed ? 'border-[#1f845a] bg-[#1f845a] text-white' : 'border-muted-foreground/70 hover:border-foreground',
              )}
            >
              {card.completed && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
            </button>
            <div className="min-w-0 flex-1">
              <DialogTitle asChild>
                <TitleEditor key={card.title} value={card.title} onSave={(title) => patch({ title })} />
              </DialogTitle>
              <DialogDescription className="sr-only">{tr('Карточка в колонке «{{list}}»', { list: list?.title ?? '' })}</DialogDescription>
              {isShared && <VisibilityLine card={card} candidates={candidates} isAuthor={isAuthor} membersSet={membersSet} patch={patch} run={run} />}
            </div>
          </div>

          {/* Кнопки «добавить на карточку» */}
          <div className="-mt-2 flex flex-wrap gap-2 sm:pl-8">
            {labelsPicker(
              <Button type="button" variant="outline" size="sm" className={actionBtn}>
                <Tag /> {tr('Метки')}
              </Button>,
            )}
            {datesPicker(
              <Button type="button" variant="outline" size="sm" className={actionBtn}>
                <Clock /> {tr('Даты')}
              </Button>,
            )}
            <ChecklistAdd
              onAdd={(title) => run(() => createChecklist(card, title, Math.max(0, ...(detail?.checklists ?? []).map((c) => c.position)) + POS_STEP))}
              trigger={
                <Button type="button" variant="outline" size="sm" className={actionBtn}>
                  <CheckSquare /> {tr('Чек-лист')}
                </Button>
              }
            />
            {(isShared || !membersSet.size) &&
              membersPicker(
                <Button type="button" variant="outline" size="sm" className={actionBtn}>
                  <UserRound /> {tr('Участники')}
                </Button>,
              )}
            {attachPicker(
              <Button type="button" variant="outline" size="sm" className={actionBtn}>
                <Paperclip /> {tr('Вложение')}
              </Button>,
            )}
          </div>

          {/* Участники, метки, даты */}
          {(cardLabels.length > 0 || card.member_ids.length > 0 || card.due_at || card.start_date) && (
            <div className="flex flex-wrap gap-x-6 gap-y-4 sm:pl-8">
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
                  <div className="flex min-w-0 items-center gap-2">
                    {card.due_at && (
                      <input
                        type="checkbox"
                        checked={card.due_done}
                        onChange={(e) => void patch({ due_done: e.target.checked })}
                        aria-label={tr('Срок выполнен')}
                        className="size-4 shrink-0 accent-[#1f845a]"
                      />
                    )}
                    {datesPicker(
                      <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 min-w-0 shrink flex-wrap justify-start whitespace-normal py-1 text-left font-normal">
                        {card.start_date && formatDay(card.start_date)}
                        {card.start_date && card.due_at && ' – '}
                        {card.due_at && formatDue(card.due_at)}
                        {due && due !== 'later' && <span className={cn('ml-1 rounded px-1 text-xs font-medium', DUE_CLASS[due])}>{dueTitle(due)}</span>}
                        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
                      </Button>,
                    )}
                  </div>
                </Field>
              )}
            </div>
          )}

          {/* Описание */}
          <Section
            icon={<AlignLeft />}
            title={tr('Описание')}
            actions={
              !descEditing && !!detail?.description.trim() ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => setDescEditing(true)}>
                  {tr('Изменить')}
                </Button>
              ) : undefined
            }
          >
            {detail ? (
              <DescriptionEditor
                key={detail.description}
                value={detail.description}
                people={candidates}
                mentionable={mentionable}
                editing={descEditing}
                onEditingChange={setDescEditing}
                onSave={(description) => patch({ description }, false)}
              />
            ) : (
              <div className="h-14 animate-pulse rounded-md bg-muted" />
            )}
          </Section>

          {/* Вложения */}
          {!!detail?.attachments.length && (
            <AttachmentsSection
              card={card}
              attachments={detail.attachments}
              canManage={canManage}
              meId={meId}
              run={run}
              patch={patch}
              picker={attachPicker}
              onComment={(attachment) => setCommentSeed((s) => ({ attachment, n: (s?.n ?? 0) + 1 }))}
            />
          )}

          {/* Чек-листы */}
          {detail?.checklists.map((cl) => (
            <ChecklistBlock key={cl.id} checklist={cl} card={card} run={run} />
          ))}
        </div>

        {/* Правая часть: комментарии и история */}
        <aside className="flex min-w-0 flex-col border-t bg-muted/50 px-4 py-5 sm:px-5 md:overflow-y-auto md:border-l md:border-t-0">
          <ActivityBlock card={card} comments={detail?.comments} activity={detail?.activity} people={people} mentionable={mentionable} meId={meId} run={run} seed={commentSeed} />
        </aside>
      </div>
    </div>
  )
}

/** Меню «…» в шапке карточки: переместить, копировать, ссылка, архив, удалить. */
function CardMenu({ data, card, patch, onClose }: { data: BoardData; card: BoardCard; patch: (p: CardPatch) => Promise<void>; onClose: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const item = 'h-8 w-full justify-start gap-2 px-2 font-normal'
  return (
    <PickerPopover
      title={tr('Действия')}
      open={open}
      onOpenChange={setOpen}
      className="w-[240px]"
      trigger={
        <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Действия с карточкой')} title={tr('Действия')}>
          <MoreHorizontal />
        </Button>
      }
    >
      <div className="flex flex-col">
        <MovePopover
          data={data}
          card={card}
          trigger={
            <Button type="button" variant="ghost" className={item}>
              <ArrowRight /> {tr('Переместить')}
            </Button>
          }
        />
        <CopyPopover
          data={data}
          card={card}
          trigger={
            <Button type="button" variant="ghost" className={item}>
              <Copy /> {tr('Копировать')}
            </Button>
          }
        />
        <Button
          type="button"
          variant="ghost"
          className={item}
          onClick={() => {
            setOpen(false)
            void navigator.clipboard?.writeText(window.location.href).then(
              () => toast.success(tr('Ссылка на карточку скопирована')),
              () => toast.error(tr('Не удалось скопировать ссылку.')),
            )
          }}
        >
          <Link2 /> {tr('Ссылка')}
        </Button>
        <div className="my-1 border-t" />
        {card.archived_at ? (
          <>
            <Button type="button" variant="ghost" className={item} onClick={() => void patch({ archived_at: null }).then(() => setOpen(false))}>
              <RotateCcw /> {tr('Вернуть из архива')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={cn(item, 'text-destructive hover:text-destructive')}
              onClick={async () => {
                if (!window.confirm(tr('Удалить карточку «{{title}}»? Все её данные пропадут. Это нельзя отменить.', { title: card.title }))) return
                try {
                  await deleteCard(card.id)
                  onClose()
                  await refreshBoard(qc, data.board.id)
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
          <Button type="button" variant="ghost" className={item} onClick={() => void patch({ archived_at: new Date().toISOString() }).then(() => setOpen(false))}>
            <Archive /> {tr('Архивировать')}
          </Button>
        )}
      </div>
    </PickerPopover>
  )
}

// ---------------------------------------------------------------------------
// Вложения: свой файл или документ проекта
// ---------------------------------------------------------------------------
function AttachmentPicker({
  data,
  card,
  attached,
  onDone,
  trigger,
}: {
  data: BoardData
  card: BoardCard
  attached: CardAttachment[]
  onDone: () => Promise<void>
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'main' | 'card'>('main')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // что уже прикреплено — в окне выбора отмечено и недоступно
  const taken = useMemo(
    () =>
      new Set(
        attached
          .map((a) => (a.document_id ? `doc:${a.document_id}` : a.file ? `file:${a.file.id}` : a.linked_card_id ? `card:${a.linked_card_id}` : ''))
          .filter(Boolean),
      ),
    [attached],
  )

  const upload = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    const failed: string[] = []
    for (const f of files) {
      try {
        await attachUpload(card, data.board.project_id, data.board.tenant_id, f)
      } catch {
        failed.push(f.name)
      }
    }
    setBusy(false)
    await onDone()
    if (failed.length) toast.error(tr('Не удалось загрузить: {{names}}', { names: failed.join(', ') }))
    else setOpen(false)
  }

  const attachPicked = async (items: CatalogItem[]) => {
    const failed: string[] = []
    for (const i of items) {
      try {
        if (i.document_id) await attachDocument(card, i.document_id, i.title)
        else if (i.file_id) await attachProjectFile(card, i.file_id, i.title)
      } catch {
        failed.push(i.title)
      }
    }
    await onDone()
    if (failed.length) toast.error(tr('Не удалось прикрепить: {{names}}', { names: failed.join(', ') }))
    else setCatalogOpen(false)
  }

  return (
    <>
      <PickerPopover
        title={view === 'card' ? tr('Прикрепить карточку') : tr('Вложение')}
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setView('main')
        }}
        onBack={view === 'card' ? () => setView('main') : undefined}
        className={view === 'card' ? 'w-[340px]' : 'w-[300px]'}
        trigger={trigger}
      >
        {view === 'card' ? (
          <CardLinkList
            data={data}
            card={card}
            taken={taken}
            onPick={async (id) => {
              try {
                await attachCard(card, id)
                setOpen(false)
                setView('main')
              } catch {
                toast.error(tr('Не удалось прикрепить карточку.'))
              } finally {
                await onDone()
              }
            }}
          />
        ) : (
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void upload(files)
            }}
          />
          <Button type="button" variant="secondary" className="w-full justify-start" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload /> {busy ? tr('Загружаем…') : tr('Загрузить с компьютера')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              setCatalogOpen(true)
            }}
          >
            <FolderOpen /> {tr('Выбрать из проекта')}
          </Button>
          <p className="px-1 text-xs text-muted-foreground">{tr('Документы, чертежи и схемы, мебель, рендеры и фото проекта.')}</p>
          <Button type="button" variant="secondary" className="w-full justify-start" disabled={busy} onClick={() => setView('card')}>
            <KanbanSquare /> {tr('Карточка')}
          </Button>
          <p className="px-1 text-xs text-muted-foreground">{tr('Ссылка на другую карточку этой или другой доски проекта.')}</p>
        </div>
        )}
      </PickerPopover>
      <ProjectFilePicker projectId={data.board.project_id} open={catalogOpen} onOpenChange={setCatalogOpen} taken={taken} onPick={attachPicked} />
    </>
  )
}

function AttachmentsSection({
  card,
  attachments,
  canManage,
  meId,
  run,
  patch,
  picker,
  onComment,
}: {
  card: BoardCard
  attachments: CardAttachment[]
  canManage: boolean
  meId: string | undefined
  run: (fn: () => Promise<unknown>) => Promise<void>
  patch: (p: CardPatch) => Promise<void>
  picker: (trigger: ReactNode) => ReactNode
  /** «Комментировать»: привязать новый комментарий к вложению */
  onComment: (a: CardAttachment) => void
}) {
  return (
    <Section
      icon={<Paperclip />}
      title={tr('Вложения')}
      actions={picker(
        <Button type="button" size="sm" variant="secondary">
          {tr('Добавить')}
        </Button>,
      )}
    >
      <ul className="flex flex-col gap-2">
        {attachments.map((a) => (
          <AttachmentRow key={a.id} a={a} card={card} canEdit={canManage || a.created_by === meId} run={run} patch={patch} onComment={onComment} />
        ))}
      </ul>
    </Section>
  )
}

function AttachmentRow({
  a,
  card,
  canEdit,
  run,
  patch,
  onComment,
}: {
  a: CardAttachment
  card: BoardCard
  canEdit: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
  patch: (p: CardPatch) => Promise<void>
  onComment: (a: CardAttachment) => void
}) {
  const { code } = useParams({ strict: false }) as { code?: string }
  const [renaming, setRenaming] = useState(false)
  const isImage = !!a.file && a.file.mime.startsWith('image/')
  const isCover = card.cover_attachment_id === a.id
  const linked = a.linked
  const title = a.linked_card_id ? (linked?.title ?? tr('Нет доступа к карточке')) : a.name
  const openFileNow = () => void openFile(a.file!.storage_key).catch(() => toast.error(tr('Не удалось открыть файл.')))

  const meta = [
    a.linked_card_id
      ? linked?.board
        ? tr('Карточка · доска «{{board}}»', { board: linked.board.title })
        : tr('Карточка')
      : a.document_id
        ? tr('Документ проекта')
        : a.file
          ? formatBytes(a.file.size_bytes)
          : null,
    isCover ? tr('Обложка') : null,
    timeFmt().format(new Date(a.created_at)),
  ]
    .filter(Boolean)
    .join(' · ')

  const cardLink = (children: ReactNode, className: string) =>
    linked?.board && code ? (
      <Link to="/projects/$code/boards" params={{ code }} search={{ kind: linked.board.kind, board: linked.board.id, card: linked.id }} className={className}>
        {children}
      </Link>
    ) : (
      <span className={className}>{children}</span>
    )

  const nameEl = renaming ? (
    <InlineInput
      initial={a.name}
      ariaLabel={tr('Название вложения')}
      maxLength={300}
      className="h-8 w-full font-medium"
      onDone={(v) => {
        setRenaming(false)
        if (v && v !== a.name) void run(() => renameAttachment(a.id, v))
      }}
    />
  ) : a.linked_card_id ? (
    cardLink(
      <>
        {linked?.completed && <CircleCheck className="mr-1 inline size-4 fill-[#1f845a] align-[-3px] text-white" aria-hidden />}
        {title}
      </>,
      cn('block truncate font-medium', linked ? 'hover:underline' : 'italic text-muted-foreground'),
    )
  ) : a.document_id && code ? (
    <Link to="/projects/$code/document/$id" params={{ code, id: a.document_id }} className="block truncate font-medium hover:underline">
      {a.name}
    </Link>
  ) : a.file ? (
    <button type="button" onClick={openFileNow} className="block max-w-full truncate text-left font-medium hover:underline">
      {a.name}
    </button>
  ) : (
    <span className="block truncate font-medium">{a.name}</span>
  )

  return (
    <li className="flex items-center gap-3">
      {a.linked_card_id ? (
        cardLink(<KanbanSquare className="size-5" aria-hidden />, 'grid h-12 w-16 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground')
      ) : (
        <AttachmentThumb a={a} />
      )}
      <div className="min-w-0 flex-1 text-sm">
        {nameEl}
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Действия с вложением «{{name}}»', { name: title })}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        {/* фокус не возвращаем на «…»: иначе он уходит из поля переименования и комментария, и они сразу закрываются */}
        <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          {a.file && canEdit && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
              <Pencil /> {tr('Изменить')}
            </DropdownMenuItem>
          )}
          {a.linked_card_id && linked && (
            <DropdownMenuItem asChild>
              {cardLink(
                <>
                  <ExternalLink /> {tr('Открыть карточку')}
                </>,
                '',
              )}
            </DropdownMenuItem>
          )}
          {a.document_id && code && (
            <DropdownMenuItem asChild>
              <Link to="/projects/$code/document/$id" params={{ code, id: a.document_id }}>
                <ExternalLink /> {tr('Открыть')}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onComment(a)}>
            <MessageSquare /> {tr('Комментировать')}
          </DropdownMenuItem>
          {a.file && (
            <DropdownMenuItem onSelect={() => void downloadFile(a.file!.storage_key, a.name).catch(() => toast.error(tr('Не удалось скачать файл.')))}>
              <Download /> {tr('Скачать')}
            </DropdownMenuItem>
          )}
          {isImage &&
            (isCover ? (
              <DropdownMenuItem onSelect={() => void patch({ cover_attachment_id: null })}>
                <ImageOff /> {tr('Убрать обложку')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void patch({ cover_attachment_id: a.id, cover: null })}>
                <ImageIcon /> {tr('Сделать обложкой')}
              </DropdownMenuItem>
            ))}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => window.confirm(tr('Убрать вложение «{{name}}» из карточки?', { name: title })) && void run(() => deleteAttachment(a.id))}
              >
                <Trash2 /> {tr('Удалить')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function AttachmentThumb({ a }: { a: CardAttachment }) {
  const isImage = !!a.file && a.file.mime.startsWith('image/')
  const { data: url } = useQuery({ ...signedUrlQuery(a.file?.storage_key ?? ''), enabled: isImage })
  const box = 'grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground'
  if (isImage && url) {
    return (
      <button type="button" className={box} onClick={() => window.open(url, '_blank', 'noopener')} aria-label={tr('Открыть {{name}}', { name: a.name })}>
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      </button>
    )
  }
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(a.file?.name ?? '')?.[1]?.toUpperCase()
  return (
    <span className={box} aria-hidden>
      {a.document_id ? <FileText className="size-5" /> : ext ? <span className="text-xs font-semibold">{ext}</span> : <FileIcon className="size-5" />}
    </span>
  )
}

/** Плашка-ссылка на вложение (в комментарии и в поле ввода): миниатюра или значок и название; открывает файл, документ или карточку */
function AttachmentRef({ a }: { a: CommentAttachment }) {
  const { code } = useParams({ strict: false }) as { code?: string }
  const isImage = !!a.file && a.file.mime.startsWith('image/')
  const { data: url } = useQuery({ ...signedUrlQuery(a.file?.storage_key ?? ''), enabled: isImage })
  const title = a.linked_card_id ? (a.linked?.title ?? tr('Нет доступа к карточке')) : a.name
  const cls =
    'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-0.5 pr-2 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  const inner = (
    <>
      <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded bg-muted text-muted-foreground [&_svg]:size-3.5">
        {isImage && url ? <img src={url} alt="" className="size-full object-cover" /> : a.linked_card_id ? <KanbanSquare /> : a.document_id ? <FileText /> : <Paperclip />}
      </span>
      <span className="truncate">{title}</span>
    </>
  )
  if (a.linked_card_id && a.linked?.board && code) {
    return (
      <Link to="/projects/$code/boards" params={{ code }} search={{ kind: a.linked.board.kind, board: a.linked.board.id, card: a.linked.id }} className={cls}>
        {inner}
      </Link>
    )
  }
  if (a.document_id && code) {
    return (
      <Link to="/projects/$code/document/$id" params={{ code, id: a.document_id }} className={cls}>
        {inner}
      </Link>
    )
  }
  if (a.file) {
    const key = a.file.storage_key
    return (
      <button type="button" className={cls} title={tr('Открыть {{name}}', { name: title })} onClick={() => void openFile(key).catch(() => toast.error(tr('Не удалось открыть файл.')))}>
        {inner}
      </button>
    )
  }
  return <span className={cn(cls, 'italic text-muted-foreground')}>{inner}</span>
}

/** Выбор карточки для вложения: любые видимые мне карточки досок проекта */
function CardLinkList({ data, card, taken, onPick }: { data: BoardData; card: BoardCard; taken: Set<string>; onPick: (id: string) => Promise<void> }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { data: cards, isPending } = useQuery(linkableCardsQuery(data.board.project_id, q))
  const shown = (cards ?? []).filter((c) => c.id !== card.id)
  return (
    <div className="flex flex-col gap-2">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск карточек проекта')} aria-label={tr('Поиск карточек проекта')} className="h-9" />
      <ul className="flex max-h-72 flex-col overflow-y-auto">
        {shown.map((c) => {
          const already = taken.has(`card:${c.id}`)
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={already || !!busy}
                onClick={async () => {
                  setBusy(c.id)
                  try {
                    await onPick(c.id)
                  } finally {
                    setBusy(null)
                  }
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none enabled:hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <KanbanSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.board.title}
                    {c.list ? ` · ${c.list.title}` : ''}
                  </span>
                </span>
                {already && <Check className="mt-0.5 size-4 text-primary" aria-label={tr('Уже прикреплена')} />}
              </button>
            </li>
          )
        })}
        {isPending && <li className="h-10 animate-pulse rounded-md bg-muted" />}
        {!isPending && shown.length === 0 && <li className="py-2 text-center text-sm text-muted-foreground">{tr('Карточек не нашли.')}</li>}
      </ul>
      <p className="px-1 text-xs text-muted-foreground">{tr('Видны только карточки, которые видите вы. Кто связанную карточку не видит, увидит вместо неё «нет доступа».')}</p>
    </div>
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
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
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
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    // Окно открывается с анимацией и меняет ширину — пересчитываем высоту, чтобы длинное название не обрезалось
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
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
      className="w-full resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-0.5 text-2xl font-semibold leading-8 outline-none focus:bg-background focus:ring-2 focus:ring-primary"
    />
  )
}

function DescriptionEditor({
  value,
  people,
  mentionable,
  editing,
  onEditingChange: setEditing,
  onSave,
}: {
  value: string
  people: BoardPerson[]
  mentionable: BoardPerson[]
  editing: boolean
  onEditingChange: (v: boolean) => void
  onSave: (v: string) => Promise<void>
}) {
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
    case 'attached':
      if (a.data.card) return tr('прикреплена карточка')
      return a.data.document ? tr('прикреплён документ «{{name}}»', { name: a.data.name ?? '' }) : tr('прикреплён файл «{{name}}»', { name: a.data.name ?? '' })
    case 'due_done':
      return tr('срок отмечен выполненным')
    case 'due_undone':
      return tr('снята отметка о выполнении срока')
    case 'visibility':
      return a.data.visibility === 'selected' ? tr('карточку видят только выбранные') : tr('карточку видят все участники доски')
  }
}

/** Под названием: кто видит карточку общей доски. Автор меняет видимость здесь же. */
function VisibilityLine({
  card,
  candidates,
  isAuthor,
  membersSet,
  patch,
  run,
}: {
  card: BoardCard
  candidates: BoardPerson[]
  isAuthor: boolean
  membersSet: Set<string>
  patch: (p: CardPatch) => Promise<void>
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const hidden = card.visibility === 'selected'
  const seers = new Set([card.created_by, ...card.member_ids, ...card.viewer_ids].filter(Boolean)).size
  const content = (
    <>
      {hidden ? <Lock className="size-3.5 shrink-0" aria-hidden /> : <Eye className="size-3.5 shrink-0" aria-hidden />}
      <span>{hidden ? tr('Видят только выбранные ({{n}})', { n: seers }) : tr('Видят все участники доски')}</span>
    </>
  )
  if (!isAuthor) return <p className="mt-1 flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground">{content}</p>
  return (
    <VisibilityPicker
      value={card.visibility}
      people={candidates.filter((p) => p.id !== card.created_by)}
      viewers={new Set(card.viewer_ids)}
      members={membersSet}
      onChange={(visibility) => patch({ visibility })}
      onToggleViewer={(id, on) => run(() => toggleCardViewer(card, id, on))}
      trigger={
        <button
          type="button"
          title={tr('Кто видит карточку')}
          className={cn(
            'mt-1 flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            hidden ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {content}
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      }
    />
  )
}

function ActivityBlock({
  card,
  comments,
  activity,
  people,
  mentionable,
  meId,
  run,
  seed,
}: {
  card: BoardCard
  comments: CardComment[] | undefined
  activity: CardActivity[] | undefined
  people: Map<string, BoardPerson>
  mentionable: BoardPerson[]
  meId: string | undefined
  run: (fn: () => Promise<unknown>) => Promise<void>
  /** «Комментировать» у вложения: следующий комментарий — к этому вложению */
  seed: { attachment: CardAttachment; n: number } | null
}) {
  const [details, setDetails] = useState(true)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [attachTo, setAttachTo] = useState<CommentAttachment | null>(null)

  useEffect(() => {
    if (!seed) return
    setAttachTo(seed.attachment)
    setFocused(true)
    // поле комментария — после закрытия меню вложения
    setTimeout(() => {
      const el = document.getElementById('card-comment-input') as HTMLTextAreaElement | null
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n])
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
    const attachmentId = attachTo?.id ?? null
    setDraft('')
    setAttachTo(null)
    setFocused(false)
    await run(() => addComment(card, body, attachmentId))
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
          {attachTo && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {tr('Комментарий к вложению')}
              <AttachmentRef a={attachTo} />
              <Button type="button" size="icon-xs" variant="ghost" aria-label={tr('Не привязывать к вложению')} onClick={() => setAttachTo(null)}>
                <X />
              </Button>
            </div>
          )}
          <MentionTextarea
            value={draft}
            onValueChange={setDraft}
            people={mentionable}
            rows={focused || draft ? 3 : 1}
            maxLength={10000}
            onFocus={() => setFocused(true)}
            onBlur={() => !draft && !attachTo && setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
            placeholder={mentionable.length ? tr('Напишите комментарий… @ — упомянуть коллегу') : tr('Напишите комментарий…')}
            aria-label={tr('Комментарий')}
            id="card-comment-input"
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {(focused || draft || attachTo) && (
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
              {row.a.data.auto ? (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f5cd47]/25" aria-hidden>
                <Zap className="size-4 text-[#b38600]" />
              </span>
              ) : (
                <UserAvatar name={people.get(row.a.actor_id ?? '')?.full_name ?? '?'} path={people.get(row.a.actor_id ?? '')?.avatar_path} className="size-8 text-xs" />
              )}
              <div className="min-w-0 flex-1 pt-0.5 text-sm">
                {row.a.data.auto ? <AutomationBadge /> : <span className="font-semibold">{people.get(row.a.actor_id ?? '')?.full_name ?? tr('Кто-то')}</span>}{' '}
                {activityText(row.a)}
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
      {c.is_system ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f5cd47]/25" aria-hidden>
                <Zap className="size-4 text-[#b38600]" />
              </span>
      ) : (
        <UserAvatar name={author?.full_name ?? '?'} path={author?.avatar_path} className="size-8 text-xs" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {c.is_system ? <AutomationBadge /> : <span className="font-semibold">{author?.full_name ?? tr('Удалённый пользователь')}</span>}
          <span className="text-xs text-muted-foreground">
            {timeFmt().format(new Date(c.created_at))}
            {c.edited_at && ` · ${tr('изменён')}`}
          </span>
        </div>
        {c.attachment && (
          <div className="mt-1">
            <AttachmentRef a={c.attachment} />
          </div>
        )}
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
