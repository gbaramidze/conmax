import { queryOptions } from '@tanstack/react-query'
import { uploadProjectFile } from '@/features/activity/api'
import type { SchemeSource } from '@/features/inspections/scheme-image'
import type { StatusCategory } from '@/features/tasks/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const INSPECTION_STATUSES = {
  A: tr('Принято'),
  C: tr('Принято с замечаниями'),
  R: tr('Не принято'),
} as const
export type ItemStatus = keyof typeof INSPECTION_STATUSES

export const REPORT_STATUSES = { draft: tr('Черновик'), issued: tr('Выдан') } as const
export type ReportStatus = keyof typeof REPORT_STATUSES

/** Разделы стандартного чек-листа (в базе — только код, название по языку интерфейса). */
export const SECTION_LABELS = {
  walls: tr('Стены'),
  floor: tr('Пол'),
  ceiling: tr('Потолок'),
  doors: tr('Двери'),
  windows: tr('Окна'),
  electrical: tr('Электрика и приборы'),
  sanitary: tr('Сантехника'),
  ffe: tr('Мебель и оборудование (FF&E)'),
} as const
export type SectionCode = keyof typeof SECTION_LABELS

/** Цвета статусов: зелёный, жёлтый, красный; текст не опирается только на цвет (буква A/C/R рядом). */
export const STATUS_STYLE: Record<ItemStatus, { on: string; off: string }> = {
  A: { on: 'border-emerald-600 bg-emerald-600 text-white', off: 'hover:bg-emerald-500/15' },
  C: { on: 'border-amber-500 bg-amber-400 text-amber-950', off: 'hover:bg-amber-400/20' },
  R: { on: 'border-red-600 bg-red-600 text-white', off: 'hover:bg-red-500/15' },
}

export interface InspectionRow {
  id: string
  number: number
  key: string
  title: string
  location_id: string | null
  inspection_date: string
  contractor_org_id: string | null
  scheme_text: string
  scheme_file_id: string | null
  /** Схема из чертежа: версия документа и страница */
  scheme_version_id: string | null
  scheme_page: number
  note: string
  status: ReportStatus
  result: ItemStatus | null
  cnt_a: number
  cnt_c: number
  cnt_r: number
  cnt_open: number
  client_name: string | null
  client_signed_at: string | null
  client_sign_file_id: string | null
  contractor_name: string | null
  contractor_signed_at: string | null
  contractor_sign_file_id: string | null
  issued_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** Расписание, по которому отчёт создан сам; у обычных отчётов пусто */
  schedule_id: string | null
  location: { name: string; path: string; kind: string } | null
  contractor: { name: string } | null
  author: { full_name: string } | null
}

const REPORT_COLUMNS =
  'id, number, key, title, location_id, inspection_date, contractor_org_id, scheme_text, scheme_file_id, scheme_version_id, scheme_page, note, status, result, cnt_a, cnt_c, cnt_r, cnt_open, ' +
  'client_name, client_signed_at, client_sign_file_id, contractor_name, contractor_signed_at, contractor_sign_file_id, issued_at, created_by, created_at, updated_at, schedule_id, ' +
  'location:locations!location_id(name, path, kind), contractor:organizations!contractor_org_id(name), author:users!created_by(full_name)'

export const inspectionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['inspections', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspection_reports')
        .select(REPORT_COLUMNS)
        .eq('project_id', projectId)
        .order('inspection_date', { ascending: false })
        .order('number', { ascending: false })
        .limit(2000)
      if (error) throw error
      return data as unknown as InspectionRow[]
    },
  })

