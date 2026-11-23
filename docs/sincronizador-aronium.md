# Sincronizador Aronium Lite ↔ tienda online

Estado: Aronium → tienda **construido y probado** (17/11/2026). Tienda → Aronium
**rediseñado el 18/11/2026**: el pedido web entra como **proforma** (cotización) y
se convierte en venta cuando la cajera la marca "Pagado" (punto 4.2). Lo
construido el 17/11 (venta directa) se reutiliza para ese segundo paso.
Reemplaza a `plan-ventas-online-aronium.md`. Instalación y uso: [connector/README.md](../connector/README.md).

## 1. Qué hace, en una frase

Mantiene a Aronium (la caja del local) y a la tienda online contando el mismo
stock y los mismos precios, y hace que **toda venta, sea de la caja o de la web,
quede registrada en Aronium**, sin que nadie cargue nada dos veces.

## 2. Reglas de fondo

1. **Aronium manda en lo físico:** stock real, precio normal, productos que
   existen. La tienda nunca cambia esos datos en Aronium (salvo registrar ventas
   web, punto 3).
2. **La tienda manda en lo comercial:** fotos, descripciones, categorías,
   marcas, filtros, ofertas y cupones. Aronium no los pisa.
3. **Todo pedido web llega a Aronium.** Primero como proforma (no mueve stock);
   cuando el cliente paga y la cajera la marca "Pagado", el sincronizador la
   convierte en venta, como si se hubiera cobrado en la caja.
4. **Stock que ve el cliente online = stock de Aronium − pedidos web que todavía
   no son venta en Aronium.** En ningún momento se descuenta dos veces ni se vende
   de más por demora.
5. **Una venta nunca se pierde ni se duplica.** Cada pedido web se registra una
   sola vez aunque se corte la luz o internet a mitad de camino.
6. **Si algo falla, se ve.** El panel de la tienda (→ Aronium) muestra el estado
   y cada error, con una acción para resolverlo. Nada falla en silencio.
7. **Solo el agente toca Aronium**, desde la PC del local. El servidor de la
   tienda nunca accede a la base de Aronium.
8. **Ante la duda, no escribe.** Si la base de Aronium no es la versión que el
   sincronizador conoce, sigue leyendo (stock y precios) pero no registra ventas
   hasta que se actualice.

## 3. Piezas

| Pieza | Dónde corre | Qué hace |
|---|---|---|
| **Agente** (`connector/`) | PC del local, junto a Aronium | Lee Aronium y le avisa a la tienda; trae los pedidos web y los escribe en Aronium; hace copias de respaldo de `pos.db` |
| **Servidor** (`backend/`, módulo `aronium`) | Railway | Aplica lo que manda el agente; mantiene la **cola de ventas web**; calcula el stock online |
| **Panel** (→ Aronium) | Navegador del dueño | Estado del agente, ventas web y su estado en Aronium, historial, errores con "Reintentar" |

## 4. Los dos sentidos

### 4.1 Aronium → tienda (funciona; probado el 17/11)

Cada minuto el agente lee productos, precios y stock, y manda solo lo que cambió.
Cada 30 minutos (y al arrancar, o si desaparece un código) manda todo, que es
como se detectan los productos borrados.

| En Aronium | En la tienda |
|---|---|
| Venta, compra, recuento, cualquier movimiento | Stock nuevo en ≤ 1 minuto |
| Cambio de precio | Precio normal nuevo (las ofertas no se tocan) |
| Producto nuevo | Borrador con nombre, categoría, marca y tipo deducidos, y su foto |
| Producto borrado | Baja: stock 0, deja de venderse |

#### Contenido del producto (a ampliar)

Aronium guarda poco de cada producto: nombre, descripción, **una** foto, grupo
(con subgrupos) y códigos de barras. El campo "Color" de Aronium es el color del
botón en la pantalla de la caja, no el del producto.

