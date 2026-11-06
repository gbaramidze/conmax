import { useState } from 'react'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { tr } from '@/lib/tr'

/** Какого типа обведённая зона на плане этажа: поиск по названию (ONE BEDROOM 1, STANDARD KING 2…). */
export function PickTypeDialog({ types, busy, onPick, onClose }: { types: { id: string; name: string }[]; busy: boolean; onPick: (typeId: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Какого типа этот номер?')}</DialogTitle>
          <DialogDescription>{tr('Выберите тип номера: ONE BEDROOM, KING 1 и другие. Нажатие на зону потом откроет этот тип.')}</DialogDescription>
        </DialogHeader>
        <SearchSelect value={value} onChange={setValue} options={types.map((t) => ({ value: t.id, label: t.name }))} ariaLabel={tr('Тип номера')} placeholder={tr('Выберите тип')} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="max-sm:h-11" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button className="max-sm:h-11" disabled={!value || busy} onClick={() => onPick(value)}>
            {tr('Сохранить зону')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
