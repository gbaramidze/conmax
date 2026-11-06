import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET } from '@/features/activity/api'
import type { TextStatus, VersionStatus } from '@/features/documents/api'
import type { RawSheet } from '@/features/documents/compare/table-diff'
import { supabase } from '@/lib/supabase'

/**
 * Сверка считается в браузере по файлам и тексту, которые пользователь и так вправе читать:
 * версии, файлы, извлечённый текст и хранилище закрыты теми же правилами, что и сами документы
 * (внешним участникам виден только действующий выпуск), поэтому отдельных прав у сверки нет.
 */

export interface CompareFile {
  id: string
  name: string
  mime: string
  size_bytes: number
  storage_key: string
}

export interface CompareVersion {
  id: string
  version_no: number
  revision: string
  status: VersionStatus
  created_at: string
  document: { id: string; title: string; code: string | null; project_id: string }
  file: CompareFile | null
}

export const compareVersionQuery = (versionId: string) =>
  queryOptions({
    queryKey: ['compare-version', versionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_versions')
        .select(
          'id, version_no, revision, status, created_at, document:documents!document_id(id, title, code, project_id), file:files!file_id(id, name, mime, size_bytes, storage_key)',
        )
        .eq('id', versionId)
        .maybeSingle()
      if (error) throw error
      return data as unknown as CompareVersion | null
    },
  })

export type FileKind = 'table' | 'text' | 'unsupported'

const ext = (name: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? '').toLowerCase()

/** Как сверять файл: таблицей (Excel, CSV), текстом (PDF, Word, TXT) или никак (чертежи, картинки, старый .xls). */
export function fileKind(name: string): FileKind {
  const e = ext(name)
  if (['xlsx', 'xlsm', 'csv'].includes(e)) return 'table'
  if (['pdf', 'docx', 'txt', 'md', 'json', 'xml', 'html', 'htm', 'log'].includes(e)) return 'text'
  return 'unsupported'
}

/** Текст в UTF-8, а если много «�» — в windows-1251 (CSV из Excel). */
function decodeText(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const bad = (utf8.match(/�/g) ?? []).length
  return bad > Math.max(3, utf8.length / 200) ? new TextDecoder('windows-1251').decode(bytes) : utf8
}

/** Листы Excel / CSV файла. Читается в браузере; файл скачивается из закрытого хранилища по правам пользователя. */
export const sheetsQuery = (file: CompareFile) =>
  queryOptions({
    queryKey: ['compare-sheets', file.id],
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async (): Promise<RawSheet[]> => {
      const { data: blob, error } = await supabase.storage.from(FILES_BUCKET).download(file.storage_key)
      if (error || !blob) throw error ?? new Error('file_not_found')
      if (ext(file.name) === 'csv') {
        const { parseCsv } = await import('@/features/volumes/api')
        return [{ name: 'CSV', rows: parseCsv(decodeText(await blob.arrayBuffer())) }]
      }
      const { default: readXlsxFile } = await import('read-excel-file/browser')
      const sheets = await readXlsxFile(blob)
      return sheets.map((s) => ({ name: s.sheet, rows: s.data as RawSheet['rows'] }))
    },
  })

export interface FileText {
  status: TextStatus
  text: string | null
}

/** Текст файла, который достал воркер extract-texts (его же показывает «Читать текст документа»). */
export const compareTextQuery = (fileId: string) =>
  queryOptions({
    queryKey: ['compare-text', fileId],
    staleTime: 5 * 60_000,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'pending' || q.state.data.status === 'processing') ? 6000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.from('file_texts').select('status, text').eq('file_id', fileId).maybeSingle()
      if (error) throw error
      return (data ?? { status: 'pending', text: null }) as unknown as FileText
    },
  })
