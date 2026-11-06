import {
  CATEGORY_STYLES,
  DEFAULT_DISCIPLINE_STYLE,
  DISCIPLINE_STYLES,
  type StatusCategory,
} from '@/features/tasks/api'

const DOT: Record<StatusCategory, string> = {
  backlog: 'bg-muted-foreground/60',
  todo: 'bg-slate-500',
  in_progress: 'bg-blue-500',
  blocked: 'bg-red-500',
  review: 'bg-amber-500',
  done: 'bg-green-500',
  cancelled: 'bg-muted-foreground/60',
}

/** Статус: точка цвета категории + название. Цвет не единственный носитель смысла — название всегда видно. */
export function StatusBadge({ name, category }: { name: string; category: StatusCategory }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT[category]}`} aria-hidden />
      {name}
    </span>
  )
}

export function DisciplineBadge({ code, name, color }: { code: string; name: string; color: string | null }) {
  return (
    <span
      title={name}
      className={`ident inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 font-medium ${
        (color && DISCIPLINE_STYLES[color]) || DEFAULT_DISCIPLINE_STYLE
      }`}
    >
      {code}
    </span>
  )
}
