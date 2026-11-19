import { needsPublishedMark, visibilityChange } from '../aronium-sync'

// Visibilidad automática según foto y stock (la categoría se mira aparte, en
// la base).
const product = (over: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) => ({
  id: 'prod_1',
  title: 'Casio MTP-1302',
  status: 'draft',
  thumbnail: 'https://tienda/foto.jpg',
  metadata: { aronium_code: 'MTP-1302', ...metadata },
  type: { value: 'Reloj' },
  ...over,
})

describe('visibilityChange: borradores nuevos', () => {
  it('del conector con foto y stock: se publica', () => {
    expect(visibilityChange(product(), 2)).toBe('publish')
  })

  it('sin stock o sin foto: sigue oculto', () => {
    expect(visibilityChange(product(), 0)).toBe(null)
    expect(visibilityChange(product({ thumbnail: null }), 3)).toBe(null)
  })

  it('no es del conector: no', () => {
    expect(visibilityChange(product({ metadata: {} }), 3)).toBe(null)
  })

  it('mallas: no se publican solas (el local no las vende online)', () => {
    expect(visibilityChange(product({ type: { value: 'Malla de reloj' } }), 3)).toBe(null)
  })

  it('ya estuvo publicado y alguien lo ocultó a mano: sigue oculto', () => {
    expect(visibilityChange(product({}, { aronium_autopublish: false }), 3)).toBe(null)
    expect(visibilityChange(product({}, { aronium_autopublish: 'false' }), 3)).toBe(null)
  })
})

describe('visibilityChange: sin stock', () => {
  it('publicado que se queda sin stock: se oculta', () => {
    expect(visibilityChange(product({ status: 'published' }), 0)).toBe('hide')
    expect(visibilityChange(product({ status: 'published' }), 1)).toBe(null)
  })

  it('con varias variantes no se oculta por una', () => {
    expect(visibilityChange(product({ status: 'published', variants: [{ id: 'a' }, { id: 'b' }] }), 0)).toBe(null)
  })

  it('oculto por falta de stock: vuelve solo, aunque no sea del conector', () => {
    const hidden = { aronium_no_stock: true, aronium_autopublish: false }
    expect(visibilityChange(product({}, hidden), 1)).toBe('publish')
    expect(visibilityChange(product({ metadata: { aronium_no_stock: true } }), 1)).toBe('publish')
    expect(visibilityChange(product({}, hidden), 0)).toBe(null)
  })
})

describe('needsPublishedMark', () => {
  it('publicado sin marca: se marca una vez', () => {
    expect(needsPublishedMark(product({ status: 'published' }))).toBe(true)
    expect(needsPublishedMark(product({ status: 'published' }, { aronium_autopublish: false }))).toBe(false)
    expect(needsPublishedMark(product())).toBe(false)
  })
})
