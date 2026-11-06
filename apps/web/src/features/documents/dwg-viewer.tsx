import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

/**
 * Просмотр DWG через Autodesk включается, когда на сервере есть ключи APS: `VITE_DWG_VIEWER=on` в `.env.local`.
 * Пока выключен, DWG открывается через приложенную PDF-печать, а кнопки «Открыть DWG» в интерфейсе нет.
 */
export const DWG_VIEWER_ENABLED = import.meta.env.VITE_DWG_VIEWER === 'on'

/** Ответ функции `dwg-view`: где сейчас просмотр файла и, когда готов, чем его открыть. */
export interface DwgView {
  status: 'not_configured' | 'uploading' | 'translating' | 'ready' | 'failed'
  progress?: string | null
  urn?: string
  token?: string
  expires_in?: number
  error?: string
}

async function fetchView(storageKey: string, retry = false): Promise<DwgView> {
  const { data, error } = await supabase.functions.invoke('dwg-view', { body: { storage_key: storageKey, retry } })
  if (error) throw error
  return data as DwgView
}

// ---- просмотрщик Autodesk: скрипт и стили грузятся с адреса Autodesk один раз за сессию ----
const VIEWER_BASE = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*'

/** Минимум того, что нужно от глобального `Autodesk.Viewing` (полного описания типов у вьюера нет). */
interface AdskViewer {
  start: () => number
  finish: () => void
  loadDocumentNode: (doc: unknown, node: unknown) => Promise<unknown>
}
interface AdskGlobal {
  Viewing: {
    Initializer: (opts: Record<string, unknown>, done: () => void) => void
    Document: { load: (urn: string, ok: (doc: { getRoot: () => { getDefaultGeometry: () => unknown } }) => void, fail: (code: number, message: string) => void) => void }
    GuiViewer3D: new (el: HTMLElement, cfg?: Record<string, unknown>) => AdskViewer
  }
}
const adsk = () => (window as unknown as { Autodesk: AdskGlobal }).Autodesk

