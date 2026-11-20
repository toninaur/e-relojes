import { batches, buildItem, type ContimarketRules, itemHash, listedStock, MAX_IMAGES, planPush, specialPrice, type StoreProductSnapshot } from '../contimarket'
import { createContimarketClient, credentialsFromEnv, parseRejected } from '../contimarket-client'

const rules: ContimarketRules = { products: 'all', price_rule: 'same', price_percent: 0, min_stock: 1, dimensions: null }

const product = (extra: Partial<StoreProductSnapshot> = {}): StoreProductSnapshot => ({
  code: 'MTP-V001SG-9BUDF',
  product_id: 'prod_1',
  title: 'Casio MTP-V001SG-9BUDF Dorado',
  description: null,
  published: true,
  brand: 'Casio',
  type: 'Reloj',
  tags: [],
  color: 'Dorado | Negro',
  strap: 'Acero',
  specs: '40 mm | Sumergible 3 BAR',
  images: ['https://tienda/static/a.jpg', 'https://tienda/static/b.jpg', 'https://tienda/static/c.jpg', 'https://tienda/static/d.jpg'],
  price: 395000,
  offer_price: null,
  available: 4,
  ...extra,
})

describe('ContiMarket: cómo se arma cada producto', () => {
  it('lleva todos los campos que exige ContiMarket, sin descripciones vacías', () => {
    const item = buildItem(product(), rules)
    expect(item).toMatchObject({ CodigoProducto: 'MTP-V001SG-9BUDF', Nombre: 'Casio MTP-V001SG-9BUDF Dorado', PrecioCatalogo: 395000, PrecioContinental: 395000, Stock: 4, Peso: 0.3, Longitud: 12, Anchura: 10, Altura: 8 })
    expect(item.DescripcionBreve).toBe('Reloj Casio MTP-V001SG-9BUDF Dorado.')
    expect(item.DescripcionCompleta).toContain('Color: Dorado, Negro.')
    expect(item.DescripcionCompleta).toContain('Referencia MTP-V001SG-9BUDF.')
    expect(item.Caracteristicas).toEqual(
      expect.arrayContaining([
        { Title: 'Marca', Value: 'Casio' },
        { Title: 'Malla', Value: 'Acero' },
        { Title: 'Característica', Value: '40 mm' },
      ])
    )
  })

  it('con descripción en la tienda: la breve es la primera oración', () => {
    const item = buildItem(product({ description: 'Reloj clásico de acero. Cristal mineral y calendario.' }), rules)
    expect(item.DescripcionBreve).toBe('Reloj clásico de acero.')
    expect(item.DescripcionCompleta).toBe('Reloj clásico de acero. Cristal mineral y calendario.')
  })

  it(`hasta ${MAX_IMAGES} fotos, solo URLs públicas`, () => {
    const item = buildItem(product({ images: ['/static/rel.jpg', 'https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg', 'https://a/4.jpg'] }), rules)
    expect(item.Imagen).toEqual([{ url: 'https://a/1.jpg' }, { url: 'https://a/2.jpg' }, { url: 'https://a/3.jpg' }])
  })

  it('peso y medidas por tipo, con lo del panel por encima', () => {
    expect(buildItem(product({ type: 'Perfume' }), rules).Peso).toBe(0.5)
    expect(buildItem(product({ type: 'Algo raro' }), rules).Peso).toBe(0.5)
    const custom = buildItem(product(), { ...rules, dimensions: { Reloj: { kg: 0.25 } } })
    expect([custom.Peso, custom.Longitud]).toEqual([0.25, 12])
  })
})

describe('ContiMarket: stock y precio', () => {
  it('oculto en la tienda, o sin la etiqueta cuando van solo los marcados: stock 0', () => {
    expect(listedStock(product({ published: false }), rules)).toBe(0)
    expect(listedStock(product(), { ...rules, products: 'tagged' })).toBe(0)
    expect(listedStock(product({ tags: ['ContiMarket'] }), { ...rules, products: 'tagged' })).toBe(4)
  })

  it('última unidad: con min_stock 2, una sola unidad se publica como 0', () => {
    expect(listedStock(product({ available: 1 }), { ...rules, min_stock: 2 })).toBe(0)
    expect(listedStock(product({ available: 2 }), { ...rules, min_stock: 2 })).toBe(2)
    expect(listedStock(product({ available: -3 }), rules)).toBe(0)
  })

  it('precio especial: el mismo, el de oferta vigente o un porcentaje menos', () => {
    expect(specialPrice(product({ offer_price: 350000 }), rules)).toBe(395000)
    expect(specialPrice(product({ offer_price: 350000 }), { ...rules, price_rule: 'offer' })).toBe(350000)
    expect(specialPrice(product({ offer_price: null }), { ...rules, price_rule: 'offer' })).toBe(395000)
    expect(specialPrice(product(), { ...rules, price_rule: 'percent', price_percent: 10 })).toBe(355500)
  })
})

