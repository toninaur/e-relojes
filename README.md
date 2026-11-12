# e-relojes — tienda online

Tienda online: un backend [Medusa](https://docs.medusajs.com) (admin, catálogo,
pedidos, stock, promociones) y un storefront en Next.js, en un monorepo con
npm workspaces.

```
├── backend/      # Medusa 2 (@erelojes/backend) — API en :9000, admin en :9000/app
├── storefront/   # Next.js (@erelojes/storefront) — :8000
└── connector/    # Conector Aronium → tienda (corre en la PC del local; no es parte del deploy)
```

## Requisitos

- Node 22.23 o más nuevo
- PostgreSQL 15 o más nuevo
- Redis: opcional en local

## Levantar en local

```bash
npm install

# 1. Backend
cp backend/.env.template backend/.env      # completar DATABASE_URL
cd backend
npx medusa db:setup --db erelojes_ecommerce   # crea la base, migra y carga los datos iniciales
npx medusa user -e admin@ejemplo.com -p <contraseña>   # usuario del admin
cd ..

# 2. Storefront
cp storefront/.env.template storefront/.env.local
# Completar NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY con la clave "Storefront"
# (admin → Settings → Publishable API Keys)

# 3. Los dos juntos
npm run dev
```

- Tienda: http://localhost:8000
- Admin: http://localhost:9000/app

## Páginas de la tienda

| Ruta | Qué es |
|---|---|
| `/` | Inicio: banner rotativo, destacados, categorías, perfumes, cómo comprar, reseñas, local |
| `/catalogo` | Catálogo con búsqueda y filtros: tipo, categoría, marca, color, malla, precio y ofertas (ver abajo) |
| `/producto/<handle>` | Ficha de producto |
| `/carrito` | Carrito y checkout. Crea el pedido en Medusa (admin → Pedidos) |

## Banner de la portada

Se carga en el panel → **Banner**: título, texto, foto, botón con link, orden,
visible u oculto y fechas opcionales (para promociones). "La foto llena todo el
círculo" es para fotos con fondo de color o flyers; apagado, el producto va
sobre fondo blanco con margen. Sin diapositivas visibles, la portada usa el
texto fijo de `storefront/content/landing.ts`. El seed del catálogo de demo
crea tres diapositivas si no hay ninguna.

## Datos iniciales

- `backend/src/migration-scripts/initial-data-seed.ts` corre una sola vez, con
  la primera migración: región Paraguay (PYG), envíos ("Envío a domicilio" y
  "Retiro en el local"), pago manual y el local de stock.
- Catálogo de demo (los productos de la landing, con fotos y ofertas):

  ```bash
  cd backend
  npx medusa exec ./src/scripts/seed-demo-catalog.ts         # agrega lo que falte
  npx medusa exec ./src/scripts/seed-demo-catalog.ts reset   # borra y recrea la demo
  ```

## Cargar productos en el admin (lo que lee la tienda)

| Dato en la tienda | Dónde se carga en Medusa |
|---|---|
| Nombre | Título del producto, con la marca ("Tissot PRX"). La tienda muestra la marca arriba y el modelo como título. |
| Marca | Colección |
| Categoría (Caballeros, Damas…) | Categorías |
| Referencia | SKU de la variante (o metadata `ref`) |
| Características (chips) | Metadata `specs`, separadas por ` \| ` — ej. `Swiss made \| 40 mm` |
| Destacado en el inicio | Tag `destacado` |
| Precio de oferta (con el normal tachado) | Lista de precios "Ofertas" |
| Fotos | Imágenes del producto |
| Tipo (filtro) | Tipo de producto: Reloj, Perfume, Accesorio |
| Color (filtro) | Metadata `color`, separados por ` \| ` — ej. `Negro \| Dorado`. También cuentan los valores de la opción **Color**. La muestra de cada color está en `storefront/lib/colors.ts` |
| Malla (filtro) | Metadata `malla` — ej. `Acero`, `Cuero`, `Silicona`, `Mesh`, `Resina` |
| Variantes | Opción **Color** → selector de color (hex opcional en metadata de la variante, `color_hex`). Otra opción con más de un valor → selector de opción. |