export interface InspectionSection {
  id: string
  position: number
  code: SectionCode | null
  title: string | null
  ok: boolean
}
export interface InspectionItem {
  id: string
  section_id: string
  position: number
  comment: string
  status: ItemStatus | null
  /** Точка замечания на схеме: доли ширины и высоты (0–1) */
  scheme_x: number | null
  scheme_y: number | null
  /** Задача, созданная по замечанию */
  task_id: string | null
  /** Инспектор подтвердил, что замечание устранено (проверено на месте) */
  resolved_at: string | null
}
export interface InspectionPhoto {
  id: string
  item_id: string | null
  caption: string | null
  created_at: string
  file: { id: string; name: string; storage_key: string }
}
export interface InspectionFull {
  report: InspectionRow
  sections: InspectionSection[]
  items: InspectionItem[]
  photos: InspectionPhoto[]
  /** Ключи в хранилище для файлов подписей: id файла → ключ. */
  fileKeys: Record<string, string>
  /** Файл схемы: картинка, PDF или предпросмотр чертежа; пусто, если схемы нет */
  scheme: SchemeSource | null
}

export const inspectionQuery = (id: string) =>
  queryOptions({
    queryKey: ['inspection', id],
    queryFn: async (): Promise<InspectionFull | null> => {
      const [report, sections, items, photos] = await Promise.all([
        supabase.from('inspection_reports').select(REPORT_COLUMNS).eq('id', id).maybeSingle(),
        supabase.from('inspection_sections').select('id, position, code, title, ok').eq('report_id', id).order('position'),
        supabase.from('inspection_items').select('id, section_id, position, comment, status, scheme_x, scheme_y, task_id, resolved_at').eq('report_id', id).order('position'),
        supabase.from('inspection_photos').select('id, item_id, caption, created_at, file:files(id, name, storage_key)').eq('report_id', id).order('created_at'),
      ])
      for (const r of [report, sections, items, photos]) if (r.error) throw r.error
      if (!report.data) return null
      const row = report.data as unknown as InspectionRow
      const fileIds = [row.scheme_file_id, row.client_sign_file_id, row.contractor_sign_file_id].filter((x): x is string => !!x)
      const fileKeys: Record<string, string> = {}
      let scheme: SchemeSource | null = null
      if (fileIds.length > 0) {
        const { data, error } = await supabase.from('files').select('id, storage_key, mime').in('id', fileIds)
        if (error) throw error
        for (const f of data) {
          fileKeys[f.id] = f.storage_key
          if (f.id === row.scheme_file_id) scheme = { storageKey: f.storage_key, mime: f.mime }
        }
      }
      if (row.scheme_version_id) {
        // схема из чертежа: сам файл версии (PDF или картинка) или его предпросмотр
        const { data, error } = await supabase
          .from('document_versions')
          .select('file:files!file_id(storage_key, mime), preview:files!preview_file_id(storage_key, mime)')
          .eq('id', row.scheme_version_id)
          .maybeSingle()
        if (error) throw error
        const v = data as unknown as { file: { storage_key: string; mime: string } | null; preview: { storage_key: string; mime: string } | null } | null
        const use = v?.file && (v.file.mime === 'application/pdf' || v.file.mime.startsWith('image/')) ? v.file : v?.preview
        if (use) scheme = { storageKey: use.storage_key, mime: use.mime }
      }
      return {
        fileKeys,
        scheme,
        report: row,
        sections: sections.data as unknown as InspectionSection[],
        items: items.data as unknown as InspectionItem[],
        photos: (photos.data as unknown as (InspectionPhoto | { file: null })[]).filter((p): p is InspectionPhoto => p.file !== null),
      }
    },
  })

export const sectionLabel = (s: InspectionSection): string => (s.code ? SECTION_LABELS[s.code] : (s.title ?? ''))

/** Номера замечаний как в бумажной форме: «1.1», «1.2», «2.1» — по порядку раздела и замечания в нём. */
export function itemRefs(sections: InspectionSection[], items: InspectionItem[]): Map<string, string> {
  const refs = new Map<string, string>()
  sections.forEach((s, si) => {
    items
      .filter((i) => i.section_id === s.id)
      .forEach((i, ii) => refs.set(i.id, `${si + 1}.${ii + 1}`))
  })
  return refs
}

export interface InspectionInput {
  id?: string
  locationId: string | null
  title: string
  date: string
  contractorId: string | null
  schemeText: string
  note: string
}

