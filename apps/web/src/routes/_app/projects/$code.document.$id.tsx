import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

// Отдельной страницы документа больше нет: ссылка открывает просмотрщик, а сведения о документе лежат в его боковой панели
export const Route = createFileRoute('/_app/projects/$code/document/$id')({
  // q — слово из поиска по реестру: сведения откроются с подсветкой найденного
  validateSearch: z.object({ q: z.string().optional() }),
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/projects/$code/plan/$id', params, search: { q: search.q }, replace: true })
  },
})
