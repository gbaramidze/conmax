import { cn } from '@/lib/utils'

/**
 * Значок файла «как в проводнике»: лист с загнутым уголком и цветной плашкой с типом — PDF красный, Word синий,
 * Excel зелёный, PowerPoint оранжевый и т. д. Чтобы тип было видно сразу, не читая названия.
 */

type Family = 'pdf' | 'word' | 'excel' | 'ppt' | 'image' | 'archive' | 'cad' | 'text' | 'video' | 'audio' | 'mail' | 'other'

const COLORS: Record<Family, string> = {
  pdf: '#D93025',
  word: '#2B579A',
  excel: '#1E7145',
  ppt: '#C43E1C',
  image: '#7C3AED',
  archive: '#B7791F',
  cad: '#0E7490',
  text: '#64748B',
  video: '#DB2777',
  audio: '#0891B2',
  mail: '#0F6CBD',
  other: '#64748B',
}

const FAMILIES: [RegExp, Family, string?][] = [
  [/^pdf$/, 'pdf', 'PDF'],
  [/^(docx?|docm|dotx?|rtf|odt)$/, 'word', 'DOC'],
  [/^(xlsx?|xlsm|xlsb|ods)$/, 'excel', 'XLS'],
  [/^csv$/, 'excel', 'CSV'],
  [/^(pptx?|ppsx?|odp)$/, 'ppt', 'PPT'],
  [/^(png|jpe?g|gif|webp|bmp|heic|heif|tiff?|svg)$/, 'image'],
  [/^(zip|rar|7z|tar|gz|tgz)$/, 'archive'],
  [/^(dwg|dxf|ifc|rvt|nwd|skp)$/, 'cad'],
  [/^(txt|md|log|json|xml|ini|ya?ml|tsv)$/, 'text'],
  [/^(mp4|mov|avi|mkv|webm|m4v)$/, 'video'],
  [/^(mp3|wav|m4a|ogg|aac|flac)$/, 'audio'],
  [/^(eml|msg|ics)$/, 'mail'],
]

function look(name: string, mime?: string | null): { family: Family; label: string } {
  const ext = /\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1]?.toLowerCase() ?? ''
  for (const [re, family, label] of FAMILIES) if (re.test(ext)) return { family, label: label ?? ext.toUpperCase().replace('JPEG', 'JPG').slice(0, 4) }
  const m = mime ?? ''
  if (m === 'application/pdf') return { family: 'pdf', label: 'PDF' }
  if (m.startsWith('image/')) return { family: 'image', label: 'IMG' }
  if (m.includes('spreadsheet')) return { family: 'excel', label: 'XLS' }
  if (m.includes('wordprocessing')) return { family: 'word', label: 'DOC' }
  return { family: 'other', label: ext ? ext.toUpperCase().slice(0, 4) : '' }
}

export function FileTypeIcon({ name, mime, className }: { name: string; mime?: string | null; className?: string }) {
  const { family, label } = look(name, mime)
  const color = COLORS[family]
  return (
    <svg viewBox="0 0 32 40" aria-hidden className={cn('size-8 shrink-0', className)}>
      {/* лист */}
      <path d="M5 1.5h15.5L29.5 10.5V36.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-33a2 2 0 0 1 2-2Z" className="fill-card stroke-border" strokeWidth="1.25" />
      {/* загнутый уголок */}
      <path d="M20.5 1.5v7a2 2 0 0 0 2 2h7" className="fill-muted stroke-border" strokeWidth="1.25" strokeLinejoin="round" />
      {/* строки текста на листе, в цвет типа */}
      <path d="M8 13h9M8 16.5h13" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
      {/* плашка с типом */}
      <rect x="0.5" y="21" width="27" height="12.5" rx="2" fill={color} />
      {label && (
        <text
          x="14"
          y="30.4"
          textAnchor="middle"
          fill="#fff"
          fontSize={label.length > 3 ? 7.2 : 8.4}
          fontWeight="700"
          letterSpacing="0.2"
          fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        >
          {label}
        </text>
      )}
    </svg>
  )
}