export async function saveInspection(projectId: string, r: InspectionInput): Promise<string> {
  const { data, error } = await supabase.rpc('inspection_save', {
    p_project: projectId,
    p_id: r.id,
    p_location: r.locationId ?? undefined,
    p_title: r.title,
    p_date: r.date || undefined,
    p_contractor: r.contractorId ?? undefined,
    p_scheme_text: r.schemeText,
    p_note: r.note,
  })
  if (error) throw error
  return data as string
}

/** Выбирает другую схему из изображений места; пусто — без схемы. Загружать свои файлы в отчёт нельзя: схема привязана к месту. */
export async function setScheme(reportId: string, option: SchemeOption | null): Promise<void> {
  const { error } = await supabase.rpc('inspection_set_scheme', { p_report: reportId, p_file: option?.file_id ?? undefined, p_version: option?.version_id ?? undefined })
  if (error) throw error
}

export interface SchemeOption {
  /** file — изображение, отмеченное как схема; document — чертёж или план из «Документов» (текущая версия) */
  kind: 'file' | 'document'
  file_id: string | null
  version_id: string | null
  title: string
  name: string
  storage_key: string
  mime: string
  /** location — само место, room_type — тип номера, parent — вышестоящий узел (например, план этажа) */
  source: 'location' | 'room_type' | 'parent'
}

/** Схемы, привязанные к месту: сначала самого места, затем типа номера, затем вышестоящих узлов. */
export const schemeOptionsQuery = (locationId: string | null) =>
  queryOptions({
    queryKey: ['inspection-scheme-options', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('inspection_scheme_options', { p_location: locationId! })
      if (error) throw error
      return data as unknown as SchemeOption[]
    },
  })

/** Ставит точку замечания на схеме (доли 0–1); без координат — убирает точку. */
export async function setItemPoint(itemId: string, point: { x: number; y: number } | null): Promise<void> {
  const { error } = await supabase.rpc('inspection_item_point', { p_item: itemId, p_x: point?.x, p_y: point?.y })
  if (error) throw error
}

/** Сводка по задачам замечаний одного отчёта (для списка отчётов). */
export interface TaskStats {
  report_id: string
  remarks: number
  with_task: number
  /** в работе (без тех, что на проверке) */
  active: number
  review: number
  done: number
  overdue: number
  resolved: number
  /** все неподтверждённые замечания выполнены: можно заходить и проверять */
  ready: boolean
}

export const taskStatsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['inspection-stats', projectId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('inspection_task_stats', { p_project: projectId })
      if (error) throw error
      return new Map((data as unknown as TaskStats[]).map((s) => [s.report_id, s]))
    },
  })

/** Расписание повторных инспекций места: каждые N дней создаётся новый отчёт-черновик. */
export interface InspectionSchedule {
  id: string
  location_id: string
  contractor_org_id: string | null
  title: string
  period_days: number
  next_due: string
  active: boolean
  inspector_id: string | null
  location: { name: string; path: string } | null
  contractor: { name: string } | null
  inspector: { full_name: string } | null
}

export async function fetchSchedules(projectId: string): Promise<InspectionSchedule[]> {
  const { data, error } = await supabase
    .from('inspection_schedules')
    .select(
      'id, location_id, contractor_org_id, title, period_days, next_due, active, inspector_id, location:locations!location_id(name, path), contractor:organizations!contractor_org_id(name), inspector:users!inspector_id(full_name)',
    )
    .eq('project_id', projectId)
    .order('next_due')
    .limit(1000)
  if (error) throw error
  return data as unknown as InspectionSchedule[]
}

export const schedulesQuery = (projectId: string) => queryOptions({ queryKey: ['inspection-schedules', projectId], queryFn: () => fetchSchedules(projectId) })

export interface ScheduleInput {
  id?: string
  locationId: string | null
  contractorId: string | null
  title: string
  periodDays: number
  nextDue: string
  active: boolean
}

