import { tr } from '@/lib/tr'
import { FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadXlsx, type ExportSheet } from '@/features/export/xlsx'

/** Кнопка «Excel»: формирует таблицу в момент нажатия из того, что сейчас на экране (с учётом фильтров). */
export function ExportButton({ fileName, build, disabled }: { fileName: string; build: () => ExportSheet; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || busy}
      title={tr('Выгрузить в Excel то, что показано на экране')}
      onClick={async () => {
        setBusy(true)
        await downloadXlsx(fileName, build())
        setBusy(false)
      }}
    >
      <FileSpreadsheet /> Excel
    </Button>
  )
}
