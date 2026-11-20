import { queryOptions } from '@tanstack/react-query'
import { FILES_BUCKET, uploadProjectFile } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/**
 * Электронная подпись PDF (простая электронная подпись): моя подпись (рисунок), запросы на подпись документов проекта,
 * журнал подписей и проверка по коду из штампа или по файлу. Сам штамп вшивается в браузере — `stamp.ts`.
 */

export interface MySignature {
  id: string
  image: string
  created_at: string
}

/** Мои сохранённые подписи (полная, инициалы…), новые сверху; не больше 10. */
export const mySignaturesQuery = queryOptions({
  queryKey: ['my-signatures'],
  queryFn: async (): Promise<MySignature[]> => {
    const { data, error } = await supabase.from('user_signatures').select('id, image, created_at').order('created_at', { ascending: false })
    if (error) throw error
    return data as MySignature[]
  },
})

/** Сохранить подпись в мой список. */
export async function saveMySignature(image: string): Promise<void> {
  const { error } = await supabase.from('user_signatures').insert({ image } as never)
  if (error) throw new SignError(error.message.startsWith('too_many_signatures') ? 'too_many_signatures' : 'unknown')
}

export async function deleteMySignature(id: string): Promise<void> {
  const { error } = await supabase.from('user_signatures').delete().eq('id', id)
  if (error) throw error
}

export type RequestStatus = 'pending' | 'completed' | 'declined' | 'cancelled'
export type SignerStatus = 'pending' | 'signed' | 'declined'

export interface SignerRow {
  user_id: string
  position: number
  status: SignerStatus
  signature_id: string | null
  decided_at: string | null
  decline_reason: string | null
  user: { full_name: string } | null
}

export interface SignatureRequest {
  id: string
  document_id: string
  project_id: string
  base_version_id: string
  current_file_id: string
  sequential: boolean
  message: string | null
  status: RequestStatus
  created_by: string
  created_at: string
  finished_at: string | null
  result_version_id: string | null
  creator: { full_name: string } | null
  file: { id: string; name: string; mime: string; storage_key: string } | null
  signers: SignerRow[]
}

export const signatureRequestsQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['signature-requests', documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signature_requests')
        .select(
          '*, creator:users!created_by(full_name), file:files!current_file_id(id, name, mime, storage_key), signers:signature_request_signers(user_id, position, status, signature_id, decided_at, decline_reason, user:users!user_id(full_name))',
        )
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      const rows = data as unknown as SignatureRequest[]
      for (const r of rows) r.signers.sort((a, b) => a.position - b.position)
      return rows
    },
  })

/** Чья сейчас очередь подписывать: по порядку — первый неподписавший, «все сразу» — любой неподписавший. */
export function canSignNow(r: SignatureRequest, uid: string): boolean {
  if (r.status !== 'pending') return false
  const me = r.signers.find((s) => s.user_id === uid)
  if (!me || me.status !== 'pending') return false
  if (!r.sequential) return true
  return r.signers.find((s) => s.status === 'pending')?.user_id === uid
}

export const SIGN_ERROR_TEXT: Record<string, string> = {
  signer_no_access: tr('Кто-то из подписантов не видит этот документ. Выберите тех, у кого есть доступ.'),
  request_exists: tr('Документ уже отправлен на подпись. Дождитесь подписей или отзовите запрос.'),
  document_not_published: tr('Сначала выпустите версию документа — подписывают действующую.'),
  not_pdf: tr('Подписать можно только PDF.'),
  signers_required: tr('Выберите хотя бы одного подписанта.'),
  too_many_signers: tr('Не больше 20 подписантов.'),
  not_your_turn: tr('Сейчас очередь другого подписанта.'),
  stale_copy: tr('Пока вы подписывали, документ подписал кто-то ещё. Откройте подпись заново — подпишете свежую копию.'),
  request_closed: tr('Запрос на подпись уже закрыт.'),
  not_a_signer: tr('Вы не в списке подписантов этого запроса.'),
  encrypted: tr('PDF защищён паролем — подписать его нельзя.'),
  too_many_signatures: tr('Сохранено уже 10 подписей — удалите лишнюю, чтобы сохранить новую.'),
  forbidden: tr('У вас нет права на это действие.'),
}

export class SignError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export const signErrorText = (e: unknown, fallback = tr('Не удалось. Попробуйте ещё раз.')) =>
  e instanceof SignError ? (SIGN_ERROR_TEXT[e.code] ?? fallback) : fallback

function fail(error: { code?: string; message?: string }): never {
  const key = Object.keys(SIGN_ERROR_TEXT).find((k) => error.message?.startsWith(k))
  throw new SignError(key ?? (error.code === '42501' ? 'forbidden' : 'unknown'))
}

export async function createSignatureRequest(input: { documentId: string; signers: string[]; sequential: boolean; message: string }): Promise<string> {
  const { data, error } = await supabase.rpc('create_signature_request', {
    p_document: input.documentId,
    p_signers: input.signers,
    p_sequential: input.sequential,
    p_message: input.message,
  })
  if (error) fail(error)
  return data as string
}

export async function declineSignatureRequest(requestId: string, reason: string) {
  const { error } = await supabase.rpc('decline_signature_request', { p_request: requestId, p_reason: reason })
  if (error) fail(error)
}

export async function cancelSignatureRequest(requestId: string) {
  const { error } = await supabase.rpc('cancel_signature_request', { p_request: requestId })
  if (error) fail(error)
}

/** Файл из хранилища проекта (рабочая копия запроса) */
export async function downloadProjectFile(storageKey: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).download(storageKey)
  if (error || !data) throw error ?? new Error('file_not_found')
  return data
}

