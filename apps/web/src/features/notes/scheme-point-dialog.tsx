import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { schemeOptionsQuery, type SchemeOption } from '@/features/inspections/api'
import { SchemePanZoom } from '@/features/inspections/scheme-pan-zoom'
import { ownSchemes, type NotePoint } from '@/features/notes/api'
import { cn } from '@/lib/utils'

const optionOf = (o: SchemeOption) => ({ fileId: o.file_id, versionId: o.version_id })
const sameScheme = (o: SchemeOption, p: NotePoint | null) => !!p && ((o.file_id !== null && o.file_id === p.fileId) || (o.version_id !== null && o.version_id === p.versionId))

/**
 * Отметка места заметки на схеме: схемы берутся те же, что в инспекции (изображения места и вышестоящих узлов, типа номера, чертежи и планы).
 * Нажать на схему там, где проблема, и «Сохранить точку». Если схем несколько — сверху выбор схемы (точка при смене схемы сбрасывается).
 */
export function SchemePointDialog({ locationId, value, onClose, onSave }: { locationId: string; value: NotePoint | null; onClose: () => void; onSave: (point: NotePoint | null) => void }) {
  const { data: raw = [], isFetched } = useQuery(schemeOptionsQuery(locationId))
  // только схемы самого места (у комнаты — её собственные и типа номера); один и тот же чертёж показываем один раз
  const all = ownSchemes(raw)
  const options = all.filter((o, i) => all.findIndex((x) => (x.file_id ?? x.version_id) === (o.file_id ?? o.version_id)) === i)
  const [chosen, setChosen] = useState<SchemeOption | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(value ? { x: value.x, y: value.y } : null)

  const current = chosen ?? options.find((o) => sameScheme(o, value)) ?? options[0] ?? null
  const kind: Record<SchemeOption['source'], string> = { location: tr('Это место'), room_type: tr('Тип номера'), parent: tr('Выше по структуре') }

  const save = () => {
    if (current && draft) onSave({ ...optionOf(current), x: draft.x, y: draft.y, source: { storageKey: current.storage_key, mime: current.mime }, title: current.title })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Где проблема')}</DialogTitle>
          <DialogDescription>{tr('Нажмите на схему в том месте, где проблема.')}</DialogDescription>
        </DialogHeader>

        {isFetched && !current && <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{tr('Для этого места нет схемы.')}</p>}

        {options.length > 1 && (
          <div role="group" aria-label={tr('Схемы этого места')} className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const on = !!current && (current.file_id ?? current.version_id) === (o.file_id ?? o.version_id)
              return (
                <button
                  key={o.file_id ?? o.version_id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (on) return
                    setChosen(o)
                    setDraft(null) // координаты относятся к конкретному изображению
                  }}
                  className={cn(
                    'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 md:px-3',
                    on ? 'border-primary bg-primary font-medium text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="truncate">{o.title}</span>
                  <span className="shrink-0 text-xs opacity-70">{kind[o.source]}</span>
                </button>
              )
            })}
          </div>
        )}

        {current && (
          <>
            <p className="text-xs text-muted-foreground">{tr('Двумя пальцами увеличьте схему, одним сдвиньте, затем коснитесь места проблемы.')}</p>
            <SchemePanZoom key={current.file_id ?? current.version_id} source={{ storageKey: current.storage_key, mime: current.mime }} alt={tr('Схема места')} markers={[]} draft={draft} onPick={setDraft} heightClass="h-[56svh]" />
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={!value}
            onClick={() => {
              onSave(null)
              onClose()
            }}
          >
            <X /> {tr('Убрать точку')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="button" disabled={!draft || !current} onClick={save}>
              {tr('Сохранить точку')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
