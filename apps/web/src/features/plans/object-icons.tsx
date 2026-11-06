import type { ComponentType, CSSProperties, ReactNode } from 'react'

type SvgProps = { className?: string; style?: CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' }

/** Значок объекта: подходят и значки lucide, и собственные ниже. */
export type IconComponent = ComponentType<SvgProps>

function Svg({ className, style, children, ...rest }: SvgProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={rest['aria-hidden']}
    >
      {children}
    </svg>
  )
}

/** Купольная камера: полусфера на основании, в центре линза. */
export const DomeCameraIcon: IconComponent = (p) => (
  <Svg {...p}>
    <path d="M3 19h18" />
    <path d="M5 19a7 7 0 0 1 14 0" />
    <circle cx="12" cy="15" r="2" />
    <path d="M12 6V4" />
  </Svg>
)

/** Поворотная (PTZ) камера: купол и стрелки поворота по сторонам. */
export const PtzCameraIcon: IconComponent = (p) => (
  <Svg {...p}>
    <path d="M7 18a5 5 0 0 1 10 0" />
    <path d="M6 18h12" />
    <circle cx="12" cy="15" r="1.5" />
    <path d="M3 9l-1.5 2L3 13" />
    <path d="M21 9l1.5 2L21 13" />
    <path d="M3 11h4" />
    <path d="M17 11h4" />
    <path d="M12 7V4" />
  </Svg>
)

/** Камера «рыбий глаз» с круговым обзором: линза в нескольких кольцах. */
export const FisheyeCameraIcon: IconComponent = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
)
