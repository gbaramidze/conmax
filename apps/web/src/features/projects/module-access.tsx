import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { projectMembersQuery } from '@/features/projects/api'
import { moduleDef, setModuleAccess, type ModuleAccess, type ModuleKey } from '@/features/projects/modules'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** Строка «кому открыт модуль» на карточке модуля в настройках проекта. */
export function AccessLine({ module, access, canManage, onEdit }: { module: ModuleKey; access: ModuleAccess | undefined; canManage: boolean; onEdit: () => void }) {
  const restricted = access?.restricted.has(module) ?? false
  const people = access?.users.get(module)?.length ?? 0
  const roles = access?.roles.get(module)?.length ?? 0
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
      {restricted ? <Lock className="size-3.5 text-amber-600" aria-hidden /> : <Users className="size-3.5 text-muted-foreground" aria-hidden />}
      <span className={restricted ? 'font-medium' : 'text-muted-foreground'}>
        {restricted ? tr('Доступ: только выбранным — людей {{p}}, ролей {{r}}', { p: people, r: roles }) : tr('Доступ: всем участникам проекта по их ролям')}
      </span>
      {canManage && (
        <button type="button" onClick={onEdit} className="ml-auto font-medium text-primary underline-offset-2 hover:underline">
          {tr('Настроить доступ')}
        </button>
      )}
    </div>
  )
}

/** Кому открыт модуль: всем участникам или только выбранным людям и ролям. Ограничение действует и на сервере. */
export function ModuleAccessDialog({ projectId, module, access, onClose }: { projectId: string; module: ModuleKey; access: ModuleAccess | undefined; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const [restricted, setRestricted] = useState(access?.restricted.has(module) ?? false)
  const [users, setUsers] = useState<Set<string>>(() => new Set(access?.users.get(module) ?? []))
  const [roles, setRoles] = useState<Set<string>>(() => new Set(access?.roles.get(module) ?? []))
  const [busy, setBusy] = useState(false)
  const name = t(moduleDef(module).label)

  const roleList = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>()
    for (const x of members) {
      const r = x.role as { id: string; name: string } | null
      if (!r) continue
      const cur = m.get(r.id) ?? { id: r.id, name: r.name, count: 0 }
      cur.count += 1
      m.set(r.id, cur)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [members])

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    apply(n)
  }

  const save = async () => {
    setBusy(true)
    try {
      await setModuleAccess(projectId, module, restricted, [...users], [...roles])
      await Promise.all([qc.invalidateQueries({ queryKey: ['module-access', projectId] }), qc.invalidateQueries({ queryKey: ['projects'] }), qc.invalidateQueries({ queryKey: ['my-permissions'] })])
      toast.success(restricted ? tr('Модуль «{{v1}}» открыт только выбранным', { v1: name }) : tr('Модуль «{{v1}}» открыт всем участникам', { v1: name }))
      onClose()
    } catch {
      toast.error(tr('Не удалось сохранить доступ. Попробуйте ещё раз.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Кому открыт модуль «{{v1}}»', { v1: name })}</DialogTitle>
          <DialogDescription>
            {tr('Закрытый модуль пропадает из меню у остальных, а его данные им не отдаются — ни на экране, ни в выгрузках и уведомлениях. Руководитель проекта видит модуль всегда.')}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={tr('Доступ')} className="flex flex-col gap-2">
          {(
            [
              [false, tr('Всем участникам проекта'), tr('Каждый видит то, что разрешает его роль в проекте — как сейчас.')],
              [true, tr('Только выбранным людям и ролям'), tr('Остальные участники модуль не увидят.')],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={restricted === value}
              onClick={() => setRestricted(value)}
              className={cn('flex items-start gap-3 rounded-lg border p-3 text-left', restricted === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}
            >
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', restricted === value && 'border-primary')}>
                {restricted === value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        {restricted && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">{tr('Роли — все, у кого эта роль в проекте')}</legend>
              {roleList.length === 0 && <p className="text-sm text-muted-foreground">{tr('В проекте пока нет участников.')}</p>}
              {roleList.map((r) => (
                <label key={r.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded px-1 text-sm hover:bg-muted/50">
                  <input type="checkbox" className="size-4" checked={roles.has(r.id)} onChange={() => toggle(roles, r.id, setRoles)} />
                  <span className="flex-1">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{tr('человек: {{n}}', { n: r.count })}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">{tr('Отдельные люди')}</legend>
              {members.map((x) => {
                const u = x.user as { id: string; full_name: string | null; email: string } | null
                const r = x.role as { id: string; name: string } | null
                if (!u) return null
                const viaRole = !!r && roles.has(r.id)
                return (
                  <label key={x.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded px-1 text-sm hover:bg-muted/50">
                    <input type="checkbox" className="size-4" checked={viaRole || users.has(u.id)} disabled={viaRole} onChange={() => toggle(users, u.id, setUsers)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{u.full_name || u.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[r?.name, viaRole ? tr('открыт по роли') : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
            {users.size === 0 && roles.size === 0 && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">{tr('Никто не выбран: модуль увидит только руководитель проекта.')}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? tr('Сохраняем…') : tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