export interface Signed {
  /** коды штампов — у каждого места свой (первый — код всего подписания) */
  codes: string[]
  /** страницы штампов (с 1), по порядку кодов */
  pages: number[]
  bytes: Uint8Array
  hashBefore: string
  hashAfter: string
}

/** Подписанную рабочую копию — в хранилище и в запрос (сервер проверит очередь и свежесть копии). */
export async function submitRequestSignature(input: { request: SignatureRequest; tenantId: string; signed: Signed }): Promise<{ completed: boolean }> {
  const { request: r, signed } = input
  const name = r.file?.name ?? 'document.pdf'
  const file = new File([signed.bytes as BlobPart], name, { type: 'application/pdf' })
  const fileId = await uploadProjectFile(r.project_id, input.tenantId, file)
  const { data, error } = await supabase.rpc('sign_signature_request', {
    p_request: r.id,
    p_codes: signed.codes,
    p_pages: signed.pages,
    p_base_file: r.current_file_id,
    p_file: fileId,
    p_hash_before: signed.hashBefore,
    p_hash_after: signed.hashAfter,
    p_user_agent: navigator.userAgent.slice(0, 400),
  })
  if (error) fail(error)
  return data as unknown as { completed: boolean }
}

/** Личный бакет копий подписанных PDF из писем: <tenant>/<user>/<код>.pdf, видит только владелец. */
export const SIGNED_BUCKET = 'signed-files'

/**
 * Подпись PDF не из документа проекта (вложение письма): копия файла — в личное хранилище (чтобы открыть его потом
 * со страницы «Мои подписи»), запись — в журнал. Копия не сохранилась — подпись всё равно записывается.
 */
export async function recordSignature(fileName: string, signed: Signed, tenantId: string) {
  const { data: auth } = await supabase.auth.getUser()
  let path: string | null = `${tenantId}/${auth.user?.id}/${signed.codes[0]}.pdf`
  const up = await supabase.storage.from(SIGNED_BUCKET).upload(path, new Blob([signed.bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (up.error) path = null
  const { error } = await supabase.rpc('record_signature', {
    p_codes: signed.codes,
    p_pages: signed.pages,
    p_file_name: fileName,
    p_hash_before: signed.hashBefore,
    p_hash_after: signed.hashAfter,
    p_user_agent: navigator.userAgent.slice(0, 400),
    p_file_path: path as never,
  })
  if (error) fail(error)
}

export interface MySigned {
  batch_id: string
  signed_at: string
  file_name: string
  source: 'document' | 'mail'
  marks: number
  pages: (number | null)[]
  codes: string[]
  document_id: string | null
  document_title: string | null
  project_code: string | null
  /** файл документа после моей подписи (хранилище проекта) */
  storage_key: string | null
  /** копия PDF из письма (личное хранилище) */
  file_path: string | null
  hash_after: string
}

/** Всё, что я подписал: одна строка на подписание, новые сверху. */
export const mySignedQuery = queryOptions({
  queryKey: ['signatures', 'mine'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('my_signatures', { p_limit: 1000 })
    if (error) throw error
    return (data ?? []) as MySigned[]
  },
})

/** Подписанный файл: из хранилища проекта или из личной копии. */
export async function downloadSigned(s: MySigned): Promise<Blob> {
  if (s.file_path) {
    const { data, error } = await supabase.storage.from(SIGNED_BUCKET).download(s.file_path)
    if (error || !data) throw error ?? new Error('file_not_found')
    return data
  }
  if (s.storage_key) return downloadProjectFile(s.storage_key)
  throw new Error('file_not_found')
}

export interface PendingForMe {
  request_id: string
  request: {
    id: string
    status: RequestStatus
    sequential: boolean
    message: string | null
    created_at: string
    creator: { full_name: string } | null
    document: { id: string; title: string } | null
    project: { code: string } | null
    signers: { user_id: string; position: number; status: SignerStatus }[]
  } | null
}

/** Запросы, где я подписант и ещё не подписал (очередь — моя или скоро будет). */
export const pendingForMeQuery = queryOptions({
  queryKey: ['signature-requests', 'pending-for-me'],
  queryFn: async () => {
    const { data: auth } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('signature_request_signers')
      .select(
        'request_id, request:signature_requests!inner(id, status, sequential, message, created_at, creator:users!created_by(full_name), document:documents(id, title), project:projects(code), signers:signature_request_signers(user_id, position, status))',
      )
      .eq('user_id', auth.user?.id ?? '')
      .eq('status', 'pending')
      .eq('request.status', 'pending')
    if (error) throw error
    return (data as unknown as PendingForMe[]).filter((r) => r.request).sort((a, b) => b.request!.created_at.localeCompare(a.request!.created_at))
  },
})

export interface VerifiedSignature {
  id: string
  signer_name: string
  signed_at: string
  file_name: string
  source: 'document' | 'mail'
  hash_before: string
  hash_after: string
  document_title: string | null
  project_code: string | null
  document_id: string | null
  /** страница этого штампа (с 1) */
  page: number | null
  /** сколько штампов в этом подписании */
  marks: number
}

export async function verifySignature(input: { code?: string; hash?: string }): Promise<VerifiedSignature[]> {
  const { data, error } = await supabase.rpc('verify_signature', { p_code: (input.code ?? null) as never, p_hash: (input.hash ?? null) as never })
  if (error) throw error
  return (data ?? []) as VerifiedSignature[]
}

export const signaturesOfDocumentQuery = (documentId: string) =>
  queryOptions({
    queryKey: ['signatures', documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signatures')
        .select('id, signer_name, signed_at, hash_after, request_id')
        .eq('document_id', documentId)
        .order('signed_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
