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
| `/` | Inicio: banner rotativo, nuevos ingresos (los 4 últimos publicados), destacados, categorías, perfumes, cómo comprar, reseñas, local. En el encabezado se resalta la sección que se está viendo |
| `/catalogo` | Catálogo con búsqueda y filtros: tipo, categoría, marca, color, malla, precio y ofertas (ver abajo). Cada tarjeta muestra el stock y un botón de WhatsApp |
| `/producto/<handle>` | Ficha de producto: stock, WhatsApp y productos relacionados (misma marca, después misma categoría) |
| `/carrito` | Carrito y checkout. Crea el pedido en Medusa (admin → Pedidos). Las formas de entrega son las opciones de envío del panel (Configuración → Ubicaciones y envíos): se listan todas; las de tipo `pickup` o con "retiro" en el nombre no piden dirección. En el pedido, el recuadro **Pago y entrega** muestra cómo paga (transferencia o efectivo) y cómo lo recibe |
| `/terminos`, `/cambios-y-devoluciones`, `/privacidad` | Páginas legales, con links al pie. Título y texto en el panel → **Páginas** (vacías hasta que el cliente cargue el texto; vacías no van a Google) |

## Banner de la portada

Se carga en el panel → **Banner**: título, texto, foto, botón con link, orden,
visible u oculto y fechas opcionales (para promociones). "La foto llena todo el
círculo" es para fotos con fondo de color o flyers; apagado, el producto va
sobre fondo blanco con margen. Sin diapositivas visibles, la portada usa el
texto fijo de `storefront/content/landing.ts`. El seed del catálogo de demo
crea tres diapositivas si no hay ninguna.

## Portada y páginas editables

En el panel → **Portada**: los productos destacados (hasta 8, en orden) y la
sección "Perfumes y decants" (títulos, textos, 2 fotos y los combos que se
presentan). En el panel → **Páginas**: términos y condiciones, cambios y
devoluciones, y privacidad. Se guardan en el módulo `site-content`
(`backend/src/lib/site-content.ts`) y la tienda los lee en
`/store/content/:key` (se actualiza en un minuto). Mientras no se guarden: los
destacados son los productos con el tag `destacado` y los combos, los productos
que se llaman "Combo…".

## Panel en español

El panel abre en español (cada usuario lo puede cambiar en su perfil) y usa las
palabras del local: Marcas (colecciones), Ofertas (listas de precios), Marcar
como pagado (capturar pago), Envío (fulfillment), Oculto (borrador). Los textos
salen de `backend/src/admin/i18n/es.json`, que genera
`node scripts/admin-es.mjs` (desde `backend/`) sobre la traducción oficial de
Medusa; volver a correrlo al actualizar Medusa.

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
| Categoría | Categorías: Caballeros, Damas, Casio, Perfumes y decants, Lentes de sol, Joyas y pulseras, Bolsos y billeteras, Organizadores y accesorios |
| Referencia | SKU de la variante (o metadata `ref`) |
| Características (chips) | Recuadro **Filtros de la tienda** del producto, una por línea (metadata `specs`, separadas por ` \| `) |
| Destacado en el inicio | Panel → **Portada** (hasta 8) |
| Precio de oferta (con el normal tachado) | Lista de precios "Ofertas" |
| Fotos | Imágenes del producto |
| Tipo (filtro) | Tipo de producto: Reloj, Perfume, Decant, Lentes de sol, Joya, Pulsera, Billetera, Cinto, Mochila o bolso, Cartera, Necessaire, Organizador, Botella o vaso, Herramienta, Accesorio |
| Color (filtro) | Recuadro **Filtros de la tienda**, de una lista cerrada (metadata `color`, ej. `Negro \| Dorado`). También cuentan los valores de la opción **Color**. La muestra de cada color está en `storefront/lib/colors.ts` |
| Malla (filtro) | Recuadro **Filtros de la tienda**: Acero, Mesh, Cuero, Silicona, Resina, Nylon o Tela (metadata `malla`) |
| Variantes | Opción **Color** → selector de color (hex opcional en metadata de la variante, `color_hex`). Otra opción con más de un valor → selector de opción. |

Las listas (categorías, tipos, marcas, colores y mallas) salen de los catálogos
PDF del cliente y están en `backend/src/lib/catalog-taxonomy.ts`. La migración
`backend/src/migration-scripts/catalog-taxonomy.ts` las crea una sola vez y no
crea productos. Un filtro muestra solo los valores que tienen productos.
Después de correrla, reconstruir el índice de búsqueda:
`POST /admin/search-indexes/product/reindex` (con una clave secreta).

## Búsqueda y filtros del catálogo

El catálogo usa el índice de búsqueda de Medusa (`backend/src/search/product.ts`):
búsqueda por texto con tolerancia a errores (título, marca, referencia,
descripción) y conteos por filtro. Cambiar los campos del índice requiere
reiniciar el backend (se reindexa al arrancar).

Filtros por URL, combinables y con varios valores (`?color=Negro&color=Azul`):
`q`, `tipo`, `categoria` (handle), `marca` (handle), `color`, `malla`, `min`, `max`,
`oferta=1`, `orden` (`nuevos`, `precio-asc`, `precio-desc`, `nombre`), `pagina`.

## Buscador y SEO

- **Buscador del encabezado** (lupa o tecla "/"): muestra resultados mientras se
  escribe desde `/api/buscar`, con la misma búsqueda del catálogo; Enter lleva
  a `/catalogo?q=`.
- **SEO**: `/sitemap.xml` (inicio, catálogo, categorías, marcas y productos),
  `/robots.txt` (en modo demo no indexa nada), datos estructurados del local
  (inicio) y de cada producto (precio y stock), y vista previa al compartir con
  foto y precio. Las búsquedas y los filtros combinados llevan noindex.

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