export async function saveSchedule(projectId: string, s: ScheduleInput): Promise<string> {
  const { data, error } = await supabase.rpc('inspection_schedule_save', {
    p_project: projectId,
    p_id: s.id,
    p_location: s.locationId ?? undefined,
    p_contractor: s.contractorId ?? undefined,
    p_title: s.title,
    p_period_days: s.periodDays,
    p_next_due: s.nextDue || undefined,
    p_active: s.active,
  })
  if (error) throw error
  return data as string
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_schedule_delete', { p_id: id })
  if (error) throw error
}

/** «Провести сейчас»: отчёт на сегодня вне очереди (или уже открытый черновик расписания); возвращает id отчёта. */
export async function runSchedule(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('inspection_schedule_run', { p_id: id })
  if (error) throw error
  return data as string
}

export interface InspectionTask {
  id: string
  key: string
  status_category: StatusCategory
  due_date: string | null
  assignee: { full_name: string; avatar_path: string | null } | null
  status: { name: string } | null
}

/** Задачи, созданные по замечаниям отчёта: ключ, статус, исполнитель, срок. */
export const inspectionTasksQuery = (ids: string[]) =>
  queryOptions({
    queryKey: ['inspection-tasks', ...ids],
    enabled: ids.length > 0,
    // статусы задач меняют другие люди: обновляем сами, пока отчёт открыт
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, key, status_category, due_date, assignee:users!assignee_id(full_name, avatar_path), status:workflow_statuses!status_id(name)')
        .in('id', ids)
        .is('deleted_at', null)
      if (error) throw error
      return data as unknown as InspectionTask[]
    },
  })

/** Задача по одному замечанию (C или R): исполнитель, срок и подрядчик необязательны. */
export async function assignItem(itemId: string, to: { assigneeId: string | null; due: string | null; orgId: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('inspection_item_assign', { p_item: itemId, p_assignee: to.assigneeId ?? undefined, p_due: to.due ?? undefined, p_org: to.orgId ?? undefined })
  if (error) throw error
  return data as string
}

/** Задачи по списку замечаний, у каждого свой исполнитель и срок; всё или ничего. Возвращает, сколько создано. */
export async function assignMany(reportId: string, entries: { item: string; assignee: string | null; due: string | null; org: string | null }[]): Promise<number> {
  const { data, error } = await supabase.rpc('inspection_assign_many', {
    p_report: reportId,
    p_items: entries.map((e) => ({ item: e.item, assignee: e.assignee ?? '', due: e.due ?? '', org: e.org ?? '' })),
  })
  if (error) throw error
  return data as number
}

/** Задачи по всем замечаниям C и R без задачи; возвращает, сколько создано. */
export async function assignAll(reportId: string, to: { assigneeId: string | null; due: string | null; orgId: string | null }): Promise<number> {
  const { data, error } = await supabase.rpc('inspection_assign_all', { p_report: reportId, p_assignee: to.assigneeId ?? undefined, p_due: to.due ?? undefined, p_org: to.orgId ?? undefined })
  if (error) throw error
  return data as number
}

/** Подтвердить, что замечание устранено (проверено на месте), или снять отметку. Работает и у выданного отчёта. */
export async function resolveItem(itemId: string, resolved: boolean): Promise<void> {
  const { error } = await supabase.rpc('inspection_item_resolve', { p_item: itemId, p_resolved: resolved })
  if (error) throw error
}

export async function addSection(reportId: string, title: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_section_add', { p_report: reportId, p_title: title })
  if (error) throw error
}

export async function setSection(sectionId: string, patch: { ok?: boolean; title?: string }): Promise<void> {
  const { error } = await supabase.rpc('inspection_section_set', { p_section: sectionId, p_ok: patch.ok, p_title: patch.title })
  if (error) throw error
}

export async function deleteSection(sectionId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_section_delete', { p_section: sectionId })
  if (error) throw error
}

export async function saveItem(sectionId: string, item: { id?: string; comment: string; status: ItemStatus | null }): Promise<string> {
  const { data, error } = await supabase.rpc('inspection_item_save', { p_section: sectionId, p_id: item.id, p_comment: item.comment, p_status: item.status ?? undefined })
  if (error) throw error
  return data as string
}

export async function deleteItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_item_delete', { p_item: itemId })
  if (error) throw error
}

