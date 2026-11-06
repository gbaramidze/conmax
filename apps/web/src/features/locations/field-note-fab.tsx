import { tr } from '@/lib/tr'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useParams, useRouterState } from '@tanstack/react-router'
import { Camera, ChevronRight, ClipboardPen, Play, SearchCheck } from 'lucide-react'
import { Suspense, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/features/auth/auth-provider'
import { inspectionsQuery } from '@/features/inspections/api'
import { NewInspectionDialog } from '@/features/inspections/new-dialog'
import { FieldNoteSheet } from '@/features/locations/field-note'
import { myPermissionsQuery } from '@/features/projects/api'

/** Крупная строка быстрого меню: значок, название, пояснение. */
function Action({ icon, title, hint, onClick, to }: { icon: ReactNode; title: string; hint: string; onClick?: () => void; to?: { code: string; id: string } }) {
  const cls = 'flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring'
  const body = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </>
  )
  return to ? (
    <Link to="/projects/$code/inspection/$id" params={to} onClick={onClick} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  )
}

/**
 * Кнопка камеры на телефоне: открывает быстрое меню — заметка с фото к месту, новая инспекция, продолжить свой черновик инспекции.
 * Доступна с любого экрана проекта (кроме чек-листа обхода и самого отчёта: у них своя камера).
 */
export function FieldNoteFab({ projectId }: { projectId: string }) {
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { code } = useParams({ strict: false }) as { code?: string }
  const { session } = useAuth()
  const [menu, setMenu] = useState(false)
  const [note, setNote] = useState(false)
  const [inspect, setInspect] = useState(false)
  const canNote = permissions.includes('comment.create')
  const canInspect = permissions.includes('inspection.conduct')
  const { data: reports } = useQuery({ ...inspectionsQuery(projectId), enabled: menu && canInspect })
  const draft = (reports ?? []).find((r) => r.status === 'draft' && r.created_by === session?.user.id)

  // На чек-листе обхода у каждой позиции своя камера, а в отчёте об инспекции свои кнопки «Снять»: кнопка закрывала бы действия
  if ((!canNote && !canInspect) || /\/walk\/[^/]+/.test(pathname) || /\/inspection\/[^/]+/.test(pathname)) return null

  // На экране задач уже есть «+»: камера встаёт над ним
  const onTasks = /\/tasks(\/|$)/.test(pathname)
  return (
    <>
      <Button
        size="icon-lg"
        variant="outline"
        className={`fixed right-4 z-20 size-14 rounded-full border-2 bg-card shadow-lg md:hidden ${
          onTasks ? 'bottom-[calc(8.25rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
        }`}
        aria-label={tr('Снять: заметка или инспекция')}
        aria-haspopup="dialog"
        onClick={() => setMenu(true)}
      >
        <Camera className="size-6" />
      </Button>

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl p-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="gap-1 border-b p-4 pr-14">
            <SheetTitle>{tr('Что делаем?')}</SheetTitle>
            <SheetDescription>{tr('Быстрые действия на площадке.')}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2.5 p-4">
            {canInspect && <Action icon={<SearchCheck className="size-5" />} title={tr('Новая инспекция')} hint={tr('Выбрать место и пройти по разделам')} onClick={() => { setMenu(false); setInspect(true) }} />}
            {canInspect && draft && code && (
              <Action icon={<Play className="size-5" />} title={tr('Продолжить инспекцию')} hint={`${draft.key} · ${draft.title}`} to={{ code, id: draft.id }} onClick={() => setMenu(false)} />
            )}
            {canNote && <Action icon={<ClipboardPen className="size-5" />} title={tr('Заметка с фото')} hint={tr('Фото и пара слов к этажу или помещению')} onClick={() => { setMenu(false); setNote(true) }} />}
          </div>
        </SheetContent>
      </Sheet>

      {note && (
        <Suspense fallback={null}>
          <FieldNoteSheet projectId={projectId} open={note} onOpenChange={setNote} />
        </Suspense>
      )}
      {inspect && code && <NewInspectionDialog projectId={projectId} code={code} onClose={() => setInspect(false)} />}
    </>
  )
}
