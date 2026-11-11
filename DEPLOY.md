# Deploy en Railway

Todo en **un solo proyecto de Railway**, con tres servicios:

| Servicio | Qué es | Dominio |
|---|---|---|
| `Postgres` | Base de datos | — |
| `backend` | Medusa: API + admin (`/app`) | `api-….up.railway.app` |
| `storefront` | La tienda (Next.js) | `….up.railway.app` o el dominio propio |

Redis no hace falta para la demo (Medusa usa módulos en memoria). Para la
tienda real con tráfico, se agrega un servicio Redis y la variable `REDIS_URL`
en el backend: `medusa-config.ts` lo usa solo si existe.

Costo aproximado: plan Hobby (USD 5/mes, incluye USD 5 de uso); una demo con
poco tráfico anda en USD 5–15/mes.

## 1. Proyecto y base de datos

1. Crear el proyecto en [railway.com](https://railway.com) (cuenta propia o del cliente).
2. **+ New → Database → PostgreSQL.**

## 2. Backend

1. **+ New → GitHub Repo** → este repo. Renombrar el servicio a `backend`.
2. **Settings:**
   - *Source → Root Directory:* `e-commerce`
   - *Source → Branch:* la rama a publicar.
   - *Config-as-code → Railway Config File:* `/e-commerce/backend/railway.json`
   - *Networking → Generate Domain* (puerto 9000).
3. **Variables** (las `${{…}}` son referencias de Railway, se escriben tal cual):

   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   MEDUSA_BACKEND_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   ADMIN_CORS=https://${{RAILWAY_PUBLIC_DOMAIN}}
   AUTH_CORS=https://${{RAILWAY_PUBLIC_DOMAIN}}
   STORE_CORS=https://${{storefront.RAILWAY_PUBLIC_DOMAIN}}
   JWT_SECRET=<texto largo al azar>
   COOKIE_SECRET=<otro texto largo al azar>
   SEED_DEMO=1
   ```

   `SEED_DEMO=1` carga el catálogo de demo al arrancar (si ya está, no hace
   nada). Para la tienda real con el catálogo del cliente, se borra.
4. **Volumen para las fotos:** clic derecho en el servicio → *Attach Volume* →
   mount path `/app/backend/.medusa/server/static`. Sin volumen, las fotos se
   pierden en cada deploy.
5. Deploy. Al arrancar migra la base, crea región Paraguay, envíos y la clave
   publicable, y carga la demo (`backend/scripts/start-production.sh`).
6. **Usuario del admin** (una vez): en la terminal, con la
   [CLI de Railway](https://docs.railway.com/guides/cli) vinculada al proyecto:

   ```bash
   railway ssh --service backend
   cd backend/.medusa/server && npx medusa user -e <email> -p <contraseña>
   ```

7. Entrar a `https://<dominio-backend>/app` → *Settings → Publishable API Keys*
   → copiar la clave **Storefront**.

## 3. Storefront

1. **+ New → GitHub Repo** → el mismo repo. Renombrar a `storefront`.
2. **Settings:** Root Directory `e-commerce`, la misma rama, Config File
   `/e-commerce/storefront/railway.json`, *Generate Domain* (puerto 8080 o el
   que Railway sugiera).
3. **Variables:**

   ```
   NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
   NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<la clave del paso 2.7>
   NEXT_PUBLIC_SITE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   NEXT_PUBLIC_DEMO_MODE=1
   ```

   Las `NEXT_PUBLIC_*` se graban en el build: si se cambian, hay que volver a
   hacer deploy. El backend tiene que estar andando antes (el build lee los
   productos del inicio).
4. Deploy y abrir el dominio.

## Pasar a producción (cuando el cliente confirme)

- Storefront: borrar `NEXT_PUBLIC_DEMO_MODE`; dominio propio (*Networking →
  Custom Domain*) y actualizar `NEXT_PUBLIC_SITE_URL` y `STORE_CORS`.
- Backend: borrar `SEED_DEMO`, borrar los productos de demo desde el admin (o
  `medusa exec ./src/scripts/seed-demo-catalog.js reset` y borrar a mano) y
  cargar el catálogo real; agregar Redis (`REDIS_URL`).
- Datos reales de transferencia en `storefront/lib/brand.ts`.
- Pasarela de pago online, la que elija el cliente.
- Railway permite transferir el proyecto a la cuenta del cliente
  (*Project Settings → Transfer*).
