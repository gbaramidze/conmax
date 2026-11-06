/**
 * Знак CONMAX: здание и каска из логотипа. Берётся верхняя часть картинки логотипа (без надписи), на белой плашке:
 * логотип нарисован на белом фоне, и на тёмной боковой панели он читается только так. Размер задаётся высотой (`h-8`), ширина пропорциональна.
 */
export function BrandMark({ className = 'h-8' }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="CONMAX"
      className={`inline-block aspect-[2.11/1] shrink-0 rounded-md bg-white bg-no-repeat shadow-sm ${className}`}
      style={{ backgroundImage: 'url(/conmax-logo.webp)', backgroundSize: '158.4% auto', backgroundPosition: '47.7% 8.9%' }}
    />
  )
}
