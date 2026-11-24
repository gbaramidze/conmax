import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building, CornerLeftUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { deletePosition, deptHeadcount, isVacant, savePosition, staffError, type Department, type Position } from '@/features/staff/api'
import { PersonChip, selectCls, useStaffAccess } from '@/features/staff/ui'

/**
 * Карточка отдела сбоку от схемы: чем занимается отдел, порядок работ по шагам, руководитель, штат (позиции и вакансии),
 * сотрудники и подотделы. Правит право staff.manage.
 */
export function DepartmentSheet({ deptId, onNavigate, onClose, onEdit }: { deptId: string; onNavigate: (id: string) => void; onClose: () => void; onEdit?: (d: Department) => void }) {
  const { departments, employees, positions, byId, canManage } = useStaffAccess()
  const [positionForm, setPositionForm] = useState<Position | 'new' | null>(null)
  const dept = departments.find((d) => d.id === deptId)
  if (!dept) return null

  const parent = dept.parent_id ? departments.find((d) => d.id === dept.parent_id) : undefined
  const children = departments.filter((d) => d.parent_id === dept.id)
  const own = positions.filter((p) => p.department_id === dept.id)
  const head = dept.head_user_id ? byId.get(dept.head_user_id) : undefined
  const inPositions = new Set(own.map((p) => p.user_id).filter(Boolean))
  const members = employees.filter((e) => e.profile?.department_id === dept.id && e.id !== dept.head_user_id && !inPositions.has(e.id))
  const { people, vacancies } = deptHeadcount(dept, employees, positions)

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          {parent && (
            <button
              type="button"
              onClick={() => onNavigate(parent.id)}
              className="flex w-fit items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CornerLeftUp className="size-3.5" aria-hidden /> {parent.name}
            </button>
          )}
          <SheetTitle className="pr-8 text-lg">{dept.name}</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-x-3 gap-y-1">
            <span>{tr('{{n}} чел.', { n: people })}</span>
            {vacancies > 0 && <span className="text-amber-700 dark:text-amber-400">{tr('вакансий: {{n}}', { n: vacancies })}</span>}
            {dept.outsourced_to && <span>{tr('Аутсорс: {{v1}}', { v1: dept.outsourced_to })}</span>}
            {dept.is_assistant && parent && <span>{tr('Подчиняется руководителю отдела «{{v1}}»', { v1: parent.name })}</span>}
          </SheetDescription>
          {onEdit && (
            <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => onEdit(dept)}>
              <Pencil /> {tr('Изменить отдел')}
            </Button>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-6 p-4">
          <Section title={tr('Руководитель')}>
            {head ? <PersonChip person={head} /> : <p className="text-sm text-muted-foreground">{tr('Не назначен.')}</p>}
          </Section>

          <Section title={tr('Чем занимается отдел')}>
            {dept.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{dept.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{canManage ? tr('Описания пока нет — добавьте его в «Изменить отдел».') : tr('Описания пока нет.')}</p>
            )}
          </Section>

          {dept.steps.length > 0 && (
            <Section title={tr('Порядок работ')}>
              <ol className="flex flex-col gap-1.5">
                {dept.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 rounded-md border bg-card px-2.5 py-1.5 text-sm">{s}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <Section
            title={tr('Штат')}
            action={
              canManage && (
                <Button variant="ghost" size="sm" onClick={() => setPositionForm('new')}>
                  <Plus /> {tr('Позиция')}
                </Button>
              )
            }
          >
            {own.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {canManage ? tr('Добавьте должности отдела: занятые, вакансии и группы без учётной записи (например, «Охранники, 8 чел.»).') : tr('Должности не заведены.')}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {own.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-sm font-medium">
                        {p.title}
                        {p.headcount > 1 && <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">×{p.headcount}</span>}
                      </span>
                      {p.user_id ? (
                        <PersonChip person={byId.get(p.user_id)} sub={null} />
                      ) : isVacant(p) ? (
                        <span className="w-fit rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{tr('Вакансия')}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {p.person_name} <span className="text-xs">· {tr('без учётной записи')}</span>
                        </span>
                      )}
                    </div>
                    {canManage && (
                      <Button variant="ghost" size="icon-sm" onClick={() => setPositionForm(p)} aria-label={tr('Изменить позицию «{{v1}}»', { v1: p.title })}>
                        <Pencil />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {members.length > 0 && (
            <Section title={tr('Сотрудники отдела')}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {members.map((e) => (
                  <li key={e.id} className="rounded-md border px-2.5 py-2">
                    <PersonChip person={e} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {children.length > 0 && (
            <Section title={tr('Подотделы')}>
              <ul className="flex flex-col gap-1">
                {children.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(c.id)}
                      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Building className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{tr('{{n}} чел.', { n: deptHeadcount(c, employees, positions).people })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        {positionForm && <PositionDialog deptId={dept.id} position={positionForm === 'new' ? null : positionForm} onClose={() => setPositionForm(null)} />}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Кто занимает позицию: сотрудник из справочника, человек без учётной записи или никто (вакансия) */
type Holder = 'vacant' | 'name' | `user:${string}`

function PositionDialog({ deptId, position, onClose }: { deptId: string; position: Position | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { employees } = useStaffAccess()
  const [title, setTitle] = useState(position?.title ?? '')
  const [holder, setHolder] = useState<Holder>(position?.user_id ? `user:${position.user_id}` : position?.person_name ? 'name' : 'vacant')
  const [name, setName] = useState(position?.person_name ?? '')
  const [count, setCount] = useState(String(position?.headcount ?? 1))
  const headcount = Math.min(9999, Math.max(1, Math.round(Number(count)) || 1))
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['staff'] })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      savePosition({
        id: position?.id,
        department_id: deptId,
        title: title.trim(),
        user_id: holder.startsWith('user:') ? holder.slice(5) : null,
        person_name: holder === 'name' ? name.trim() : '',
        headcount,
      }),
    onSuccess: () => {
      toast.success(tr('Позиция сохранена'))
      done()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const remove = useMutation({
    mutationFn: () => deletePosition(position!.id),
    onSuccess: () => {
      toast.success(tr('Позиция удалена'))
      done()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const valid = title.trim() && (holder !== 'name' || name.trim())

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{position ? tr('Позиция') : tr('Новая позиция')}</DialogTitle>
          <DialogDescription>{tr('Пустая позиция показывается на схеме как вакансия.')}</DialogDescription>
        </DialogHeader>
        <form
          id="position-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pos-title">{tr('Должность')}</Label>
            <Input id="pos-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Site Supervisor" required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pos-holder">{tr('Кто занимает')}</Label>
            <select id="pos-holder" value={holder} onChange={(e) => setHolder(e.target.value as Holder)} className={selectCls}>
              <option value="vacant">{tr('— никто, вакансия —')}</option>
              <option value="name">{tr('Человек без учётной записи…')}</option>
              <optgroup label={tr('Сотрудники')}>
                {employees.map((e) => (
                  <option key={e.id} value={`user:${e.id}`}>
                    {e.full_name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          {holder === 'name' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pos-name">{tr('Имя')}</Label>
              <Input id="pos-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pos-count">{tr('Сколько человек')}</Label>
            <Input id="pos-count" type="number" inputMode="numeric" min={1} max={9999} value={count} onChange={(e) => setCount(e.target.value)} className={cn('w-28')} />
            <p className="text-xs text-muted-foreground">{tr('Больше одного — для групп: охранники, разнорабочие, операторы техники.')}</p>
          </div>
        </form>
        <DialogFooter className="sm:justify-between">
          {position ? (
            <Button variant="destructive" onClick={() => window.confirm(tr('Удалить позицию «{{v1}}»?', { v1: position.title })) && remove.mutate()} disabled={remove.isPending}>
              <Trash2 /> {tr('Удалить')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" form="position-form" disabled={!valid || save.isPending}>
              {tr('Сохранить')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
