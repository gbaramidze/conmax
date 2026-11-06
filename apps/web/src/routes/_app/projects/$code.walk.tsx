import { createFileRoute, Outlet } from '@tanstack/react-router'

// Раздел «Обход»: начало обхода (index) и чек-лист ($id)
export const Route = createFileRoute('/_app/projects/$code/walk')({
  component: () => <Outlet />,
})
