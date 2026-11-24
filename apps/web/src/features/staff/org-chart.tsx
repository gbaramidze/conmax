import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building, ChevronRight, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { deleteDepartment, directReports, saveDepartment, staffError, type Department, type Employee } from '@/features/staff/api'
import { DepartmentSheet } from '@/features/staff/department-sheet'
import { OrgDiagram } from '@/features/staff/org-diagram'
import { PersonChip, selectCls, useStaffAccess } from '@/features/staff/ui'

/**
 * Оргструктура в трёх видах: схема (дерево отделов с линиями, как оргсхема в PowerPoint), по отделам (вложенный список,
 * у каждого руководитель и люди) и по руководителям (кто кому подчиняется). Отделы и штат правит право staff.manage.
 */
export function OrgChart() {
  const [view, setView] = useState<'chart' | 'departments' | 'managers'>('chart')
  const { canManage, departments } = useStaffAccess()
  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const [opened, setOpened] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={tr('Вид оргструктуры')} className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ['chart', tr('Схема')],
              ['departments', tr('По отделам')],
              ['managers', tr('По руководителям')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn('min-h-9 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', view === id ? 'bg-card font-medium shadow-soft' : 'text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        {canManage && view !== 'managers' && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus /> {tr('Отдел')}
          </Button>
        )}
      </div>
      {view === 'chart' && departments.length > 0 && <OrgDiagram onOpen={(d) => setOpened(d.id)} onShowUnassigned={() => setView('departments')} />}
      {(view === 'departments' || (view === 'chart' && departments.length === 0)) && <DepartmentsView onEdit={canManage ? setEditing : undefined} />}
      {view === 'managers' && <ManagersView />}
      {opened && <DepartmentSheet deptId={opened} onNavigate={setOpened} onClose={() => setOpened(null)} onEdit={canManage ? setEditing : undefined} />}
      {editing && (
        <DepartmentDialog
          dept={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDeleted={() => setOpened(null)}
        />
      )}
    </div>
  )
}

function DepartmentsView({ onEdit }: { onEdit?: (d: Department) => void }) {
  const { departments, employees } = useStaffAccess()
  const roots = departments.filter((d) => !d.parent_id || !departments.some((x) => x.id === d.parent_id))
  const unassigned = employees.filter((e) => !e.profile?.department_id || !departments.some((d) => d.id === e.profile?.department_id))

  return (
    <div className="flex flex-col gap-3">
      {departments.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {onEdit ? tr('Отделов пока нет. Добавьте первый отдел, затем распределите сотрудников в их карточках.') : tr('Отделы ещё не заведены.')}
        </p>
      )}
      {roots.map((d) => (
        <DepartmentNode key={d.id} dept={d} depth={0} onEdit={onEdit} />
      ))}
      {unassigned.length > 0 && (
        <section className="rounded-lg border border-dashed bg-card/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Users className="size-4" aria-hidden /> {tr('Без отдела')} · {unassigned.length}
          </h3>
          <PeopleGrid people={unassigned} />
        </section>
      )}
    </div>
  )
}

