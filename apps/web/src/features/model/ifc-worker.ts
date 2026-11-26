/// <reference lib="webworker" />
// Перевод IFC → GLB в фоновом потоке браузера: страница не замирает, пока разбирается файл на сотни мегабайт.
// Сообщения: вход { file }, выход { type: 'progress', stage, done } | { type: 'done', result } | { type: 'error', message }.
import JSZip from 'jszip'
import wasmUrl from 'web-ifc/web-ifc.wasm?url'
import { convertIfc, type ConvertProgress, type ConvertResult } from './ifc-convert'

export type WorkerOut =
  | ({ type: 'progress' } & ConvertProgress)
  | { type: 'read'; done: number }
  | { type: 'done'; result: ConvertResult }
  | { type: 'error'; message: string }

const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  try {
    const { file } = e.data
    post({ type: 'read', done: 0 })
    let data: Uint8Array = new Uint8Array(await file.arrayBuffer())
    // .ifczip — обычный zip с одним .ifc внутри
    if (data[0] === 0x50 && data[1] === 0x4b) {
      const zip = await JSZip.loadAsync(data)
      const entry = Object.values(zip.files).find((f) => !f.dir && /\.ifc$/i.test(f.name))
      if (!entry) throw new Error('ifczip_no_ifc')
      data = await entry.async('uint8array', (m) => post({ type: 'read', done: m.percent / 100 }))
    }
    post({ type: 'read', done: 1 })
    const result = await convertIfc(data, {
      sourceName: file.name,
      init: (api) => api.Init((path) => (path.endsWith('.wasm') ? wasmUrl : path), true),
      onProgress: (p) => post({ type: 'progress', ...p }),
    })
    post({ type: 'done', result }, [result.glbGz.buffer as ArrayBuffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