let assets: Promise<void> | null = null
function loadAssets(): Promise<void> {
  assets ??= new Promise<void>((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${VIEWER_BASE}/style.min.css`
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = `${VIEWER_BASE}/viewer3D.min.js`
    s.onload = () => resolve()
    s.onerror = () => {
      assets = null
      reject(new Error('viewer_script'))
    }
    document.head.appendChild(s)
  })
  return assets
}

// Токен для вьюера берётся у функции заново, когда прежний подходит к концу; источник задаёт открытый сейчас просмотр
let tokenSource: () => Promise<{ token: string; expires_in: number }> = () => Promise.reject(new Error('no_source'))
let initialized: Promise<void> | null = null
function initViewer(): Promise<void> {
  initialized ??= loadAssets().then(
    () =>
      new Promise<void>((resolve) =>
        adsk().Viewing.Initializer(
          {
            env: 'AutodeskProduction2',
            api: 'streamingV2',
            getAccessToken: (cb: (token: string, expiresIn: number) => void) => void tokenSource().then((t) => cb(t.token, t.expires_in)),
          },
          resolve,
        ),
      ),
  )
  initialized.catch(() => (initialized = null))
  return initialized
}

const ERROR_TEXTS: Record<string, string> = {
  too_big: tr('Файл больше 150 МБ: в Autodesk он не откроется. Скачайте его и откройте в программе.'),
  translation_failed: tr('Autodesk не смог обработать этот файл. Возможно, он повреждён или сохранён в очень старой версии AutoCAD.'),
  download_failed: tr('Не удалось прочитать файл из хранилища.'),
  upload_timeout: tr('Отправка файла в Autodesk оборвалась.'),
}

/**
 * Просмотр DWG и DXF в браузере через Autodesk Platform Services: слои, листы (вкладки раскладок), измерения, текст.
 * При первом открытии файл переводится в формат просмотра (от секунд до нескольких минут), дальше открывается сразу.
 */
export function DwgViewer({ storageKey }: { storageKey: string }) {
  const qc = useQueryClient()
  const key = ['dwg-view', storageKey]
  const host = useRef<HTMLDivElement>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const view = useQuery({
    queryKey: key,
    queryFn: () => fetchView(storageKey),
    refetchInterval: (q) => (q.state.data?.status === 'uploading' || q.state.data?.status === 'translating' ? 3000 : false),
    retry: 1,
    staleTime: 0,
    gcTime: 0,
  })
  const retry = useMutation({ mutationFn: () => fetchView(storageKey, true), onSuccess: (d) => qc.setQueryData(key, d) })

  const urn = view.data?.status === 'ready' ? view.data.urn : undefined
  useEffect(() => {
    if (!urn) return
    setViewerError(null)
    tokenSource = async () => {
      const v = await fetchView(storageKey)
      if (v.status !== 'ready' || !v.token) throw new Error('no_token')
      return { token: v.token, expires_in: v.expires_in ?? 3000 }
    }
    let cancelled = false
    let viewer: AdskViewer | null = null
    void initViewer()
      .then(() => {
        if (cancelled || !host.current) return
        const A = adsk().Viewing
        viewer = new A.GuiViewer3D(host.current, { extensions: ['Autodesk.DocumentBrowser'] })
        viewer.start()
        A.Document.load(
          `urn:${urn}`,
          (doc) => {
            if (cancelled) return
            void viewer?.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry()).catch(() => setViewerError(tr('Не удалось открыть чертёж в просмотрщике.')))
          },
          () => setViewerError(tr('Не удалось открыть чертёж в просмотрщике.')),
        )
      })
      .catch(() => !cancelled && setViewerError(tr('Не удалось загрузить просмотрщик Autodesk. Проверьте подключение к интернету.')))
    return () => {
      cancelled = true
      try {
        viewer?.finish()
      } catch {
        // просмотрщик уже закрыт
      }
    }
  }, [urn, storageKey])

  const d = view.data
  if (view.isPending) return <Centered busy>{tr('Открываем чертёж…')}</Centered>
  if (view.isError) return <Centered warn>{tr('Не удалось связаться с сервисом просмотра. Попробуйте позже.')}</Centered>
  if (d?.status === 'not_configured') {
    return (
      <Centered warn>
        <span className="max-w-md">{tr('Просмотр DWG ещё не подключён: администратору нужно добавить ключи Autodesk Platform Services (APS_CLIENT_ID и APS_CLIENT_SECRET) в настройки сервера. Пока чертёж можно скачать.')}</span>
      </Centered>
    )
  }
  if (d?.status === 'uploading' || d?.status === 'translating') {
    return (
      <Centered busy>
        <span className="max-w-md">
          {d.status === 'uploading' ? tr('Отправляем чертёж в Autodesk…') : tr('Autodesk готовит чертёж к просмотру…')}
          {d.progress ? ` ${d.progress}` : ''}
          <span className="mt-1 block text-xs">{tr('В первый раз это занимает от нескольких секунд до нескольких минут, дальше чертёж открывается сразу. Окно можно не закрывать.')}</span>
        </span>
      </Centered>
    )
  }
  if (d?.status === 'failed') {
    return (
      <Centered warn>
        <span className="max-w-md">{ERROR_TEXTS[d.error ?? ''] ?? tr('Не удалось подготовить чертёж к просмотру.')}</span>
        {d.error !== 'too_big' && (
          <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
            <RotateCw /> {tr('Повторить')}
          </Button>
        )}
      </Centered>
    )
  }
  return (
    <div className="relative size-full min-h-72 overflow-hidden bg-card">
      <div ref={host} className="absolute inset-0" />
      {viewerError && <p className="absolute inset-x-4 top-4 z-10 rounded-lg border border-amber-500/40 bg-background p-3 text-sm">{viewerError}</p>}
    </div>
  )
}

function Centered({ children, busy, warn }: { children: React.ReactNode; busy?: boolean; warn?: boolean }) {
  return (
    <div className="flex size-full min-h-72 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {warn && <AlertTriangle className="size-5" aria-hidden />}
      {children}
    </div>
  )
}
