/**
 * Catálogo de demo de e-relojes: los productos de la landing de demo, con sus
 * fotos, marcas, referencias, características y ofertas.
 *
 *   npx medusa exec ./src/scripts/seed-demo-catalog.ts
 *
 * Se puede correr de nuevo: saltea los productos cuyo handle ya existe. Borra
 * los 3 productos de ejemplo del seed inicial si siguen estando. Con `reset`
 * (npx medusa exec ./src/scripts/seed-demo-catalog.ts reset) borra y vuelve a
 * crear los productos de demo.
 *
 * Cómo se mapea cada dato (y cómo cargarlo después a mano desde el admin):
 * - Marca            → colección del producto.
 * - Categoría        → categoría (Caballeros, Damas, Casio, Perfumes, Accesorios).
 * - Referencia       → SKU de la variante.
 * - Características  → metadata `specs`, separadas por " | ".
 * - Destacado        → tag `destacado`.
 * - Oferta           → precio en la lista de precios "Ofertas" (tipo sale).
 * - Tipo             → tipo de producto (Reloj, Perfume, Accesorio). Filtro "Tipo".
 * - Color            → metadata `color`, separados por " | ". Filtro "Color".
 * - Malla            → metadata `malla`. Filtro "Malla".
 *
 * Tipo, color y malla se sincronizan también en los productos de demo que ya
 * existían, así que correrlo de nuevo los completa sin borrar nada.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from '@medusajs/framework/utils'
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createPriceListPricesWorkflow,
  createPriceListsWorkflow,
  createProductCategoriesWorkflow,
  createProductTagsWorkflow,
  createPromotionsWorkflow,
  createProductTypesWorkflow,
  createProductsWorkflow,
  updateProductsWorkflow,
  deleteProductCategoriesWorkflow,
  deleteProductsWorkflow,
  uploadFilesWorkflow,
} from '@medusajs/medusa/core-flows'

const CURRENCY = 'pyg'
const DEMO_STOCK = 5
const FEATURED_TAG = 'destacado'
const SALE_LIST_TITLE = 'Ofertas'
const DEMO_PROMO_CODE = 'BIENVENIDA10'
// En producción el seed corre desde el build (.medusa/server), que no tiene
// las fotos: scripts/start-production.sh le pasa la carpeta original.
const IMAGES_DIR = process.env.DEMO_CATALOG_DIR
  ? path.resolve(process.env.DEMO_CATALOG_DIR)
  : path.join(process.cwd(), 'demo-catalog')

const CATEGORIES = ['Caballeros', 'Damas', 'Casio', 'Perfumes', 'Accesorios']
const OLD_DEMO_HANDLES = ['reloj-clasico', 'reloj-deportivo', 'malla-de-cuero']
const OLD_DEMO_CATEGORIES = ['Relojes']

const TYPE_BY_CATEGORY: Record<string, string> = { Perfumes: 'Perfume', Accesorios: 'Accesorio' }
const DEFAULT_TYPE = 'Reloj'
const PRODUCT_TYPES = [DEFAULT_TYPE, ...Object.values(TYPE_BY_CATEGORY)]

// Color (esfera y tono del reloj) y material de la malla, sacados de las fotos.
const ATTRIBUTES: Record<string, { color?: string[]; malla?: string }> = {
  'tissot-prx': { color: ['Negro'], malla: 'Acero' },
  'seiko-5-sports-gmt': { color: ['Azul'], malla: 'Acero' },
  'citizen-tsuyosa': { color: ['Verde'], malla: 'Acero' },
  'tissot-seastar': { color: ['Negro'], malla: 'Cuero' },
  'emporio-armani-ar11521': { color: ['Negro', 'Dorado'], malla: 'Acero' },
  'tommy-hilfiger-1792095': { color: ['Negro', 'Dorado'], malla: 'Acero' },
  'invicta-scuba-45719': { color: ['Dorado', 'Negro'], malla: 'Silicona' },
  'casio-edifice-efr-526l': { color: ['Blanco'], malla: 'Cuero' },
  'casio-g-shock-ga-2100': { color: ['Negro'], malla: 'Resina' },
  'casio-edifice-efv-c120d': { color: ['Azul'], malla: 'Acero' },
  'tissot-ballade-ladies': { color: ['Azul'], malla: 'Acero' },
  'michael-kors-mk5774': { color: ['Blanco', 'Oro rosa'], malla: 'Acero' },
  'fossil-es5463': { color: ['Blanco', 'Dorado'], malla: 'Mesh' },
  'tommy-hilfiger-1782687': { color: ['Blanco'], malla: 'Silicona' },
  'swarovski-collar-signum': { color: ['Plateado'] },
}

function typeOf(p: DemoProduct) {
  return TYPE_BY_CATEGORY[p.category] ?? DEFAULT_TYPE
}

function metadataOf(p: DemoProduct) {
  const attrs = ATTRIBUTES[p.handle] ?? {}
  return {
    specs: p.specs.join(' | '),
    ...(attrs.color ? { color: attrs.color.join(' | ') } : {}),
    ...(attrs.malla ? { malla: attrs.malla } : {}),
  }
}

type DemoProduct = {
  handle: string
  category: string
  brand: string
  title: string
  sku: string
  image?: string
  specs: string[]
  price: number
  sale?: number
  featured?: boolean
  description?: string
}

const PRODUCTS: DemoProduct[] = [
  { handle: 'tissot-prx', category: 'Caballeros', brand: 'Tissot', title: 'Tissot PRX', sku: 'T137.410.11051.00', image: 'tissot-prx.jpg', specs: ['Swiss made', 'Cristal de zafiro', '40 mm', 'Sumergible 10 BAR'], price: 3900000, sale: 3500000, featured: true },
  { handle: 'seiko-5-sports-gmt', category: 'Caballeros', brand: 'Seiko', title: 'Seiko 5 Sports GMT', sku: 'SSK003K1', image: 'seiko-gmt.jpg', specs: ['Automático', 'Bisel giratorio', '42 mm', 'Sumergible 10 BAR'], price: 4200000, sale: 3400000, featured: true },
  { handle: 'citizen-tsuyosa', category: 'Caballeros', brand: 'Citizen', title: 'Citizen Tsuyosa', sku: 'NJ0150-56X', image: 'citizen-tsuyosa.jpg', specs: ['Automático', 'Cristal de zafiro', '40 mm'], price: 3450000, sale: 2900000, featured: true },
  { handle: 'tissot-seastar', category: 'Caballeros', brand: 'Tissot', title: 'Tissot Seastar', sku: 'T118.410.16.057.00', image: 'tissot-seastar.jpg', specs: ['Swiss made', 'Bisel rotativo', '45,5 mm', 'Sumergible 30 BAR'], price: 4600000, featured: true },
  { handle: 'emporio-armani-ar11521', category: 'Caballeros', brand: 'Emporio Armani', title: 'Emporio Armani AR11521', sku: 'AR11521', image: 'armani-ar11521.jpg', specs: ['Cronómetro', 'Acero inoxidable', '43 mm'], price: 1850000, featured: true },
  { handle: 'tommy-hilfiger-1792095', category: 'Caballeros', brand: 'Tommy Hilfiger', title: 'Tommy Hilfiger 1792095', sku: '1792095', image: 'tommy-1792095.jpg', specs: ['Acero inoxidable', 'Fecha y día', '42,5 mm'], price: 1450000, sale: 1250000, featured: true },
  { handle: 'invicta-scuba-45719', category: 'Caballeros', brand: 'Invicta', title: 'Invicta Scuba 45719', sku: '45719', image: 'invicta-scuba.jpg', specs: ['48 mm', 'Cuarzo japonés', 'Sumergible 100 m'], price: 1100000, sale: 850000, featured: true },
  { handle: 'casio-edifice-efr-526l', category: 'Casio', brand: 'Casio', title: 'Casio Edifice EFR-526L', sku: 'EFR-526L-7AVUDF', image: 'edifice-efr526.jpg', specs: ['Cronómetro', '42 mm', 'Sumergible 100 m'], price: 1200000, sale: 950000, featured: true },
  { handle: 'casio-g-shock-ga-2100', category: 'Casio', brand: 'Casio', title: 'Casio G-Shock GA-2100', sku: 'GA-2100-1A1DR', image: 'gshock-ga2100.jpg', specs: ['Resistente a impactos', '45 mm', 'Sumergible 20 BAR'], price: 975000, featured: true },
  { handle: 'casio-edifice-efv-c120d', category: 'Casio', brand: 'Casio', title: 'Casio Edifice EFV-C120D', sku: 'EFV-C120D-2ADF', image: 'edifice-efvc120.jpg', specs: ['Horario mundial', 'Cronómetro', 'Sumergible 100 m'], price: 1300000, sale: 1050000, featured: true },
  { handle: 'tissot-ballade-ladies', category: 'Damas', brand: 'Tissot', title: 'Tissot Ballade Ladies', sku: 'T156.210.11.041.00', image: 'tissot-ballade-ladies.jpg', specs: ['Cuarzo suizo', 'Cristal de zafiro', '34 mm'], price: 3250000, featured: true },
  { handle: 'michael-kors-mk5774', category: 'Damas', brand: 'Michael Kors', title: 'Michael Kors MK5774', sku: 'MK5774', image: 'mk5774.jpg', specs: ['Cronógrafo', '39 mm', 'Sumergible 10 ATM'], price: 1350000, featured: true },
  { handle: 'fossil-es5463', category: 'Damas', brand: 'Fossil', title: 'Fossil ES5463', sku: 'ES5463', image: 'fossil-es5463.jpg', specs: ['Malla mesh de acero', '28 mm', 'Sumergible 5 ATM'], price: 945000, featured: true },
  { handle: 'tommy-hilfiger-1782687', category: 'Damas', brand: 'Tommy Hilfiger', title: 'Tommy Hilfiger 1782687', sku: '1782687', image: 'tommy-1782687.jpg', specs: ['Malla de goma', '34 mm'], price: 920000, featured: true },
  { handle: 'swarovski-collar-signum', category: 'Accesorios', brand: 'Swarovski', title: 'Swarovski Collar Signum', sku: '5649194', image: 'swarovski-signum.jpg', specs: ['Chapado en rodio', 'Colgante de cisne'], price: 1630000, sale: 990000, featured: true },
  { handle: 'combo-decants-1', category: 'Perfumes', brand: 'Decants', title: 'Combo 1', sku: 'DECANT-COMBO-1', image: 'perfume-9pm.jpg', specs: ['5 decants de 10 ml'], price: 275000, sale: 220000, description: 'Al Haramain Amber Oud y cuatro de Afnan (9PM, 9PM Elixir, 9PM Rebel, 9AM Dive).' },
  { handle: 'combo-decants-2', category: 'Perfumes', brand: 'Decants', title: 'Combo 2', sku: 'DECANT-COMBO-2', image: 'perfume-9pm.jpg', specs: ['5 decants de 10 ml'], price: 275000, sale: 220000, description: 'Bharara King, tres Armaf Club de Nuit y Calvin Klein One.' },
  { handle: 'combo-decants-3-odyssey', category: 'Perfumes', brand: 'Decants', title: 'Combo 3, Odyssey', sku: 'DECANT-COMBO-3', image: 'perfume-9pm.jpg', specs: ['5 decants de 10 ml'], price: 275000, sale: 220000, description: 'Elegí 5 entre siete fragancias de la línea Armaf Odyssey.' },
  { handle: 'combo-decants-4', category: 'Perfumes', brand: 'Decants', title: 'Combo 4', sku: 'DECANT-COMBO-4', image: 'perfume-million.jpg', specs: ['5 decants de 10 ml'], price: 570000, sale: 480000, description: 'Paco Rabanne Invictus, Invictus Victory Elixir y 1 Million Parfum, Carolina Herrera 212 Men y Armani Stronger With You Intensely.' },
  { handle: 'combo-decants-5', category: 'Perfumes', brand: 'Decants', title: 'Combo 5', sku: 'DECANT-COMBO-5', image: 'perfume-million.jpg', specs: ['5 decants de 10 ml'], price: 710000, sale: 590000, description: 'Azzaro The Most Wanted, Valentino Born in Roma Intense, Jean Paul Gaultier Scandal, 1 Million Elixir y Armani Stronger With You Absolutely.' },
]

export default async function seedDemoCatalog({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // ---- Limpieza de los productos de ejemplo del seed inicial ---------------
  const { data: oldProducts } = await query.graph({
    entity: 'product',
    fields: ['id'],
    filters: { handle: args?.includes('reset') ? [...OLD_DEMO_HANDLES, ...PRODUCTS.map((p) => p.handle)] : OLD_DEMO_HANDLES },
  })
  if (oldProducts.length) {
    await deleteProductsWorkflow(container).run({ input: { ids: oldProducts.map((p) => p.id) } })
    logger.info(`Borrados ${oldProducts.length} productos de demo`)
  }
  const { data: oldCategories } = await query.graph({
    entity: 'product_category',
    fields: ['id'],
    filters: { name: OLD_DEMO_CATEGORIES },
  })
  if (oldCategories.length) {
    await deleteProductCategoriesWorkflow(container).run({ input: oldCategories.map((c) => c.id) })
  }

  // ---- Requisitos -----------------------------------------------------------
  const { data: salesChannels } = await query.graph({ entity: 'sales_channel', fields: ['id'] })
  const { data: shippingProfiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const { data: stockLocations } = await query.graph({ entity: 'stock_location', fields: ['id'] })
  const salesChannel = salesChannels[0]
  const shippingProfile = shippingProfiles[0]
  const stockLocation = stockLocations[0]
  if (!salesChannel || !shippingProfile || !stockLocation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, 'Falta el seed inicial (canal de venta, perfil de envío o local).')
  }

  // ---- Categorías, marcas (colecciones) y tag de destacados ----------------
  const categoryIds = await ensureByName(
    query,
    'product_category',
    'name',
    CATEGORIES,
    async (missing) => {
      await createProductCategoriesWorkflow(container).run({
        input: { product_categories: missing.map((name) => ({ name, is_active: true })) },
      })
    }
  )

  const brandIds = await ensureByName(
    query,
    'product_collection',
    'title',
    [...new Set(PRODUCTS.map((p) => p.brand))],
    async (missing) => {
      await createCollectionsWorkflow(container).run({
        input: { collections: missing.map((title) => ({ title })) },
      })
    }
  )

  const tagIds = await ensureByName(query, 'product_tag', 'value', [FEATURED_TAG], async (missing) => {
    await createProductTagsWorkflow(container).run({
      input: { product_tags: missing.map((value) => ({ value })) },
    })
  })

  const typeIds = await ensureByName(query, 'product_type', 'value', PRODUCT_TYPES, async (missing) => {
    await createProductTypesWorkflow(container).run({
      input: { product_types: missing.map((value) => ({ value })) },
    })
  })

  // ---- Cupón de demo (10% sobre los productos) ------------------------------
  const { data: promos } = await query.graph({ entity: 'promotion', fields: ['id'], filters: { code: DEMO_PROMO_CODE } })
  if (!promos.length) {
    await createPromotionsWorkflow(container).run({
      input: {
        promotionsData: [
          {
            code: DEMO_PROMO_CODE,
            type: 'standard',
            status: 'active',
            is_automatic: false,
            application_method: {
              type: 'percentage',
              target_type: 'items',
              allocation: 'across',
              value: 10,
              currency_code: CURRENCY,
            },
          },
        ],
      },
    })
    logger.info(`Creado el cupón ${DEMO_PROMO_CODE}`)
  }

  // ---- Productos ------------------------------------------------------------
  const { data: existing } = await query.graph({ entity: 'product', fields: ['id', 'handle', 'metadata'] })
  const taken = new Set(existing.map((p) => p.handle))
  const toCreate = PRODUCTS.filter((p) => !taken.has(p.handle))

  // Tipo, color y malla de los productos de demo que ya estaban cargados.
  const toSync = existing.flatMap((row) => {
    const demo = PRODUCTS.find((p) => p.handle === row.handle)
    return demo
      ? [{ id: row.id, type_id: typeIds.get(typeOf(demo))!, metadata: { ...(row.metadata ?? {}), ...metadataOf(demo) } }]
      : []
  })
  if (toSync.length) {
    await updateProductsWorkflow(container).run({ input: { products: toSync } })
    logger.info(`Actualizados tipo, color y malla de ${toSync.length} productos`)
  }

  if (!toCreate.length) {
    logger.info('El catálogo de demo ya estaba cargado.')
    return
  }

  const imageUrls = await uploadImages(container, toCreate)

  const { result: created } = await createProductsWorkflow(container).run({
    input: {
      products: toCreate.map((p) => ({
        title: p.title,
        handle: p.handle,
        description: p.description,
        status: ProductStatus.PUBLISHED,
        collection_id: brandIds.get(p.brand),
        category_ids: [categoryIds.get(p.category)!],
        tag_ids: p.featured ? [tagIds.get(FEATURED_TAG)!] : [],
        shipping_profile_id: shippingProfile.id,
        images: p.image ? [{ url: imageUrls.get(p.image)! }] : [],
        thumbnail: p.image ? imageUrls.get(p.image) : undefined,
        type_id: typeIds.get(typeOf(p)),
        metadata: metadataOf(p),
        options: [{ title: 'Modelo', values: ['Único'] }],
        variants: [
          {
            title: 'Único',
            sku: p.sku,
            manage_inventory: true,
            options: { Modelo: 'Único' },
            prices: [{ currency_code: CURRENCY, amount: p.price }],
          },
        ],
        sales_channels: [{ id: salesChannel.id }],
      })),
    },
  })
  logger.info(`Creados ${created.length} productos`)

  // ---- Stock ----------------------------------------------------------------
  const { data: variants } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'sku', 'inventory_items.inventory_item_id'],
    filters: { product_id: created.map((p) => p.id) },
  })
  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: variants.flatMap((v) =>
        (v.inventory_items ?? []).map((ii) => ({
          inventory_item_id: ii!.inventory_item_id,
          location_id: stockLocation.id,
          stocked_quantity: DEMO_STOCK,
        }))
      ),
    },
  })

  // ---- Ofertas --------------------------------------------------------------
  const salePrices = variants.flatMap((v) => {
    const demo = PRODUCTS.find((p) => p.sku === v.sku)
    return demo?.sale ? [{ variant_id: v.id, currency_code: CURRENCY, amount: demo.sale }] : []
  })
  if (salePrices.length) {
    const { data: lists } = await query.graph({
      entity: 'price_list',
      fields: ['id'],
      filters: { title: SALE_LIST_TITLE },
    })
    if (lists[0]) {
      await createPriceListPricesWorkflow(container).run({
        input: { data: [{ id: lists[0].id, prices: salePrices }] },
      })
    } else {
      await createPriceListsWorkflow(container).run({
        input: {
          price_lists_data: [
            {
              title: SALE_LIST_TITLE,
              description: 'Precios de oferta. La tienda muestra el precio normal tachado.',
              status: 'active',
              prices: salePrices,
            },
          ],
        },
      })
    }
    logger.info(`Cargadas ${salePrices.length} ofertas`)
  }
}


// Devuelve nombre → id, creando antes los que falten.
async function ensureByName(
  query: any,
  entity: string,
  field: string,
  names: string[],
  create: (missing: string[]) => Promise<void>
): Promise<Map<string, string>> {
  const read = async () => {
    const { data } = await query.graph({ entity, fields: ['id', field] })
    return new Map<string, string>(data.map((row: any) => [row[field], row.id]))
  }
  let byName = await read()
  const missing = names.filter((n) => !byName.has(n))
  if (missing.length) {
    await create(missing)
    byName = await read()
  }
  return byName
}

async function uploadImages(container: ExecArgs['container'], products: DemoProduct[]) {
  const files = [...new Set(products.map((p) => p.image).filter((f): f is string => Boolean(f)))]
  const { result } = await uploadFilesWorkflow(container).run({
    input: {
      files: files.map((filename) => ({
        filename,
        mimeType: 'image/jpeg',
        content: fs.readFileSync(path.join(IMAGES_DIR, filename)).toString('base64'),
        access: 'public' as const,
      })),
    },
  })
  return new Map(files.map((filename, i) => [filename, result[i].url]))
}
