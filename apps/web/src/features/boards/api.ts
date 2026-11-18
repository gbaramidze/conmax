import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type React from 'react'
import { uploadProjectFile } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { uuid } from '@/lib/utils'

// Доски проекта в духе Trello: личные (видит только владелец) и общие (колонки задаёт человек с правом проекта `board.manage`).
// Таблицы и правила доступа — миграция 20261023000132_boards.sql.

export type BoardKind = 'personal' | 'shared'

export interface BoardSummary {
  id: string
  project_id: string
  kind: BoardKind
  title: string
  background: string
  /** Путь к своему фото фона в бакете `board-backgrounds`; цвет `background` остаётся запасным */
  background_image: string | null
  all_staff: boolean
  closed_at: string | null
  owner_id: string | null
  updated_at: string
  starred: boolean
}

export interface Board extends Omit<BoardSummary, 'starred'> {
  tenant_id: string
  description: string
  starred: boolean
}

export interface BoardList {
  id: string
  board_id: string
  title: string
  position: number
  archived_at: string | null
}

export interface BoardLabel {
  id: string
  board_id: string
  name: string
  color: LabelColor
  position: number
}

/** Кто видит карточку общей доски: все, кто видит доску, или только автор, участники карточки и выбранные автором */
export type CardVisibility = 'all' | 'selected'

export interface BoardCard {
  id: string
  board_id: string
  list_id: string
  title: string
  has_description: boolean
  position: number
  start_date: string | null
  due_at: string | null
  due_done: boolean
  cover: LabelColor | null
  archived_at: string | null
  created_at: string
  /** Кружок «выполнено» у названия */
  completed: boolean
  visibility: CardVisibility
  created_by: string | null
  label_ids: string[]
  member_ids: string[]
  /** Выбранные автором — видят скрытую карточку, не будучи её участниками */
  viewer_ids: string[]
  checklist_total: number
  checklist_done: number
  comment_count: number
  attachment_count: number
}

export interface BoardData {
  board: Board
  lists: BoardList[]
  labels: BoardLabel[]
  cards: BoardCard[]
  member_ids: string[]
}

// ---------------------------------------------------------------------------
// Цвета: фон доски и метки (палитра как в Trello)
// ---------------------------------------------------------------------------
export const BACKGROUNDS: Record<string, string> = {
  blue: '#0c66e4',
  sky: '#0b8eb0',
  green: '#1f845a',
  lime: '#4c6b1f',
  orange: '#c25100',
  red: '#c9372c',
  purple: '#6e5dc6',
  pink: '#ae4787',
  grey: '#626f86',
  ocean: 'linear-gradient(135deg, #0c66e4 0%, #09326c 100%)',
  sunset: 'linear-gradient(135deg, #e774bb 0%, #943d73 50%, #5e4db2 100%)',
  forest: 'linear-gradient(135deg, #4bce97 0%, #1f845a 50%, #164b35 100%)',
  dusk: 'linear-gradient(135deg, #f87168 0%, #c25100 100%)',
}
export const backgroundCss = (key: string) => BACKGROUNDS[key] ?? BACKGROUNDS.blue!

export type LabelColor = 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'lime' | 'pink' | 'black'
export const LABEL_COLORS: LabelColor[] = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black']
/** Фон метки и цвет текста на ней: подобраны так, чтобы надпись читалась в светлой и тёмной теме */
export const LABEL_STYLE: Record<LabelColor, { bg: string; fg: string }> = {
  green: { bg: '#4bce97', fg: '#164b35' },
  yellow: { bg: '#f5cd47', fg: '#533f04' },
  orange: { bg: '#fea362', fg: '#702e00' },
  red: { bg: '#f87168', fg: '#5d1f1a' },
  purple: { bg: '#9f8fef', fg: '#352c63' },
  blue: { bg: '#579dff', fg: '#09326c' },
  sky: { bg: '#6cc3e0', fg: '#164555' },
  lime: { bg: '#94c748', fg: '#37471f' },
  pink: { bg: '#e774bb', fg: '#50253f' },
  black: { bg: '#8590a2', fg: '#091e42' },
}
export const labelColorName = (c: LabelColor): string =>
  ({
    green: tr('зелёный'),
    yellow: tr('жёлтый'),
    orange: tr('оранжевый'),
    red: tr('красный'),
    purple: tr('фиолетовый'),
    blue: tr('синий'),
    sky: tr('голубой'),
    lime: tr('салатовый'),
    pink: tr('розовый'),
    black: tr('серый'),
  })[c]

