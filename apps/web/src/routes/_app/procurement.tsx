import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod'
import { requestQuery } from '@/features/procurement/api'
import { RequestCard } from '@/features/procurement/request-card'
import { projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'

/**
 * Переход по ссылке из уведомления о заявке (/procurement?r=<id>). Закупки живут в модуле проекта: кто видит проект,
 * попадает в «Заявки» проекта с открытой карточкой. Согласующий без доступа к проекту видит только саму карточку.
 */
export const Route = createFileRoute('/_app/procurement')({
  validateSearch: z.object({ r: z.string().optional() }),
  component: ProcurementLink,
})

function ProcurementLink() {
  const { r: id } = Route.useSearch()
  const navigate = useNavigate()
  const { data: request, isError } = useQuery({ ...requestQuery(id ?? ''), enabled: !!id })
  const code = request?.project.code
  const { data: project, isFetched } = useQuery({ ...projectByCodeQuery(code ?? ''), enabled: !!code })

  useEffect(() => {
    if (code && project) navigate({ to: '/projects/$code/requests', params: { code }, search: { r: id }, replace: true })
  }, [code, project, id, navigate])

  if (!id || isError) return <p className="text-sm text-muted-foreground">{tr('Заявка недоступна: её удалили или у вас нет к ней доступа.')}</p>
  if (!request || !isFetched || project) return <p className="text-sm text-muted-foreground">{tr('Загружаем заявку…')}</p>
  return <RequestCard id={id} onClose={() => navigate({ to: '/', replace: true })} />
}
