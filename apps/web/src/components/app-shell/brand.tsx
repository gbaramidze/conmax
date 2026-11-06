/** Знак: графитовый квадрат с жёлтой «опалубочной» планкой — отсылка к разметке на стройплощадке. */
export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="BuildOS">
      <rect width="32" height="32" rx="7" fill="#14181b" stroke="#ffffff" strokeOpacity="0.2" />
      <rect x="7" y="7" width="4.5" height="18" rx="1" fill="#ffc20e" />
      <rect x="14" y="7" width="11" height="4.5" rx="1" fill="#ffc20e" />
      <rect x="14" y="13.75" width="8" height="4.5" rx="1" fill="#ffffff" fillOpacity="0.9" />
      <rect x="14" y="20.5" width="11" height="4.5" rx="1" fill="#ffffff" fillOpacity="0.9" />
    </svg>
  )
}
