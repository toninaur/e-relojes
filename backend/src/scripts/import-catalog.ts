/**
 * Fotos, características, color, malla y categoría de los catálogos PDF del
 * local, para los productos que llegaron de Aronium.
 *
 *   CATALOG_DIR=C:/ruta/catalogo-extraido npx medusa exec ./src/scripts/import-catalog.ts [publicar]
 *   CATALOG_URL=https://…/catalogo-datos.json npx medusa exec … [publicar]
 *
 * CATALOG_DIR es la salida de tools/catalog-pdf (catalog.json + img/). En el
 * servidor, donde no están esos archivos, CATALOG_URL es la dirección que
 * imprime tools/catalog-pdf/upload.mjs: las fotos ya están subidas a la tienda
 * y el json trae su dirección. Cada página del catálogo trae el código de
 * Aronium (= SKU en la tienda).
 *
 * Por producto, sin pisar nada cargado a mano:
 * - Foto: la del catálogo, si el producto no tiene.
 * - Características (metadata `specs`) y descripción: si están vacías.
 * - Color y malla: si están vacíos, deducidos del catálogo.
 * - Categoría, tipo y marca: solo en borradores. La categoría sale del
 *   catálogo donde aparece (un reloj del catálogo de Damas va a Damas; si
 *   aparece en Damas y en Caballeros, a las dos).
 *
 * Además completa categoría, tipo y marca de los demás borradores de Aronium
 * que no los tengan, con las reglas actuales (lib/aronium-classify.ts).
 *
 * Con `publicar`, publica los borradores que quedan con foto, categoría y stock.
 * Con `reemplazar-fotos`, vuelve a poner las fotos que había subido este
 * script (archivos "catalogo-…"), por ejemplo después de mejorar la extracción.
 * Las fotos cargadas a mano no se tocan.
 *
 * Lo que escribe queda como "editado en la tienda": el sincronizador de
 * Aronium no lo pisa (lib/aronium-content.ts, canWrite). Se puede correr de
 * nuevo: lo que ya está cargado se saltea.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules, ProductStatus } from '@medusajs/framework/utils'
import { updateProductsWorkflow, uploadFilesWorkflow } from '@medusajs/medusa/core-flows'
import { CATEGORY_BY_TYPE, classify } from '../lib/aronium-classify'
import { parseAroniumContent } from '../lib/aronium-content'

type CatalogPage = {
  file: string
  page: number
  code: string | null
  title: string[]
  specs: string[]
  price: number | null
  offer: number | null
  /** url y bytes: catálogo subido con upload.mjs (CATALOG_URL). */
  image: { file: string; url?: string; bytes?: number } | null
}

type ProductRow = {
  id: string
  title: string
  status: string
  description: string | null
  thumbnail: string | null
  metadata: Record<string, unknown> | null
  collection_id: string | null
  type_id: string | null
  images?: { url: string }[]
  variants?: { sku: string | null; inventory_items?: { inventory?: { location_levels?: { stocked_quantity?: unknown }[] } }[] }[]
}

// Catálogo → categoría de los relojes que aparecen en él. Lo que no es reloj
// va a la categoría de su tipo.
const WATCH_CATALOGS: [RegExp, string][] = [
  [/^casio/i, 'Casio'],
  [/^damas/i, 'Damas'],
  [/^relojes caballeros/i, 'Caballeros'],
]

const BATCH = 50
const MAX_SPECS = 10
const MIN_PHOTO_BYTES = 5_000

