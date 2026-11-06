# BuildOS

Платформа управления строительной компанией. Документация: `construction-platform-docs` (ADR-012 — почему Supabase).

## Запуск локально

Нужны: Node 24+, pnpm, Docker Desktop, Supabase CLI.

```bash
pnpm install
supabase start                      # Postgres, Auth, Studio (http://127.0.0.1:54323), Mailpit (:54324)
cp apps/web/.env.example apps/web/.env.local   # впишите Publishable key из `supabase status`
supabase functions serve            # Edge Functions (приглашения), в отдельном терминале
pnpm dev                            # http://localhost:5173
```

Письма (приглашения, сброс пароля) локально не уходят наружу — смотрите их в Mailpit: http://127.0.0.1:54324.
Демо-пользователи из `supabase/seed.sql` (`admin@demo.test`, `pm1@demo.test`, …), пароль `demo-pass-2026`.

## База данных

| Команда | Что делает |
|---|---|
| `pnpm db:reset` | Пересоздаёт БД по миграциям |
| `pnpm db:test` | pgTAP-тесты (изоляция тенантов, права) |
| `pnpm db:types` | Перегенерирует TS-типы в `apps/web/src/lib/database.types.ts` |

Миграции — `supabase/migrations`. Каждая новая таблица: `tenant_id`, RLS + политики, тест в `supabase/tests`.

## Резервные копии

`pnpm db:reset` стирает все данные, включая загруженные файлы и записи совещаний. Перед ним и вообще регулярно:

```powershell
.\scripts\backup.ps1                       # копия в C:\dev\backups\<дата-время>, хранятся последние 14
.\scripts\restore.ps1 -From C:\dev\backups\<дата-время> -Yes   # ВОССТАНОВЛЕНИЕ: заменяет все текущие данные
```

Копия содержит базу (схемы public, private, auth, storage) и загруженные файлы. Скрипт сам проверяет, что в дампе
ровно столько строк, сколько в базе; восстановление так же сверяет число строк по каждой таблице. Структура БД при
восстановлении не меняется: уровень миграций должен совпадать с копией (`supabase migration up`).
Копии лежат на том же компьютере — для настоящей защиты их нужно регулярно переносить на другой диск или в облако.

## Структура

```
apps/web/        React SPA (Vite, TanStack Router/Query, shadcn/ui, Tailwind v4)
supabase/        миграции, тесты, конфиг
```
