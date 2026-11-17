import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
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
  const people = useMemo(() => members.filter((m) => m.user && m.user.id !== me).sort((a, b) => a.user!.full_name.localeCompare(b.user!.full_name)), [members, me])

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
              'min-h-11 rounded-lg border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              kind === k.id ? 'border-primary bg-primary font-semibold text-signal' : 'bg-card hover:bg-muted/60',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'user' && (
        <Select value={value.user || undefined} onValueChange={(v) => onChange({ user: v, org: null })}>
          <SelectTrigger aria-label={tr('Сотрудник')} className="h-11 w-full text-base md:text-sm">
            <SelectValue placeholder={tr('Выберите сотрудника')} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {people.map((m) => (
              <SelectItem key={m.user!.id} value={m.user!.id}>
                {m.user!.full_name}
                {(m.title ?? m.role?.name) && <span className="text-muted-foreground"> · {m.title ?? m.role?.name}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