export default async function importCatalog({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const publish = args?.includes('publicar') ?? false
  const replacePhotos = args?.includes('reemplazar-fotos') ?? false
  const ours = (url: string | null | undefined) => Boolean(url && /[/-]catalogo-[^/]*$/.test(url))

  const dir = process.env.CATALOG_DIR ?? ''
  const remoteUrl = process.env.CATALOG_URL
  let pages: CatalogPage[]
  if (remoteUrl) {
    const res = await fetch(remoteUrl)
    if (!res.ok) throw new Error(`No se pudo leer CATALOG_URL (${res.status}).`)
    pages = (await res.json()) as CatalogPage[]
  } else if (dir && fs.existsSync(path.join(dir, 'catalog.json'))) {
    pages = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'))
  } else {
    throw new Error('Falta CATALOG_DIR (carpeta de tools/catalog-pdf) o CATALOG_URL (de upload.mjs).')
  }
  const byCode = new Map<string, CatalogPage[]>()
  for (const p of pages) if (p.code) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p])

  const { data: categories } = await query.graph({ entity: 'product_category', fields: ['id', 'name', 'products.id'] })
  const { data: collections } = await query.graph({ entity: 'product_collection', fields: ['id', 'title'] })
  const { data: types } = await query.graph({ entity: 'product_type', fields: ['id', 'value'] })
  const categoryId = new Map(categories.map((c) => [c.name, c.id]))
  const brandId = new Map(collections.map((c) => [c.title, c.id]))
  const typeId = new Map(types.map((t) => [t.value, t.id]))
  // Categorías de cada producto, leídas desde las categorías (rápido).
  const categoriesOf = new Map<string, string[]>()
  for (const c of categories) for (const p of c.products ?? []) if (p) categoriesOf.set(p.id, [...(categoriesOf.get(p.id) ?? []), c.id])

  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'status',
      'description',
      'thumbnail',
      'metadata',
      'collection_id',
      'type_id',
      'images.url',
      'variants.sku',
      'variants.inventory_items.inventory.location_levels.stocked_quantity',
    ],
  })
  const products = (data as unknown as ProductRow[]).filter((p) => p.metadata?.aronium_code)
  const stockOf = (p: ProductRow) =>
    (p.variants ?? []).reduce(
      (sum, v) =>
        sum +
        (v.inventory_items ?? []).reduce(
          (s, ii) => s + (ii.inventory?.location_levels ?? []).reduce((t, l) => t + (Number(l.stocked_quantity) || 0), 0),
          0
        ),
      0
    )

  const updates = new Map<string, Record<string, unknown>>()
  const photos: { product: ProductRow; page: CatalogPage }[] = []
  // Peso de la foto: una de menos de MIN_PHOTO_BYTES salió vacía del PDF.
  const photoSize = (p: CatalogPage) => {
    if (!p.image) return 0
    if (p.image.bytes !== undefined) return p.image.bytes
    const file = path.join(dir, 'img', p.image.file)
    return dir && fs.existsSync(file) ? fs.statSync(file).size : 0
  }
  const stats = { catalog: 0, photos: 0, specs: 0, color: 0, malla: 0, description: 0, category: 0, type: 0, brand: 0, published: 0 }
  const set = (p: ProductRow, values: Record<string, unknown>) => updates.set(p.id, { ...(updates.get(p.id) ?? { id: p.id }), ...values })

  for (const product of products) {
    const code = String(product.metadata!.aronium_code)
    const found = byCode.get(code) ?? []
    const draft = product.status === ProductStatus.DRAFT
    const group = (product.metadata?.aronium_group as string | undefined) ?? null
    const metadata: Record<string, unknown> = { ...(product.metadata ?? {}) }
    let metadataChanged = false

    // Clasificación con las reglas actuales; el catálogo la completa.
    // Si aparece en varios catálogos, la página con la foto más pesada (una
    // foto casi vacía pesa muy poco).
    const page = [...found].sort((a, b) => photoSize(b) - photoSize(a))[0]
    const catalogTitle = page ? page.title.join(' ') : ''
    const auto = classify({ name: product.title, group }, [...categoryId.keys()], [...brandId.keys()])
    const fromCatalog = page ? classify({ name: catalogTitle, group }, [...categoryId.keys()], [...brandId.keys()]) : null
    const watchCatalogs = found.flatMap((f) => WATCH_CATALOGS.filter(([re]) => re.test(f.file)).map(([, c]) => c))
    const type = auto.type ?? fromCatalog?.type ?? (watchCatalogs.length ? 'Reloj' : null)
    const brand = auto.brand ?? fromCatalog?.brand ?? null

    if (page) {
      stats.catalog++
      // Texto del catálogo: renglones cortos = características, largos = descripción.
      const lines = [...new Set(found.flatMap((f) => f.specs))]
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l && !/precio|oferta|^obs\b/i.test(l))
      const specs = lines.filter((l) => l.length <= 80).slice(0, MAX_SPECS)
      const prose = lines.filter((l) => l.length > 80)

      // Una foto de menos de MIN_PHOTO_BYTES salió vacía del PDF (fotos con
      // transparencia): no se usa, y si este script la había puesto, se saca.
      const usable = page.image && photoSize(page) >= MIN_PHOTO_BYTES
      if (usable && (!product.thumbnail || (replacePhotos && ours(product.thumbnail)))) photos.push({ product, page })
      if (!usable && ours(product.thumbnail)) {
        const others = (product.images ?? []).map((img) => img.url).filter((u) => !ours(u))
        set(product, { thumbnail: others[0] ?? null, images: others.map((u) => ({ url: u })), ...(others.length ? {} : { status: ProductStatus.DRAFT }) })
      }
      if (!String(metadata.specs ?? '').trim() && specs.length) {
        metadata.specs = specs.join(' | ')
        metadataChanged = true
        stats.specs++
      }
      if (!(product.description ?? '').trim() && prose.length) {
        set(product, { description: prose.join('\n\n') })
        stats.description++
      }
      const content = parseAroniumContent(`${product.title} ${catalogTitle}`, lines.join('\n'))
      const noColor = type === 'Perfume' || type === 'Decant'
      if (!String(metadata.color ?? '').trim() && content.colors.length && !noColor) {
        metadata.color = content.colors.join(' | ')
        metadataChanged = true
        stats.color++
      }
      if (!String(metadata.malla ?? '').trim() && content.strap && type === 'Reloj') {
        metadata.malla = content.strap
        metadataChanged = true
        stats.malla++
      }
      metadata.catalog_source = found.map((f) => `${f.file} p${f.page}`).join(', ')
      metadataChanged = true
    }
    if (metadataChanged) set(product, { metadata })

    // Categoría, tipo y marca: solo borradores (lo publicado ya lo revisó alguien).
    if (draft) {
      const wanted = new Set<string>()
      if (type === 'Reloj' && watchCatalogs.length) {
        for (const c of watchCatalogs) wanted.add(c)
        if (brand === 'Casio') wanted.add('Casio')
      } else if (type && CATEGORY_BY_TYPE[type]) {
        wanted.add(CATEGORY_BY_TYPE[type])
      } else if (auto.category) {
        wanted.add(auto.category)
      }
      const current = categoriesOf.get(product.id) ?? []
      const ids = [...wanted].map((c) => categoryId.get(c)).filter((id): id is string => Boolean(id))
      if (ids.length && (page || !current.length) && ids.sort().join() !== [...current].sort().join()) {
        set(product, { category_ids: ids })
        stats.category++
      }
      if (!product.type_id && type && typeId.get(type)) {
        set(product, { type_id: typeId.get(type) })
        stats.type++
      }
      if (!product.collection_id && brand && brandId.get(brand)) {
        set(product, { collection_id: brandId.get(brand) })
        stats.brand++
      }
    }
  }

  // Fotos: ya subidas (CATALOG_URL) o se suben ahora, de a BATCH.
  const imagesDir = path.join(dir, 'img')
  for (let i = 0; i < photos.length; i += BATCH) {
    const batch = photos.slice(i, i + BATCH).filter(({ page }) => page.image?.url || fs.existsSync(path.join(imagesDir, page.image!.file)))
    const toUpload = batch.filter(({ page }) => !page.image?.url)
    const { result: uploaded } = toUpload.length
      ? await uploadFilesWorkflow(container).run({
          input: {
            files: toUpload.map(({ product, page }) => ({
              filename: `catalogo-${String(product.metadata!.aronium_code).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`,
              mimeType: 'image/jpeg',
              content: fs.readFileSync(path.join(imagesDir, page.image!.file)).toString('base64'),
              access: 'public' as const,
            })),
          },
        })
      : { result: [] as { url: string }[] }
    const urlOf = new Map(toUpload.map(({ product }, index) => [product.id, uploaded[index]?.url]))
    batch.forEach(({ product, page }) => {
      const url = page.image?.url ?? urlOf.get(product.id)
      if (!url) return
      // La foto nueva primero; las demás de la galería quedan (menos las viejas del catálogo).
      const others = (product.images ?? []).map((img) => img.url).filter((u) => !ours(u))
      set(product, { thumbnail: url, images: [{ url }, ...others.map((u) => ({ url: u }))] })
      stats.photos++
    })
    logger.info(`Fotos: ${Math.min(i + BATCH, photos.length)} de ${photos.length}`)
  }

  // Publicar: borradores con foto, categoría y stock, menos las mallas (el
  // local no las vende online) y lo que alguien ocultó a mano.
  if (publish) {
    const mallaTypeId = typeId.get('Malla de reloj')
    for (const product of products) {
      if (product.status !== ProductStatus.DRAFT || stockOf(product) <= 0) continue
      const pending = updates.get(product.id) ?? {}
      if (mallaTypeId && (pending.type_id ?? product.type_id) === mallaTypeId) continue
      const flag = product.metadata?.aronium_autopublish
      if ((flag === false || flag === 'false') && !product.metadata?.aronium_no_stock) continue
      const hasPhoto = Boolean(product.thumbnail || pending.thumbnail)
      const hasCategory = Boolean((pending.category_ids as string[] | undefined)?.length || categoriesOf.get(product.id)?.length)
      if (hasPhoto && hasCategory) {
        set(product, { status: ProductStatus.PUBLISHED })
        stats.published++
      }
    }
  }

  const all = [...updates.values()]
  for (let i = 0; i < all.length; i += BATCH) {
    await updateProductsWorkflow(container).run({ input: { products: all.slice(i, i + BATCH) as any } })
  }
  // Este proceso termina antes de procesar todos sus eventos, así que el
  // buscador de la tienda quedaría a medias: se reconstruye entero acá, y se
  // espera a que termine.
  if (all.length) {
    const search = container.resolve(Modules.SEARCH) as { reindex: (input: { index: string; strategy: 'swap' }) => Promise<unknown> }
    await search.reindex({ index: 'product', strategy: 'swap' })
  }
  logger.info(
    `Catálogo: ${stats.catalog} productos encontrados en los PDF. Fotos ${stats.photos}, características ${stats.specs}, ` +
      `descripción ${stats.description}, color ${stats.color}, malla ${stats.malla}, categoría ${stats.category}, ` +
      `tipo ${stats.type}, marca ${stats.brand}${publish ? `, publicados ${stats.published}` : ''}.`
  )
}
