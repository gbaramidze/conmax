#!/usr/bin/env bash
# Разовая установка self-hosted Supabase в /opt/supabase-project по официальной инструкции (вариант «ручной клон»).
# Актуальную версию смотрите на https://supabase.com/docs/guides/self-hosting/docker  (по умолчанию — v0.8.4).
# Запуск: bash /opt/buildos-deploy/supabase-install.sh [self-hosted/vX.Y.Z]
set -euo pipefail

REF="${1:-self-hosted/v0.8.4}"
DOMAIN="${DOMAIN:-conmax.ge}"
TARGET=/opt/supabase-project
SRC=/opt/supabase-src

if [ -e "$TARGET/.env" ]; then echo "$TARGET/.env уже есть — установка уже сделана. Ничего не меняю."; exit 0; fi

sudo mkdir -p /opt && sudo chown "$(id -un)": /opt
rm -rf "$SRC"
git clone --depth 1 --branch "$REF" https://github.com/supabase/supabase "$SRC"
mkdir -p "$TARGET"
cp -rf "$SRC/docker/." "$TARGET"
cd "$TARGET"
cp .env.example .env
printf 'ref=%s\n' "$REF" > .supabase-version
cp /opt/buildos-deploy/docker-compose.buildos.yml ./docker-compose.buildos.yml

echo "==> Генерация секретов и ключей (официальные скрипты)"
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh

echo "==> Настройка адресов"
setenv() { # setenv ИМЯ ЗНАЧЕНИЕ — заменить строку или добавить в конец
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
setenv SUPABASE_PUBLIC_URL "https://$DOMAIN/supabase"
setenv API_EXTERNAL_URL "https://$DOMAIN/supabase/auth/v1"
setenv SITE_URL "https://$DOMAIN"
setenv ADDITIONAL_REDIRECT_URLS "https://$DOMAIN,https://www.$DOMAIN"
setenv ENABLE_EMAIL_AUTOCONFIRM "true"   # как в локальной разработке (enable_confirmations = false)
setenv ENABLE_PHONE_SIGNUP "false"
# подключить наш дополнительный compose-файл
if grep -q "^COMPOSE_FILE=" .env; then sed -i '/^COMPOSE_FILE=/ s|$|:docker-compose.buildos.yml|' .env; else echo "COMPOSE_FILE=docker-compose.yml:docker-compose.buildos.yml" >> .env; fi

# секреты Edge-функций
if [ ! -f .env.functions ]; then
  W="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  cat > .env.functions <<EOF
# Секреты Edge-функций (читаются контейнером functions). После правки: docker compose up -d --force-recreate functions
APP_URL=https://$DOMAIN
EMAIL_WORKER_SECRET=$W

# Почта (функция send-emails): например Amazon SES SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=BuildOS <no-reply@$DOMAIN>

# Итоги совещаний (по необходимости)
STT_API_KEY=
STT_BASE_URL=https://api.openai.com/v1
STT_MODEL=whisper-1
STT_LANGUAGE=ru
ANTHROPIC_API_KEY=
EOF
  chmod 600 .env .env.functions
fi

echo
echo "Готово. Теперь:"
echo "  1) nano $TARGET/.env            — заполните SMTP_* (письма входа/приглашений)"
echo "  2) nano $TARGET/.env.functions  — SMTP для функций и ключи сервисов"
echo "  3) cd $TARGET && sh run.sh start && docker compose ps"
echo "  4) sudo systemctl reload caddy"
echo "Ключ для сайта (его надо положить в GitHub Secrets как SUPABASE_PUBLISHABLE_KEY):"
echo "  grep '^SUPABASE_PUBLISHABLE_KEY=' $TARGET/.env"
