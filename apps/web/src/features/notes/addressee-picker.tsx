import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { SearchSelect } from '@/components/search-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery, disciplineSubtreeIds } from '@/features/disciplines/api'
import { UserAvatar } from '@/features/profile/avatar'
import { orgMembersQuery, orgOverviewQuery } from '@/features/contractors/api'
import { NO_ADDRESSEE, type Addressee } from '@/features/notes/api'
import { cn } from '@/lib/utils'

type Kind = 'none' | 'user' | 'org'

/**
 * Выбор адресата: три крупные кнопки «Никому / Сотруднику / Подрядчику» и список под выбранной.
 * Список сотрудников — участники проекта, подрядчиков — организации проекта.
 */
export function AddresseePicker({ projectId, value, onChange }: { projectId: string; value: Addressee; onChange: (v: Addressee) => void }) {
  const { session } = useAuth()
  const me = session?.user.id
  const { data: members = [] } = useQuery(orgMembersQuery(projectId))
  const { data: orgs = [] } = useQuery(orgOverviewQuery(projectId))
  const { data: disciplines = [] } = useQuery(disciplinesQuery(projectId))
  const [discipline, setDiscipline] = useState('any')
  const people = useMemo(() => members.filter((m) => m.user && m.user.id !== me).sort((a, b) => a.user!.full_name.localeCompare(b.user!.full_name)), [members, me])

  // Направления человека: назначенное ему, те, которыми он руководит, и направления его организации
  const personDisciplines = useMemo(() => {
    const orgDisc = new Map(orgs.map((o) => [o.organization_id, o.discipline_ids]))
    return new Map(
      people.map((m) => {
        const ids = new Set<string>()
        if (m.discipline_id) ids.add(m.discipline_id)
        for (const d of disciplines) if (d.lead_user_id === m.user!.id) ids.add(d.id)
        for (const id of (m.user!.organization_id && orgDisc.get(m.user!.organization_id)) || []) ids.add(id)
        return [m.user!.id, ids] as const
      }),
    )
  }, [people, disciplines, orgs])
  const hasDisciplineOf = (userId: string, rootId: string) => {
    const mine = personDisciplines.get(userId)
    return !!mine && disciplineSubtreeIds(disciplines, rootId).some((id) => mine.has(id))
  }
  // в фильтре только направления, в которых есть хотя бы один сотрудник
  const usedDisciplines = useMemo(
    () => disciplines.filter((d) => people.some((m) => hasDisciplineOf(m.user!.id, d.id))),
    [disciplines, people, personDisciplines], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const disciplineById = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])
  const personOptions = people
    .filter((m) => discipline === 'any' || hasDisciplineOf(m.user!.id, discipline) || m.user!.id === value.user)
    .map((m) => {
      const own = [...(personDisciplines.get(m.user!.id) ?? [])].map((id) => disciplineById.get(id)?.name).filter(Boolean)
      return {
        value: m.user!.id,
        label: m.user!.full_name,
        hint: [m.role?.name, own.join(', ')].filter(Boolean).join(' · ') || undefined,
        avatar: <UserAvatar name={m.user!.full_name} path={m.user!.avatar_path} className="size-8 text-xs" />,
      }
    })

  // «Выбрал вид, но ещё не выбрал человека» хранится отдельно от значения, поэтому вид выводим из значения, а пустой выбор держим в value.user/org = ''
  const kind: Kind = value.user !== null ? 'user' : value.org !== null ? 'org' : 'none'

  const kinds: { id: Kind; label: string }[] = [
    { id: 'none', label: tr('Никому') },
    ...(people.length > 0 ? [{ id: 'user' as const, label: tr('Сотруднику') }] : []),
    ...(orgs.length > 0 ? [{ id: 'org' as const, label: tr('Подрядчику') }] : []),
  ]

  function pickKind(k: Kind) {
    if (k === kind) return
    onChange(k === 'user' ? { user: '', org: null } : k === 'org' ? { user: null, org: '' } : NO_ADDRESSEE)
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={tr('Кому заметка')} className="grid auto-cols-fr grid-flow-col gap-2">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            onClick={() => pickKind(k.id)}
            className={cn(
              'min-h-11 min-w-0 break-words rounded-lg border px-1.5 py-1 text-[13px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm',
              kind === k.id ? 'border-primary bg-primary font-semibold text-signal' : 'bg-card hover:bg-muted/60',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'user' && (
        <div className="flex flex-col gap-2">
          {usedDisciplines.length > 0 && (
            <Select value={discipline} onValueChange={setDiscipline}>
              <SelectTrigger aria-label={tr('Направление')} className="h-11 w-full text-base md:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="any">{tr('Все направления')}</SelectItem>
                {usedDisciplines.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <SearchSelect value={value.user ?? ''} onChange={(v) => onChange({ user: v, org: null })} options={personOptions} ariaLabel={tr('Сотрудник')} placeholder={tr('Выберите сотрудника')} />
        </div>
      )}
      {kind === 'org' && (
        <Select value={value.org || undefined} onValueChange={(v) => onChange({ user: null, org: v })}>
          <SelectTrigger aria-label={tr('Подрядчик')} className="h-11 w-full text-base md:text-sm">
            <SelectValue placeholder={tr('Выберите подрядчика')} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {orgs.map((o) => (
              <SelectItem key={o.organization_id} value={o.organization_id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
