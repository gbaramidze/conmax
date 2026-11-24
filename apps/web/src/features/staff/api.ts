import { queryOptions } from '@tanstack/react-query'
import type { DirectoryPerson } from '@/features/people/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/**
 * Управление персоналом — раздел компании (не проекта): оргструктура, карточки, навыки, опыт, оценки, заметки руководителей.
 * Доступ проверяет база (миграция 157): заметки о сотруднике ему самому не отдаются никогда.
 */

export const EMPLOYMENT_LABELS = {
  full_time: tr('Полная занятость'),
  part_time: tr('Частичная занятость'),
  contract: tr('Договор подряда'),
  intern: tr('Стажёр'),
} as const
export type EmploymentType = keyof typeof EMPLOYMENT_LABELS

export const NOTE_KIND_LABELS = {
  note: tr('Заметка'),
  achievement: tr('Достижение'),
  bonus: tr('Бонус'),
  raise: tr('Повышение'),
  concern: tr('Замечание'),
} as const
export type NoteKind = keyof typeof NOTE_KIND_LABELS

export const SKILL_LEVEL_LABELS: Record<number, string> = {
  1: tr('Начальный'),
  2: tr('Базовый'),
  3: tr('Уверенный'),
  4: tr('Продвинутый'),
  5: tr('Эксперт'),
}

export const REVIEW_STATUS_LABELS = {
  self: tr('Самооценка'),
  manager: tr('Оценка руководителя'),
  done: tr('Завершена'),
} as const

export const RATING_LABELS: Record<number, string> = {
  1: tr('Ниже ожиданий'),
  2: tr('Частично соответствует'),
  3: tr('Соответствует'),
  4: tr('Выше ожиданий'),
  5: tr('Исключительно'),
}

export interface Department {
  id: string
  parent_id: string | null
  name: string
  head_user_id: string | null
  position: number
  /** чем занимается отдел — свободный текст */
  description: string
  /** порядок работ отдела по шагам */
  steps: string[]
  /** кому отдан на аутсорс; null — свои сотрудники */
  outsourced_to: string | null
  /** подчиняется руководителю вышестоящего отдела напрямую, на схеме — сбоку */
  is_assistant: boolean
}

/** Штатная позиция отдела: сотрудник, человек без учётной записи или вакансия (никого) */
export interface Position {
  id: string
  department_id: string
  title: string
  user_id: string | null
  person_name: string
  headcount: number
  position: number
}

export const isVacant = (p: Position) => !p.user_id && !p.person_name.trim()

/** Сколько людей в отделе (сотрудники с учётной записью — без повторов, плюс люди без учётной записи) и сколько вакансий */
export function deptHeadcount(dept: Department, employees: { id: string; profile: { department_id: string | null } | null }[], positions: Position[]) {
  const own = positions.filter((p) => p.department_id === dept.id)
  const users = new Set(employees.filter((e) => e.profile?.department_id === dept.id).map((e) => e.id))
  if (dept.head_user_id) users.add(dept.head_user_id)
  let people = 0
  let vacancies = 0
  for (const p of own) {
    if (p.user_id) users.add(p.user_id)
    else if (isVacant(p)) vacancies += p.headcount
    else people += p.headcount
  }
  return { people: people + users.size, vacancies }
}

export interface StaffProfile {
  user_id: string
  department_id: string | null
  manager_id: string | null
  hire_date: string | null
  employment_type: EmploymentType
  experience_before_months: number | null
  review_interval_months: number
  next_review_on: string | null
}

export interface Skill {
  id: string
  name: string
  category: string
}

export interface SkillLevel {
  user_id: string
  skill_id: string
  level: number
}

export interface Experience {
  id: string
  user_id: string
  company: string
  role: string
  started_on: string | null
  ended_on: string | null
  note: string
}

export interface Review {
  id: string
  user_id: string
  reviewer_id: string | null
  period: string
  due_on: string
  status: keyof typeof REVIEW_STATUS_LABELS
  self_text: string
  self_submitted_at: string | null
  shared_at: string | null
  created_at: string
  assessment: { manager_text: string; rating: number | null; goals: string } | null
}

export interface StaffNote {
  id: string
  user_id: string
  author_id: string
  kind: NoteKind
  body: string
  remind_on: string | null
  reminded_at: string | null
  done_at: string | null
  created_at: string
}

/** Сотрудник компании = человек из справочника без внешних, плюс его карточка (если заведена) */
export interface Employee extends DirectoryPerson {
  profile: StaffProfile | null
}

const DEPT_COLS = 'id, parent_id, name, head_user_id, position, description, steps, outsourced_to, is_assistant'
const PROFILE_COLS = 'user_id, department_id, manager_id, hire_date, employment_type, experience_before_months, review_interval_months, next_review_on'

