# Catálogos PDF → tienda

Los catálogos del local (Casio Caballeros, Damas, Relojes Caballeros, Lentes y
accesorios, Organizadores, Perfumes) tienen un producto por página: la foto a
la izquierda y, a la derecha, marca, modelo, código, código de barras,
características y precio. Esto saca de ahí la foto y los datos de cada producto
y los carga en los productos que llegaron de Aronium.

## 1. Extraer (en la PC)

```
cd tools/catalog-pdf && npm install
node extract.mjs "<carpeta de los PDF>" "<copia de pos.db>" "<carpeta de salida>"
```

Deja `catalog.json` y `img/` (~80 MB, fuera del repo). Cada página se une a un
producto de Aronium por el código o el código de barras que aparece en ella.
Las páginas sin código de Aronium (perfumes, termos…) quedan sin unir.

## 2a. Importar en la tienda local

```
cd backend
CATALOG_DIR="<carpeta de salida>" npx medusa exec ./src/scripts/import-catalog.ts publicar
```

## 2b. Importar en producción (Railway)

Las fotos tienen que quedar en el disco del servidor, así que primero se suben
por la API de administración (como si se cargaran desde el panel):

1. Panel de producción → Configuración → Claves de API secretas → crear una.
2. En la PC:
   ```
   STORE_URL=https://<backend> ADMIN_KEY=sk_… node upload.mjs "<carpeta de salida>"
   ```
   Sube una foto por producto y al final imprime `CATALOG_URL=…`. Si se corta,
   se vuelve a correr y sigue donde quedó (`uploaded.json`).
3. En el servidor (`railway ssh --service backend`):
   ```
   cd /app/backend/.medusa/server
   CATALOG_URL=<la dirección impresa> npx medusa exec ./src/scripts/import-catalog.js publicar
   ```
4. Borrar la clave del paso 1.

Qué hace la importación, y las opciones (`publicar`, `reemplazar-fotos`): ver
el comentario de `backend/src/scripts/import-catalog.ts`.
