import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { companyQuery, requestQuery, requestsQuery } from '@/features/procurement/api'
import { RequestCard } from '@/features/procurement/request-card'
import { BOARD_TABS, RequestsBoard } from '@/features/procurement/requests-board'
import { projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'

/**
 * Общий раздел «Закупки»: заявки отделов без проекта (IT, офис, бухгалтерия…). Здесь же разбираются ссылки из
 * уведомлений (/procurement?r=<id>): заявка проекта открывается в «Заявках» проекта, если проект виден, иначе — одна карточка.
 */
export const Route = createFileRoute('/_app/procurement')({
  validateSearch: z.object({ r: z.string().optional(), tab: z.enum(BOARD_TABS).optional() }),
  component: ProcurementPage,
})

function ProcurementPage() {
  const { r: id } = Route.useSearch()
  const navigate = useNavigate()
  const { data: request, isError } = useQuery({ ...requestQuery(id ?? ''), enabled: !!id })
  const code = request && !request.project.internal ? request.project.code : undefined
  const { data: project, isFetched } = useQuery({ ...projectByCodeQuery(code ?? ''), enabled: !!code })
  // заявка отдела, открытая со страницы (или только что созданная), — страница остаётся на месте, пока грузится карточка
  const { data: company } = useQuery(companyQuery)
  const { data: deptRows } = useQuery({ ...requestsQuery(company?.project_id), enabled: !!company })
  const onBoard = !!id && !!deptRows?.some((x) => x.id === id)

  useEffect(() => {
    if (code && project) navigate({ to: '/projects/$code/requests', params: { code }, search: { r: id }, replace: true })
  }, [code, project, id, navigate])

  if (id && isError) return <p className="text-sm text-muted-foreground">{tr('Заявка недоступна: её удалили или у вас нет к ней доступа.')}</p>
  if (id && !request && !onBoard) return <p className="text-sm text-muted-foreground">{tr('Загружаем заявку…')}</p>
  if (code) {
    if (!isFetched || project) return <p className="text-sm text-muted-foreground">{tr('Загружаем заявку…')}</p>
    // согласующий без доступа к проекту видит только саму карточку
    return <RequestCard id={id!} onClose={() => navigate({ to: '/', replace: true })} />
  }
  return <DepartmentRequests />
}

function DepartmentRequests() {
  const { r: openedId, tab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: company, isPending } = useQuery(companyQuery)
  const { data: rows } = useQuery({ ...requestsQuery(company?.project_id), enabled: !!company })

  if (isPending || (company && !rows)) return <p className="text-sm text-muted-foreground">{tr('Загружаем заявки…')}</p>
  if (!company) return <p className="text-sm text-muted-foreground">{tr('Раздел для сотрудников компании.')}</p>
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Закупки')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{tr('Заявки отделов, не привязанные к стройке: техника, мебель, канцелярия, услуги. Заявки для объектов заводят в проекте, в модуле «Закупки».')}</p>
      </div>
      <RequestsBoard
        projectId={company.project_id}
        rows={rows ?? []}
        canRequest={company.can_request}
        isBuyer={company.is_buyer}
        internal
        tab={tab}
        onTab={(t) => navigate({ search: (x) => ({ ...x, tab: t }), replace: true })}
        openedId={openedId}
        onOpen={(rid) => navigate({ search: (x) => ({ ...x, r: rid }), replace: !rid })}
        emptyText={tr('Заведите заявку, когда отделу что-то понадобится — например, ноутбук или принтер.')}
        help={
          <PageHelp id="dept-requests" title={tr('Как работает заявка отдела')}>
            <p>{tr('Сотрудник перечисляет, что нужно, и выбирает отдел → руководитель подтверждает, что это действительно нужно → отдел закупок проверяет склад и ищет цены → согласующие одобряют → сотрудник подтверждает, что выбрана нужная модель → заказ и доставка.')}</p>
            <p>{tr('Цены видят только отдел закупок, согласующие и финансы. Сотрудник и его руководитель видят выбранную модель, но не сумму.')}</p>
          </PageHelp>
        }
      />
    </div>
  )
}
