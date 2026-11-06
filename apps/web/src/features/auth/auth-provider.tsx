import { tr } from '@/lib/tr'
import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * loading    — сессия ещё читается
 * signed_out — не вошёл
 * no_tenant  — вошёл, но в JWT нет tenant_id (нужен onboarding: bootstrap_tenant)
 * mfa_required — пароль принят, но у пользователя включена двухфакторная защита и код ещё не введён
 * ready      — вошёл и привязан к компании
 */
export type AuthStatus = 'loading' | 'signed_out' | 'mfa_required' | 'no_tenant' | 'ready'

export interface AuthState {
  status: AuthStatus
  session: Session | null
  tenantId: string | null
  isExternal: boolean
  signOut: () => Promise<void>
}

function readClaims(token: string): { tenant_id?: string; is_external?: boolean; aal?: string } {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return {}
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // двухфакторная защита: нужен ли код. Пока уровень входа проверяется, статус остаётся «loading»
  const [mfa, setMfa] = useState<{ key: string; required: boolean } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      // Токен может быть формально валиден, а пользователь уже удалён/заблокирован — проверяем на сервере
      if (data.session) {
        const { error } = await supabase.auth.getUser()
        if (error && (error.status === 401 || error.status === 403 || error.status === 404)) {
          await supabase.auth.signOut({ scope: 'local' })
          setSession(null)
          setLoading(false)
          return
        }
      }
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const aalKey = session ? `${session.user.id}:${readClaims(session.access_token).aal ?? 'aal1'}` : null
  useEffect(() => {
    if (!aalKey) {
      setMfa(null)
      return
    }
    let alive = true
    supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => alive && setMfa({ key: aalKey, required: data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2' }))
      .catch(() => alive && setMfa({ key: aalKey, required: false }))
    return () => {
      alive = false
    }
  }, [aalKey])

  const value = useMemo<AuthState>(() => {
    const claims = session ? readClaims(session.access_token) : {}
    const mfaPending = !!session && mfa?.key !== aalKey
    const tenantId = claims.tenant_id ?? null
    return {
      status: loading || mfaPending ? 'loading' : !session ? 'signed_out' : mfa?.required ? 'mfa_required' : tenantId ? 'ready' : 'no_tenant',
      session,
      tenantId,
      isExternal: claims.is_external ?? false,
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [session, loading, mfa, aalKey])

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error(tr('useAuth вне AuthProvider'))
  return ctx
}