function DepartmentNode({ dept, depth, onEdit }: { dept: Department; depth: number; onEdit?: (d: Department) => void }) {
  const { departments, employees, byId } = useStaffAccess()
  const [open, setOpen] = useState(true)
  const children = departments.filter((d) => d.parent_id === dept.id)
  const members = employees.filter((e) => e.profile?.department_id === dept.id && e.id !== dept.head_user_id)
  const head = dept.head_user_id ? byId.get(dept.head_user_id) : undefined
  const total = (function count(id: string): number {
    return employees.filter((e) => e.profile?.department_id === id).length + departments.filter((d) => d.parent_id === id).reduce((s, d) => s + count(d.id), 0)
  })(dept.id)

  return (
    <section className={cn('rounded-lg border bg-card shadow-soft', depth > 0 && 'shadow-none')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
          <Building className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium">{dept.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{tr('{{n}} чел.', { n: total })}</span>
        </button>
        {onEdit && (
          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(dept)} aria-label={tr('Изменить отдел «{{v1}}»', { v1: dept.name })}>
            <Pencil />
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{tr('Руководитель отдела')}</span>
            {head ? <PersonChip person={head} /> : <span className="text-sm text-muted-foreground">{tr('не назначен')}</span>}
          </div>
          {members.length > 0 && <PeopleGrid people={members} />}
          {children.length > 0 && (
            <div className="flex flex-col gap-2 border-l-2 pl-3">
              {children.map((c) => (
                <DepartmentNode key={c.id} dept={c} depth={depth + 1} onEdit={onEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PeopleGrid({ people }: { people: Employee[] }) {
  const { byId } = useStaffAccess()
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((e) => {
        const mgr = e.profile?.manager_id ? byId.get(e.profile.manager_id) : undefined
        return (
          <li key={e.id} className="rounded-md border px-2.5 py-2">
            <PersonChip person={e} sub={[e.job_title, mgr ? tr('рук.: {{v1}}', { v1: mgr.full_name }) : null].filter(Boolean).join(' · ') || null} />
          </li>
        )
      })}
    </ul>
  )
}

/** Дерево подчинения: сверху те, у кого нет руководителя, под каждым — его прямые подчинённые */
function ManagersView() {
  const { employees } = useStaffAccess()
  const ids = new Set(employees.map((e) => e.id))
  const tops = employees.filter((e) => !e.profile?.manager_id || !ids.has(e.profile.manager_id))
  const withReports = tops.filter((e) => directReports(employees, e.id).length > 0)
  const alone = tops.filter((e) => directReports(employees, e.id).length === 0)

  return (
    <div className="flex flex-col gap-3">
      {withReports.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{tr('Руководители ещё не назначены. Укажите руководителя в карточке сотрудника.')}</p>
      )}
      {withReports.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border bg-card p-3 shadow-soft">
          {withReports.map((e) => (
            <ManagerNode key={e.id} person={e} depth={0} />
          ))}
        </ul>
      )}
      {alone.length > 0 && (
        <section className="rounded-lg border border-dashed p-4">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            {tr('Без руководителя и подчинённых')} · {alone.length}
          </h3>
          <PeopleGrid people={alone} />
        </section>
      )}
    </div>
  )
}

function ManagerNode({ person, depth }: { person: Employee; depth: number }) {
  const { employees } = useStaffAccess()
  const reports = directReports(employees, person.id)
  const [open, setOpen] = useState(depth < 2)
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-1">
        {reports.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? tr('Свернуть подчинённых {{v1}}', { v1: person.full_name }) : tr('Показать подчинённых {{v1}}', { v1: person.full_name })}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-8 shrink-0" />
        )}
        <PersonChip person={person} className="py-1" />
        {reports.length > 0 && <span className="ml-1 shrink-0 text-xs text-muted-foreground">{tr('подчинённых: {{n}}', { n: reports.length })}</span>}
      </div>
      {open && reports.length > 0 && (
        <ul className="ml-4 flex flex-col gap-0.5 border-l pl-2">
          {reports.map((r) => (
            <ManagerNode key={r.id} person={r} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function DepartmentDialog({ dept, onClose, onDeleted }: { dept: Department | null; onClose: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient()
  const { departments, employees } = useStaffAccess()
  const [name, setName] = useState(dept?.name ?? '')
  const [parent, setParent] = useState(dept?.parent_id ?? '')
  const [head, setHead] = useState(dept?.head_user_id ?? '')
  const [assistant, setAssistant] = useState(dept?.is_assistant ?? false)
  const [outsourced, setOutsourced] = useState(!!dept?.outsourced_to)
  const [vendor, setVendor] = useState(dept?.outsourced_to ?? '')
  const [description, setDescription] = useState(dept?.description ?? '')
  const [steps, setSteps] = useState((dept?.steps ?? []).join('\n'))
  const stepList = steps
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['staff'] })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      saveDepartment({
        id: dept?.id,
        name: name.trim(),
        parent_id: parent || null,
        head_user_id: head || null,
        is_assistant: !!parent && assistant,
        outsourced_to: outsourced && vendor.trim() ? vendor.trim() : null,
        description: description.trim(),
        steps: stepList.slice(0, 30).map((s) => s.slice(0, 200)),
      }),
    onSuccess: () => {
      toast.success(tr('Отдел сохранён'))
      done()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const remove = useMutation({
    mutationFn: () => deleteDepartment(dept!.id),
    onSuccess: () => {
      toast.success(tr('Отдел удалён'))
      onDeleted?.()
      done()
    },
    onError: (e) => toast.error(staffError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dept ? tr('Отдел') : tr('Новый отдел')}</DialogTitle>
          <DialogDescription>{tr('Сотрудников в отдел добавляют в их карточках, должности и вакансии — в карточке отдела на схеме.')}</DialogDescription>
        </DialogHeader>
        <form
          id="dept-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-name">{tr('Название')}</Label>
            <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-parent">{tr('Входит в отдел')}</Label>
            <select id="dept-parent" value={parent} onChange={(e) => setParent(e.target.value)} className={selectCls}>
              <option value="">{tr('— верхний уровень —')}</option>
              {departments
                .filter((d) => d.id !== dept?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-head">{tr('Руководитель отдела')}</Label>
            <select id="dept-head" value={head} onChange={(e) => setHead(e.target.value)} className={selectCls}>
              <option value="">{tr('— не назначен —')}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </div>
          {parent && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={assistant} onChange={(e) => setAssistant(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>
                {tr('При руководителе')}
                <span className="block text-xs text-muted-foreground">{tr('Подчиняется руководителю вышестоящего отдела напрямую (помощник, координатор). На схеме — сбоку.')}</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={outsourced} onChange={(e) => setOutsourced(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>{tr('Отдан на аутсорс')}</span>
          </label>
          {outsourced && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dept-vendor">{tr('Кому')}</Label>
              <Input id="dept-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={120} placeholder={tr('Название компании')} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-desc">{tr('Чем занимается отдел')}</Label>
            <Textarea id="dept-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} rows={4} className="max-h-60" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dept-steps">{tr('Порядок работ')}</Label>
            <Textarea id="dept-steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} className="max-h-60" placeholder={tr('Каждый шаг с новой строки')} />
            <p className="text-xs text-muted-foreground">
              {stepList.length > 0 ? tr('Шагов: {{n}}. Каждый шаг — с новой строки.', { n: stepList.length }) : tr('Каждый шаг — с новой строки, по порядку.')}
            </p>
          </div>
        </form>
        <DialogFooter className="sm:justify-between">
          {dept ? (
            <Button variant="destructive" onClick={() => window.confirm(tr('Удалить отдел «{{v1}}»? Сотрудники и подотделы останутся без отдела.', { v1: dept.name })) && remove.mutate()} disabled={remove.isPending}>
              <Trash2 /> {tr('Удалить')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" form="dept-form" disabled={!name.trim() || save.isPending}>
              {tr('Сохранить')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
