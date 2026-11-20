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
| Código del producto | SKU de la variante (es lo que los une). Sin código, el primer código de barras hace de código (salvo que choque con otro) |
| Precio | Precio normal. Las ofertas (lista "Ofertas") no se tocan |
| Stock (suma de los depósitos, o el de `warehouseId`) | Stock del local, más las ventas web que Aronium ya restó y la tienda todavía tiene reservadas (así nada se descuenta dos veces) |
| Producto borrado | **Baja**: stock 0 (no se vende online) |
| Código que no existe en la tienda | Producto nuevo **en borrador** (oculto) con nombre, descripción, filtros, categoría, marca y tipo deducidos; la foto llega en un segundo paso. **Se publica solo** cuando tiene foto, categoría y stock (una vez: si alguien lo vuelve a ocultar, queda oculto). De a 250 por pasada: la primera carga del catálogo entero (unos 2.250 productos) tarda unos minutos |
| Producto sin código ni código de barras | No llega a la tienda |
| Producto publicado que se queda sin stock (o con la última unidad reservada por un pedido web) | Se **oculta**, y vuelve solo cuando tiene stock (lo pidió el local). Al entrar o cancelarse un pedido web, la tienda le pide al agente esos códigos y el cambio se ve en uno o dos minutos. Las mallas no se publican solas |
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

## Tienda → Aronium (pedidos web: proforma → venta)

Desde el agente 0.7.0, cada pedido de la tienda entra a Aronium como
**proforma** y pasa a venta cuando el cliente paga:

| Pedido | En Aronium |
|---|---|
| Pedido nuevo | **Proforma** (documento 230) **"No pagado"**, con el cliente, el precio cobrado de cada producto (con oferta o cupón), el IVA y el envío (el servicio de Aronium que se llama como la forma de entrega: "Delivery Asunción", "Envío de encomienda (a cobrar)"; si no hay, el producto `ENVIO`). **No descuenta stock.** Número de orden y nota interna: **`Pedido web PW-1042-K7`** (el código de seguimiento), con cliente, teléfono, RUC, entrega, pago y notas |
| La cajera marca la proforma **"Pagado"** | En la pasada siguiente el agente crea la **venta** (documento 200) con lo que dice la proforma, el pago ("Itaú" o "Efectivo") y el stock descontado; anota "Facturado 26-200-…" en la proforma; la tienda marca el pedido como pagado |
| Cliente | Todos quedan registrados en Aronium, buscados por RUC y si no por email, con dirección, ciudad y país. Si ya existe, solo se completan los datos vacíos |
| Cancelado antes de pagar | La proforma queda anotada **ANULADO** |
| Cancelado después de la venta | Devolución (documento 220) que devuelve el stock y la plata |

Aronium Lite no convierte proformas en venta ni crea un pago al marcarlas
"Pagado" (solo cambia `PaidStatus`: 1 = No pagado, 2 = Pagado), y crea las
proformas como "Pagado" por defecto: por eso el agente escribe la venta él mismo
y fija "No pagado" al crear la proforma.

Nunca duplica nada (busca el código `PW-…` antes de escribir) y escribe cada
documento entero o nada. Si un producto del pedido no existe en Aronium, no
escribe nada y el pedido queda "Con error" en el panel, con botón
**Reintentar**. Avisa en el panel si la cajera cambió la proforma antes de
cobrarla (la venta sale con lo de la proforma), si ya había cargado la venta a
mano (no crea otra) o si la proforma se borró (ahí el panel ofrece **La cargué a mano**). Las proformas hechas a mano, sin
código `PW-`, no se tocan.

**Ante la duda, no escribe:** si una actualización de Aronium cambió su base de
datos, el agente sigue sincronizando stock y precios pero deja de registrar
pedidos y lo avisa en el panel. Un agente anterior a 0.7.0 tampoco recibe
pedidos (no los entendería): el panel avisa que hay que actualizarlo.

### Qué hay que crear en Aronium (una vez)

**Nadie tiene que crear nada a mano:** lo hace el instalador (o `npm run setup`),
con Aronium abierto o cerrado, después de una copia de respaldo, y solo crea lo
que falta.

**Usuario:** las proformas y ventas web quedan a nombre del usuario principal de
Aronium (el de más permisos), porque el historial de Aronium muestra solo los
documentos del usuario con la sesión abierta. Se reconocen por el número de
orden `PW-…` y la nota interna. Para usar otro: `webSales.userName` en `config.json`.


| Qué | Para qué | Si no está |
|---|---|---|
| Forma de pago de las transferencias (`webSales.paymentTypes.bank_transfer`; en el local ya existe: **"Itaú"**) | Pagos por transferencia, separados del efectivo en el cierre | Las ventas pagadas por transferencia quedan impagas en Aronium hasta crearla |
| Producto-servicio **"Envío"**, código `ENVIO` | Envíos que no tienen un servicio de Aronium con su nombre (los "Delivery <ciudad>" del local sí lo tienen) | El envío no se suma (queda en la nota, con aviso) |

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

## Avisos en la PC del local

`avisos.ps1` pone un ícono junto al reloj de Windows. Cuando entra un pedido
web muestra un aviso ("Pedido web PW-1042-K7 — Juan Pérez — Gs. 1.250.000") y,
con doble clic, la lista de proformas que esperan que la cajera las marque
"Pagado". Avisa también los pedidos con error y si el sincronizador dejó de
responder (más de 10 minutos sin novedades).

El sincronizador corre como tarea del sistema, que no puede mostrar nada en
pantalla: escribe `avisos.json` en cada pasada y `avisos.ps1` (con el usuario
que inició sesión) lo lee cada 15 segundos. Lo instala `install.ps1` como
tarea "Avisos pedidos web - Tienda", que arranca al iniciar sesión.

## Uso y diagnóstico

- Panel de la tienda → **Aronium**: estado, ventas web y errores, desde cualquier lado.
- `connector.log`: el registro en la computadora del local.
- `backups/`: una copia de `pos.db` por día (las últimas 14).
- `state.json`: lo que el agente recuerda entre reinicios (no tocar).
- `avisos.json`: lo que muestran los avisos de la PC (lo reescribe cada pasada).
- `npm run once`: una pasada a mano. `npm test`: pruebas del registro de ventas
  sobre una **copia** de `pos.db` (nunca la base real).

Aronium Pro (varias cajas, base SQL Server) no está soportado: este agente es
para Aronium Lite (`pos.db`).

## Pendiente

- ContiMarket: actualizar stock y precio en ContiMarket y traer de ahí fotos y
  descripciones. Falta que ContiMarket le dé al cliente acceso a su API.

## Manejo desde el panel (agente 0.6+)

Panel → **Aronium**, sin tocar la computadora del local:

- **Interruptores**: "Copiar stock, precios y productos de Aronium a la tienda" y "Registrar las ventas web en Aronium". Apagado, lo pendiente espera (no se pierde); al reanudar la sincronización se hace sola una pasada completa.
- **Frecuencia** (1 a 30 min, o la del `config.json`): el agente la toma en su próxima pasada.
- **Sincronizar todo ahora**: pasada completa en la próxima.
- **Ventas web**: Reintentar y **La cargué a mano** (la saca de la cola; cuenta como ya descontada en Aronium para el stock).
- **Ayuda e instalación**: cómo funciona, formato de la descripción, instalación con la clave del conector y qué hacer ante cada problema.

Los ajustes viajan en la respuesta de `POST /aronium-agent/sync` (`settings`); pausado, la tienda responde `paused: true` sin aplicar nada y el agente no da los cambios por enviados.
