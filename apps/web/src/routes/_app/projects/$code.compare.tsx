import { BackButton } from '@/components/app-shell/back-button'
import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { CompareScreen } from '@/features/documents/compare/compare-view'
import { projectByCodeQuery } from '@/features/projects/api'

// Паттерн «Detail / Record»: две версии вверху, что изменилось — ниже. a — «было», b — «стало» (id версий документов)
export const Route = createFileRoute('/_app/projects/$code/compare')({
  validateSearch: z.object({ a: z.string().optional().catch(undefined), b: z.string().optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>,
  component: ComparePage,
})

function ComparePage() {
  const { code } = Route.useParams()
  const { a, b } = Route.useSearch()
  const navigate = Route.useNavigate()
  useSuspenseQuery(projectByCodeQuery(code))

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div>
        <BackButton fallback={
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$code/documents" params={{ code }} search={{}}>
            <ChevronLeft />{tr('Все документы')}</Link>
        </Button>
} />
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{tr('Сверка версий')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Что изменилось между двумя версиями или двумя документами: добавленное, удалённое, изменённое и разница в числах.')}</p>
      </header>
      {a && b ? (
        <CompareScreen a={a} b={b} onChange={(na, nb) => void navigate({ search: { a: na, b: nb }, replace: true })} />
      ) : (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('Выберите, что сравнить: в карточке документа нажмите «Сравнить версии», а в реестре отметьте два документа галочками.')}</p>
      )}
    </div>
  )
}
