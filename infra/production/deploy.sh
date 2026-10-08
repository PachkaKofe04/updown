#!/bin/sh
# Обновление на сервере: свежий код, сборка, перезапуск. Запускать от root.
# API останавливается с дренажом: открытые прогнозы доигрывают, новые на это время не принимаются.
set -eu

APP=/opt/updown/app
cd "$APP"
sudo -u updown git pull --ff-only
sudo -u updown pnpm install --frozen-lockfile
sudo -u updown pnpm build
systemctl restart updown-api
systemctl restart updown-web

# сервис отвечает и видит базу
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health > /dev/null; then
    echo "deploy: ok ($(git rev-parse --short HEAD))"
    exit 0
  fi
  sleep 2
done
echo "deploy: API не ответил за 60 с, смотрите journalctl -u updown-api" >&2
exit 1
