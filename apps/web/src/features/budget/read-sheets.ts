export type Cell = string | number | boolean | Date | null | undefined
export interface Sheet {
  name: string
  rows: Cell[][]
}

function decode(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return (utf8.match(/�/g) ?? []).length > Math.max(3, utf8.length / 200) ? new TextDecoder('windows-1251').decode(bytes) : utf8
}

/** Читает все листы .xlsx (или один «лист» из .csv) в браузере. */
export async function readSheets(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) {
    const { parseCsv } = await import('@/features/volumes/api')
    return [{ name: 'CSV', rows: parseCsv(decode(await file.arrayBuffer())) }]
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = await readXlsxFile(file)
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }))
}
