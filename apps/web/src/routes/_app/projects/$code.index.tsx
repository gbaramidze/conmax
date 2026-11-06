import { CurrencyCard } from '@/features/projects/currency-card'
import { tr } from '@/lib/tr'
import { HealthWidget } from '@/features/signals/widgets'
import { WeatherWidget } from '@/features/weather/widget'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { commentsQuery, eventsQuery } from '@/features/activity/api'
import { dashboardQuery } from '@/features/dashboard/api'
import { BuildingSection } from '@/features/dashboard/building-section'
import { Fold } from '@/features/dashboard/fold'
import { BreakdownPanel, DynamicsPanel, ProgressHeadline } from '@/features/dashboard/progress-hub'
import { DashTabs, type DashTab } from '@/features/dashboard/tabs'
import { SectionTiles } from '@/features/dashboard/section-tiles'
import { RoomsOverview } from '@/features/ffe/rooms-overview'
import { MembersSection } from '@/features/projects/members-section'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'

export const Route = createFileRoute('/_app/projects/$code/')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    const entity = { type: 'project', id: project.id }
    await Promise.all([
      queryClient.ensureQueryData(dashboardQuery(project.id)),
      queryClient.ensureQueryData(projectMembersQuery(project.id)),
      queryClient.ensureQueryData(commentsQuery(entity)),
      queryClient.ensureQueryData(eventsQuery(entity)),
    ])
  },
  component: ProjectOverview,
})

function ProjectOverview() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: members } = useSuspenseQuery(projectMembersQuery(p.id))

  // Порядок: главное (готовность, внимание) → плитки разделов → здоровье → вкладки с остальным (открыта одна, прочие не строятся)
  const tabs: DashTab[] = [
    { id: 'dynamics', label: tr('Динамика'), render: () => <Suspense fallback={null}><DynamicsPanel projectId={p.id} /></Suspense> },
    { id: 'breakdown', label: tr('Где что сделано'), render: () => <Suspense fallback={null}><BreakdownPanel projectId={p.id} code={code} /></Suspense> },
    { id: 'building', label: tr('Здание'), render: () => <BuildingSection projectId={p.id} code={code} /> },
    ...(permissions.includes('schedule.view')
      ? [
          {
            id: 'rooms',
            label: tr('Номера и мебель'),
            render: () => (
              <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Считаем номера и мебель…')}</p>}>
                <RoomsOverview projectId={p.id} code={code} />
              </Suspense>
            ),
          },
        ]
      : []),
    {
      id: 'members',
      label: tr('Участники'),
      count: members.length,
      render: () => <MembersSection projectId={p.id} canManage={permissions.includes('project.members.manage')} canInviteOrg={permissions.includes('project.members.invite_org')} />,
    },
    {
      id: 'history',
      label: tr('История'),
      render: () => (
        <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем обсуждение…')}</p>}>
          <ActivityFeed entity={{ type: 'project', id: p.id }} projectId={p.id} />
        </Suspense>
      ),
    },
    {
      id: 'site',
      label: tr('Погода и валюты'),
      render: () => (
        <>
          <Suspense fallback={null}>
            <WeatherWidget projectId={p.id} address={p.address} canEdit={permissions.includes('project.settings.manage') || permissions.includes('project.edit')} />
          </Suspense>
          <CurrencyCard projectId={p.id} code={code} canEdit={permissions.includes('project.edit')} />
        </>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5 lg:gap-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Считаем готовность…')}</p>}>
        <ProgressHeadline projectId={p.id} code={code} canManage={permissions.includes('workitem.manage')} />
      </Suspense>
      <SectionTiles code={code} perms={permissions} />
      {permissions.includes('signal.view') && (
        <Fold title={tr('Здоровье проекта')} summary={tr('Индекс и причины')}>
          <Suspense fallback={null}>
            <HealthWidget projectId={p.id} code={code} />
          </Suspense>
        </Fold>
      )}
      <DashTabs storageKey={`overview-tab:${p.id}`} label={tr('Подробности проекта')} tabs={tabs} />
    </div>
  )
}
