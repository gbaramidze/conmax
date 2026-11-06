import { Armchair } from 'lucide-react'
import { DocThumb } from '@/features/documents/doc-thumb'
import type { FfeDoc } from '@/features/ffe/api'

/** Миниатюра позиции каталога для списков выбора: первый привязанный чертёж или каталожный лист, иначе значок мебели. */
export function ItemAvatar({ docs, canGenerate }: { docs: FfeDoc[] | undefined; canGenerate: boolean }) {
  const d = docs?.[0]
  if (d) return <DocThumb d={d} canGenerate={canGenerate} className="h-10 w-9" />
  return (
    <span aria-hidden className="grid h-10 w-9 shrink-0 place-items-center rounded-md border bg-muted/40 text-muted-foreground">
      <Armchair className="size-4" />
    </span>
  )
}
