# Sincronizador Aronium Lite ↔ tienda online

Mantiene a Aronium (la caja del local) y a la tienda con el mismo stock y los
mismos precios, y registra en Aronium las ventas de la tienda. Diseño completo
y decisiones: [docs/sincronizador-aronium.md](../docs/sincronizador-aronium.md).

| Parte | Dónde corre | Qué hace |
|---|---|---|
| **Agente** (esta carpeta) | PC del local, junto a Aronium | Cada minuto: registra en Aronium los pedidos web (y sus pagos y cancelaciones), lee productos, precios y stock y manda a la tienda lo que cambió. Hace una copia de respaldo de `pos.db` por día |
| **Servidor** (`backend/src/lib/aronium-*.ts`, módulo `aronium`) | Tienda (Railway) | Aplica lo que manda el agente, mantiene la cola de ventas web, calcula el stock online |
| **Panel** (→ **Aronium**, y el recuadro "Aronium" de cada producto) | Navegador | Estado, clave del conector, ventas web y su estado en Aronium, productos para completar, bitácora |

## Aronium → tienda

| En Aronium | En la tienda |
|---|---|
| Código del producto | SKU de la variante (es lo que los une) |
| Precio | Precio normal. Las ofertas (lista "Ofertas") no se tocan |
| Stock (suma de los depósitos, o el de `warehouseId`) | Stock del local, más las ventas web que Aronium ya restó y la tienda todavía tiene reservadas (así nada se descuenta dos veces) |
| Producto borrado | **Baja**: stock 0 (no se vende online) |
| Código que no existe en la tienda | Producto nuevo **en borrador** con nombre, descripción, filtros, categoría, marca y tipo deducidos; la foto llega en un segundo paso |
| Foto, descripción, código de barras | Se copian y se mantienen al día, salvo que se editen en el panel |

**Descripción con filtros (opcional).** En la descripción de Aronium se pueden
agregar estas líneas; van a los filtros y a las características de la tienda:

```
Reloj automático con cristal de zafiro.
Color: Negro, Dorado
Malla: Acero
Características: 40 mm | Zafiro | Sumergible 10 BAR
```

Sin esas líneas, color y malla se deducen de las palabras del nombre y la
descripción. Lo que no se deduce aparece en el panel → Aronium → "Productos
nuevos para completar".

**Lo editado en el panel no se pisa.** Si alguien cambia en el panel la foto,
la descripción, los filtros o el código de barras de un producto, Aronium deja
de copiar ese dato en ese producto. En la ficha del producto, el recuadro
"Aronium" muestra qué viene de Aronium y qué se editó, y el botón **Tomar de
Aronium** vuelve a copiar todo.

Al crear un borrador, `backend/src/lib/aronium-classify.ts` deduce:
- **Categoría:** por el grupo de Aronium, si se llama igual que una categoría o
  figura en `GROUP_ALIASES` (`backend/src/lib/catalog-taxonomy.ts`; completar
  con los grupos reales del local).
- **Marca:** la que aparece al principio del nombre ("Tissot PRX…", "G-Shock…"
  → Casio, "MK5774" → Michael Kors).
- **Tipo:** por palabras del nombre (billetera, lentes, EDP…) o por la marca.

Aronium Lite no permite desactivar productos ni borrar los que tienen
movimientos: para dejar de vender algo online, stock 0 en Aronium o
"despublicar" en el panel.

## Tienda → Aronium (ventas web)

Cada pedido de la tienda se escribe en Aronium como una venta más (lo mismo que
graba la caja al cobrar):

| Pedido | En Aronium |
|---|---|
| Pedido nuevo | Venta con el número siguiente, **número de pedido `WEB-123`**, el precio cobrado de cada producto (con oferta o cupón), el IVA de cada producto, el envío (producto `ENVIO`), y el stock descontado. Nota interna con cliente, teléfono, RUC, entrega y notas. **Impaga** hasta que se pague |
| Marcado como pagado en el panel | Se agrega el pago (forma "Transferencia" o "Cash") |
| Cliente con RUC | Se usa (o crea) el cliente de Aronium con ese RUC, para la factura; sin RUC, el "Walk-in customer" |
| Cancelado en el panel | Devolución (documento 220) que devuelve el stock y la plata |

