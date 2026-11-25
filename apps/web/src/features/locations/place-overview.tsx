import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Expand, FileText, Map as MapIcon, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { schemeOptionsQuery } from '@/features/inspections/api'
import { schemeImageQuery } from '@/features/inspections/scheme-image'
import { ownSchemes } from '@/features/notes/api'
import { PlanCanvas } from '@/features/plans/plan-canvas'
import type { PinRow } from '@/features/plans/api'
import { imageUrlsQuery, type EntityImage } from '@/features/renders/api'
import { LOCATION_KIND_LABELS, type LocationRow } from '@/features/locations/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const NO_PINS: PinRow[] = []
const noop = () => {}

export interface PlaceSection<T extends string = string> {
  id: T
  label: string
  icon: LucideIcon
  /** Строка под названием на плитке обзора: сколько там всего или что там лежит */
  summary?: string
  badge?: number
}

/**
 * Обзор места — первое, что видно при открытии: сразу схема этого места (этажа или номера), под ней фраза о задачах,
 * короткие сведения и плитки разделов. Ради схемы сюда в основном и приходят, поэтому она сверху и грузится сразу.
 */
export function PlaceOverview<T extends string>({
  loc,
  parentLabel,
  typeName,
  cover,
  tasks,
  sections,
  onOpen,
}: {
  loc: LocationRow
  parentLabel: string
  typeName?: string | null
  /** Обложка для плитки «Рендеры»: своя у места, иначе из типа номера */
  cover?: EntityImage
  tasks: { open: number; mine: number; overdue: number }
  sections: PlaceSection<T>[]
  onOpen: (id: T) => void
}) {
  const { data: coverUrls } = useQuery(imageUrlsQuery(cover ? [cover.file.storage_key] : []))
  const coverSrc = cover ? coverUrls?.get(cover.file.storage_key) : undefined

  return (
    <div className="flex flex-col gap-4">
      <PlaceScheme loc={loc} onOpenPlans={sections.some((s) => s.id === 'plan') ? () => onOpen('plan' as T) : undefined} />

      {/* главное одной фразой: что здесь требует внимания */}
      <button
        type="button"
        onClick={() => onOpen('tasks' as T)}
        className={cn(
          'flex items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
          tasks.overdue > 0 && 'border-destructive/40 bg-destructive/5',
        )}
      >
        {tasks.overdue > 0 && <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />}
        <span className="min-w-0 flex-1 text-sm">
          {tasks.open === 0 ? (
            tr('Открытых задач здесь нет.')
          ) : (
            <>
              <span className="font-medium">{tr('Открытых задач: {{n}}', { n: tasks.open })}</span>
              {tasks.mine > 0 && <span className="text-muted-foreground">{` · ${tr('ваших: {{n}}', { n: tasks.mine })}`}</span>}
              {tasks.overdue > 0 && <span className="font-medium text-destructive">{` · ${tr('просрочено: {{n}}', { n: tasks.overdue })}`}</span>}
            </>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <ul className="grid gap-2 sm:grid-cols-2" aria-label={tr('Разделы места')}>
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left outline-none transition-colors hover:border-foreground/20 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.id === 'renders' && coverSrc ? (
                <img src={coverSrc} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-foreground">
                  <s.icon className="size-5" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.label}
                  {s.badge ? <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{s.badge}</span> : null}
                </span>
                {s.summary && <span className="block truncate text-xs text-muted-foreground">{s.summary}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-sm sm:grid-cols-4">
        {[
          [tr('Код'), loc.code],
          [tr('Вид'), LOCATION_KIND_LABELS[loc.kind]],
          ...(typeName ? [[tr('Тип номера'), typeName]] : []),
          [tr('Где'), parentLabel || '—'],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5 bg-background px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Схема самого места: у этажа — план этажа, у номера — схема номера или его типа (план этажа выше по структуре сюда не берётся).
 * Те же источники, что у инспекций: изображения, отмеченные как схема, и чертежи/планы места или типа номера.
 */
function PlaceScheme({ loc, onOpenPlans }: { loc: LocationRow; onOpenPlans?: () => void }) {
  const { data: raw = [], isFetched } = useQuery(schemeOptionsQuery(loc.id))
  const options = ownSchemes(raw)
  const [pick, setPick] = useState(0)
  const chosen = options[Math.min(pick, options.length - 1)]
  const title = loc.kind === 'room' ? tr('Схема номера') : loc.kind === 'floor' ? tr('Схема этажа') : tr('Схема')
  // сам файл схемы (PDF или картинка), а не готовая картинка с него: при приближении PDF перерисовывается и остаётся чётким
  const { data: urls } = useQuery(imageUrlsQuery(chosen ? [chosen.storage_key] : []))
  const url = chosen ? urls?.get(chosen.storage_key) : undefined
  // Картинка листа для PDF: сначала обычная (обычно уже в кэше — показывается сразу), затем подробная для чтения размеров.
  // Обе хранятся в кэше браузера: тяжёлый чертёж разбирается один раз, дальше схема открывается мгновенно.
  const pdfSrc = chosen?.mime === 'application/pdf' ? { storageKey: chosen.storage_key, mime: chosen.mime } : null
  const { data: low } = useQuery(schemeImageQuery(pdfSrc, 1600))
  const { data: high } = useQuery({ ...schemeImageQuery(pdfSrc, 4000), enabled: !!pdfSrc && !!low })
  const preview = high ?? low
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [full, setFull] = useState(false)
  const choose = (i: number) => {
    setPick(i)
    setPage(1)
  }

  const canvas = (fill: boolean) =>
    url && chosen && (!pdfSrc || preview) ? (
      <PlanCanvas
        key={chosen.storage_key}
        preview={preview}
        url={url}
        mime={chosen.mime}
        page={page}
        pages={pages}
        onPage={setPage}
        onPages={setPages}
        pins={NO_PINS}
        selectedId={null}
        pending={null}
        mode="view"
        tool="point"
        onTool={noop}
        onPlace={noop}
        onPlaceArea={noop}
        onSelect={noop}
      />
    ) : (
      <div className={cn('grid animate-pulse place-items-center bg-muted text-sm text-muted-foreground', fill ? 'size-full' : 'h-full rounded-lg')} role="status">
        {tr('Рисуем схему…')}
      </div>
    )

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MapIcon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{chosen?.title}</span>
        {chosen && (
          <Button type="button" size="sm" variant="outline" onClick={() => setFull(true)}>
            <Expand /> {tr('На весь экран')}
          </Button>
        )}
      </div>
      {options.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={tr('Схемы')}>
          {options.map((o, i) => (
            <button
              key={`${o.kind}-${o.file_id ?? o.version_id}`}
              type="button"
              aria-pressed={o === chosen}
              onClick={() => choose(i)}
              className={cn(
                'inline-flex min-h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                o === chosen && 'border-primary bg-primary/15 font-medium hover:bg-primary/20',
              )}
            >
              <span className="truncate">{o.title}</span>
            </button>
          ))}
        </div>
      )}
      {!isFetched ? (
        <div className="h-[55svh] animate-pulse rounded-xl border bg-muted sm:h-[min(62vh,640px)]" role="status" aria-label={tr('Рисуем схему…')} />
      ) : chosen ? (
        <>
          {/* при открытом полном экране встроенный холст не держим: один PDF не разбирается дважды */}
          <div className="h-[55svh] sm:h-[min(62vh,640px)]">{full ? <div className="h-full rounded-lg border bg-muted/60" /> : canvas(false)}</div>
          <p className="text-xs text-muted-foreground">{tr('Двумя пальцами или колесом мыши — увеличить, пальцем — сдвинуть. Мини-карта в углу показывает, где вы на листе.')}</p>
          {full && (
            <Dialog open onOpenChange={(o) => !o && setFull(false)}>
              <DialogContent
                showCloseButton={false}
                className="left-0 top-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 sm:max-w-none"
              >
                <div className="flex shrink-0 items-center gap-2 border-b bg-popover px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
                  <MapIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {loc.name} · {chosen.title}
                  </DialogTitle>
                  <DialogDescription className="sr-only">{title}</DialogDescription>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setFull(false)} aria-label={tr('Закрыть')}>
                    <X />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">{canvas(true)}</div>
              </DialogContent>
            </Dialog>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-background px-4 py-8 text-center">
          <FileText className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{tr('Схема ещё не загружена')}</p>
          <p className="max-w-md text-xs text-muted-foreground">
            {loc.kind === 'room'
              ? tr('Добавьте план в «Чертежи» этого номера или его типа, либо отметьте изображение в рендерах как схему.')
              : tr('Добавьте план в «Планы» этого места, либо отметьте изображение в рендерах как схему.')}
          </p>
          {onOpenPlans && (
            <button type="button" onClick={onOpenPlans} className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-md border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              {loc.kind === 'room' ? tr('Открыть чертежи') : tr('Открыть планы')} <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
