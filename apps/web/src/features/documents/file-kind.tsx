/** Что за файл: короткая цветная метка PDF, XLS, DOC, DWG… — чтобы в списках сразу было видно тип. */
export interface FileKind {
  label: string
  className: string
}

const KINDS: [RegExp, FileKind][] = [
  [/\.pdf$/i, { label: 'PDF', className: 'bg-red-500/10 text-red-700 dark:text-red-300' }],
  [/\.(xlsx|xlsm|xls|csv)$/i, { label: 'XLS', className: 'bg-green-500/10 text-green-700 dark:text-green-300' }],
  [/\.(docx|doc|rtf|odt)$/i, { label: 'DOC', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' }],
  [/\.(dwg|dxf)$/i, { label: 'DWG', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' }],
  [/\.(png|jpe?g|webp|gif|heic|tiff?)$/i, { label: 'IMG', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }],
  [/\.(txt|md|log|json|xml)$/i, { label: 'TXT', className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }],
  [/\.(zip|rar|7z)$/i, { label: 'ZIP', className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }],
  [/\.(ifc|rvt|nwd)$/i, { label: 'BIM', className: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' }],
]

export function fileKind(name: string | null | undefined, mime?: string | null): FileKind | null {
  if (!name && !mime) return null
  const n = name ?? ''
  for (const [re, kind] of KINDS) if (re.test(n)) return kind
  if (mime === 'application/pdf') return KINDS[0][1]
  if (mime?.startsWith('image/')) return KINDS[4][1]
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(n)?.[1]?.toUpperCase()
  return ext ? { label: ext, className: 'bg-muted text-muted-foreground' } : null
}

export function FileKindBadge({ name, mime, className = '' }: { name: string | null | undefined; mime?: string | null; className?: string }) {
  const k = fileKind(name, mime)
  if (!k) return null
  return (
    <span title={name ?? undefined} className={`inline-flex h-5 min-w-9 shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold tracking-wide ${k.className} ${className}`}>
      {k.label}
    </span>
  )
}