describe('ContiMarket: qué se manda', () => {
  const a = buildItem(product({ code: 'A' }), rules)
  const b = buildItem(product({ code: 'B' }), rules)
  const hidden = buildItem(product({ code: 'C', published: false }), rules)

  it('solo lo que cambió; lo nuevo sin stock no se crea; lo que ya estaba y se ocultó va con 0', () => {
    const previous = new Map([
      ['A', itemHash(a)],
      ['B', 'otra-huella'],
    ])
    expect(planPush([a, b, hidden], previous).map((i) => i.CodigoProducto)).toEqual(['B'])
    expect(planPush([a, b, hidden], previous, true).map((i) => i.CodigoProducto)).toEqual(['A', 'B'])
    const wasThere = new Map([['C', 'huella-vieja']])
    expect(planPush([hidden], wasThere)).toEqual([hidden])
    expect(hidden.Stock).toBe(0)
  })

  it('un producto que ContiMarket rechazó (huella null) se vuelve a mandar', () => {
    expect(planPush([a], new Map([['A', null]]))).toEqual([a])
  })

  it('tandas por cantidad y por tamaño (límite de 10 MB)', () => {
    const items = Array.from({ length: 450 }, (_, i) => buildItem(product({ code: `X${i}` }), rules))
    expect(batches(items).map((x) => x.length)).toEqual([200, 200, 50])
    const size = Buffer.byteLength(JSON.stringify(items[0]))
    expect(batches(items, 1000, size * 3 + 10).every((x) => x.length <= 3)).toBe(true)
  })
})

describe('ContiMarket: cliente HTTP', () => {
  const credentials = { url: 'https://cm.test', user: 'tienda@ejemplo.com', password: 'secreta' }
  const fakeFetch = (status: number, body: string) => {
    const calls: { url: string; init: RequestInit }[] = []
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(body, { status })
    }) as unknown as typeof fetch
    return { fn, calls }
  }

  it('manda Basic con email:contraseña a /ImportProduct y entiende "Ok"', async () => {
    const f = fakeFetch(200, '"Ok"')
    const res = await createContimarketClient(credentials, f.fn).importProducts([])
    expect(res).toEqual({ ok: true })
    expect(f.calls[0].url).toBe('https://cm.test/ImportProduct')
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('tienda@ejemplo.com:secreta').toString('base64')}`)
  })

  it('400: los rechazos por producto', async () => {
    const f = fakeFetch(400, JSON.stringify([{ codigoproducto: 'A', mensaje: 'Producto con Stock Invalido ' }]))
    const res = await createContimarketClient(credentials, f.fn).importProducts([])
    expect(res).toMatchObject({ ok: false, rejected: [{ code: 'A', message: 'Producto con Stock Invalido' }] })
  })

  it('401: usuario o contraseña rechazados', async () => {
    const f = fakeFetch(401, '')
    await expect(createContimarketClient(credentials, f.fn).importProducts([])).rejects.toThrow(/rechazó el usuario o la contraseña/)
  })

  it('respuesta de error que no se entiende: sin rechazos con nombre', () => {
    expect(parseRejected('<html>error</html>')).toEqual([])
  })

  it('sin las tres variables de entorno no hay credenciales', () => {
    expect(credentialsFromEnv({ CONTIMARKET_URL: 'https://x', CONTIMARKET_USER: 'a' })).toBeNull()
    expect(credentialsFromEnv({ CONTIMARKET_URL: 'https://x/', CONTIMARKET_USER: 'a', CONTIMARKET_PASSWORD: 'b' })).toEqual({ url: 'https://x', user: 'a', password: 'b' })
  })
})
