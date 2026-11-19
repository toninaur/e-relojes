import { model } from '@medusajs/framework/utils'

// Cola de pedidos web → Aronium (una fila por pedido de la tienda). El agente
// de la PC del local escribe cada pedido en Aronium como PROFORMA; cuando la
// cajera la marca "Pagado" en Aronium, el agente crea la venta. Ver
// docs/sincronizador-aronium.md, punto 4.2.
//
// Estados:
// - pending:        pedido nuevo, falta escribir la proforma.
// - quoted:         proforma en Aronium (`aronium_quote_number`), esperando
//                   que la marquen "Pagado".
// - invoiced:       venta creada en Aronium (`aronium_number`): resta stock.
// - failed:         el agente no pudo escribir la proforma (`last_error`); se
//                   reintenta desde el panel.
// - cancel_pending: se canceló en la tienda con la proforma o la venta ya en
//                   Aronium; falta anularla o escribir la devolución.
// - cancelled:      cancelado (antes de llegar a Aronium, proforma anulada, o
//                   devolución escrita: `aronium_refund_number`).
// - skipped:        "La cargué a mano" en el panel: el local la registró en
//                   Aronium por su cuenta; el agente no la toca.
export const AroniumWebSale = model.define('aronium_web_sale', {
  id: model.id({ prefix: 'arweb' }).primaryKey(),
  order_id: model.text().unique(),
  display_id: model.number(),
  // Código de seguimiento "PW-1042-K7": va en la nota interna y en el número
  // de orden de la proforma y de la venta.
  tracking_code: model.text().nullable(),
  status: model
    .enum(['pending', 'quoted', 'invoiced', 'failed', 'cancel_pending', 'cancelled', 'skipped'])
    .default('pending'),
  // El pedido está pagado en la tienda (se marcó en el panel o lo marcó el
  // agente al crear la venta).
  paid: model.boolean().default(false),
  // Sin uso desde el rediseño de la proforma (18/11/2026); se conserva para no
  // borrar datos.
  payment_registered: model.boolean().default(false),
  // Lo que se escribe en Aronium: renglones (SKU, cantidad, precio cobrado),
  // envío, cliente, forma de pago y notas. Se guarda al crear el pedido.
  payload: model.json(),
  aronium_quote_number: model.text().nullable(),
  aronium_number: model.text().nullable(),
  aronium_refund_number: model.text().nullable(),
  attempts: model.number().default(0),
  last_error: model.text().nullable(),
  // Aviso que no impidió avanzar (proforma cambiada por la cajera, posible
  // venta duplicada, stock negativo en Aronium...).
  warning: model.text().nullable(),
  // Fecha en que la proforma entró en Aronium.
  registered_at: model.dateTime().nullable(),
  invoiced_at: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),
})
