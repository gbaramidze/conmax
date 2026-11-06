import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VERSION_STATUS_LABELS, type VersionRow } from '@/features/documents/api'

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

/** Выбор двух версий одного документа: что было и что стало. По умолчанию — предыдущая и действующая (или последняя). */
export function CompareVersionsDialog({ code, versions, currentId, onClose }: { code: string; versions: VersionRow[]; currentId: string | null; onClose: () => void }) {
  const navigate = useNavigate()
  // versions идут от новой к старой
  const newer = versions.find((v) => v.id === currentId) ?? versions[0]
  const older = versions[versions.indexOf(newer) + 1] ?? versions.find((v) => v.id !== newer.id) ?? newer
  const [a, setA] = useState(older.id)
  const [b, setB] = useState(newer.id)

  const options = versions.map((v) => (
    <SelectItem key={v.id} value={v.id}>
      <span className="ident font-medium">{v.revision || `№${v.version_no}`}</span> · {VERSION_STATUS_LABELS[v.status]} · {dateFmt.format(new Date(v.created_at))}
    </SelectItem>
  ))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Сравнить версии')}</DialogTitle>
          <DialogDescription>{tr('Покажем, что добавилось, пропало и изменилось. Для Excel — ещё и разницу в числах.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cmp-a">{tr('Было')}</Label>
            <Select value={a} onValueChange={setA}>
              <SelectTrigger id="cmp-a" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>{options}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cmp-b">{tr('Стало')}</Label>
            <Select value={b} onValueChange={setB}>
              <SelectTrigger id="cmp-b" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>{options}</SelectContent>
            </Select>
          </div>
          {a === b && <p className="text-sm text-muted-foreground">{tr('Выберите две разные версии.')}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={a === b} onClick={() => void navigate({ to: '/projects/$code/compare', params: { code }, search: { a, b } })}>{tr('Сравнить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