## Búsqueda y filtros del catálogo

El catálogo usa el índice de búsqueda de Medusa (`backend/src/search/product.ts`):
búsqueda por texto con tolerancia a errores (título, marca, referencia,
descripción) y conteos por filtro. Cambiar los campos del índice requiere
reiniciar el backend (se reindexa al arrancar).

Filtros por URL, combinables y con varios valores (`?color=Negro&color=Azul`):
`q`, `tipo`, `categoria` (handle), `marca` (handle), `color`, `malla`, `min`, `max`,
`oferta=1`, `orden` (`nuevos`, `precio-asc`, `precio-desc`, `nombre`), `pagina`.

## Buscador, SEO y medición

- **Buscador del encabezado** (lupa o tecla "/"): muestra resultados mientras se
  escribe desde `/api/buscar`, con la misma búsqueda del catálogo; Enter lleva
  a `/catalogo?q=`.
- **SEO**: `/sitemap.xml` (inicio, catálogo, categorías, marcas y productos),
  `/robots.txt` (en modo demo no indexa nada), datos estructurados del local
  (inicio) y de cada producto (precio y stock), y vista previa al compartir con
  foto y precio. Las búsquedas y los filtros combinados llevan noindex.
- **Medición**: Google Analytics 4 y Píxel de Meta, solo si están
  `NEXT_PUBLIC_GA_ID` / `NEXT_PUBLIC_META_PIXEL_ID`. Eventos: página vista,
  búsqueda, vio un producto, agregó al carrito, inició la compra, compra y
  click a WhatsApp (`storefront/lib/analytics.ts`).

## Checkout

El carrito vive en Medusa (el navegador guarda solo su id). Al confirmar se
crea el pedido con pago manual; transferencia o efectivo queda en la metadata
del pedido (`payment_method`). Con transferencia se muestran los datos de
`brand.payment` (`storefront/lib/brand.ts`, **a completar con la cuenta real**) y
un botón para mandar el comprobante por WhatsApp. Cupón de demo: `BIENVENIDA10`
(10%), creado por el seed del catálogo.

## Modo demo

Con `NEXT_PUBLIC_DEMO_MODE=1` en el storefront, la tienda muestra un aviso arriba
("Sitio de demostración…") y le pide a Google que no la indexe. Sin la variable
funciona como tienda real.

## Marca (para un cliente nuevo)

1. `storefront/lib/brand.ts`: nombre, logo, WhatsApp, redes, dirección, reseñas.
2. `storefront/content/landing.ts`: textos e imágenes de la portada.
3. `storefront/app/globals.css`: paleta de colores. Fuentes en `storefront/app/layout.tsx`.
4. `storefront/public/brand/` y `storefront/public/images/`: logos e imágenes.
5. Textos del carrito y checkout: `storefront/lib/texts.ts`.

## Conector con Aronium

El precio normal y el stock vienen de Aronium, el sistema de caja del local. Un
agente en la PC del local (`connector/`, ver su [README](connector/README.md)) lee la base de
Aronium y la manda a `POST /admin/aronium/sync`; el backend (`backend/src/lib/aronium-sync.ts`) compara y aplica,
y el panel muestra el estado y el historial en **Aronium**. El código de Aronium es el SKU de la variante;
los códigos nuevos se crean como productos en borrador.

## Pendiente

- Pasarela de pago online: la elige el cliente (Pagopar ya no existe).
- Datos reales de transferencia en `brand.payment`.
- Catálogo completo del cliente (con tipo, color y malla cargados).
- Deploy en Railway: paso a paso en [DEPLOY.md](DEPLOY.md) (un solo proyecto:
  Postgres + backend + storefront; las fotos van en un volumen).