// ---------------------------------------------------------------------------
// Порядок: дробная позиция между соседями
// ---------------------------------------------------------------------------
export const POS_STEP = 65536
export function positionBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return POS_STEP
  if (prev === undefined) return next! / 2
  if (next === undefined) return prev + POS_STEP
  return (prev + next) / 2
}

// ---------------------------------------------------------------------------
// Запросы
// ---------------------------------------------------------------------------
export const boardsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['boards', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boards')
        .select('id, project_id, kind, title, background, background_image, all_staff, closed_at, owner_id, updated_at, board_stars(user_id)')
        .eq('project_id', projectId)
        .order('title')
      if (error) throw error
      return (data ?? []).map(({ board_stars, ...b }) => ({ ...b, starred: (board_stars ?? []).length > 0 })) as BoardSummary[]
    },
  })

export const boardQuery = (id: string) =>
  queryOptions({
    queryKey: ['board', id],
    queryFn: async (): Promise<BoardData | null> => {
      const [b, lists, labels, cards, members] = await Promise.all([
        supabase.from('boards').select('id, tenant_id, project_id, kind, title, description, background, background_image, all_staff, closed_at, owner_id, updated_at, board_stars(user_id)').eq('id', id).maybeSingle(),
        supabase.from('board_lists').select('id, board_id, title, position, archived_at').eq('board_id', id).order('position'),
        supabase.from('board_labels').select('id, board_id, name, color, position').eq('board_id', id).order('position'),
        supabase
          .from('board_cards')
          .select(
            'id, board_id, list_id, title, has_description, position, start_date, due_at, due_done, cover, archived_at, created_at, completed, visibility, created_by, board_card_labels(label_id), board_card_members(user_id), board_card_viewers(user_id), board_checklist_items(done), board_comments(count), board_card_attachments(count)',
          )
          .eq('board_id', id)
          .order('position')
          .limit(5000),
        supabase.from('board_members').select('user_id').eq('board_id', id),
      ])
      for (const r of [b, lists, labels, cards, members]) if (r.error) throw r.error
      if (!b.data) return null
      const { board_stars, ...board } = b.data as unknown as Board & { board_stars: { user_id: string }[] }
      type RawCard = Omit<BoardCard, 'label_ids' | 'member_ids' | 'viewer_ids' | 'checklist_total' | 'checklist_done' | 'comment_count' | 'attachment_count'> & {
        board_card_labels: { label_id: string }[]
        board_card_members: { user_id: string }[]
        board_card_viewers: { user_id: string }[]
        board_checklist_items: { done: boolean }[]
        board_comments: { count: number }[]
        board_card_attachments: { count: number }[]
      }
      return {
        board: { ...board, starred: (board_stars ?? []).length > 0 },
        lists: (lists.data ?? []) as BoardList[],
        labels: (labels.data ?? []) as unknown as BoardLabel[],
        cards: ((cards.data ?? []) as unknown as RawCard[]).map(({ board_card_labels, board_card_members, board_card_viewers, board_checklist_items, board_comments, board_card_attachments, ...c }) => ({
          ...c,
          label_ids: board_card_labels.map((x) => x.label_id),
          member_ids: board_card_members.map((x) => x.user_id),
          viewer_ids: board_card_viewers.map((x) => x.user_id),
          checklist_total: board_checklist_items.length,
          checklist_done: board_checklist_items.filter((x) => x.done).length,
          comment_count: board_comments[0]?.count ?? 0,
          attachment_count: board_card_attachments[0]?.count ?? 0,
        })),
        member_ids: (members.data ?? []).map((m) => m.user_id),
      }
    },
  })

