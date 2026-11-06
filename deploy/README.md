# Деплой BuildOS на один EC2 (conmax.ge)

Всё на одном сервере: **Caddy** (HTTPS + сайт) → **self-hosted Supabase** в Docker (БД, Auth, Storage, Realtime, Edge-функции).
Каждый push в `main` через GitHub Actions собирает сайт и выкатывает: миграции БД → Edge-функции → сайт.

```
браузер ──443──> Caddy ──/            ──> /var/www/conmax/current  (собранный сайт)
                       └─/supabase/*  ──> 127.0.0.1:8000 (шлюз Supabase) ──> db, auth, rest, storage, realtime, functions
```

## 1. EC2

- Образ **Ubuntu 24.04**, тип **t3.large** (2 vCPU / 8 ГБ — для Supabase меньше нельзя), диск **gp3 60–100 ГБ**.
- **Elastic IP** (иначе адрес меняется при перезапуске).
- Security group: **22** — только ваш IP, **80** и **443** — всем. Больше ничего не открывать (8000, 5432 наружу не нужны).
- Пара ключей: скачайте `.pem`, он понадобится дважды (вход вручную и GitHub Secret).

## 2. DNS

У регистратора `.ge`: записи **A** для `conmax.ge` и `www.conmax.ge` → Elastic IP. Подождите, пока обновится (`nslookup conmax.ge`).
Caddy получит сертификат сам, только если домен уже указывает на сервер.

## 3. Подготовка сервера (с вашего компьютера, PowerShell)

```powershell
scp -i ключ.pem -r C:\dev\buildos\deploy ubuntu@<IP>:~/deploy
ssh -i ключ.pem ubuntu@<IP>
```

На сервере:

```bash
bash ~/deploy/server-setup.sh     # Docker, Caddy, папки, ночной бэкап
exit                              # зайти по SSH заново, чтобы заработала группа docker
```

```bash
bash /opt/buildos-deploy/supabase-install.sh   # ставит Supabase в /opt/supabase-project, генерирует секреты
nano /opt/supabase-project/.env                # SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_ADMIN_EMAIL, SMTP_SENDER_NAME
nano /opt/supabase-project/.env.functions      # SMTP для функций, ключи STT/Anthropic (по необходимости)
cd /opt/supabase-project && sh run.sh start && docker compose ps    # все сервисы должны стать healthy
sudo systemctl reload caddy
grep '^SUPABASE_PUBLISHABLE_KEY=' /opt/supabase-project/.env        # ключ для GitHub (шаг 4)
```

Почта: проще всего Amazon SES (SMTP-доступ). Без SMTP не уйдут письма-приглашения и сброс пароля.

## 4. GitHub

1. Для деплоя создайте отдельный ключ (на своём компьютере): `ssh-keygen -t ed25519 -f deploy_key -N ""`.
   Содержимое `deploy_key.pub` добавьте на сервер в `~/.ssh/authorized_keys`.
2. В репозитории **Settings → Secrets and variables → Actions → Secrets**:

   | Секрет | Значение |
   |---|---|
   | `SSH_HOST` | Elastic IP |
   | `SSH_USER` | `ubuntu` |
   | `SSH_KEY` | содержимое файла `deploy_key` (приватный ключ целиком) |
   | `SUPABASE_PUBLISHABLE_KEY` | значение из шага 3 |

3. Там же во вкладке **Variables** добавьте `DEPLOY_ENABLED` = `true`.
4. **Actions → Deploy → Run workflow** (или любой push в `main`).

Приватный `.pem`, ключи и пароли в чат и в git не отправляйте.

## 5. После первого деплоя (один раз)

```bash
bash /opt/buildos-deploy/post-install.sh
cd /opt/supabase-project && docker compose up -d --force-recreate functions
```

Он прописывает в БД адреса и секрет, по которым pg_cron будит Edge-функции (почта, тексты документов, погода).
Без этого шага уведомления по почте не отправляются.

Откройте https://conmax.ge — должна появиться страница входа.

## Повседневная работа

- **Обновление** — просто `git push` в `main`. Новые файлы миграций применяются автоматически, по одному, каждая в транзакции;
  при ошибке выкатка останавливается (сайт остаётся прежним) — смотрите лог Action.
- **Откат сайта**: `ln -sfn /var/www/conmax/releases/<версия> /var/www/conmax/current` (хранятся 5 последних).
- **Студия Supabase** (наружу закрыта): `ssh -i ключ.pem -L 8000:127.0.0.1:8000 ubuntu@<IP>`, затем http://localhost:8000
  (логин и пароль: `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` из `.env`).
- **Бэкап**: каждую ночь 03:30 → `/var/backups/buildos` (дамп БД + файлы), хранится 14 дней. Лог: `backup.log` там же.
  Диск — единственная копия, поэтому настройте копию в S3: создайте бакет, дайте инстансу IAM-роль с записью в него,
  поставьте aws cli и добавьте в crontab `BACKUP_S3=s3://имя-бакета/` перед вызовом `backup.sh`.
  Ещё включите автоматические снимки EBS (Data Lifecycle Manager).
- **Восстановление БД**: `docker exec -i supabase-db pg_restore -h localhost -U supabase_admin -d postgres --clean --if-exists < db-ДАТА.dump`
- **Обновление Supabase**: сначала бэкап, затем по инструкции из официального README (`sh update.sh`, `sh run.sh pull && sh run.sh recreate`).
- **Секреты функций**: правка `.env.functions`, затем `docker compose up -d --force-recreate functions`.

## Что проверить в первую очередь

- Вход, приглашение пользователя (письмо приходит и ссылка ведёт на `https://conmax.ge`).
- Загрузка файла в проект (Storage), чат в реальном времени (Realtime).
- Включение двухфакторной защиты (MFA) и сброс MFA админом.
- Демо-данные (`supabase/seed.sql`) на сервер **не** заливаются — это только для разработки.
