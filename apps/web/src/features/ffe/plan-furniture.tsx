import { Link } from '@tanstack/react-router'
import { ExternalLink, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DocThumb } from '@/features/documents/doc-thumb'
import { FFE_STATUS_DOT, FFE_STATUS_LABELS, type FfeDoc, type FfeItem, type FfeStatus } from '@/features/ffe/api'
import { tr } from '@/lib/tr'

/** Что известно о позиции в том номере или типе, к которому привязан план. */
export interface FurnitureContext {
  /** Номер или тип, о котором речь: «Номер 1303», «Тип JUNIOR SUITE 1» */
  scope: string
  /** Сколько штук в составе; null — позиции в составе нет */
  qty: number | null
  /** Статус позиции в этом номере (у типа его нет) */
  status?: FfeStatus
}

/**
 * Окно мебели с плана комнаты: нажали на надпись CM-TV-01 — открылась позиция каталога с тем же кодом:
 * название, сколько штук в этом номере и в каком статусе, чертежи и каталожные листы позиции.
 */
export function FurnitureDialog({
  projectCode,
  item,
  docs,
  context,
  canGenerate,
  onRemoveMark,
  onClose,
}: {
  projectCode: string
  item: FfeItem
  docs: FfeDoc[]
  context: FurnitureContext | null
  canGenerate: boolean
  /** Окно открыто с отметки, поставленной вручную: её можно убрать */
  onRemoveMark?: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-0.5 text-left">
            <span className="ident text-sm font-normal text-muted-foreground">{item.code}</span>
            <span>{item.name}</span>
          </DialogTitle>
          <DialogDescription>{[item.category, item.unit].filter(Boolean).join(' · ') || tr('Позиция каталога мебели и оборудования')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {context && (
            <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="text-xs text-muted-foreground">{context.scope}</span>
              {context.qty === null ? (
                <span className="font-medium text-amber-700 dark:text-amber-300">{tr('Этой позиции нет в составе: на плане она есть, в списке нет')}</span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{tr('{{n}} {{unit}}', { n: context.qty, unit: item.unit })}</span>
                  {context.status && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className={`size-2 rounded-full ${FFE_STATUS_DOT[context.status]}`} aria-hidden />
                      {FFE_STATUS_LABELS[context.status]}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {item.note && <p className="whitespace-pre-line text-sm">{item.note}</p>}

          {docs.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{tr('Чертежи и листы')}</h3>
              <ul className="flex flex-col gap-2">
                {docs.map((d) => (
                  <li key={d.id}>
                    <PlanLink projectCode={projectCode} doc={d} canGenerate={canGenerate} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tr('К позиции пока не привязан ни один чертёж.')}</p>
          )}

          <ToCatalog projectCode={projectCode} code={item.code} />
          {onRemoveMark && (
            <Button variant="ghost" className="text-destructive max-sm:h-11" onClick={onRemoveMark}>
              <Trash2 /> {tr('Убрать эту отметку с плана')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PlanLink({ projectCode, doc, canGenerate }: { projectCode: string; doc: FfeDoc; canGenerate: boolean }) {
  return (
    <Link to="/projects/$code/plan/$id" params={{ code: projectCode, id: doc.id }} search={{}} className="flex min-h-14 items-center gap-3 rounded-lg border p-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
      <DocThumb d={doc} canGenerate={canGenerate} className="h-12 w-14 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{doc.title}</span>
        {doc.code && (
          <span className="ident flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3" aria-hidden /> {doc.code}
          </span>
        )}
      </span>
    </Link>
  )
}

function ToCatalog({ projectCode, code }: { projectCode: string; code: string }) {
  return (
    <Button asChild variant="outline" className="max-sm:h-11">
      <Link to="/projects/$code/ffe" params={{ code: projectCode }} search={{ tab: 'catalog' }} aria-label={`${tr('Открыть в каталоге')}: ${code}`}>
        <ExternalLink /> {tr('Открыть в каталоге')}
      </Link>
    </Button>
  )
}

/** Выбор мебели для только что указанной точки или зоны на плане: поиск по коду и названию, позиции из состава номера сверху. */
export function PickFurnitureDialog({ options, busy, onPick, onClose }: { options: SearchOption[]; busy: boolean; onPick: (itemId: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Какая здесь мебель?')}</DialogTitle>
          <DialogDescription>{tr('Выберите позицию каталога: найдите по коду, например CM-TV-01, или по названию.')}</DialogDescription>
        </DialogHeader>
        <SearchSelect value={value} onChange={setValue} options={options} ariaLabel={tr('Позиция мебели')} placeholder={tr('Выберите позицию')} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="max-sm:h-11" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button className="max-sm:h-11" disabled={!value || busy} onClick={() => onPick(value)}>
            {tr('Поставить отметку')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
