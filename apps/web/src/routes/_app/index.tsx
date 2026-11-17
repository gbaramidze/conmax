import { createFileRoute, redirect } from '@tanstack/react-router'
import { projectsQuery } from '@/features/projects/api'

/**
 * Вход в приложение: если у человека ровно один проект — сразу открываем его, иначе «Мой день».
 * Список проектов и «Мой день» остаются в меню, так что вернуться к ним можно в один тап.
 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const projects = await queryClient.ensureQueryData(projectsQuery).catch(() => [])
    if (projects.length === 1) throw redirect({ to: '/projects/$code', params: { code: projects[0].code } })
    throw redirect({ to: '/today' })
  },
})
