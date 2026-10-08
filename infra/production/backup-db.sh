#!/bin/sh
# Ежедневная копия базы (cron): сжатый дамп, хранятся последние 14 дней.
# Восстановление на отдельную базу: gunzip -c файл.sql.gz | docker exec -i <контейнер> psql -U updown -d <база>
set -eu

DIR=/opt/updown/backups
KEEP_DAYS=14
CONTAINER=$(docker compose -f /opt/updown/app/infra/production/docker-compose.db.yml ps -q postgres)

mkdir -p "$DIR"
FILE="$DIR/updown-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker exec "$CONTAINER" pg_dump -U updown -d updown --no-owner | gzip -6 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
find "$DIR" -name 'updown-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"
