import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Suspense, useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { orgMembersQuery, orgOverviewQuery, type OrgOverview } from '@/features/contractors/api'
import { DisciplinesDialog, OrgPanel } from '@/features/contractors/org-panel'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { DisciplineBadge } from '@/features/tasks/status-badge'
import { NewOrganizationButton } from '@/features/volumes/new-organization'
import { organizationsListQuery } from '@/features/volumes/api'
import { tr } from '@/lib/tr'

// Паттерн «Список / Index» с карточкой выбранного: организации проекта слева, выбранная — справа
export const Route = createFileRoute('/_app/projects/$code/contractors')({
  validateSearch: z.object({ org: z.string().optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(orgOverviewQuery(project.id)),
      queryClient.ensureQueryData(orgMembersQuery(project.id)),
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем подрядчиков…')}</p>,
  component: ContractorsPage,
})

function ContractorsPage() {
  const { code } = Route.useParams()
  const { org: orgParam } = Route.useSearch()
  const navigate = useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: orgs } = useSuspenseQuery(orgOverviewQuery(p.id))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(p.id))
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const byId = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])

  const canManage = permissions.includes('project.members.manage')
  const canInviteOrg = permissions.includes('project.members.invite_org')
  const selected = orgs.find((o) => o.organization_id === orgParam) ?? orgs[0]
  const [adding, setAdding] = useState(false)

  const select = (id: string) => void navigate({ to: '/projects/$code/contractors', params: { code }, search: { org: id }, replace: true })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          {canManage
            ? tr('Организации, которые работают в проекте: сотрудники, направления работ, объёмы и задачи. Подрядчик сам ведёт свою страницу: приглашает людей и выбирает направления.')
            : canInviteOrg
              ? tr('Ваша организация в проекте: приглашайте сотрудников и выбирайте направления, в которых вы работаете.')
              : tr('Ваша организация в проекте: сотрудники и направления. Менять их может ответственный от подрядчика.')}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            {tr('Добавить подрядчика')}
          </Button>
        )}
      </div>

      {orgs.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="font-medium">{tr('Подрядчиков в проекте пока нет')}</p>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? tr('Добавьте организацию и выберите её направления, затем пригласите её сотрудников.')
              : tr('Руководитель проекта ещё не добавил вашу организацию.')}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          {orgs.length > 1 && (
            <>
              {/* Телефон: переключатель организации */}
              <div className="flex flex-col gap-2 md:hidden">
                <Label htmlFor="org-switch">{tr('Организация')}</Label>
                <Select value={selected?.organization_id} onValueChange={select}>
                  <SelectTrigger id="org-switch" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.organization_id} value={o.organization_id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Планшет и десктоп: список организаций */}
              <ul className="hidden flex-col gap-2 md:flex" aria-label={tr('Организации проекта')}>
                {orgs.map((o) => (
                  <li key={o.organization_id}>
                    <Link
                      to="/projects/$code/contractors"
                      params={{ code }}
                      search={{ org: o.organization_id }}
                      replace
                      aria-current={o.organization_id === selected?.organization_id ? 'true' : undefined}
                      className={`flex flex-col gap-1.5 rounded-lg border p-3 hover:bg-muted/50 ${o.organization_id === selected?.organization_id ? 'border-foreground/30 bg-muted/60' : 'bg-card'}`}
                    >
                      <span className="truncate font-medium">{o.name}</span>
                      <OrgSummary org={o} byId={byId} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={orgs.length > 1 ? '' : 'md:col-span-2'}>
            {selected && (
              <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}>
                <OrgPanel key={selected.organization_id} projectId={p.id} org={selected} canManage={canManage} canInviteOrg={canInviteOrg} />
              </Suspense>
            )}
          </div>
        </div>
      )}

      {adding && (
        <Suspense fallback={null}>
          <AddContractorDialog
            projectId={p.id}
            existing={orgs.map((o) => o.organization_id)}
            disciplines={disciplines}
            onClose={() => setAdding(false)}
            onAdded={(id) => select(id)}
          />
        </Suspense>
      )}
    </div>
  )
}

function OrgSummary({ org, byId }: { org: OrgOverview; byId: Map<string, { code: string; name: string; color: string | null }> }) {
  const ds = org.discipline_ids.map((id) => byId.get(id)).filter((d): d is { code: string; name: string; color: string | null } => !!d)
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {tr('Сотрудников: {{n}}', { n: org.members })}
        {org.open_tasks > 0 ? ` · ${tr('задач: {{n}}', { n: org.open_tasks })}` : ''}
        {org.overdue_tasks > 0 ? ` · ${tr('просрочено: {{n}}', { n: org.overdue_tasks })}` : ''}
      </span>
      {ds.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {ds.slice(0, 6).map((d) => (
            <DisciplineBadge key={d.code} code={d.code} name={d.name} color={d.color} />
          ))}
          {ds.length > 6 && <span className="text-xs text-muted-foreground">+{ds.length - 6}</span>}
        </span>
      )}
    </>
  )
}

/** Руководитель проекта берёт организацию в проект: выбирает её (или заводит новую) и отмечает направления. */
function AddContractorDialog({
  projectId,
  existing,
  disciplines,
  onClose,
  onAdded,
}: {
  projectId: string
  existing: string[]
  disciplines: ReturnType<typeof flattenDisciplines>
  onClose: () => void
  onAdded: (orgId: string) => void
}) {
  const { data: all } = useQuery(organizationsListQuery)
  const [orgId, setOrgId] = useState('')
  const [step, setStep] = useState<'pick' | 'disciplines'>('pick')
  const candidates = (all ?? []).filter((o) => o.kind !== 'own' && !existing.includes(o.id))
  const chosen = candidates.find((o) => o.id === orgId) ?? (all ?? []).find((o) => o.id === orgId)

  if (step === 'disciplines' && chosen) {
    return (
      <DisciplinesDialog
        projectId={projectId}
        org={{ organization_id: chosen.id, name: chosen.name, discipline_ids: [] }}
        disciplines={disciplines}
        onClose={() => {
          onAdded(chosen.id)
          onClose()
        }}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Добавить подрядчика')}</DialogTitle>
          <DialogDescription>{tr('Выберите организацию из списка или заведите новую. Следующим шагом отметьте её направления работ.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ac-org">{tr('Организация')}</Label>
            <NewOrganizationButton projectId={projectId} onCreated={(id) => setOrgId(id)} />
          </div>
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger id="ac-org" className="w-full">
              <SelectValue placeholder={tr('Выберите организацию')} />
            </SelectTrigger>
            <SelectContent>
              {(all ?? [])
                .filter((o) => o.kind !== 'own' && (!existing.includes(o.id) || o.id === orgId))
                .map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {candidates.length === 0 && !orgId && <p className="text-xs text-muted-foreground">{tr('Все организации уже в проекте. Заведите новую.')}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={!orgId} onClick={() => setStep('disciplines')}>
            {tr('Дальше')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
