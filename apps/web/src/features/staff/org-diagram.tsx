import { Maximize2, Minus, Plus, Printer, Users } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/features/profile/avatar'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { deptHeadcount, isVacant, type Department, type Position } from '@/features/staff/api'
import { useStaffAccess } from '@/features/staff/ui'

const ZOOM_MIN = 0.3
const ZOOM_MAX = 1.6
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

/**
 * Оргструктура схемой: дерево отделов сверху вниз с линиями, как функциональная оргсхема в PowerPoint.
 * Карточка отдела — название, руководитель, штатные позиции (вакансии видны сразу), число людей.
 * Нажатие на карточку открывает отдел (описание, порядок работ, штат). Схему можно двигать мышью,
 * приближать (Ctrl + колесо или кнопки) и печатать / сохранять в PDF.
 */
export function OrgDiagram({ onOpen, onShowUnassigned }: { onOpen: (d: Department) => void; onShowUnassigned: () => void }) {
  const { departments, employees } = useStaffAccess()
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [printing, setPrinting] = useState<string | null>(null)
  const ids = new Set(departments.map((d) => d.id))
  const roots = departments.filter((d) => !d.parent_id || !ids.has(d.parent_id))
  const unassigned = employees.filter((e) => !e.profile?.department_id || !ids.has(e.profile.department_id)).length

  // естественный размер схемы (без масштаба)
  const naturalSize = useCallback(() => {
    const el = canvas.current
    if (!el) return { w: 0, h: 0 }
    const r = el.getBoundingClientRect()
    const z = Number(el.style.zoom || 1)
    return { w: r.width / z, h: r.height / z }
  }, [])

  const fit = useCallback(() => {
    const vp = viewport.current
    const { w, h } = naturalSize()
    if (!vp || !w) return
    setZoom(clampZoom(Math.min(1, (vp.clientWidth - 32) / w, Math.max(0.6, (vp.clientHeight - 32) / h))))
  }, [naturalSize])

  // при первом показе — вписать по ширине
  useLayoutEffect(() => {
    fit()
  }, [fit, departments.length])

  // Ctrl + колесо — масштаб (слушатель не пассивный, чтобы не масштабировалась вся страница)
  useEffect(() => {
    const vp = viewport.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  // перетаскивание схемы мышью за пустое место
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('button, a')) return
    const vp = viewport.current!
    drag.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop }
    vp.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const vp = viewport.current!
    vp.scrollLeft = d.left - (e.clientX - d.x)
    vp.scrollTop = d.top - (e.clientY - d.y)
  }
  const endDrag = () => {
    drag.current = null
  }

  // печать: схема целиком на альбомный лист A4 (≈ 1050 × 700 px без полей), затем прежний масштаб
  const print = () => {
    const before = zoom
    const { w, h } = naturalSize()
    flushSync(() => {
      setPrinting(new Date().toLocaleDateString())
      setZoom(Math.min(1, 1040 / w, 680 / (h + 40)))
    })
    const restore = () => {
      window.removeEventListener('afterprint', restore)
      setPrinting(null)
      setZoom(before)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  if (departments.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border bg-card" role="group" aria-label={tr('Масштаб схемы')}>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => clampZoom(z / 1.2))} aria-label={tr('Уменьшить')}>
            <Minus />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => clampZoom(z * 1.2))} aria-label={tr('Увеличить')}>
            <Plus />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={fit}>
          <Maximize2 /> {tr('Вписать')}
        </Button>
        <Button variant="outline" size="sm" onClick={print}>
          <Printer /> {tr('Печать / PDF')}
        </Button>
        <span className="text-xs text-muted-foreground max-sm:hidden">{tr('Двигайте схему мышью, Ctrl + колесо — масштаб.')}</span>
      </div>

      <div
        ref={viewport}
        className={cn('h-[min(72vh,860px)] cursor-grab overflow-auto rounded-lg border bg-background active:cursor-grabbing', printing && 'oc-print-root')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div ref={canvas} className="oc-tree mx-auto w-max p-6" style={{ zoom }}>
          {printing && <p className="mb-4 text-center text-sm font-medium">{tr('Оргструктура · {{v1}}', { v1: printing })}</p>}
          <div className="oc-roots">
            {roots.map((d) => (
              <Branch key={d.id} dept={d} level={0} onOpen={onOpen} />
            ))}
          </div>
        </div>
      </div>

      {unassigned > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          {tr('Без отдела: {{n}} чел.', { n: unassigned })}
          <button type="button" onClick={onShowUnassigned} className="rounded underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {tr('Показать списком')}
          </button>
        </p>
      )}
    </div>
  )
}

