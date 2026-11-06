import { tr } from '@/lib/tr'
import { CheckSquare, CornerDownRight, FileText, ListChecks, MessageSquare, Paperclip } from 'lucide-react'
import type { TaskRow } from '@/features/tasks/api'

const chip = 'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground'

/**
 * Метки карточки: связь с родителем, прогресс подзадач «2/5», а также чек-лист, вложения, комментарии и документы
 * (как значки на карточке Trello).
 */
export function SubtaskChips({ task }: { task: Pick<TaskRow, 'parent' | 'subtask_stats' | 'badges'> }) {
  const { parent, subtask_stats: s, badges: b } = task
  return (
    <>
      {parent && (
        <span title={tr('Подзадача: {{title}}', { title: parent.title })} className={`ident ${chip}`}>
          <CornerDownRight className="size-3" aria-hidden />
          {parent.key}
        </span>
      )}
      {s.total > 0 && (
        <span
          title={tr('Подзадачи: выполнено {{done}} из {{total}}', { done: s.done, total: s.total })}
          className={`${chip} ${s.done === s.total ? 'border-green-500/40 !text-green-700 dark:!text-green-300' : ''}`}
        >
          <ListChecks className="size-3" aria-hidden />
          {s.done}/{s.total}
        </span>
      )}
      {b.checklist_total > 0 && (
        <span
          title={tr('Чек-лист: выполнено {{checklist_done}} из {{checklist_total}}', { checklist_done: b.checklist_done, checklist_total: b.checklist_total })}
          className={`${chip} ${b.checklist_done === b.checklist_total ? 'border-green-500/40 !text-green-700 dark:!text-green-300' : ''}`}
        >
          <CheckSquare className="size-3" aria-hidden />
          {b.checklist_done}/{b.checklist_total}
        </span>
      )}
      {b.attachments > 0 && (
        <span title={tr('Вложений: {{attachments}}', { attachments: b.attachments })} className={chip}>
          <Paperclip className="size-3" aria-hidden />
          {b.attachments}
        </span>
      )}
      {b.documents > 0 && (
        <span title={tr('Документов: {{documents}}', { documents: b.documents })} className={chip}>
          <FileText className="size-3" aria-hidden />
          {b.documents}
        </span>
      )}
      {b.comments > 0 && (
        <span title={tr('Комментариев: {{comments}}', { comments: b.comments })} className={chip}>
          <MessageSquare className="size-3" aria-hidden />
          {b.comments}
        </span>
      )}
    </>
  )
}
