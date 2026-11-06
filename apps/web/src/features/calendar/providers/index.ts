import { documentsProvider } from '@/features/calendar/providers/documents'
import { inspectionsProvider } from '@/features/calendar/providers/inspections'
import { personalProvider } from '@/features/calendar/providers/personal'
import { meetingsProvider } from '@/features/calendar/providers/meetings'
import { scheduleProvider } from '@/features/calendar/providers/schedule'
import { tasksProvider } from '@/features/calendar/providers/tasks'
import { weeklyProvider } from '@/features/calendar/providers/weekly'
import type { CalendarProvider } from '@/features/calendar/types'

/**
 * Единый список источников календаря. Чтобы добавить новый (обход, проверки, платежи):
 *  1. добавьте тип события в `KindId` (types.ts) и его вид в `KINDS` (kinds.ts);
 *  2. если событие ведёт на новую страницу — вариант в `EventTarget` (types.ts) и ветку в `EventLink` (event-link.tsx);
 *  3. создайте файл провайдера рядом (`defineProvider`): право доступа, запрос под RLS и разбор строк в события;
 *  4. добавьте его сюда. Фильтр, цвета, значки и права подхватятся сами.
 */
export const CALENDAR_PROVIDERS: CalendarProvider[] = [tasksProvider, meetingsProvider, scheduleProvider, weeklyProvider, documentsProvider, inspectionsProvider, personalProvider]
