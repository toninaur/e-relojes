# Sincronizador Aronium Lite ↔ tienda online

Estado: **construido y probado sobre una copia de `pos.db`** (17/11/2026). Falta la
prueba con Aronium abierto (punto 8, paso 5) y en el local. Reemplaza a
`plan-ventas-online-aronium.md`. Instalación y uso: [connector/README.md](../connector/README.md).

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
3. **Toda venta termina en Aronium.** Las de la caja ya están; las de la web las
   carga el sincronizador, como si se hubieran cobrado en la caja.
4. **Stock que ve el cliente online = stock de Aronium − ventas web que todavía
   no están en Aronium.** En ningún momento se descuenta dos veces ni se vende de
   más por demora.
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

**Cambio pendiente (regla 4):** hoy la tienda copia el stock de Aronium tal
cual y le resta todas las reservas web. Cuando el punto 4.2 esté hecho, una
venta web ya registrada en Aronium aparece dos veces: en el stock de Aronium y
en la reserva. Nueva fórmula:

> stock del local en la tienda = stock de Aronium + unidades de pedidos web **ya
> registrados en Aronium** y todavía no entregados

Así lo disponible online (stock − reservas) queda siempre igual a "Aronium menos
las ventas web que todavía no llegaron a Aronium". Ejemplo: Aronium tiene 5, entra
un pedido web de 1 → online 4 (reserva). El agente lo registra en Aronium → Aronium
4, la tienda guarda 4 + 1 = 5, reserva 1 → online 4. Se entrega → la reserva se va,
Aronium 4 → online 4. En ningún paso cambia el número que ve el cliente.

### 4.2 Tienda → Aronium (a construir)

```
cliente compra ─▶ pedido en la tienda ─▶ cola "ventas web" (pendiente)
                                              │
            agente, cada minuto ◀─────────────┘
                 │  ¿ya existe WEB-123 en Aronium? → sí: solo avisa "registrada"
                 │  no: escribe la venta en Aronium (todo o nada)
                 ▼
         Aronium: venta WEB-123, stock descontado ─▶ avisa a la tienda: registrada (N.º 26-200-000045)
```

**Qué escribe en Aronium**, igual que lo hace la caja (estudiado en `pos.db`):

| Tabla | Qué |
|---|---|
| `Document` | Venta (tipo 200), número siguiente del año (`26-200-000045`), fecha, depósito, usuario principal de la caja, cliente, **número de pedido `WEB-123`**, nota con nombre, teléfono, RUC, entrega y notas del cliente |
| `DocumentItem` | Un renglón por producto (código de Aronium = SKU), cantidad y **precio realmente cobrado** (con oferta o cupón) |
| `DocumentItemTax` | El impuesto que cada producto tiene cargado en Aronium |
| `Payment` | El pago, cuando corresponde (ver decisión D1) |
| `Stock` | Resta las unidades vendidas |
| `Counter` | Avanza la numeración |

Todo dentro de **una sola transacción de SQLite**: o entra la venta completa o
no entra nada. Antes de escribir se fija si ya existe una venta con ese `WEB-…`
(si el agente se cortó justo después de escribir, no la repite).

**Casos especiales**

| Caso | Qué hace |
|---|---|
| Un producto del pedido no existe en Aronium (SKU sin código) | No escribe nada; el pedido queda "con error" en el panel, con el código que falta |
| No alcanza el stock en Aronium (se vendió en la caja al mismo tiempo) | Registra igual (la venta ya se hizo) y lo marca en el panel para avisarle al cliente |
| Costo de envío | Renglón con un producto-servicio "Envío" de Aronium (decisión D4) |
| Pedido cancelado antes de llegar a Aronium | Sale de la cola; no se escribe nada |
| Pedido cancelado después | Se escribe una **devolución** (tipo 220) que devuelve el stock y hace referencia a la venta |
| Cambios, devoluciones parciales | Fuera de esta versión: se hacen a mano en Aronium, como hoy |

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
| D1 | ¿Cuándo entra la venta web en Aronium? | **Al hacerse el pedido**, como venta impaga; el pago se agrega cuando se marca "pagado" en el panel | Recién cuando se marca pagado (el stock de Aronium tarda más en bajar) |
| D2 | Forma de pago en Aronium | Crear "Transferencia" en Aronium; "Efectivo al recibir" va como efectivo cuando se cobra | Todo como efectivo (descuadra el arqueo) |
| D3 | Cliente | Consumidor final ("Walk-in customer") con los datos en la nota; **si dejó RUC**, se busca o crea el cliente con ese RUC (para la factura) | Siempre consumidor final |
| D4 | Envío | Producto-servicio "Envío" en Aronium | No registrar el envío (el total no coincide con lo cobrado) |
| D5 | Usuario que figura en la venta | **El usuario principal** (decidido en la prueba del 17/11: el historial de ventas de Aronium muestra solo las del usuario con la sesión abierta; con un usuario aparte, las ventas web no se veían) | Otro (`webSales.userName`) |
| D6 | Depósito | El del local (el único) | Uno específico (`warehouseId`) |

## 8. Plan de trabajo

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
