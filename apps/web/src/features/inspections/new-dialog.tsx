import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { inspectionErrorText, saveInspection } from '@/features/inspections/api'
import { locationsQuery } from '@/features/locations/api'
import { LocationPicker, readRecentLocations, rememberLocation } from '@/features/locations/location-picker'
import { organizationsListQuery } from '@/features/volumes/api'
import { tr } from '@/lib/tr'

/**
 * Создание инспекции: место подставляется из последнего выбранного, подрядчик — из прошлой инспекции; достаточно нажать «Создать отчёт».
 * Нужен и на странице инспекций, и в быстром меню кнопки камеры.
 */
export function NewInspectionDialog({ projectId, code, onClose, initialDate }: { projectId: string; code: string; onClose: () => void; initialDate?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: orgs } = useQuery(organizationsListQuery)
  const orgOptions: SearchOption[] = (orgs ?? []).map((o) => ({
    value: o.id,
    label: o.name,
    avatar: (
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Building2 className="size-4" />
      </span>
    ),
  }))
  const { data: locations = [] } = useQuery(locationsQuery(projectId))
  const [placeId, setPlaceId] = useState<string | null>(() => readRecentLocations(projectId)[0] ?? null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(initialDate ?? new Date().toLocaleDateString('sv'))
  const orgKey = `insp-org:${projectId}`
  const [orgId, setOrgId] = useState(() => {
    try {
      return localStorage.getItem(orgKey) ?? ''
    } catch {
      return ''
    }
  })

  const create = useMutation({
    mutationFn: () => saveInspection(projectId, { locationId: placeId, title, date, contractorId: orgId || null, schemeText: '', note: '' }),
    onSuccess: async (id) => {
      if (placeId) rememberLocation(projectId, placeId)
      try {
        localStorage.setItem(orgKey, orgId)
      } catch {
        // подрядчик просто не запомнится
      }
      await queryClient.invalidateQueries({ queryKey: ['inspections', projectId] })
      onClose()
      void navigate({ to: '/projects/$code/inspection/$id', params: { code, id } })
    },
    onError: (e) => toast.error(inspectionErrorText(e)),
  })

  const placeName = placeId ? locations.find((l) => l.id === placeId)?.name : ''
  const canCreate = !!placeId || title.trim() !== ''

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Новая инспекция')}</DialogTitle>
          <DialogDescription>{tr('Выберите место и подрядчика. Разделы чек-листа создадутся сами, схему и замечания добавите в отчёте.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{tr('Место (этаж, зона, помещение)')}</Label>
            <LocationPicker projectId={projectId} value={placeId} onChange={setPlaceId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="insp-title">{tr('Название отчёта')}</Label>
            <Input id="insp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeName || tr('Например, «Номер 1006»')} maxLength={200} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insp-date">{tr('Дата инспекции')}</Label>
              <DatePicker id="insp-date" value={date} onChange={setDate} clearable={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="insp-org">{tr('Подрядчик')}</Label>
              <SearchSelect value={orgId} onChange={setOrgId} options={orgOptions} noneLabel={tr('Не указан')} ariaLabel={tr('Подрядчик')} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>
            {tr('Создать отчёт')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
