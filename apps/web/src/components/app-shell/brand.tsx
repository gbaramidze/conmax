/**
 * Знак CONMAX: иконка приложения (каска и здания на тёмной плашке со скруглёнными углами, `public/favicon.svg`).
 * Размер задаётся высотой (`h-8`), знак квадратный. Рядом всегда есть надпись CONMAX или подпись ссылки,
 * поэтому картинка декоративная. Тонкая светлая рамка отделяет плашку от тёмной боковой панели.
 */
export function BrandMark({ className = 'h-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" aria-hidden draggable={false} className={`inline-block aspect-square shrink-0 rounded-[22%] ring-1 ring-white/10 ${className}`} />
}
