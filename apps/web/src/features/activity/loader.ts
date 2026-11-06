import type { QueryClient } from '@tanstack/react-query'
import { commentsQuery, eventsQuery, type EntityRef } from '@/features/activity/api'

/** Предзагрузка ленты сущности для loader-ов маршрутов. */
export async function activityLoader(queryClient: QueryClient, entity: EntityRef): Promise<void> {
  await Promise.all([
    queryClient.ensureQueryData(commentsQuery(entity)),
    queryClient.ensureQueryData(eventsQuery(entity)),
  ])
}
