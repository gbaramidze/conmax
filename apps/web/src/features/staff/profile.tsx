import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { birthdayRowQuery, birthdaysQuery, formatBirthDate, formatDayMonth, setBirthday, turnsLabel } from '@/features/birthdays/api'
import { jobTitleOptions, usedJobTitlesQuery } from '@/features/people/api'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import {
  deleteExperience,
  directReports,
  EMPLOYMENT_LABELS,
  experienceMonths,
  experienceQuery,
  formatMonths,
  saveExperience,
  saveProfile,
  setJobTitle,
  setSkillLevel,
  SKILL_LEVEL_LABELS,
  skillsQuery,
  staffError,
  type Employee,
  type EmploymentType,
  type Experience,
} from '@/features/staff/api'
import { fmtDate, PersonChip, selectCls, todayIso, useStaffAccess } from '@/features/staff/ui'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** Вкладка «Карточка»: место в структуре, стаж, график оценок, опыт работы */
export function ProfileTab({ person }: { person: Employee }) {
  const { byId, departments, employees, canManage, me } = useStaffAccess()
  const [editing, setEditing] = useState(false)
  const p = person.profile
  const manager = p?.manager_id ? byId.get(p.manager_id) : undefined
  const dept = departments.find((d) => d.id === p?.department_id)
  const reports = directReports(employees, person.id)
  const exp = experienceMonths(p)
  // день рождения: всем сотрудникам — день и месяц; себе и staff.manage — полная дата
  const { data: birthdays } = useQuery(birthdaysQuery)
  const birthday = birthdays?.find((b) => b.user_id === person.id)
  const { data: birthRow } = useQuery({ ...birthdayRowQuery(person.id), enabled: canManage || person.id === me })

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border bg-card p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium">{tr('Место в компании')}</h3>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> {tr('Изменить')}
            </Button>
          )}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={tr('Должность')}>{person.job_title || '—'}</Fact>
          <Fact label={tr('Отдел')}>{dept?.name ?? '—'}</Fact>
          <Fact label={tr('Руководитель')}>{manager ? <PersonChip person={manager} /> : '—'}</Fact>
          <Fact label={tr('Принят(а)')}>{fmtDate(p?.hire_date)}</Fact>
          <Fact label={tr('Занятость')}>{p ? EMPLOYMENT_LABELS[p.employment_type] : '—'}</Fact>
          <Fact label={tr('Стаж')}>
            {exp.before + exp.inCompany > 0
              ? tr('{{all}} (в компании {{inside}})', { all: formatMonths(exp.before + exp.inCompany), inside: formatMonths(exp.inCompany) })
              : '—'}
          </Fact>
          <Fact label={tr('Оценка эффективности')}>
            {tr('раз в {{n}} мес.', { n: p?.review_interval_months ?? 12 })}
            {p?.next_review_on && <span className="text-muted-foreground"> · {tr('следующая {{v1}}', { v1: fmtDate(p.next_review_on) })}</span>}
          </Fact>
          <Fact label={tr('Почта')}>{person.email}</Fact>
          {person.phone && <Fact label={tr('Телефон')}>{person.phone}</Fact>}
          <Fact label={tr('День рождения')}>
            {birthRow ? (
              <>
                {formatBirthDate(birthRow.birth_date)}
                {!birthRow.show_year && <span className="text-muted-foreground"> · {tr('год скрыт от коллег')}</span>}
              </>
            ) : birthday ? (
              <>
                {formatDayMonth(birthday.birth_month, birthday.birth_day)}
                {birthday.turns != null && <span className="text-muted-foreground"> · {turnsLabel(birthday)}</span>}
              </>
            ) : person.id === me ? (
              <Link to="/profile" className="font-medium underline underline-offset-4">
                {tr('Указать в профиле')}
              </Link>
            ) : (
              '—'
            )}
          </Fact>
        </dl>
        {reports.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <h4 className="mb-2 text-xs text-muted-foreground">{tr('Подчинённые · {{n}}', { n: reports.length })}</h4>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((r) => (
                <li key={r.id}>
                  <PersonChip person={r} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ExperienceSection person={person} canEdit={canManage || person.id === me} />
      {editing && <ProfileDialog person={person} birth={birthRow ?? null} onClose={() => setEditing(false)} />}
    </div>
  )
}

function ExperienceSection({ person, canEdit }: { person: Employee; canEdit: boolean }) {
  const { data: items } = useSuspenseQuery(experienceQuery(person.id))
  const [editing, setEditing] = useState<Experience | 'new' | null>(null)
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: deleteExperience,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff', 'experience', person.id] }),
    onError: (e) => toast.error(staffError(e)),
  })
  const period = (x: Experience) => `${x.started_on ? fmtDate(x.started_on) : '…'} — ${x.ended_on ? fmtDate(x.ended_on) : tr('по сей день')}`

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{tr('Опыт работы')}</h3>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus /> {tr('Добавить')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Прошлые места работы не указаны.')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((x) => (
            <li key={x.id} className="flex gap-3 rounded-lg border bg-card p-3 shadow-soft">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {x.role ? `${x.role} · ` : ''}
                  {x.company}
                </span>
                <span className="text-xs text-muted-foreground">{period(x)}</span>
                {x.note && <p className="mt-1 whitespace-pre-wrap text-sm">{x.note}</p>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(x)} aria-label={tr('Изменить запись «{{v1}}»', { v1: x.company })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => window.confirm(tr('Удалить запись «{{v1}}»?', { v1: x.company })) && remove.mutate(x.id)} aria-label={tr('Удалить запись «{{v1}}»', { v1: x.company })}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {editing && <ExperienceDialog userId={person.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ExperienceDialog({ userId, item, onClose }: { userId: string; item: Experience | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [company, setCompany] = useState(item?.company ?? '')
  const [role, setRole] = useState(item?.role ?? '')
  const [start, setStart] = useState(item?.started_on ?? '')
  const [end, setEnd] = useState(item?.ended_on ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const save = useMutation({
    mutationFn: () => saveExperience({ id: item?.id, user_id: userId, company: company.trim(), role: role.trim(), started_on: start || null, ended_on: end || null, note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff', 'experience', userId] })
      onClose()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? tr('Место работы') : tr('Новое место работы')}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Компания, роль и период')}</DialogDescription>
        </DialogHeader>
        <form
          id="exp-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (company.trim()) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-company">{tr('Компания')}</Label>
            <Input id="exp-company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={160} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-role">{tr('Роль')}</Label>
            <Input id="exp-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={160} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-start">{tr('С')}</Label>
              <DatePicker id="exp-start" value={start} onChange={setStart} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-end">{tr('По')}</Label>
              <DatePicker id="exp-end" value={end} onChange={setEnd} min={start || undefined} placeholder={tr('по сей день')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-note">{tr('Чем занимался(ась)')}</Label>
            <Textarea id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="exp-form" disabled={!company.trim() || save.isPending}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProfileDialog({ person, birth, onClose }: { person: Employee; birth: { birth_date: string; show_year: boolean } | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { departments, employees } = useStaffAccess()
  const p = person.profile
  const { data: usedTitles } = useQuery(usedJobTitlesQuery)
  const [jobTitle, setJobTitleValue] = useState(person.job_title ?? '')
  const jobChanged = jobTitle.trim() !== (person.job_title ?? '').trim()
  const [birthDate, setBirthDate] = useState(birth?.birth_date ?? '')
  const [showYear, setShowYear] = useState(birth?.show_year ?? false)
  const birthChanged = birthDate !== (birth?.birth_date ?? '') || showYear !== (birth?.show_year ?? false)
  const [dept, setDept] = useState(p?.department_id ?? '')
  const [manager, setManager] = useState(p?.manager_id ?? '')
  const [hire, setHire] = useState(p?.hire_date ?? '')
  const [type, setType] = useState<EmploymentType>(p?.employment_type ?? 'full_time')
  const [beforeYears, setBeforeYears] = useState(p?.experience_before_months != null ? String(Math.round((p.experience_before_months / 12) * 10) / 10) : '')
  const [interval, setInterval] = useState(p?.review_interval_months ?? 12)
  const [next, setNext] = useState(p?.next_review_on ?? '')
  const save = useMutation({
    mutationFn: async () => {
      await saveProfile({
        user_id: person.id,
        department_id: dept || null,
        manager_id: manager || null,
        hire_date: hire || null,
        employment_type: type,
        experience_before_months: beforeYears.trim() ? Math.round(Number(beforeYears.replace(',', '.')) * 12) : null,
        review_interval_months: interval,
        next_review_on: next || null,
      })
      if (jobChanged) await setJobTitle(person.id, jobTitle)
      if (birthChanged) await setBirthday(person.id, birthDate || null, showYear)
    },
    onSuccess: () => {
      toast.success(tr('Карточка сохранена'))
      void qc.invalidateQueries({ queryKey: ['staff'] })
      void qc.invalidateQueries({ queryKey: ['birthdays'] })
      if (jobChanged) {
        void qc.invalidateQueries({ queryKey: ['people-directory'] })
        void qc.invalidateQueries({ queryKey: ['used-job-titles'] })
      }
      onClose()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const badYears = beforeYears.trim() !== '' && !(Number(beforeYears.replace(',', '.')) >= 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{person.full_name}</DialogTitle>
          <DialogDescription>{tr('Должность, место в структуре, стаж и график оценок.')}</DialogDescription>
        </DialogHeader>
        <form
          id="profile-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!badYears) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="pf-job">{tr('Должность')}</Label>
            <Input
              id="pf-job"
              list="pf-job-titles"
              autoComplete="off"
              maxLength={120}
              value={jobTitle}
              onChange={(e) => setJobTitleValue(e.target.value)}
              placeholder={tr('Выберите из списка или введите свою')}
            />
            <datalist id="pf-job-titles">
              {jobTitleOptions(usedTitles).map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-dept">{tr('Отдел')}</Label>
            <select id="pf-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={selectCls}>
              <option value="">{tr('— без отдела —')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-manager">{tr('Руководитель')}</Label>
            <select id="pf-manager" value={manager} onChange={(e) => setManager(e.target.value)} className={selectCls}>
              <option value="">{tr('— нет —')}</option>
              {employees
                .filter((e) => e.id !== person.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-hire">{tr('Дата приёма')}</Label>
            <DatePicker id="pf-hire" value={hire} onChange={setHire} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-type">{tr('Занятость')}</Label>
            <select id="pf-type" value={type} onChange={(e) => setType(e.target.value as EmploymentType)} className={selectCls}>
              {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map((k) => (
                <option key={k} value={k}>
                  {EMPLOYMENT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-before">{tr('Стаж до компании, лет')}</Label>
            <Input id="pf-before" inputMode="decimal" value={beforeYears} onChange={(e) => setBeforeYears(e.target.value)} aria-invalid={badYears} placeholder="0" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-interval">{tr('Оценка эффективности')}</Label>
            <select id="pf-interval" value={interval} onChange={(e) => setInterval(Number(e.target.value))} className={selectCls}>
              <option value={3}>{tr('раз в квартал')}</option>
              <option value={6}>{tr('раз в полгода')}</option>
              <option value={12}>{tr('раз в год')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="pf-next">{tr('Следующая оценка')}</Label>
            <DatePicker id="pf-next" value={next} onChange={setNext} placeholder={tr('не назначена')} />
            <p className="text-xs text-muted-foreground">{tr('За 2 недели руководитель получит напоминание начать оценку.')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-birth">{tr('Дата рождения')}</Label>
            <DatePicker id="pf-birth" value={birthDate} onChange={setBirthDate} min="1900-01-01" max={todayIso()} openTo="1990-01-01" placeholder={tr('не указана')} />
          </div>
          <label className="flex min-h-11 items-center gap-2 self-end text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={showYear} disabled={!birthDate} onChange={(e) => setShowYear(e.target.checked)} />
            {tr('Показывать коллегам возраст')}
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="profile-form" disabled={badYears || save.isPending}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Вкладка «Навыки» карточки: уровни сотрудника; править может он сам, его руководители и отдел кадров */
export function PersonSkills({ person }: { person: Employee }) {
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(skillsQuery)
  const { me, leads } = useStaffAccess()
  const canEdit = person.id === me || leads(person.id)
  const mine = new Map(data.levels.filter((l) => l.user_id === person.id).map((l) => [l.skill_id, l.level]))
  const set = useMutation({
    mutationFn: (v: { skill: string; level: number | null }) => setSkillLevel(person.id, v.skill, v.level),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff', 'skills'] }),
    onError: (e) => toast.error(staffError(e)),
  })
  const groups = [...new Set(data.skills.map((s) => s.category))]
  if (data.skills.length === 0) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{tr('Каталог навыков ещё не заполнен (вкладка «Матрица навыков»).')}</p>

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g || '-'} className="flex flex-col gap-2">
          {g && <h3 className="text-xs font-medium text-muted-foreground">{g}</h3>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.skills
              .filter((s) => s.category === g)
              .filter((s) => canEdit || mine.has(s.id))
              .map((s) => {
                const v = mine.get(s.id)
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    <span className="flex gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-2 w-4 rounded-sm ${v && n <= v ? 'bg-primary' : 'bg-muted'}`} />
                      ))}
                    </span>
                    {canEdit ? (
                      <select value={v ?? 0} onChange={(e) => set.mutate({ skill: s.id, level: Number(e.target.value) || null })} aria-label={tr('Уровень навыка «{{v1}}»', { v1: s.name })} className={cn(selectCls, 'w-36')}>
                        <option value={0}>{tr('не указан')}</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} — {SKILL_LEVEL_LABELS[n]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="w-28 text-right text-xs text-muted-foreground">{v ? `${v} — ${SKILL_LEVEL_LABELS[v]}` : ''}</span>
                    )}
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
    </div>
  )
}
