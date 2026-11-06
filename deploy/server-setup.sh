#!/usr/bin/env bash
# Разовая подготовка EC2 (Ubuntu 22.04/24.04): Docker, Caddy, папки, ночной бэкап.
# Запуск: bash ~/deploy/server-setup.sh   (под пользователем ubuntu, не root)
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then echo "Запускайте не под root, а под ubuntu"; exit 1; fi
SRC="$(cd "$(dirname "$0")" && pwd)"
ME="$(id -un)"

echo "==> Своп 2 ГБ (защита от нехватки памяти)"
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Пакеты"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git rsync unzip debian-keyring debian-archive-keyring apt-transport-https

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$ME"

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
sudo cp "$SRC/Caddyfile" /etc/caddy/Caddyfile

echo "==> Папки"
sudo mkdir -p /var/www/conmax/releases /opt/buildos-deploy/incoming /var/backups/buildos
sudo chown -R "$ME":"$ME" /var/www/conmax /opt/buildos-deploy /var/backups/buildos
cp "$SRC"/*.sh /opt/buildos-deploy/ && chmod +x /opt/buildos-deploy/*.sh
cp "$SRC/docker-compose.buildos.yml" /opt/buildos-deploy/

echo "==> Ночной бэкап в 03:30"
( crontab -l 2>/dev/null | grep -v buildos-backup ; echo "30 3 * * * /opt/buildos-deploy/backup.sh >> /var/backups/buildos/backup.log 2>&1 # buildos-backup" ) | crontab -

echo
echo "Готово. ВАЖНО: выйдите из SSH и зайдите снова (чтобы заработала группа docker)."
echo "Дальше: bash /opt/buildos-deploy/supabase-install.sh"
