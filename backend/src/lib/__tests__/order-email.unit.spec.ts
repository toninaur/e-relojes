import type { WebSalePayload } from '../aronium-web-sales'
import { buildOrderEmail, formatMoney, orderEmailConfigFromEnv, sendOrderEmail } from '../order-email'

const payload: WebSalePayload = {
  order_id: 'order_1',
  display_id: 1042,
  tracking_code: 'PW-1042-R2',
  created_at: '2026-11-26T21:00:00.000Z',
  currency: 'PYG',
  total: 1080000,
  payment_method: 'Transferencia',
  delivery: 'Envío a domicilio',
  customer: {
    name: 'Ana <Pérez>',
    phone: '0981 123456',
    email: 'ana@example.com',
    ruc: null,
    business_name: null,
    address: { line1: 'Mcal. López 123', line2: null, city: 'Asunción', postal_code: null, country_code: 'PY' },
  },
  address: 'Mcal. López 123, Asunción',
  notes: null,
  gift: true,
  lines: [{ line_item_id: 'li_1', sku: 'EFV-C120D-1ADF', title: 'Casio Edifice', quantity: 1, unit_price: 1050000, total: 1050000 }],
  shipping: { name: 'Envío a domicilio', total: 30000 },
}

describe('aviso de pedido por mail', () => {
  it('guaraníes con punto de miles', () => {
    expect(formatMoney(1080000, 'pyg')).toBe('Gs. 1.080.000')
  })

  it('sin clave o sin destinatario no hay configuración', () => {
    expect(orderEmailConfigFromEnv({ RESEND_API_KEY: 're_x' })).toBeNull()
    expect(orderEmailConfigFromEnv({ ORDER_EMAIL_TO: 'a@gmail.com' })).toBeNull()
    expect(
      orderEmailConfigFromEnv({ RESEND_API_KEY: 're_x', ORDER_EMAIL_TO: 'a@gmail.com, b@gmail.com', MEDUSA_BACKEND_URL: 'https://admin.test/' })
    ).toEqual({ apiKey: 're_x', to: ['a@gmail.com', 'b@gmail.com'], from: 'E-Relojes <onboarding@resend.dev>', adminUrl: 'https://admin.test/app/orders' })
  })

  it('el mail tiene cliente, productos, total y link al panel, con el HTML escapado', () => {
    const mail = buildOrderEmail(payload, 'https://admin.test/app/orders')
    expect(mail.subject).toBe('Nuevo pedido web #1042 — Ana <Pérez> — Gs. 1.080.000')
    expect(mail.text).toContain('Teléfono: 0981 123456')
    expect(mail.text).toContain('1 × Casio Edifice [EFV-C120D-1ADF] — Gs. 1.050.000')
    expect(mail.text).toContain('Envío (Envío a domicilio) — Gs. 30.000')
    expect(mail.text).toContain('Para regalo: Sí')
    expect(mail.text).toContain('https://admin.test/app/orders/order_1')
    expect(mail.html).toContain('Ana &lt;Pérez&gt;')
    expect(mail.html).not.toContain('<Pérez>')
    expect(mail.text).not.toContain('RUC')
  })

  it('sin configurar no manda nada', async () => {
    const container = { resolve: () => { throw new Error('no debería buscar el pedido') } } as any
    expect(await sendOrderEmail(container, 'order_1', { config: null })).toMatch(/sin configurar/)
  })
})
