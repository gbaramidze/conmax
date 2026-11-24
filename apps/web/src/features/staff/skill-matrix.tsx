import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { addSkill, deleteSkill, setSkillLevel, SKILL_LEVEL_LABELS, skillsQuery, staffError, type Employee } from '@/features/staff/api'
import { PersonChip, selectCls, useStaffAccess } from '@/features/staff/ui'

/** Цвет уровня: чем выше, тем насыщеннее (не только цвет — в ячейке ещё и цифра) */
const levelCls = (n: number | undefined) =>
  !n
    ? 'text-muted-foreground/50'
    : n >= 5
      ? 'bg-primary text-signal font-semibold'
      : n >= 4
        ? 'bg-primary/80 text-primary-foreground'
        : n >= 3
          ? 'bg-primary/45 text-primary-foreground'
          : n >= 2
            ? 'bg-primary/20 text-foreground'
            : 'bg-primary/10 text-foreground'

/**
 * Матрица навыков: строки — сотрудники, столбцы — навыки (по категориям). Уровень 1–5 правят сам сотрудник,
 * его руководители и право staff.manage; каталог навыков — staff.manage. Фильтр по отделу и навыку.
 */
export function SkillMatrix() {
  const qc = useQueryClient()
  const { data } = useSuspenseQuery(skillsQuery)
  const { employees, departments, canManage, leads, me } = useStaffAccess()
  const [dept, setDept] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [minLevel, setMinLevel] = useState(0)
  const [newSkill, setNewSkill] = useState('')
  const [newCat, setNewCat] = useState('')

  const level = useMemo(() => new Map(data.levels.map((l) => [`${l.user_id}:${l.skill_id}`, l.level])), [data.levels])
  const skills = data.skills.filter((s) => !skillFilter || s.id === skillFilter)
  const people = employees.filter(
    (e) => (!dept || e.profile?.department_id === dept) && (!skillFilter || minLevel === 0 || (level.get(`${e.id}:${skillFilter}`) ?? 0) >= minLevel),
  )

  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff', 'skills'] })
  const setLevel = useMutation({
    mutationFn: (v: { user: string; skill: string; level: number | null }) => setSkillLevel(v.user, v.skill, v.level),
    onSuccess: refresh,
    onError: (e) => toast.error(staffError(e)),
  })
  const add = useMutation({
    mutationFn: () => addSkill(newSkill, newCat),
    onSuccess: () => {
      setNewSkill('')
      refresh()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const remove = useMutation({ mutationFn: deleteSkill, onSuccess: refresh, onError: (e) => toast.error(staffError(e)) })

  const canEdit = (e: Employee) => e.id === me || leads(e.id)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
          {tr('Отдел')}
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={selectCls}>
            <option value="">{tr('Все отделы')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
          {tr('Навык')}
          <select value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} className={selectCls}>
            <option value="">{tr('Все навыки')}</option>
            {data.skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {skillFilter && (
          <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
            {tr('Уровень не ниже')}
            <select value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))} className={selectCls}>
              <option value={0}>{tr('Любой (все люди)')}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} — {SKILL_LEVEL_LABELS[n]}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label={tr('Уровни')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="inline-flex items-center gap-1">
              <span className={cn('inline-flex size-5 items-center justify-center rounded text-[11px]', levelCls(n))}>{n}</span>
              {SKILL_LEVEL_LABELS[n]}
            </span>
          ))}
        </p>
      </div>

      {canManage && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (newSkill.trim()) add.mutate()
          }}
        >
          <Input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder={tr('Новый навык, например «Revit»')} maxLength={80} className="w-56" aria-label={tr('Название навыка')} />
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={tr('Категория (необязательно)')} maxLength={60} className="w-48" aria-label={tr('Категория навыка')} list="skill-categories" />
          <datalist id="skill-categories">
            {[...new Set(data.skills.map((s) => s.category).filter(Boolean))].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Button type="submit" variant="outline" size="sm" disabled={!newSkill.trim() || add.isPending}>
            <Plus /> {tr('Добавить навык')}
          </Button>
        </form>
      )}

      {data.skills.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {canManage ? tr('Навыков пока нет — добавьте первые выше, например «AutoCAD», «Сметы», «Монолит».') : tr('Каталог навыков ещё не заполнен.')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className="sticky left-0 z-10 min-w-52 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  {tr('Сотрудник')}
                </th>
                {skills.map((s) => (
                  <th key={s.id} scope="col" className="min-w-24 px-2 py-2 text-center align-bottom text-xs font-medium">
                    {s.category && <span className="block text-[10.5px] font-normal text-muted-foreground">{s.category}</span>}
                    <span className="inline-flex items-center gap-1">
                      {s.name}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => window.confirm(tr('Удалить навык «{{v1}}» вместе с уровнями всех сотрудников?', { v1: s.name })) && remove.mutate(s.id)}
                          aria-label={tr('Удалить навык «{{v1}}»', { v1: s.name })}
                          className="rounded p-0.5 text-muted-foreground/60 outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal">
                    <PersonChip person={e} />
                  </th>
                  {skills.map((s) => {
                    const v = level.get(`${e.id}:${s.id}`)
                    return (
                      <td key={s.id} className="px-2 py-1.5 text-center">
                        {canEdit(e) ? (
                          <select
                            value={v ?? 0}
                            onChange={(ev) => setLevel.mutate({ user: e.id, skill: s.id, level: Number(ev.target.value) || null })}
                            aria-label={tr('{{v1}}: уровень навыка «{{v2}}»', { v1: e.full_name, v2: s.name })}
                            title={v ? SKILL_LEVEL_LABELS[v] : tr('не указан')}
                            className={cn('h-8 w-12 cursor-pointer appearance-none rounded text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', levelCls(v), !v && 'border border-dashed bg-transparent')}
                          >
                            <option value={0}>·</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span title={v ? SKILL_LEVEL_LABELS[v] : tr('не указан')} className={cn('inline-flex size-8 items-center justify-center rounded text-sm', levelCls(v))}>
                            {v ?? '·'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
