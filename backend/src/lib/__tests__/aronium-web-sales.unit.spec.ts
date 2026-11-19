import { buildPayload, isValidTrackingCode, supportsQuotes, trackingCode } from '../aronium-web-sales'

describe('código de seguimiento PW-', () => {
  it('tiene el número del pedido y 2 caracteres de control, siempre los mismos', () => {
    expect(trackingCode(1042)).toMatch(/^PW-1042-[A-Z2-9]{2}$/)
    expect(trackingCode(1042)).toBe(trackingCode(1042))
  })

  it('da lo mismo que la tienda (storefront/lib/tracking-code.ts)', () => {
    // Si esto cambia, cambiar también el de la tienda: el cliente ve ese código.
    expect([1, 7, 1042, 99999].map(trackingCode)).toEqual(['PW-1-WC', 'PW-7-VC', 'PW-1042-R2', 'PW-99999-JB'])
  })

  it('no usa caracteres que se confunden (0, O, 1, I, L)', () => {
    for (let n = 1; n < 2000; n++) expect(trackingCode(n).slice(-2)).not.toMatch(/[01OIL]/)
  })

  it('detecta un número mal tipeado', () => {
    expect(isValidTrackingCode(trackingCode(1042))).toBe(true)
    expect(isValidTrackingCode(trackingCode(1042).toLowerCase())).toBe(true)
    const check = trackingCode(1042).slice(-2)
    // Casi ningún otro número comparte el control.
    let collisions = 0
    for (let n = 1; n < 1000; n++) if (n !== 1042 && trackingCode(n).slice(-2) === check) collisions++
    expect(collisions).toBeLessThan(5)
    expect(isValidTrackingCode('PW-1042')).toBe(false)
  })
})

describe('versión del agente', () => {
  it('solo desde 0.7.0 entiende proformas', () => {
    expect(supportsQuotes('0.6.0')).toBe(false)
    expect(supportsQuotes('0.6.9')).toBe(false)
    expect(supportsQuotes('0.7.0')).toBe(true)
    expect(supportsQuotes('0.10.0')).toBe(true)
    expect(supportsQuotes('1.0.0')).toBe(true)
  })
})

describe('payload del pedido', () => {
  it('lleva el código, el cliente con dirección y el precio realmente cobrado', () => {
    const p = buildPayload({
      id: 'order_1',
      display_id: 7,
      created_at: '2026-11-18T12:00:00Z',
      currency_code: 'pyg',
      email: 'ana@example.com',
      total: 230000,
      shipping_total: 30000,
      metadata: { ruc: '80012345-6', razon_social: 'Ana SA', payment_method: 'bank_transfer' },
      shipping_methods: [{ name: 'Envío a domicilio' }],
      shipping_address: {
        first_name: 'Ana',
        last_name: 'Gómez',
        phone: '0981',
        address_1: 'Calle 1',
        address_2: null,
        city: 'Luque',
        postal_code: '2060',
        country_code: 'py',
      },
      items: [{ id: 'li_1', product_title: 'Reloj', variant_sku: 'R1', quantity: 2, unit_price: 110000, total: 200000 }],
    })
    expect(p.tracking_code).toBe(trackingCode(7))
    expect(p.customer).toEqual({
      name: 'Ana Gómez',
      phone: '0981',
      email: 'ana@example.com',
      ruc: '80012345-6',
      business_name: 'Ana SA',
      address: { line1: 'Calle 1', line2: null, city: 'Luque', postal_code: '2060', country_code: 'PY' },
    })
    expect(p.lines[0]).toMatchObject({ sku: 'R1', quantity: 2, unit_price: 100000, total: 200000 })
    expect(p.shipping).toEqual({ name: 'Envío a domicilio', total: 30000 })
  })
})
