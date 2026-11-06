import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MapPinned } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/** Где задача отмечена на планах: ссылка открывает план сразу с этой булавкой. */
export function TaskPlanLinks({ taskId, taskKey, code }: { taskId: string; taskKey: string; code: string }) {
  const { data } = useQuery({
    queryKey: ['task-plan-links', taskId],
    queryFn: async () => {
      const { data, error } = await supabase.from('task_pins').select('id, page, document:documents(id, title)').eq('task_id', taskId)
      if (error) throw error
      return data as unknown as { id: string; page: number; document: { id: string; title: string } | null }[]
    },
  })
  const pins = (data ?? []).filter((p) => p.document)
  if (pins.length === 0) return null

  return (
    <section className="flex flex-col gap-2" aria-label={tr('На плане')}>
      <h3 className="text-sm font-semibold">{tr('На плане')}</h3>
      <ul className="flex flex-col gap-1.5">
        {pins.map((p) => (
          <li key={p.id}>
            <Link
              to="/projects/$code/plan/$id"
              params={{ code, id: p.document!.id }}
              search={{ page: p.page, pin: taskKey }}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              <MapPinned className="size-4 text-muted-foreground" aria-hidden /> {p.document!.title}
              {p.page > 1 && <span className="text-xs text-muted-foreground">{tr('стр.')}{' '}{p.page}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
