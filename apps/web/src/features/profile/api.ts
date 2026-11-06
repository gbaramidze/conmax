import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { uuid } from '@/lib/utils'

export const AVATARS_BUCKET = 'avatars'
const AVATAR_SIDE = 256
export const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024

/** Всё, что нужно странице профиля: поля из `users` (только свои) и состояние почты в Auth. */
export const myProfileQuery = queryOptions({
  queryKey: ['my-profile'],
  queryFn: async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) throw new Error('not signed in')
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, job_title, locale, timezone, avatar_path, organization:organizations(name), tenant:tenants(name)')
      .eq('id', user.id)
      .single()
    if (error) throw error
    return { ...data, authEmail: user.email ?? data.email, pendingEmail: user.new_email ?? null }
  },
})

export interface ProfileInput {
  full_name: string
  phone: string
  job_title: string
  timezone: string
}

export async function updateProfile(v: ProfileInput): Promise<void> {
  const { error } = await supabase.rpc('update_my_profile', {
    p_full_name: v.full_name,
    p_phone: v.phone || (null as never),
    p_job_title: v.job_title || (null as never),
    p_timezone: v.timezone,
  })
  if (error) throw error
}

/** Квадрат по центру кадра, 256×256, JPEG: фото с телефона на несколько мегабайт превращается в ~15–30 КБ. */
export async function resizeAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  const target = Math.min(AVATAR_SIDE, side)
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, target, target)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('resize failed')
  return blob
}

/** Загружает новое фото в свою папку, привязывает к профилю и убирает прежнее. */
export async function uploadAvatar(input: { file: File; tenantId: string; userId: string; oldPath: string | null }): Promise<string> {
  const blob = await resizeAvatar(input.file)
  const path = `${input.tenantId}/${input.userId}/${uuid()}.jpg`
  const upload = await supabase.storage.from(AVATARS_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (upload.error) throw upload.error
  const { error } = await supabase.rpc('set_my_avatar', { p_path: path })
  if (error) {
    await supabase.storage.from(AVATARS_BUCKET).remove([path])
    throw error
  }
  if (input.oldPath) await supabase.storage.from(AVATARS_BUCKET).remove([input.oldPath])
  return path
}

export async function removeAvatar(oldPath: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_avatar', { p_path: null as never })
  if (error) throw error
  if (oldPath) await supabase.storage.from(AVATARS_BUCKET).remove([oldPath])
}

/** Смена пароля: сначала проверяем текущий (повторным входом), потом ставим новый и завершаем остальные сеансы. */
export async function changePassword(input: { email: string; current: string; next: string }): Promise<'ok' | 'wrong_current' | 'weak' | 'same'> {
  const check = await supabase.auth.signInWithPassword({ email: input.email, password: input.current })
  if (check.error) return 'wrong_current'
  const { error } = await supabase.auth.updateUser({ password: input.next })
  if (error) {
    if (/different from the old|same_password/i.test(error.message) || error.code === 'same_password') return 'same'
    if (error.code === 'weak_password') return 'weak'
    throw error
  }
  await supabase.auth.signOut({ scope: 'others' })
  return 'ok'
}

export async function signOutOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) throw error
}

/** Письмо со ссылкой уходит на старый и на новый адрес; почта в профиле сменится после подтверждения. */
export async function requestEmailChange(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/profile` })
  if (error) throw error
}