export interface ChecklistItem {
  id: string
  checklist_id: string
  title: string
  done: boolean
  position: number
}
export interface Checklist {
  id: string
  title: string
  position: number
  items: ChecklistItem[]
}
export interface CardComment {
  id: string
  author_id: string | null
  body: string
  created_at: string
  edited_at: string | null
}
export interface CardActivity {
  id: string
  actor_id: string | null
  kind: 'created' | 'moved' | 'archived' | 'restored' | 'due_done' | 'due_undone' | 'attached' | 'visibility'
  data: { list?: string; from?: string; to?: string; name?: string; document?: boolean; visibility?: CardVisibility }
  created_at: string
}
/** Вложение карточки: загруженный файл или документ проекта */
export interface CardAttachment {
  id: string
  name: string
  created_by: string | null
  created_at: string
  document_id: string | null
  file: { id: string; name: string; mime: string; size_bytes: number; storage_key: string } | null
}
export interface CardDetail {
  id: string
  description: string
  created_by: string | null
  checklists: Checklist[]
  attachments: CardAttachment[]
  comments: CardComment[]
  activity: CardActivity[]
}

export const cardDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ['board-card', id],
    queryFn: async (): Promise<CardDetail | null> => {
      const [card, checklists, items, comments, activity, attachments] = await Promise.all([
        supabase.from('board_cards').select('id, description, created_by').eq('id', id).maybeSingle(),
        supabase.from('board_checklists').select('id, title, position').eq('card_id', id).order('position'),
        supabase.from('board_checklist_items').select('id, checklist_id, title, done, position').eq('card_id', id).order('position'),
        supabase.from('board_comments').select('id, author_id, body, created_at, edited_at').eq('card_id', id).order('created_at', { ascending: false }),
        supabase.from('board_activity').select('id, actor_id, kind, data, created_at').eq('card_id', id).order('created_at', { ascending: false }).limit(200),
        supabase
          .from('board_card_attachments')
          .select('id, name, created_by, created_at, document_id, file:files(id, name, mime, size_bytes, storage_key)')
          .eq('card_id', id)
          .order('created_at', { ascending: false }),
      ])
      for (const r of [card, checklists, items, comments, activity, attachments]) if (r.error) throw r.error
      if (!card.data) return null
      const allItems = (items.data ?? []) as ChecklistItem[]
      return {
        ...card.data,
        checklists: (checklists.data ?? []).map((c) => ({ ...c, items: allItems.filter((i) => i.checklist_id === c.id) })),
        comments: (comments.data ?? []) as CardComment[],
        activity: (activity.data ?? []) as unknown as CardActivity[],
        attachments: (attachments.data ?? []) as unknown as CardAttachment[],
      }
    },
  })

// ---------------------------------------------------------------------------
// Изменения. После каждого — обновить доску (и карточку); у остальных участников доску обновит Realtime.
// ---------------------------------------------------------------------------
export async function refreshBoard(qc: QueryClient, boardId: string, cardId?: string) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['board', boardId] }),
    cardId ? qc.invalidateQueries({ queryKey: ['board-card', cardId] }) : Promise.resolve(),
  ])
}

const check = <T extends { error: unknown }>(r: T): T => {
  if (r.error) throw r.error
  return r
}

export async function createBoard(v: { projectId: string; kind: BoardKind; title: string; background: string; allStaff: boolean; lists: string[] }): Promise<string> {
  const { data, error } = await supabase.rpc('board_create', {
    p_project: v.projectId,
    p_kind: v.kind,
    p_title: v.title.trim(),
    p_background: v.background,
    p_all_staff: v.allStaff,
    p_lists: v.lists,
  })
  if (error) throw error
  return data as string
}

