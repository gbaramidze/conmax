// Воркер чтения документов: забирает файлы из очереди (claim_file_texts), достаёт текст и сохраняет (finish_file_text).
// Форматы: PDF с текстовым слоем, Word (.docx), Excel (.xlsx), TXT/CSV/MD/JSON/XML/HTML. Сканы и DWG пока не читаются.
// Вызывается из БД (pg_cron → pg_net) с секретом в заголовке x-worker-secret.
import { Buffer } from 'node:buffer'
import { createClient } from 'npm:@supabase/supabase-js@2'
import mammoth from 'npm:mammoth@1.8.0'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'
import * as XLSX from 'npm:xlsx@0.18.5'

const SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'

interface Job {
  file_id: string
  storage_key: string
  name: string
  mime: string
  size: number
}

const ext = (name: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? '').toLowerCase()

/** Текст в UTF-8, а если много «�» — в windows-1251 (старые txt/csv из Excel). */
function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const bad = (utf8.match(/�/g) ?? []).length
  return bad > Math.max(3, utf8.length / 200) ? new TextDecoder('windows-1251').decode(bytes) : utf8
}

async function extract(bytes: Uint8Array, name: string): Promise<{ method: string; text: string }> {
  switch (ext(name)) {
    case 'pdf': {
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await extractText(pdf, { mergePages: true })
      return { method: 'pdf', text: Array.isArray(text) ? text.join('\n') : text }
    }
    case 'docx': {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      return { method: 'docx', text: value }
    }
    case 'xlsx':
    case 'xlsm': {
      const wb = XLSX.read(bytes, { type: 'array' })
      const parts = wb.SheetNames.map((s) => `${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s], { FS: ' | ', blankrows: false })}`)
      return { method: 'xlsx', text: parts.join('\n\n') }
    }
    case 'html':
    case 'htm': {
      const html = decodeText(bytes)
      return { method: 'html', text: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') }
    }
    default:
      return { method: 'text', text: decodeText(bytes) }
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('claim_file_texts', { p_limit: 4 })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const jobs = (data ?? []) as Job[]
  let done = 0
  let failed = 0
  for (const job of jobs) {
    try {
      const { data: blob, error: downloadError } = await supabase.storage.from('files').download(job.storage_key)
      if (downloadError || !blob) throw new Error(downloadError?.message ?? 'файл не найден в хранилище')
      const { method, text } = await extract(new Uint8Array(await blob.arrayBuffer()), job.name)
      await supabase.rpc('finish_file_text', { p_file: job.file_id, p_status: 'done', p_method: method, p_text: text.replace(/\u0000/g, '') })
      done++
    } catch (e) {
      await supabase.rpc('finish_file_text', { p_file: job.file_id, p_status: 'failed', p_error: String(e instanceof Error ? e.message : e) })
      failed++
    }
  }
  return Response.json({ done, failed })
})