| Dato de la tienda | Fuente | Cómo |
|---|---|---|
| Foto principal | Foto de Aronium | Se copia al crear **y cuando cambia** (hoy solo al crear). La galería extra, en el panel |
| Descripción | Descripción de Aronium | Se copia al crear y cuando cambia (sin las líneas de abajo) |
| Categoría | Grupo de Aronium | Como hoy (`GROUP_ALIASES`) |
| Marca, tipo | Nombre | Como hoy (`aronium-classify.ts`) |
| Color, malla (filtros) | Línea `Color:` / `Malla:` de la descripción; si no está, palabras del nombre y la descripción ("negro", "cuero"…), con las listas cerradas de `catalog-taxonomy.ts` | Nuevo |
| Características | Línea `Características:` de la descripción, separadas por `\|` | Nuevo |
| Código de barras | Códigos de barras de Aronium | Nuevo: al código de barras de la variante (sirve para Google Shopping) |

Formato opcional en la descripción de Aronium:

```
Reloj automático con cristal de zafiro y bisel giratorio.
Color: Negro, Dorado
Malla: Acero
Características: 40 mm | Zafiro | Sumergible 10 BAR
```

**Quién gana:** el sincronizador guarda, por producto y por dato, lo último que
copió de Aronium. Si en la tienda hay otra cosa, alguien lo editó en el panel:
ese dato de ese producto deja de copiarse (el panel lo muestra como "editado en
la tienda" y permite volver a "tomarlo de Aronium"). Así el local elige producto
por producto dónde cargar cada cosa.

Siempre a mano en el panel: fotos adicionales, ofertas, portada y banner.

Fuente futura: ContiMarket (fotos y descripciones), si dan acceso a su API.

**Fórmula del stock (regla 4).** Una venta web ya registrada en Aronium aparece
dos veces: en el stock de Aronium y en la reserva de la tienda. Por eso:

> stock del local en la tienda = stock de Aronium + unidades de pedidos web **ya
> convertidos en venta en Aronium** y todavía no entregados

La proforma no mueve stock, así que mientras el pedido está como proforma solo
cuenta la reserva de la tienda. Ejemplo: Aronium tiene 5, entra un pedido web de
1 → proforma, online 4 (reserva). La cajera la marca "Pagado" → el agente crea la
venta, Aronium 4, la tienda guarda 4 + 1 = 5, reserva 1 → online 4. Se entrega →
la reserva se va, Aronium 4 → online 4. En ningún paso cambia el número que ve el
cliente.

### 4.2 Tienda → Aronium: pedido → proforma → venta (rediseño 18/11)

```
cliente compra ─▶ pedido en la tienda (pendiente de pago) ─▶ cola "pedidos web"
                                                                  │
   agente, cada minuto ◀──────────────────────────────────────────┘
     │  ¿ya existe una proforma con PW-1042-K7? → sí: solo avisa "registrado"
     │  no: escribe la PROFORMA (tipo 230, "No pagado")      → no mueve stock
     ▼
   Aronium: proforma 26-230-000012, nota interna "Pedido web PW-1042-K7"
   Alerta: panel de la tienda + aviso en la PC del local
     │
     │  el cliente paga o transfiere → la cajera marca la proforma "Pagado"
     ▼
   agente (≤ 1 minuto): ve PaidStatus 1 → 2 en una proforma con código PW-
     1. escribe la VENTA (tipo 200) con lo que dice la proforma, y su pago → resta stock
     2. agrega a la nota interna de la proforma "Facturado 26-200-000046"
     3. avisa a la tienda → pedido "pagado", con el N.º de venta de Aronium
```

**Lo verificado en Aronium Lite (18/11):** la proforma no se puede convertir en
venta desde Aronium; solo se marca "Pagado" / "No pagado". Eso cambia
`Document.PaidStatus` (**2 = Pagado, 1 = No pagado**) y no crea ningún `Payment`
ni toca el stock. **Aronium crea las proformas como "Pagado" por defecto**: el
agente las escribe explícitamente con `PaidStatus = 1`. El campo "Número de
orden" no se ve en la proforma; por eso el código va en la nota interna.

**Código de seguimiento:** `PW-<número de pedido>-<control>`, por ejemplo
`PW-1042-K7`. El número es el `display_id` del pedido en la tienda (único); el
control son 2 caracteres que detectan un código mal tipeado. Corto para poder
dictarlo o escribirlo a mano. Va en:

| Dónde | Qué |
|---|---|
| Proforma, nota interna | `Pedido web PW-1042-K7`, y debajo cliente, teléfono, RUC, entrega, pago y notas del cliente |
| Proforma, `OrderNumber` | `PW-1042-K7` (para buscarla por código) |
| Venta creada desde la proforma | Mismo `OrderNumber` y nota interna `Pedido web PW-1042-K7 · Proforma 26-230-000012` |
| Pedido en la tienda | Metadata del pedido; visible en el panel y en el email de confirmación |

**Qué escribe en Aronium**, igual que lo hace la caja (estudiado en `pos.db`):

| Tabla | Proforma (al llegar el pedido) | Venta (al marcarse "Pagado") |
|---|---|---|
| `Document` | Tipo 230, número siguiente del año (`26-230-…`), cliente, `OrderNumber`, nota interna, `PaidStatus = 1` | Tipo 200 (`26-200-…`), mismos datos, `PaidStatus = 2` |
| `DocumentItem` | Un renglón por producto (código = SKU), cantidad y **precio realmente cobrado** (con oferta o cupón) | Copia de los renglones **de la proforma** |
| `DocumentItemTax` | El impuesto de cada producto | Ídem |
| `Payment` | — | El pago, con la forma de pago del pedido (D2) |
| `Stock` | — | Resta las unidades |
| `Counter` | Numeración 230 | Numeración 200 |

Cada paso en **una sola transacción de SQLite**, y nunca dos veces: antes de
escribir la proforma busca el código; antes de escribir la venta busca una venta
con ese `OrderNumber`.

**Casos especiales**

| Caso | Qué hace |
|---|---|
| Un producto del pedido no existe en Aronium | No escribe nada; el pedido queda "con error" en el panel, con el código que falta |
| La cajera cambió la proforma (cantidades, precios) antes de marcarla "Pagado" | La venta se hace con lo que dice la proforma (es lo acordado con el cliente); el panel marca la diferencia con el pedido web |
| La cajera además cargó la venta a mano en la caja | Antes de crear la venta, el agente busca una venta de los últimos días del mismo cliente con los mismos productos. Si la hay, no crea otra: la vincula y avisa "posible venta duplicada" en el panel |
| Marcada "Pagado" y después vuelta a "No pagado" | Si la venta ya se creó, no se deshace sola: aviso en el panel |
| No alcanza el stock en Aronium al crear la venta | Crea la venta igual (ya se cobró) y lo marca en el panel |
| Pedido cancelado en la tienda, proforma sin pagar | Agrega `ANULADO` a la nota interna de la proforma (no hay stock que devolver) |
| Pedido cancelado después de la venta | **Devolución** (tipo 220) que devuelve el stock, como ya está hecho |
| Pedidos sin pagar | **No vencen**: la proforma queda abierta y el stock reservado online hasta que se pague o se cancele |
| Proformas hechas a mano en Aronium (sin código PW-) | El agente no las toca |
| Costo de envío | Renglón con un producto-servicio "Envío" de Aronium (D4) |
| Cambios, devoluciones parciales | Fuera de esta versión: a mano en Aronium |

### 4.3 Clientes

Todo cliente de un pedido web queda registrado como cliente en Aronium.

| Dato | En la tienda | En Aronium (`Customer`) |
|---|---|---|
| RUC | Checkout (hoy en el pedido); **se guarda también en el cliente** | `TaxNumber` |
| Razón social / nombre | Checkout / cliente | `Name` |
| Email, teléfono | Cliente / dirección | `Email`, `PhoneNumber` |
| Dirección | Dirección de envío/facturación (`address_1`, `address_2`) | `Address` |
| Ciudad | `city` | `City` |
| País | `country_code` | `CountryId` (tabla `Country` de Aronium) |

Búsqueda: primero por RUC; sin RUC, por email; si no está, se crea. **Aronium
manda:** si el cliente ya existe, solo se completan los campos vacíos.

### 4.4 Alertas

| Dónde | Qué avisa |
|---|---|
| Panel de la tienda (→ Aronium y lista de pedidos) | Pedido web nuevo, pedidos con error, diferencias proforma/pedido, posible venta duplicada, stock insuficiente para pedidos abiertos |
| PC del local | Aviso de Windows "Pedido web PW-1042-K7 — Juan Pérez — Gs. 1.250.000", ícono junto al reloj con los pedidos pendientes y acceso a una pantalla local con el detalle |

El agente corre como tarea de Windows con el usuario SYSTEM (arranca aunque nadie
inicie sesión), y Windows no deja que esas tareas muestren nada en pantalla. Por
eso los avisos de la PC son un **segundo programa chico** que arranca al iniciar
sesión el usuario del local y lee el estado del agente (`status.json`,
`avisos.json`): `Sincronizador.exe`, que además permite configurarlo, pausarlo y
reiniciarlo sin internet.

## 5. Seguridad de los datos de Aronium

- **Copia de respaldo** de `pos.db` una vez por día y antes de la primera
  escritura del día; se guardan las últimas 14.
- **Control de versión:** el agente conoce la estructura de la base (las 78
  migraciones de la versión actual). Si Aronium se actualiza y cambia la base,
  deja de escribir y lo avisa en el panel; la lectura sigue.
- **Escrituras cortas** (milésimas de segundo), esperando si la caja está
  grabando en ese momento.
- **Prueba obligatoria con Aronium abierto:** que la numeración no se repita
  (que Aronium no tenga el número guardado en memoria), que la venta aparezca en
  sus listados y reportes, y que el cierre de caja (reporte Z) cuadre.

## 6. Lo que conviene reescribir

| Qué | Por qué |
|---|---|
| **Clave propia del agente** en vez de la clave secreta de administrador | Hoy el agente usa una clave con permiso total sobre la tienda; si alguien la saca de la PC del local, puede hacer cualquier cosa. Una clave que solo sirve para las rutas del sincronizador |
| **Fórmula del stock** (punto 4.1) | Necesaria para que las ventas web registradas no se cuenten dos veces |
| **Agente en módulos** (`read`, `write`, `backup`, `state`) | El archivo único crece demasiado con el sentido nuevo |
| **Estado del agente en disco** (`state.json`) | Hoy vive en memoria; al reiniciar repite trabajo |
| **Instalación como tarea que arranca con Windows**, no al iniciar sesión | Hoy, si la PC se prende y nadie inicia sesión, no sincroniza |

## 7. Decisiones (con valor propuesto; se cambian en `config.json`)

| | Decisión | Propuesta | Alternativa |
|---|---|---|---|
| D1 | ¿Cuándo entra el pedido web en Aronium? | **Decidido 18/11:** al hacerse el pedido, como **proforma** "No pagado"; la venta la crea el agente cuando la cajera marca la proforma "Pagado" en Aronium | — |
| D2 | Forma de pago en Aronium | Crear "Transferencia" en Aronium; "Efectivo al recibir" va como efectivo cuando se cobra | Todo como efectivo (descuadra el arqueo) |
| D3 | Cliente | **Decidido 18/11:** todo cliente web se registra en Aronium (punto 4.3), buscado por RUC y si no por email | — |
| D7 | Pedidos sin pagar | **Decidido 18/11:** no vencen; quedan como proforma y con stock reservado hasta que se paguen o se cancelen | Vencer a las 48 h |
| D8 | Alertas | **Decidido 18/11:** panel de la tienda y programa de avisos en la PC del local (punto 4.4) | — |
| D4 | Envío | Producto-servicio "Envío" en Aronium | No registrar el envío (el total no coincide con lo cobrado) |
| D5 | Usuario que figura en la venta | **El usuario principal** (decidido en la prueba del 17/11: el historial de ventas de Aronium muestra solo las del usuario con la sesión abierta; con un usuario aparte, las ventas web no se veían) | Otro (`webSales.userName`) |
| D6 | Depósito | El del local (el único) | Uno específico (`warehouseId`) |

## 8. Plan de trabajo

### Rediseño proforma (18/11)

1. **Tienda (servidor):** código `PW-…` por pedido; RUC y razón social también
   en el cliente; la cola pasa a tener los estados *pendiente → proforma →
   pagado (venta N.º …) / anulado / con error*; ruta para que el agente informe
   "pagado" y la tienda marque el pago del pedido; dirección, ciudad y país en
   lo que se manda al agente.
2. **Agente:** escribir la proforma (tipo 230, `PaidStatus = 1`); cada pasada,
   buscar proformas `PW-` que pasaron a "Pagado" y crear la venta reutilizando
   la escritura actual; anular proformas; cliente con dirección, ciudad y país;
   control de venta duplicada.
3. **Panel:** estados nuevos, código PW- en el pedido, avisos (diferencias,
   duplicadas, stock insuficiente).
4. **Avisos en la PC:** programa de bandeja que arranca al iniciar sesión.
   *Hecho 18/11 (agente 0.7.1): `connector/avisos.ps1` lee `avisos.json`.*
   *22/11 (agente 0.10.0): lo reemplaza `Sincronizador.exe` (`connector/panel/`),
   con estado, bitácora, pedidos web y configuración en la PC, sin internet
   (connector/README.md, "Programa de la PC del local").*
5. **Pruebas** sobre copia de `pos.db` y después con Aronium abierto: que la
   proforma se vea y se pueda imprimir, que "Pagado" dispare la venta, que la
   numeración 230 y 200 no se repita.
6. **ContiMarket:** segunda etapa, como módulo aparte del agente, cuando den
   acceso a su API.

### Plan original (17/11)

1. **Servidor:** cola de ventas web (tabla nueva), rutas para el agente, clave
   propia, nueva fórmula de stock, cancelaciones.
2. **Agente:** módulos, estado en disco, control de versión, respaldos,
   escritura de ventas y devoluciones; lectura de códigos de barras y de la
   foto cuando cambia.
2b. **Contenido:** foto y descripción siempre al día, filtros y
   características desde la descripción, regla de "editado en la tienda".
3. **Panel:** sección "Ventas web → Aronium" con estado y "Reintentar".
4. **Pruebas sobre una copia de `pos.db`** (automáticas): venta simple, varias
   unidades, con oferta y cupón, con envío, con RUC, SKU inexistente,
   corte a mitad de camino, pedido repetido, cancelación.
5. **Pruebas en el Aronium de la PC de desarrollo, abierto:** las mismas, más
   numeración (venta web → venta en caja → venta web), listados, reporte Z.
6. **Revisión del papá** en ese Aronium: que las ventas web se vean bien.
7. **Local** (AnyDesk): copia de su `pos.db` para probar, instalación, una
   semana mirando el panel.

## 9. Lo que no hace (por ahora)

- Facturación electrónica / SIFEN: si el local factura desde otro sistema, las
  ventas web se facturan ahí como hoy.
- Cambios y devoluciones parciales de pedidos web.
- Aronium Pro / en red (base SQL Server): esta versión es para Aronium Lite
  (`pos.db`).
- Más de un local o más de una caja con Aronium.

## Manejo desde el panel (agente 0.6+)

Panel → **Aronium**, sin tocar la computadora del local:

- **Interruptores**: "Copiar stock, precios y productos de Aronium a la tienda" y "Registrar las ventas web en Aronium". Apagado, lo pendiente espera (no se pierde); al reanudar la sincronización se hace sola una pasada completa.
- **Frecuencia** (1 a 30 min, o la del `config.json`): el agente la toma en su próxima pasada.
- **Sincronizar todo ahora**: pasada completa en la próxima.
- **Ventas web**: Reintentar y **La cargué a mano** (la saca de la cola; cuenta como ya descontada en Aronium para el stock).
- **Ayuda e instalación**: cómo funciona, formato de la descripción, instalación con la clave del conector y qué hacer ante cada problema.

Los ajustes viajan en la respuesta de `POST /aronium-agent/sync` (`settings`); pausado, la tienda responde `paused: true` sin aplicar nada y el agente no da los cambios por enviados.
