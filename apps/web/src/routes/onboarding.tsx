import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/app-shell/auth-layout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: ({ context }) => {
    if (context.auth.status === 'signed_out' || context.auth.status === 'mfa_required') throw redirect({ to: '/login' })
    if (context.auth.status === 'ready') throw redirect({ to: '/' })
  },
  component: OnboardingPage,
})

const schema = z.object({
  fullName: z.string().trim().min(2, tr('Укажите имя и фамилию')),
  companyName: z.string().trim().min(2, tr('Укажите название компании')),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, tr('Только латиница, цифры и дефисы, например stroy-invest')),
})
type Values = z.infer<typeof schema>

function OnboardingPage() {
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' })

  async function onSubmit(v: Values) {
    setFormError(null)
    const { error } = await supabase.rpc('bootstrap_tenant', {
      p_name: v.companyName,
      p_slug: v.slug,
      p_full_name: v.fullName,
    })
    if (error) {
      setFormError(
        error.code === '23505'
          ? tr('Адрес компании уже занят. Выберите другой.')
          : tr('Не удалось создать компанию. Попробуйте ещё раз.'),
      )
      return
    }
    // tenant_id попадает в JWT только при выпуске нового токена
    await supabase.auth.refreshSession()
    await navigate({ to: '/' })
  }

  return (
    <AuthLayout title={tr('Создайте компанию')} description={tr('Вы станете её администратором и сможете приглашать коллег.')}>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">{tr('Ваше имя')}</Label>
              <Input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} {...register('fullName')} />
              {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="companyName">{tr('Название компании')}</Label>
              <Input id="companyName" aria-invalid={!!errors.companyName} {...register('companyName')} />
              {errors.companyName && <p className="text-sm text-destructive">{errors.companyName.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="slug">{tr('Адрес компании')}</Label>
              <Input id="slug" placeholder="stroy-invest" aria-invalid={!!errors.slug} {...register('slug')} />
              {errors.slug && <p className="text-sm text-destructive">{errors.slug.message}</p>}
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>{tr('Создать компанию')}</Button>
          </form>
    </AuthLayout>
  )
}