export async function updateBoard(id: string, patch: Partial<Pick<Board, 'title' | 'description' | 'background' | 'all_staff' | 'closed_at'>>) {
  check(await supabase.from('boards').update(patch as never).eq('id', id))
}
export async function deleteBoard(id: string, backgroundImage?: string | null) {
  check(await supabase.from('boards').delete().eq('id', id))
  if (backgroundImage) await supabase.storage.from(BG_BUCKET).remove([backgroundImage])
}

// ---------------------------------------------------------------------------
// Фото фона
// ---------------------------------------------------------------------------
export const BG_BUCKET = 'board-backgrounds'
const BG_MAX_SIDE = 2560

/** Сжимает фото до 2560 px по длинной стороне (JPEG 85%): фон на весь экран, но без 8 МБ с телефона. */
async function resizeBackground(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, BG_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('resize failed')
  return blob
}

/** Загружает фото в папку доски, ставит его фоном и убирает прежнее. */
export async function uploadBoardBackground(board: Pick<Board, 'id' | 'background_image'> & { tenant_id: string }, file: File): Promise<void> {
  const blob = await resizeBackground(file)
  const path = `${board.tenant_id}/${board.id}/${uuid()}.jpg`
  const upload = await supabase.storage.from(BG_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (upload.error) throw upload.error
  const { error } = await supabase.from('boards').update({ background_image: path } as never).eq('id', board.id)
  if (error) {
    await supabase.storage.from(BG_BUCKET).remove([path])
    throw error
  }
  if (board.background_image) await supabase.storage.from(BG_BUCKET).remove([board.background_image])
}

/** Цвет фона; своё фото при этом убирается (как в Trello: выбор цвета заменяет фото). */
export async function setBoardColor(board: Pick<Board, 'id' | 'background_image'>, color: string): Promise<void> {
  check(await supabase.from('boards').update({ background: color, background_image: null } as never).eq('id', board.id))
  if (board.background_image) await supabase.storage.from(BG_BUCKET).remove([board.background_image])
}

/** Ссылка на фото из закрытого хранилища живёт час; в кэше держим меньше. */
export const boardBackgroundUrlQuery = (path: string | null | undefined) =>
  queryOptions({
    queryKey: ['board-bg-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BG_BUCKET).createSignedUrl(path!, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })

/** CSS фона: фото поверх запасного цвета (пока фото грузится, виден цвет). */
export function boardBackgroundStyle(colorKey: string, imageUrl: string | undefined): React.CSSProperties {
  const color = backgroundCss(colorKey)
  return imageUrl
    ? { backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: color.startsWith('#') ? color : '#0c66e4' }
    : { background: color }
}
export async function setStar(boardId: string, starred: boolean) {
  if (starred) check(await supabase.from('board_stars').insert({ board_id: boardId } as never))
  else check(await supabase.from('board_stars').delete().eq('board_id', boardId))
}
export async function addBoardMember(boardId: string, userId: string) {
  check(await supabase.from('board_members').insert({ board_id: boardId, user_id: userId } as never))
}
export async function removeBoardMember(boardId: string, userId: string) {
  check(await supabase.from('board_members').delete().eq('board_id', boardId).eq('user_id', userId))
}

export async function createList(boardId: string, title: string, position: number) {
  check(await supabase.from('board_lists').insert({ board_id: boardId, title: title.trim(), position } as never))
}
export async function updateList(id: string, patch: Partial<Pick<BoardList, 'title' | 'position' | 'archived_at'>>) {
  check(await supabase.from('board_lists').update(patch as never).eq('id', id))
}
export async function deleteList(id: string) {
  check(await supabase.from('board_lists').delete().eq('id', id))
}

export async function createCard(boardId: string, listId: string, title: string, position: number): Promise<string> {
  const { data, error } = await supabase
    .from('board_cards')
    .insert({ board_id: boardId, list_id: listId, title: title.trim(), position } as never)
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}
export type CardPatch = Partial<Pick<BoardCard, 'list_id' | 'title' | 'position' | 'start_date' | 'due_at' | 'due_done' | 'cover' | 'archived_at' | 'completed' | 'visibility'>> & {
  description?: string
}
export async function updateCard(id: string, patch: CardPatch) {
  check(await supabase.from('board_cards').update(patch as never).eq('id', id))
}
export async function archiveListCards(listId: string) {
  check(await supabase.from('board_cards').update({ archived_at: new Date().toISOString() } as never).eq('list_id', listId).is('archived_at', null))
}
export async function deleteCard(id: string) {
  check(await supabase.from('board_cards').delete().eq('id', id))
}
export async function copyCard(v: { cardId: string; listId: string; title: string; position: number; checklists: boolean; labels: boolean; members: boolean }): Promise<string> {
  const { data, error } = await supabase.rpc('board_card_copy', {
    p_card: v.cardId,
    p_list: v.listId,
    p_title: v.title,
    p_position: v.position,
    p_keep_checklists: v.checklists,
    p_keep_labels: v.labels,
    p_keep_members: v.members,
  })
  if (error) throw error
  return data as string
}

export async function toggleCardLabel(card: Pick<BoardCard, 'id' | 'board_id'>, labelId: string, on: boolean) {
  if (on) check(await supabase.from('board_card_labels').insert({ card_id: card.id, label_id: labelId, board_id: card.board_id } as never))
  else check(await supabase.from('board_card_labels').delete().eq('card_id', card.id).eq('label_id', labelId))
}
export async function toggleCardMember(card: Pick<BoardCard, 'id' | 'board_id'>, userId: string, on: boolean) {
  if (on) check(await supabase.from('board_card_members').insert({ card_id: card.id, user_id: userId, board_id: card.board_id } as never))
  else check(await supabase.from('board_card_members').delete().eq('card_id', card.id).eq('user_id', userId))
}

/** Выбранный автором человек видит скрытую карточку (менять список может только автор) */
export async function toggleCardViewer(card: Pick<BoardCard, 'id' | 'board_id'>, userId: string, on: boolean) {
  if (on) check(await supabase.from('board_card_viewers').insert({ card_id: card.id, user_id: userId, board_id: card.board_id } as never))
  else check(await supabase.from('board_card_viewers').delete().eq('card_id', card.id).eq('user_id', userId))
}

/**
 * Кого можно позвать в карточку. В скрытую карточку постороннего зовёт только автор, остальным доступны лишь те,
 * кто её уже видит (база всё равно не даст иначе).
 */
export function canInviteTo<P extends { id: string }>(card: BoardCard, people: P[], meId: string | undefined): P[] {
  if (card.visibility !== 'selected' || (meId && meId === card.created_by)) return people
  const sees = new Set([card.created_by, ...card.member_ids, ...card.viewer_ids])
  return people.filter((p) => sees.has(p.id))
}

export async function createLabel(boardId: string, name: string, color: LabelColor, position: number) {
  check(await supabase.from('board_labels').insert({ board_id: boardId, name: name.trim(), color, position } as never))
}
export async function updateLabel(id: string, patch: { name?: string; color?: LabelColor }) {
  check(await supabase.from('board_labels').update(patch as never).eq('id', id))
}
export async function deleteLabel(id: string) {
  check(await supabase.from('board_labels').delete().eq('id', id))
}

export async function createChecklist(card: Pick<BoardCard, 'id' | 'board_id'>, title: string, position: number) {
  check(await supabase.from('board_checklists').insert({ board_id: card.board_id, card_id: card.id, title: title.trim(), position } as never))
}
export async function updateChecklist(id: string, title: string) {
  check(await supabase.from('board_checklists').update({ title: title.trim() } as never).eq('id', id))
}
export async function deleteChecklist(id: string) {
  check(await supabase.from('board_checklists').delete().eq('id', id))
}
export async function createChecklistItem(card: Pick<BoardCard, 'id' | 'board_id'>, checklistId: string, title: string, position: number) {
  check(
    await supabase
      .from('board_checklist_items')
      .insert({ board_id: card.board_id, card_id: card.id, checklist_id: checklistId, title: title.trim(), position } as never),
  )
}
export async function updateChecklistItem(id: string, patch: { title?: string; done?: boolean; position?: number }) {
  check(await supabase.from('board_checklist_items').update(patch as never).eq('id', id))
}
export async function deleteChecklistItem(id: string) {
  check(await supabase.from('board_checklist_items').delete().eq('id', id))
}

/** Загрузить свой файл и прикрепить к карточке. */
export async function attachUpload(card: Pick<BoardCard, 'id' | 'board_id'>, projectId: string, tenantId: string, file: File) {
  const fileId = await uploadProjectFile(projectId, tenantId, file)
  check(await supabase.from('board_card_attachments').insert({ board_id: card.board_id, card_id: card.id, file_id: fileId, name: file.name } as never))
}
/** Прикрепить документ из реестра документов проекта. */
export async function attachDocument(card: Pick<BoardCard, 'id' | 'board_id'>, documentId: string, name: string) {
  check(await supabase.from('board_card_attachments').insert({ board_id: card.board_id, card_id: card.id, document_id: documentId, name } as never))
}
/** Прикрепить уже загруженный в проект файл (рендер, схему, фото). */
export async function attachProjectFile(card: Pick<BoardCard, 'id' | 'board_id'>, fileId: string, name: string) {
  check(await supabase.from('board_card_attachments').insert({ board_id: card.board_id, card_id: card.id, file_id: fileId, name } as never))
}

/** Раздел файла проекта в окне выбора */
export type CatalogKind = 'document' | 'plan' | 'ffe' | 'render' | 'photo'
/** Файл проекта, который можно прикрепить: документ реестра (`document_id`) или файл (`file_id`) */
export interface CatalogItem {
  kind: CatalogKind
  key: string
  document_id: string | null
  file_id: string | null
  title: string
  subtitle: string | null
  file_name: string | null
  file_mime: string | null
  thumb_file_id: string | null
  thumb_source_key: string | null
  thumb_source_mime: string | null
  has_thumb: boolean
  created_at: string
  /** Сам файл — для просмотра перед прикреплением */
  storage_key: string | null
}
/** Все файлы проекта, доступные мне: документы, чертежи и схемы, мебель, рендеры, фото (`project_file_catalog`). */
export const projectFilesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-files', projectId],
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('project_file_catalog', { p_project: projectId })
      if (error) throw error
      return (data ?? []) as unknown as CatalogItem[]
    },
  })
export async function deleteAttachment(id: string) {
  const { data, error } = await supabase.from('board_card_attachments').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('forbidden')
}

export async function addComment(card: Pick<BoardCard, 'id' | 'board_id'>, body: string) {
  check(await supabase.from('board_comments').insert({ board_id: card.board_id, card_id: card.id, body: body.trim() } as never))
}
export async function editComment(id: string, body: string) {
  check(await supabase.from('board_comments').update({ body: body.trim(), edited_at: new Date().toISOString() } as never).eq('id', id))
}
export async function deleteComment(id: string) {
  check(await supabase.from('board_comments').delete().eq('id', id))
}

// ---------------------------------------------------------------------------
// Срок: состояние для значка на карточке (как в Trello: выполнено, просрочено, скоро)
// ---------------------------------------------------------------------------
export type DueState = 'done' | 'overdue' | 'soon' | 'later'
export function dueState(c: Pick<BoardCard, 'due_at' | 'due_done'>, now = Date.now()): DueState | null {
  if (!c.due_at) return null
  if (c.due_done) return 'done'
  const t = new Date(c.due_at).getTime()
  if (t < now) return 'overdue'
  if (t - now < 24 * 3600_000) return 'soon'
  return 'later'
}
