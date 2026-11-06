import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type ActivityKind = 'task' | 'milestone' | 'summary'
export type ConstraintType = 'asap' | 'snet' | 'mso' | 'fnlt'
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'

export const KIND_LABELS: Record<ActivityKind, string> = { task: tr('Работа'), milestone: tr('Веха'), summary: tr('Группа') }
export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  asap: tr('Как можно раньше'),
  snet: tr('Начать не раньше'),
  mso: tr('Начать точно в дату'),
  fnlt: tr('Закончить не позже'),
}
export const LINK_LABELS: Record<LinkType, string> = {
  FS: tr('Окончание → начало'),
  SS: tr('Начало → начало'),
  FF: tr('Окончание → окончание'),
  SF: tr('Начало → окончание'),
}
export const LINK_SHORT: Record<LinkType, string> = { FS: tr('ОН'), SS: tr('НН'), FF: tr('ОО'), SF: tr('НО') }

export interface Activity {
  id: string
  parent_id: string | null
  sort: number
  kind: ActivityKind
  name: string
  duration_days: number
  constraint_type: ConstraintType
  constraint_date: string | null
  discipline_id: string | null
  location_id: string | null
  contractor_org_id: string | null
  responsible_id: string | null
  percent_complete: number
  actual_start: string | null
  actual_finish: string | null
  external_ref: string | null
  progress_method: 'manual' | 'quantity' | 'zero_hundred' | 'fifty_fifty'
  plan_quantity: number | null
  quantity_unit: string | null
  start_date: string | null
  finish_date: string | null
  late_start: string | null
  late_finish: string | null
  total_float: number | null
  free_float: number | null
  is_critical: boolean
  calc_at: string | null
}

export interface ScheduleLink {
  id: string
  predecessor_id: string
  successor_id: string
  type: LinkType
  lag_days: number
}

const ACTIVITY_COLUMNS =
  'id, parent_id, sort, kind, name, duration_days, constraint_type, constraint_date, discipline_id, location_id, contractor_org_id, responsible_id, percent_complete, actual_start, actual_finish, external_ref, progress_method, plan_quantity, quantity_unit, start_date, finish_date, late_start, late_finish, total_float, free_float, is_critical, calc_at'

export const activitiesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['schedule', 'activities', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_activities')
        .select(ACTIVITY_COLUMNS)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('sort')
        .order('created_at')
        .limit(5000)
      if (error) throw error
      return data as unknown as Activity[]
    },
  })

export const linksQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['schedule', 'links', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_links')
        .select('id, predecessor_id, successor_id, type, lag_days')
        .eq('project_id', projectId)
        .limit(20000)
      if (error) throw error
      return data as unknown as ScheduleLink[]
    },
  })

export interface Baseline {
  id: string
  number: number
  name: string
  reason: string | null
  created_at: string
}

export const baselinesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['schedule', 'baselines', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_baselines')
        .select('id, number, name, reason, created_at')
        .eq('project_id', projectId)
        .order('number', { ascending: false })
      if (error) throw error
      return data as unknown as Baseline[]
    },
  })

export const baselineActivitiesQuery = (baselineId: string | null) =>
  queryOptions({
    queryKey: ['schedule', 'baseline-activities', baselineId],
    enabled: !!baselineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_baseline_activities')
        .select('activity_id, start_date, finish_date')
        .eq('baseline_id', baselineId!)
        .limit(5000)
      if (error) throw error
      return new Map((data as { activity_id: string; start_date: string | null; finish_date: string | null }[]).map((r) => [r.activity_id, r]))
    },
  })

export const SCHEDULE_ERROR_TEXT: Record<string, string> = {
  '42501': tr('Нет права менять график.'),
  cycle_detected: tr('Эта связь замкнёт цикл: работы зависят друг от друга по кругу.'),
  summary_link_not_allowed: tr('Связывать можно только работы и вехи, а не группы.'),
  cycle_in_hierarchy: tr('Группа не может входить в саму себя.'),
  actual_finish_before_start: tr('Окончание не может быть раньше начала.'),
  schedule_not_calculated: tr('Сначала пересчитайте график.'),
  name_required: tr('Укажите название.'),
  location_required: tr('Выберите хотя бы одно место.'),
  '23505': tr('Такая связь уже есть.'),
}

