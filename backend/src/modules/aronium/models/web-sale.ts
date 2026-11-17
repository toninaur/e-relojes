import { model } from '@medusajs/framework/utils'

// Cola de ventas web → Aronium (una fila por pedido de la tienda). El agente
// de la PC del local las toma y las escribe en Aronium como si se hubieran
// cobrado en la caja. Ver docs/sincronizador-aronium.md.
//
// Estados:
// - pending:        pedido nuevo, falta escribirlo en Aronium.
// - registered:     ya está en Aronium (`aronium_number`).
// - failed:         el agente no pudo escribirlo (`last_error`); se reintenta
//                   desde el panel.
// - cancel_pending: se canceló en la tienda después de estar en Aronium; falta
//                   escribir la devolución.
// - cancelled:      cancelado (antes de llegar a Aronium, o con la devolución
//                   ya escrita: `aronium_refund_number`).
export const AroniumWebSale = model.define('aronium_web_sale', {
  id: model.id({ prefix: 'arweb' }).primaryKey(),
  order_id: model.text().unique(),
  display_id: model.number(),
  status: model.enum(['pending', 'registered', 'failed', 'cancel_pending', 'cancelled']).default('pending'),
  // El pedido está pagado en la tienda (transferencia confirmada o cobrado).
  paid: model.boolean().default(false),
  // El pago ya figura en Aronium.
  payment_registered: model.boolean().default(false),
  // Lo que se escribe en Aronium: renglones (SKU, cantidad, precio cobrado),
  // envío, cliente, forma de pago y notas. Se guarda al crear el pedido.
  payload: model.json(),
  aronium_number: model.text().nullable(),
  aronium_refund_number: model.text().nullable(),
  attempts: model.number().default(0),
  last_error: model.text().nullable(),
  // Aviso que no impidió registrar (por ejemplo, Aronium quedó con stock
  // negativo porque se vendió en la caja al mismo tiempo).
  warning: model.text().nullable(),
  registered_at: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),
})