/** Загружает фото и привязывает к отчёту (к замечанию, если указано). Возвращает имена файлов, которые не удалось сохранить. */
export async function addPhotos(input: { reportId: string; projectId: string; tenantId: string; itemId?: string; files: File[] }): Promise<string[]> {
  const failed: string[] = []
  for (const original of input.files) {
    try {
      const fileId = await uploadProjectFile(input.projectId, input.tenantId, original)
      const { error } = await supabase.rpc('inspection_photo_add', { p_report: input.reportId, p_file: fileId, p_item: input.itemId })
      if (error) throw error
    } catch {
      failed.push(original.name)
    }
  }
  return failed
}

export async function deletePhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_photo_delete', { p_photo: photoId })
  if (error) throw error
}

export async function issueInspection(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_issue', { p_report: reportId })
  if (error) throw error
}

export async function reopenInspection(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_reopen', { p_report: reportId })
  if (error) throw error
}

export async function deleteInspection(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('inspection_delete', { p_report: reportId })
  if (error) throw error
}

export async function signInspection(input: { reportId: string; projectId: string; tenantId: string; side: 'client' | 'contractor'; name: string; drawing: Blob | null }): Promise<void> {
  let fileId: string | null = null
  if (input.drawing) {
    fileId = await uploadProjectFile(input.projectId, input.tenantId, new File([input.drawing], `signature-${input.side}.png`, { type: 'image/png' }))
  }
  const { error } = await supabase.rpc('inspection_sign', { p_report: input.reportId, p_side: input.side, p_name: input.name, p_file: fileId ?? undefined })
  if (error) throw error
}

export async function clearSignature(reportId: string, side: 'client' | 'contractor'): Promise<void> {
  const { error } = await supabase.rpc('inspection_sign_clear', { p_report: reportId, p_side: side })
  if (error) throw error
}

const ERROR_TEXT: Record<string, string> = {
  report_issued: tr('Отчёт выдан. Чтобы изменить его, откройте заново.'),
  items_without_status: tr('У некоторых замечаний нет статуса. Отметьте A, C или R у каждого.'),
  report_empty: tr('В отчёте пока нечего выдавать: добавьте замечания или отметьте разделы «без замечаний».'),
  section_has_remarks: tr('В разделе есть замечания со статусом C или R: «без замечаний» отметить нельзя.'),
  section_standard: tr('Стандартные разделы переименовать нельзя.'),
  title_required: tr('Укажите название.'),
  name_required: tr('Укажите имя подписывающего.'),
  location_not_found: tr('Место не найдено. Выберите его заново.'),
  file_not_found: tr('Файл не найден. Загрузите его ещё раз.'),
  text_too_long: tr('Текст слишком длинный.'),
  already_assigned: tr('По этому замечанию задача уже есть.'),
  item_not_remark: tr('Задача нужна только по замечаниям со статусом C или R.'),
  'assignee is not a project member': tr('Исполнитель должен быть участником проекта.'),
  'task.assign': tr('Назначать исполнителей вам нельзя: оставьте поле пустым или попросите руководителя.'),
  'task.create': tr('Создавать задачи вам нельзя.'),
  sign_author_only: tr('Подписывает только тот, кто провёл инспекцию.'),
  scheme_not_from_place: tr('Эта схема не привязана к месту. Выберите одну из схем места.'),
  point_invalid: tr('Точка вне схемы. Нажмите на саму схему.'),
  no_scheme: tr('У отчёта нет схемы: точку ставить некуда.'),
  schedule_exists: tr('Для этого места расписание уже есть. Измените его в списке.'),
  period_invalid: tr('Период — от 1 до 365 дней.'),
  schedule_not_found: tr('Расписание не найдено. Обновите страницу.'),
}

export function inspectionErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  for (const [code, text] of Object.entries(ERROR_TEXT)) if (msg.includes(code)) return text
  if (msg.includes('permission denied') || msg.includes('42501')) return tr('Недостаточно прав для этого действия.')
  return tr('Не получилось сохранить. Попробуйте ещё раз.')
}
