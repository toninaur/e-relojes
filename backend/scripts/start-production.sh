#!/bin/sh
# Arranque en producción (Railway). Corre desde el build de Medusa
# (.medusa/server, generado por `npm run build`), que sirve /static desde
# .medusa/server/static: ahí va el volumen de las fotos.
#
# 1. Migra la base (tablas, links e índice de búsqueda) y corre los datos
#    iniciales la primera vez.
# 2. Con SEED_DEMO=1 carga el catálogo de demo (agrega solo lo que falta).
# 3. Arranca Medusa en $PORT.
set -e
cd "$(dirname "$0")/../.medusa/server"

npx medusa db:migrate --execute-safe-links --execute-all-search

if [ "$SEED_DEMO" = "1" ]; then
  DEMO_CATALOG_DIR=../../demo-catalog npx medusa exec ./src/scripts/seed-demo-catalog.js
fi

exec npx medusa start