export const staffQuery = queryOptions({
  queryKey: ['staff'],
  queryFn: async () => {
    const [directory, profiles, departments, positions] = await Promise.all([
      supabase.rpc('people_directory'),
      supabase.from('staff_profiles').select(PROFILE_COLS),
      supabase.from('staff_departments').select(DEPT_COLS).order('position').order('name'),
      supabase.from('staff_positions').select('id, department_id, title, user_id, person_name, headcount, position').order('position').order('title'),
    ])
    if (directory.error) throw directory.error
    if (profiles.error) throw profiles.error
    if (departments.error) throw departments.error
    if (positions.error) throw positions.error
    const people = directory.data as unknown as DirectoryPerson[]
    const byUser = new Map((profiles.data as StaffProfile[]).map((p) => [p.user_id, p]))
    const employees: Employee[] = people
      .filter((p) => !p.is_external)
      .map((p) => ({ ...p, profile: byUser.get(p.id) ?? null }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
    return { employees, departments: departments.data as Department[], positions: positions.data as Position[] }
  },
})

export const skillsQuery = queryOptions({
  queryKey: ['staff', 'skills'],
  queryFn: async () => {
    const [skills, levels] = await Promise.all([
      supabase.from('staff_skills').select('id, name, category').order('category').order('name'),
      supabase.from('staff_skill_levels').select('user_id, skill_id, level'),
    ])
    if (skills.error) throw skills.error
    if (levels.error) throw levels.error
    return { skills: skills.data as Skill[], levels: levels.data as SkillLevel[] }
  },
})

export const experienceQuery = (userId: string) =>
  queryOptions({
    queryKey: ['staff', 'experience', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_experience')
        .select('id, user_id, company, role, started_on, ended_on, note')
        .eq('user_id', userId)
        .order('started_on', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as Experience[]
    },
  })

/** Оценки, которые видны текущему пользователю (свои, команды по цепочке или все — по правам); userId — одного сотрудника */
export const reviewsQuery = (userId?: string) =>
  queryOptions({
    queryKey: ['staff', 'reviews', userId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('staff_reviews')
        .select('id, user_id, reviewer_id, period, due_on, status, self_text, self_submitted_at, shared_at, created_at, assessment:staff_review_assessments(manager_text, rating, goals)')
        .order('created_at', { ascending: false })
      if (userId) q = q.eq('user_id', userId)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Review[]
    },
  })

/** Заметки руководителей о сотруднике. О себе база не отдаёт ничего. */
export const notesQuery = (userId: string) =>
  queryOptions({
    queryKey: ['staff', 'notes', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_notes')
        .select('id, user_id, author_id, kind, body, remind_on, reminded_at, done_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as StaffNote[]
    },
  })

// ---------------------------------------------------------------------------
// Связи руководителей
// ---------------------------------------------------------------------------

/** Руководитель ли `managerId` сотрудника `userId` по цепочке (как private.staff_is_manager_of) */
export function isManagerOf(employees: Employee[], managerId: string, userId: string): boolean {
  const byId = new Map(employees.map((e) => [e.id, e]))
  let cur = byId.get(userId)?.profile?.manager_id ?? null
  for (let i = 0; cur && i < 30; i++) {
    if (cur === managerId) return true
    cur = byId.get(cur)?.profile?.manager_id ?? null
  }
  return false
}

export const directReports = (employees: Employee[], managerId: string) => employees.filter((e) => e.profile?.manager_id === managerId)

/** Стаж: до компании (из карточки) + в компании (от даты найма) — в месяцах */
export function experienceMonths(p: StaffProfile | null): { before: number; inCompany: number } {
  const before = p?.experience_before_months ?? 0
  if (!p?.hire_date) return { before, inCompany: 0 }
  const h = new Date(`${p.hire_date}T00:00:00`)
  const now = new Date()
  const inCompany = Math.max(0, (now.getFullYear() - h.getFullYear()) * 12 + now.getMonth() - h.getMonth() - (now.getDate() < h.getDate() ? 1 : 0))
  return { before, inCompany }
}

export function formatMonths(m: number): string {
  const y = Math.floor(m / 12)
  const mo = m % 12
  if (y && mo) return tr('{{y}} г. {{m}} мес.', { y, m: mo })
  if (y) return tr('{{y}} г.', { y })
  return tr('{{m}} мес.', { m: mo })
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------
const must = <T,>(r: { error: unknown; data?: T }) => {
  if (r.error) throw r.error
  return r.data as T
}

export async function saveProfile(p: Partial<StaffProfile> & { user_id: string }): Promise<void> {
  must(await supabase.from('staff_profiles').upsert(p, { onConflict: 'user_id' }))
}

/** Должность сотрудника (users.job_title): сам человек, staff.manage или admin.users; пустая строка очищает */
export async function setJobTitle(userId: string, jobTitle: string): Promise<void> {
  must(await supabase.rpc('staff_set_job_title', { p_user: userId, p_job_title: jobTitle }))
}

export type DepartmentInput = Pick<Department, 'name' | 'parent_id' | 'head_user_id' | 'description' | 'steps' | 'outsourced_to' | 'is_assistant'> & { id?: string }

export async function saveDepartment({ id, ...row }: DepartmentInput): Promise<void> {
  if (id) must(await supabase.from('staff_departments').update(row).eq('id', id))
  else must(await supabase.from('staff_departments').insert(row))
}

export type PositionInput = Pick<Position, 'department_id' | 'title' | 'user_id' | 'person_name' | 'headcount'> & { id?: string }

export async function savePosition({ id, ...row }: PositionInput): Promise<void> {
  if (id) must(await supabase.from('staff_positions').update(row).eq('id', id))
  else must(await supabase.from('staff_positions').insert(row))
}

export async function deletePosition(id: string): Promise<void> {
  must(await supabase.from('staff_positions').delete().eq('id', id))
}

export async function deleteDepartment(id: string): Promise<void> {
  must(await supabase.from('staff_departments').delete().eq('id', id))
}

export async function addSkill(name: string, category: string): Promise<void> {
  must(await supabase.from('staff_skills').insert({ name: name.trim(), category: category.trim() }))
}

export async function deleteSkill(id: string): Promise<void> {
  must(await supabase.from('staff_skills').delete().eq('id', id))
}

export async function setSkillLevel(userId: string, skillId: string, level: number | null): Promise<void> {
  if (level === null) must(await supabase.from('staff_skill_levels').delete().eq('user_id', userId).eq('skill_id', skillId))
  else must(await supabase.from('staff_skill_levels').upsert({ user_id: userId, skill_id: skillId, level }, { onConflict: 'user_id,skill_id' }))
}

export async function saveExperience(e: Omit<Experience, 'id'> & { id?: string }): Promise<void> {
  const row = { user_id: e.user_id, company: e.company, role: e.role, started_on: e.started_on || null, ended_on: e.ended_on || null, note: e.note }
  if (e.id) must(await supabase.from('staff_experience').update(row).eq('id', e.id))
  else must(await supabase.from('staff_experience').insert(row))
}

export async function deleteExperience(id: string): Promise<void> {
  must(await supabase.from('staff_experience').delete().eq('id', id))
}

export async function addNote(n: { user_id: string; kind: NoteKind; body: string; remind_on: string | null }): Promise<void> {
  must(await supabase.from('staff_notes').insert(n))
}

export async function updateNote(id: string, patch: Partial<Pick<StaffNote, 'kind' | 'body' | 'remind_on' | 'done_at'>>): Promise<void> {
  must(await supabase.from('staff_notes').update(patch).eq('id', id))
}

export async function deleteNote(id: string): Promise<void> {
  must(await supabase.from('staff_notes').delete().eq('id', id))
}

export async function startReview(userId: string, period: string, dueOn: string, reviewerId: string | null): Promise<void> {
  must(await supabase.rpc('staff_review_start', { p_user: userId, p_period: period, p_due: dueOn, ...(reviewerId ? { p_reviewer: reviewerId } : {}) }))
}

export async function saveSelfReview(id: string, text: string, submit: boolean): Promise<void> {
  must(await supabase.rpc('staff_review_self', { p_review: id, p_text: text, p_submit: submit }))
}

export async function saveAssessment(id: string, a: { text: string; rating: number | null; goals: string }, share: boolean): Promise<void> {
  must(
    await supabase.rpc('staff_review_assess', {
      p_review: id,
      p_text: a.text,
      // null — пока без балла (у функции параметр smallint, генератор типов не знает про null)
      p_rating: a.rating as number,
      p_goals: a.goals,
      p_share: share,
    }),
  )
}

/** Понятный текст ошибки из базы */
export function staffError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  if (m.includes('manager_cycle')) return tr('Нельзя: этот человек уже подчиняется сотруднику (получилась бы петля).')
  if (m.includes('department_cycle')) return tr('Нельзя вложить отдел в самого себя или в свой подотдел.')
  if (m.includes('review_open')) return tr('У сотрудника уже есть незавершённая оценка.')
  if (m.includes('rating_required')) return tr('Чтобы поделиться итогом, поставьте оценку.')
  if (m.includes('invalid job_title')) return tr('Должность — не длиннее 120 знаков.')
  if (m.includes('bad_reviewer')) return tr('Оценивающим не может быть сам сотрудник.')
  if (m.includes('staff_skills_name_key') || m.includes('duplicate key')) return tr('Такой навык уже есть.')
  if (m.includes('permission denied') || m.includes('row-level security')) return tr('Недостаточно прав.')
  return tr('Не удалось сохранить. Попробуйте ещё раз.')
}