function Branch({ dept, level, onOpen }: { dept: Department; level: number; onOpen: (d: Department) => void }) {
  const { departments } = useStaffAccess()
  const children = departments.filter((d) => d.parent_id === dept.id)
  const assistants = children.filter((d) => d.is_assistant)
  const kids = children.filter((d) => !d.is_assistant)
  const hasKids = (id: string) => departments.some((d) => d.parent_id === id)

  // все подотделы без своих подотделов и без помощников — лесенкой под карточкой
  if (level > 0 && kids.length > 0 && assistants.length === 0 && kids.every((k) => !hasKids(k.id))) {
    return (
      <div className="oc-hang">
        <DeptNode dept={dept} level={level} onOpen={onOpen} />
        <div className="oc-stack">
          {kids.map((k) => (
            <div key={k.id} className="oc-leaf">
              <DeptNode dept={k} level={level + 1} onOpen={onOpen} compact />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Одна основная ветка и несколько отделов без подотделов (бухгалтерия, юристы, IT при директоре) — эти отделы
  // ставим по бокам от линии к основной ветке, а не в общий ряд: иначе схема растягивается на всю ширину нижнего ряда.
  const main = kids.filter((k) => hasKids(k.id))
  const leaves = kids.filter((k) => !hasKids(k.id))
  const sideways = main.length === 1 && leaves.length >= 2
  const side = sideways ? leaves : []
  const row = sideways ? main : kids
  const left = side.slice(0, Math.ceil((side.length + assistants.length) / 2))
  const right = [...assistants, ...side.slice(left.length)]

  return (
    <div className="oc-branch">
      <DeptNode dept={dept} level={level} onOpen={onOpen} />
      {left.length + right.length > 0 && (
        <div className="oc-side">
          <div className="oc-side-list oc-left">
            {left.map((d) => (
              <div key={d.id} className="oc-side-item">
                <DeptNode dept={d} level={level + 1} onOpen={onOpen} compact />
              </div>
            ))}
          </div>
          <span className={cn('oc-trunk', row.length === 0 && 'oc-trunk-end')} />
          <div className="oc-side-list oc-right">
            {right.map((d) => (
              <div key={d.id} className={cn('oc-side-item', d.is_assistant && 'oc-dashed')}>
                <DeptNode dept={d} level={level + 1} onOpen={onOpen} compact />
              </div>
            ))}
          </div>
        </div>
      )}
      {row.length > 0 && (
        <>
          <span className="oc-down" />
          <div className="oc-row">
            {row.map((k) => (
              <div key={k.id} className="oc-cell">
                <Branch dept={k} level={level + 1} onOpen={onOpen} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const MAX_POSITIONS = 5

function DeptNode({ dept, level, onOpen, compact }: { dept: Department; level: number; onOpen: (d: Department) => void; compact?: boolean }) {
  const { employees, positions, byId } = useStaffAccess()
  const head = dept.head_user_id ? byId.get(dept.head_user_id) : undefined
  const own = positions.filter((p) => p.department_id === dept.id)
  const { people, vacancies } = deptHeadcount(dept, employees, positions)
  const root = level === 0
  const shown = own.slice(0, compact ? 3 : MAX_POSITIONS)

  return (
    <button
      type="button"
      onClick={() => onOpen(dept)}
      className={cn(
        'group flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-left shadow-soft outline-none transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        compact ? 'w-[170px]' : 'w-(--oc-w)',
        root && 'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90',
        level === 1 && 'border-t-[3px] border-t-signal',
        (dept.is_assistant || dept.outsourced_to) && 'border-dashed',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cn('line-clamp-2 text-sm font-semibold leading-snug', !root && 'group-hover:underline')}>{dept.name}</span>
        {dept.outsourced_to && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground" title={tr('Аутсорс: {{v1}}', { v1: dept.outsourced_to })}>
            {tr('аутсорс')}
          </span>
        )}
      </span>
      {dept.outsourced_to && <span className={cn('truncate text-xs', root ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{dept.outsourced_to}</span>}
      {head ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <UserAvatar name={head.full_name} path={head.avatar_path} className="size-6 shrink-0 text-[10px]" />
          <span className="truncate text-xs">{head.full_name}</span>
        </span>
      ) : (
        !dept.outsourced_to && own.length === 0 && <span className={cn('text-xs', root ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{tr('Руководитель не назначен')}</span>
      )}
      {shown.length > 0 && (
        <ul className={cn('flex flex-col gap-0.5 border-t pt-1.5', root && 'border-primary-foreground/20')}>
          {shown.map((p) => (
            <PositionLine key={p.id} p={p} root={root} name={p.user_id ? byId.get(p.user_id)?.full_name : p.person_name} />
          ))}
          {own.length > shown.length && <li className={cn('text-[11px]', root ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{tr('ещё {{n}}…', { n: own.length - shown.length })}</li>}
        </ul>
      )}
      {(people > 0 || vacancies > 0) && (
        <span className={cn('flex flex-wrap gap-x-2 text-[11px]', root ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {people > 0 && <span>{tr('{{n}} чел.', { n: people })}</span>}
          {vacancies > 0 && <span className={cn(!root && 'text-amber-700 dark:text-amber-400')}>{tr('вакансий: {{n}}', { n: vacancies })}</span>}
        </span>
      )}
    </button>
  )
}

function PositionLine({ p, name, root }: { p: Position; name: string | undefined; root: boolean }) {
  const vacant = isVacant(p)
  return (
    <li className="flex min-w-0 items-baseline gap-1 text-[11px] leading-tight">
      <span className={cn('truncate', root ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{p.title}</span>
      {p.headcount > 1 && <span className={cn('shrink-0 tabular-nums', root ? 'text-primary-foreground/80' : 'text-muted-foreground')}>×{p.headcount}</span>}
      <span className="ml-auto shrink-0 pl-1">
        {vacant ? (
          <span className="rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{tr('вакансия')}</span>
        ) : (
          <span className="block max-w-24 truncate">{name ?? '—'}</span>
        )}
      </span>
    </li>
  )
}
