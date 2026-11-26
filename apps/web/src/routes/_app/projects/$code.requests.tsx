import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { requestsQuery } from '@/features/procurement/api'
import { BOARD_TABS, RequestsBoard } from '@/features/procurement/requests-board'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'

// Паттерн «Входящие»: заявки проекта на закупку — что ждёт моего шага, мои, в работе, завершённые. Карточка открывается по ?r=
export const Route = createFileRoute('/_app/projects/$code/requests')({
  validateSearch: z.object({ r: z.string().optional(), tab: z.enum(BOARD_TABS).optional() }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(requestsQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем заявки…')}</p>,
  component: RequestsPage,
})

function RequestsPage() {
  const { code } = Route.useParams()
  const { r: openedId, tab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(requestsQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canRequest = perms.includes('procurement.request')
  return (
    <RequestsBoard
      projectId={p.id}
      rows={rows}
      canRequest={canRequest}
      isBuyer={perms.includes('procurement.manage') || perms.includes('procurement.approve')}
      tab={tab}
      onTab={(t) => navigate({ search: (x) => ({ ...x, tab: t }), replace: true })}
      openedId={openedId}
      onOpen={(id) => navigate({ search: (x) => ({ ...x, r: id }), replace: !id })}
      emptyText={canRequest ? tr('Заведите первую заявку, когда на площадке что-то понадобится.') : tr('Заявок пока нет.')}
      help={
        <PageHelp id="requests" title={tr('Как работает заявка на закупку')}>
          <p>{tr('Площадка отправляет заявку → отдел закупок проверяет склад и собирает предложения (лучше три) → выбранных закупщиком согласующих просят одобрить → инициатор подтверждает выбор → заказ → «в пути» с ожидаемой датой → получено.')}</p>
          <p>{tr('Во вкладке «Ждут меня» — заявки, где нужен ваш шаг. Отдел закупок (роль компании «Отдел закупок») видит заявки всех проектов. Уведомления о каждом шаге приходят в приложение, на почту и на телефон.')}</p>
        </PageHelp>
      }
    />
  )
}