Nunca duplica una venta (si ya existe `WEB-123`, no la repite) y la escribe
entera o nada. Si un producto del pedido no existe en Aronium, no escribe nada
y el pedido queda "Con error" en el panel, con botón **Reintentar**.

**Ante la duda, no escribe:** si una actualización de Aronium cambió su base de
datos, el agente sigue sincronizando stock y precios pero deja de registrar
ventas y lo avisa en el panel.

### Qué hay que crear en Aronium (una vez)

**Nadie tiene que crear nada a mano:** lo hace el instalador (o `npm run setup`),
con Aronium abierto o cerrado, después de una copia de respaldo, y solo crea lo
que falta.

**Usuario:** las ventas web quedan a nombre del usuario principal de Aronium (el
de más permisos), porque el historial de ventas de Aronium muestra solo las
ventas del usuario con la sesión abierta. Se reconocen por el número de pedido
`WEB-…` y la nota interna. Para usar otro: `webSales.userName` en `config.json`.


| Qué | Para qué | Si no está |
|---|---|---|
| Forma de pago **"Transferencia"** | Pagos por transferencia, separados del efectivo en el cierre | Las ventas pagadas por transferencia quedan impagas en Aronium hasta crearla |
| Producto-servicio **"Envío"**, código `ENVIO` | Que el total de Aronium coincida con lo cobrado | El envío no se suma (queda en la nota, con aviso) |

Los nombres se cambian en `config.json` → `webSales`.

## Instalación en el local

1. Instalar [Node.js](https://nodejs.org) 22.13 o más nuevo (LTS).
2. Copiar esta carpeta a la computadora, por ejemplo `C:\SincronizadorAronium`.
3. Panel de la tienda → **Aronium** → **Generar clave** y copiarla.
4. Copiar `config.example.json` como `config.json` y completar:
   - `storeUrl`: URL del backend (el del panel, sin `/app`).
   - `token`: la clave del paso 3 (`arag_…`). Solo sirve para sincronizar, no
     da acceso al panel.
   - `aroniumDb`: la base de Aronium. La de siempre es
     `%LOCALAPPDATA%/Aronium/Data/pos.db`; si no está ahí, Aronium la muestra en
     Configuración → Base de datos → "Abrir ubicación". En el JSON las rutas van
     con `/` (o `\\` doble): una sola `\` hace inválido el archivo.
   - `warehouseId`: `null` suma todos los depósitos; un número usa solo ese.
   - `intervalMinutes`: cada cuántos minutos sincroniza (1 a 30). Recomendado: 1.
   - `webSales`: nombres del usuario, las formas de pago y el producto de envío
     en Aronium (ver arriba); `"enabled": false` apaga el registro de ventas web.
5. En PowerShell **como administrador**, dentro de la carpeta:
   `powershell -ExecutionPolicy Bypass -File install.ps1`
   Prepara Aronium (forma de pago y envío), hace una pasada de prueba y
   deja una tarea programada que **arranca con
   Windows** (aunque nadie inicie sesión) y se reinicia sola si se cae.

Para quitarlo: `install.ps1 -Uninstall`.

## Uso y diagnóstico

- Panel de la tienda → **Aronium**: estado, ventas web y errores, desde cualquier lado.
- `connector.log`: el registro en la computadora del local.
- `backups/`: una copia de `pos.db` por día (las últimas 14).
- `state.json`: lo que el agente recuerda entre reinicios (no tocar).
- `npm run once`: una pasada a mano. `npm test`: pruebas del registro de ventas
  sobre una **copia** de `pos.db` (nunca la base real).

Aronium Pro (varias cajas, base SQL Server) no está soportado: este agente es
para Aronium Lite (`pos.db`).

## Pendiente

- ContiMarket: actualizar stock y precio en ContiMarket y traer de ahí fotos y
  descripciones. Falta que ContiMarket le dé al cliente acceso a su API.