export class ScheduleError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

function fail(error: { code?: string; message?: string }): never {
  const key = Object.keys(SCHEDULE_ERROR_TEXT).find((k) => error.message?.startsWith(k)) ?? error.code ?? 'unknown'
  throw new ScheduleError(key, error.message)
}

export function scheduleErrorText(e: unknown, fallback: string) {
  return e instanceof ScheduleError ? (SCHEDULE_ERROR_TEXT[e.code] ?? fallback) : fallback
}

export interface NewActivity {
  projectId: string
  name: string
  kind: ActivityKind
  durationDays?: number
  parentId?: string | null
  sort?: number
  constraintType?: ConstraintType
  constraintDate?: string | null
  disciplineId?: string | null
  locationId?: string | null
  externalRef?: string | null
}

export async function createActivity(input: NewActivity): Promise<string> {
  const { data, error } = await supabase
    .from('schedule_activities')
    .insert({
      project_id: input.projectId,
      name: input.name,
      kind: input.kind,
      duration_days: input.durationDays ?? (input.kind === 'milestone' ? 0 : 1),
      parent_id: input.parentId ?? null,
      sort: input.sort ?? 0,
      constraint_type: input.constraintType ?? 'asap',
      constraint_date: input.constraintDate ?? null,
      discipline_id: input.disciplineId ?? null,
      location_id: input.locationId ?? null,
      external_ref: input.externalRef ?? null,
    } as never)
    .select('id')
    .single()
  if (error) fail(error)
  return data.id
}

export type ActivityPatch = Partial<
  Pick<
    Activity,
    | 'parent_id'
    | 'sort'
    | 'kind'
    | 'name'
    | 'duration_days'
    | 'constraint_type'
    | 'constraint_date'
    | 'discipline_id'
    | 'location_id'
    | 'contractor_org_id'
    | 'responsible_id'
    | 'percent_complete'
    | 'actual_start'
    | 'actual_finish'
  >
> & { deleted_at?: string }

export async function updateActivity(id: string, patch: ActivityPatch) {
  const { error } = await supabase.from('schedule_activities').update(patch as never).eq('id', id)
  if (error) fail(error)
}

export async function addLink(input: { predecessorId: string; successorId: string; type: LinkType; lagDays: number }) {
  const { error } = await supabase
    .from('schedule_links')
    .insert({ predecessor_id: input.predecessorId, successor_id: input.successorId, type: input.type, lag_days: input.lagDays } as never)
  if (error) fail(error)
}

export async function updateLink(id: string, patch: { type?: LinkType; lag_days?: number }) {
  const { error } = await supabase.from('schedule_links').update(patch).eq('id', id)
  if (error) fail(error)
}

export async function removeLink(id: string) {
  const { error } = await supabase.from('schedule_links').delete().eq('id', id)
  if (error) fail(error)
}

export interface RecalcResult {
  activities: number
  critical: number
  finish: string | null
}

export async function recalculateSchedule(projectId: string): Promise<RecalcResult> {
  const { data, error } = await supabase.rpc('recalculate_schedule', { p_project: projectId })
  if (error) fail(error)
  return data as unknown as RecalcResult
}

export async function createBaseline(projectId: string, name: string, reason: string) {
  const { error } = await supabase.rpc('create_schedule_baseline', { p_project: projectId, p_name: name, p_reason: reason || undefined })
  if (error) fail(error)
}

export async function generateByLocations(input: {
  projectId: string
  name: string
  locationIds: string[]
  durationDays: number
  lagDays: number
  chain: boolean
  parentId: string | null
  disciplineId: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('generate_schedule_by_locations', {
    p_project: input.projectId,
    p_name: input.name,
    p_locations: input.locationIds,
    p_duration: input.durationDays,
    p_lag: input.lagDays,
    p_chain: input.chain,
    p_parent: input.parentId ?? undefined,
    p_discipline: input.disciplineId ?? undefined,
  })
  if (error) fail(error)
  return data as number
}
