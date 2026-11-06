import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createOrganization } from '@/features/volumes/api'
import { tr } from '@/lib/tr'

const KINDS = () =>
  [
    ['subcontractor', tr('Подрядчик')],
    ['supplier', tr('Поставщик')],
    ['designer', tr('Проектировщик')],
    ['supervision', tr('Технадзор')],
    ['client', tr('Заказчик')],
    ['other', tr('Другое')],
  ] as const

/** Кнопка «Новая организация»: создаёт подрядчика/поставщика и сразу отдаёт его id, чтобы выбрать в списке. */
export function NewOrganizationButton({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('subcontractor')
  const [taxId, setTaxId] = useState('')

  const save = useMutation({
    mutationFn: () => createOrganization(projectId, name.trim(), kind, taxId.trim()),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['organizations-all'] })
      await queryClient.invalidateQueries({ queryKey: ['organizations'] })
      toast.success(tr('Организация добавлена'))
      onCreated(id)
      setOpen(false)
      setName('')
      setTaxId('')
    },
    onError: () => toast.error(tr('Не удалось добавить организацию. Проверьте права.')),
  })

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> {tr('Новая организация')}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !save.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr('Новая организация')}</DialogTitle>
            <DialogDescription>{tr('Она появится в списках подрядчиков и поставщиков. Организация с таким названием уже есть — будет выбрана она.')}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (name.trim() && !save.isPending) save.mutate()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="no-name">{tr('Название')}</Label>
              <Input id="no-name" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="no-kind">{tr('Роль')}</Label>
                <select id="no-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                  {KINDS().map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="no-tax">{tr('ИНН / налоговый номер (необязательно)')}</Label>
                <Input id="no-tax" value={taxId} maxLength={40} onChange={(e) => setTaxId(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tr('Отмена')}
              </Button>
              <Button type="submit" disabled={!name.trim() || save.isPending}>
                {save.isPending ? tr('Добавляем…') : tr('Добавить')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
