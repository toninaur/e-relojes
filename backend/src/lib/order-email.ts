import { MedusaContainer } from '@medusajs/framework'
import { buildPayload, loadOrder, type WebSalePayload } from './aronium-web-sales'

// Aviso por mail de cada pedido web al local (subscribers/order-email.ts).
// Va por la API HTTP de Resend (https://resend.com), sin dependencias.
//
// Variables de Railway (servicio backend):
//   RESEND_API_KEY    clave de Resend (re_…). Sin ella no se manda nada.
//   ORDER_EMAIL_TO    a quién avisar; varios separados por coma.
//   ORDER_EMAIL_FROM  remitente (opcional). Sin dominio propio verificado en
//                     Resend, solo sirve el de prueba (onboarding@resend.dev),
//                     y Resend solo deja mandar al email de la cuenta de Resend.

const DEFAULT_FROM = 'E-Relojes <onboarding@resend.dev>'

export interface OrderEmailConfig {
  apiKey: string
  to: string[]
  from: string
  adminUrl: string | null
}

export function orderEmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OrderEmailConfig | null {
  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const to = (env.ORDER_EMAIL_TO ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!apiKey || !to.length) return null
  const backend = (env.MEDUSA_BACKEND_URL ?? '').trim().replace(/\/+$/, '')
  return { apiKey, to, from: (env.ORDER_EMAIL_FROM ?? '').trim() || DEFAULT_FROM, adminUrl: backend ? `${backend}/app/orders` : null }
}

export function formatMoney(amount: number, currency: string): string {
  const n = Math.round(Number(amount) || 0).toLocaleString('es-PY').replace(/,/g, '.')
  return currency.toUpperCase() === 'PYG' ? `Gs. ${n}` : `${n} ${currency.toUpperCase()}`
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Asunto, HTML y texto del aviso. */
export function buildOrderEmail(p: WebSalePayload, adminUrl: string | null = null) {
  const money = (n: number) => formatMoney(n, p.currency)
  const c = p.customer
  const subject = `Nuevo pedido web #${p.display_id} — ${c.name} — ${money(p.total)}`

  const facts: [string, string | null][] = [
    ['Pedido', `#${p.display_id} (${p.tracking_code})`],
    ['Fecha', new Date(p.created_at).toLocaleString('es-PY', { timeZone: 'America/Asuncion' })],
    ['Cliente', c.name],
    ['Teléfono', c.phone],
    ['Email', c.email],
    ['RUC', [c.ruc, c.business_name].filter(Boolean).join(' — ') || null],
    ['Entrega', p.delivery],
    ['Dirección', p.address],
    ['Pago', p.payment_method],
    ['Para regalo', p.gift ? 'Sí' : null],
    ['Nota del cliente', p.notes],
  ]
  const shown = facts.filter((f): f is [string, string] => Boolean(f[1]))
  const link = adminUrl ? `${adminUrl}/${p.order_id}` : null

  const text = [
    `Nuevo pedido web #${p.display_id}`,
    '',
    ...shown.map(([k, v]) => `${k}: ${v}`),
    '',
    ...p.lines.map((l) => `${l.quantity} × ${l.title}${l.sku ? ` [${l.sku}]` : ''} — ${money(l.total)}`),
    ...(p.shipping ? [`Envío (${p.shipping.name}) — ${money(p.shipping.total)}`] : []),
    `TOTAL: ${money(p.total)}`,
    ...(link ? ['', `Ver en el panel: ${link}`] : []),
  ].join('\n')

  const td = 'padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top'
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px">
<h2 style="margin:0 0 12px">Nuevo pedido web #${p.display_id}</h2>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px">${shown
    .map(([k, v]) => `<tr><td style="${td};color:#666;width:140px">${escape(k)}</td><td style="${td}">${escape(v)}</td></tr>`)
    .join('')}</table>
<table style="border-collapse:collapse;width:100%">
<tr><th align="left" style="${td}">Producto</th><th style="${td}">Cant.</th><th align="right" style="${td}">Total</th></tr>
${p.lines
  .map(
    (l) =>
      `<tr><td style="${td}">${escape(l.title)}${l.sku ? `<br><span style="color:#888;font-size:12px">${escape(l.sku)}</span>` : ''}</td><td align="center" style="${td}">${l.quantity}</td><td align="right" style="${td}">${money(l.total)}</td></tr>`
  )
  .join('')}
${p.shipping ? `<tr><td style="${td}">Envío (${escape(p.shipping.name)})</td><td style="${td}"></td><td align="right" style="${td}">${money(p.shipping.total)}</td></tr>` : ''}
<tr><td style="${td}"><b>TOTAL</b></td><td style="${td}"></td><td align="right" style="${td}"><b>${money(p.total)}</b></td></tr>
</table>
${link ? `<p style="margin-top:20px"><a href="${escape(link)}">Ver el pedido en el panel</a></p>` : ''}
</body></html>`

  return { subject, html, text }
}

/** Manda el aviso de un pedido. Devuelve por qué no se mandó, o null si salió. */
export async function sendOrderEmail(
  container: MedusaContainer,
  orderId: string,
  options: { config?: OrderEmailConfig | null; fetchImpl?: typeof fetch } = {}
): Promise<string | null> {
  const config = options.config === undefined ? orderEmailConfigFromEnv() : options.config
  if (!config) return 'sin configurar (RESEND_API_KEY y ORDER_EMAIL_TO en Railway)'
  const order = await loadOrder(container, orderId)
  if (!order) return `no se encontró el pedido ${orderId}`
  const payload = buildPayload(order)
  const { subject, html, text } = buildOrderEmail(payload, config.adminUrl)
  const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      subject,
      html,
      text,
      ...(payload.customer.email ? { reply_to: payload.customer.email } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend respondió ${response.status}: ${body.slice(0, 300)}`)
  }
  return null
}
