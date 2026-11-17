# Plan: registrar en Aronium las ventas de la tienda online

Estado: **reemplazado** por [sincronizador-aronium.md](sincronizador-aronium.md) (17/11/2026). Queda como antecedente.

## El problema

Aronium es la fuente del stock: cada 5 a 30 minutos el conector manda el stock
de Aronium y la tienda lo copia. La tienda resta además lo vendido online y
todavía no entregado (reservas de Medusa).

Una venta online tiene que terminar registrada en Aronium (para la caja, la
factura y el stock). Hoy eso se hace a mano y sin ningún vínculo con el pedido
web, y según en qué orden se hagan las cosas el stock queda mal un rato:

| Orden en que lo hace el local | Qué pasa con el stock online (ej.: había 5, vendió 1) |
|---|---|
| 1. Cobra en Aronium, 2. marca "enviado" en el panel | Entre 1 y 2 se ve **3** (se descuenta dos veces: Aronium bajó y la reserva sigue). Se pierde una venta posible. |
| 1. Marca "enviado" en el panel, 2. cobra en Aronium | Entre 1 y 2 se ve **5** (el conector repone lo que Aronium todavía no descontó). **Se puede vender algo que no hay.** |
| Nunca lo cobra en Aronium | El stock online queda inflado para siempre. |

## Lo que se averiguó

- **Aronium no tiene API.** Lo único oficial es importar productos por CSV
  ([guía](https://help.aronium.com/hc/en-us/articles/115000981491-Import-products-using-CSV)).
  Si el CSV trae cantidades, Aronium crea un documento que **suma** stock
  (una entrada, no una venta), así que no sirve para registrar ventas.
- Las ventas se guardan en `pos.db` (SQLite) en las tablas `Document` (tipo
  "Sales", código 200), `DocumentItem`, `Payment` y `Stock`, con numeración en
  `Counter` (`Document.200.2026`).
- **Al cobrar en el punto de venta se puede escribir un "número de pedido"**
  (`Document.OrderNumber`). En la base de prueba hay una venta con
  `OrderNumber = 'juanpi'`. Ese campo es el puente: si el local escribe ahí el
  número del pedido web, el conector puede reconocer la venta.

## Propuesta (en dos etapas)

### Etapa 1: cobrar en Aronium con el número del pedido web (recomendada)

El local sigue cobrando en Aronium como siempre, con un solo paso más:

1. Llega un pedido web (#123). El panel → **Aronium** muestra
   "Pedidos web sin registrar en caja", con los productos y su código.
2. Al prepararlo, lo cobran en Aronium y en **Número de pedido** escriben
   `WEB-123`.
3. El conector, que ya lee `pos.db`, lee también las ventas recientes con
   `OrderNumber` que empiece con `WEB-` y las manda junto con el stock.
4. En la **misma pasada**, el backend:
   - marca el pedido #123 como "registrado en caja" (metadata) y crea el envío
     (fulfillment), lo que libera la reserva;
   - recién después aplica el stock de Aronium.

   Como las dos cosas pasan juntas, ya no hay ventana con el stock mal: la
   pasada que ve el stock bajado en Aronium es la misma que libera la reserva.
5. El panel avisa los pedidos web que llevan más de X horas sin aparecer en
   Aronium, y las ventas `WEB-` de Aronium que no coinciden con ningún pedido
   (número mal tipeado).

Ventajas: no se escribe nunca en la base de Aronium (el conector sigue siendo
de solo lectura), la factura sale de la caja como siempre y, si el conector se
cae, no se rompe nada.

Costo: el local tiene que escribir `WEB-123` al cobrar. Hay que confirmar en
su versión de Aronium dónde se carga ese campo en el punto de venta y que
quede guardado (en la base de prueba quedó).

Trabajo estimado: lectura de ventas en `connector/src/aronium.mjs`, un campo
nuevo en `/admin/aronium/sync`, la conciliación en
`backend/src/lib/aronium-sync.ts` y dos listas en el panel → Aronium.

### Etapa 2 (opcional, solo si la etapa 1 queda corta): crear la venta en Aronium automáticamente

El conector escribiría el documento de venta en `pos.db`. **No se recomienda
por ahora:**

- Aronium no documenta su base: una actualización puede cambiarla sin aviso.
- Hay que respetar numeración (`Counter`), impuestos (`DocumentItemTax`),
  pagos, cierre de caja (`ZReport`) y posiblemente la impresión fiscal.
- Escribir mientras Aronium está abierto puede chocar con la caja.
- Un error deja la caja del local inconsistente, que es peor que el problema
  original.

Si se hace, tiene que ser con copia de seguridad automática antes de cada
escritura, probado sobre una copia de la base del local y, idealmente, con
confirmación del soporte de Aronium.

## Para decidir con el local

1. ¿Quién cobra en Aronium las ventas web y en qué momento: al confirmar el
   pago, al preparar el paquete o al entregar?
2. ¿Pueden escribir `WEB-<número>` en el número de pedido al cobrar? (Probarlo
   en su caja.)
3. Las ventas web pagadas por transferencia: ¿con qué forma de pago las
   cargan en Aronium? (Hoy tiene Cash, Card y Check.)
4. ¿Usan Aronium con un solo depósito, o el stock online tiene que salir de
   uno en particular (`warehouseId` del conector)?
5. ¿Qué versión de Aronium tienen? Si es Aronium Pro (SQL Server), el conector
   actual no sirve tal cual.
