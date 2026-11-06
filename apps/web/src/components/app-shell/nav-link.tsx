import { Link } from '@tanstack/react-router'
import type { ComponentType, ReactNode } from 'react'

/**
 * Ссылка на раздел проекта по строковому пути из списка разделов (`project-nav.ts`). Типизированные маршруты роутера
 * не умеют принимать путь строкой, поэтому тип сужен вручную; путь всегда берётся из списка разделов.
 */
export const NavLink = Link as unknown as ComponentType<{
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  className?: string
  onClick?: () => void
  children?: ReactNode
}>
