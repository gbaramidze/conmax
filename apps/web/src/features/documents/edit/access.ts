import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { formatBytes } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { documentQuery } from '@/features/documents/api'
import { OFFICE_MAX_BYTES } from '@/features/documents/office'
import { myPermissionsQuery } from '@/features/projects/api'

export interface EditAccess {
  /** Показывать ли кнопку «Править» (есть право загружать версии этого документа) */
  visible: boolean
  /** Если правка недоступна, то почему */
  reason: string | null
}

/**
 * Можно ли править: право загружать версии (document.upload) у автора документа или выпускающего — как в панели «Документ»;
 * только действующая версия; не больше 25 МБ; не .xlsm (макросы пропали бы).
 */
export function useOfficeEditAccess(projectId: string, documentId: string, file: { name: string; size: number }, isOld: boolean): EditAccess {
  const { session } = useAuth()
  const { data: permissions } = useQuery(myPermissionsQuery(projectId))
  const { data: doc } = useQuery(documentQuery(documentId))
  if (isOld || !permissions || !doc) return { visible: false, reason: null }
  const uid = session?.user.id
  const canPublish = permissions.includes('document.publish')
  const can = permissions.includes('document.upload') && (doc.created_by === uid || canPublish)
  if (!can) return { visible: false, reason: null }
  if (file.size > OFFICE_MAX_BYTES) return { visible: true, reason: tr('Файл больше {{v1}}: править его в браузере нельзя. Скачайте, исправьте в программе и загрузите новую версию.', { v1: formatBytes(OFFICE_MAX_BYTES) }) }
  if (/\.xlsm$/i.test(file.name)) return { visible: true, reason: tr('В файле с макросами (.xlsm) правка в браузере уничтожила бы макросы. Скачайте файл, исправьте в Excel и загрузите новую версию.') }
  return { visible: true, reason: null }
}
