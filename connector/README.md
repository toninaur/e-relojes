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
     con `/` (o `\\` doble): una sola `\` hace inválido el archivo. El
     instalador reemplaza `%LOCALAPPDATA%` por la ruta completa: la tarea corre
     con la cuenta del sistema, que tiene otra carpeta.
   - `warehouseId`: `null` suma todos los depósitos; un número usa solo ese.
   - `intervalMinutes`: cada cuántos minutos sincroniza (1 a 30). Recomendado: 1.
   - `webSales`: nombres del usuario, las formas de pago y el producto de envío
     en Aronium (ver arriba); `"enabled": false` apaga el registro de ventas web.
5. **Revisar sin instalar** (no hace falta ser administrador, no toca nada):
   `powershell -ExecutionPolicy Bypass -File install.ps1 -Prueba`
   Revisa Node, `config.json`, la base de Aronium (versión, usuario, formas
   de pago, envío, servicios de delivery), la clave con la tienda y el reloj
   de la PC. ✖ = arreglarlo antes de instalar; ⚠ = conviene mirarlo.
6. En PowerShell **como administrador**, dentro de la carpeta:
   `powershell -ExecutionPolicy Bypass -File install.ps1`
   Vuelve a revisar todo (con un ✖ no instala nada), prepara Aronium (forma
   de pago y envío), hace una pasada de prueba y deja una tarea programada que
   **arranca con Windows** (aunque nadie inicie sesión) y que, si el agente se
   cierra, lo vuelve a abrir en 5 minutos. Al final verifica que quedó
   corriendo e instala el programa de la PC (ver abajo).

Para quitarlo: `install.ps1 -Uninstall`.

### Lo que el agente cuida solo en la PC del local

- **Un solo agente** por carpeta: si alguien lo abre a mano con la tarea
  andando, el segundo no arranca.
- **El reloj de la PC**: con más de 30 minutos de diferencia con la tienda no
  registra pedidos (saldrían con otra fecha y caerían en otro cierre de caja).
  Lo dice en el panel y en los avisos.
- **Aronium actualizado** con el agente andando: revisa la base en cada pasada
  y, si cambió, deja de registrar pedidos y lo avisa.
- **La caja grabando**: si Aronium está ocupado, espera y reintenta en la
  pasada siguiente (no lo muestra como error).
- **`config.json` cambiado** (una clave nueva): lo relee solo, sin reiniciar.
  Si quedó mal escrito, sigue con el anterior y lo anota en el registro.
- **Sin internet**: lo escrito en Aronium queda guardado y se informa al
  volver. El registro anota cada error repetido una vez por hora.

## Programa de la PC del local (Sincronizador.exe)

Para manejar el sincronizador **en la PC, sin internet y sin entrar al panel**.
Ícono junto al reloj de Windows: verde (funcionando), amarillo (en pausa, con
errores, pedidos web en pausa) o rojo (detenido, sin conexión con la tienda,
no puede leer Aronium). También está en el menú Inicio y en el escritorio como
**Sincronizador Aronium**. La X cierra la ventana pero el ícono sigue.

| Pestaña | Qué tiene |
|---|---|
| **Estado** | Si está corriendo, la última y la próxima pasada, la conexión con la tienda, Aronium, pedidos web, frecuencia y la última actividad. Botones: **Sincronizar ahora**, **Pasada completa**, **Pausar / Reanudar**, **Iniciar**, **Reiniciar**, **Revisar todo** (lo mismo que `install.ps1 -Prueba`), **Abrir en ventana (diagnóstico)**, panel de la tienda y carpeta |
| **Bitácora** | `connector.log` en hora local, con los errores en rojo; filtro "solo errores y avisos" |
| **Pedidos web** | Las proformas que esperan que la cajera las marque "Pagado" y los pedidos con error |
| **Configuración** | Todo `config.json` con campos: tienda y claves (conector y de administrador vieja), base de Aronium, depósito, frecuencia (y si el panel la puede cambiar), pedidos web (usuario, consumidor final, formas de pago, envío, tipo de servicio), copias de respaldo y los avisos de este programa. Guarda sin reiniciar nada; la versión anterior queda en `%APPDATA%\SincronizadorAronium\config-anterior.json` |

**Avisos** (globos de Windows, se apagan en Configuración → Este programa):
- *Pedidos web* (lo que antes hacía `avisos.ps1`): pedido nuevo ("Pedido web
  PW-1042-K7 — Juan Pérez — Gs. 1.250.000"), pedido con error y pedidos web en
  pausa (y por qué: el reloj de la PC, una versión nueva de Aronium).
- *El sincronizador*: detenido más de un minuto, o sin conexión con la tienda
  más de 5 minutos.

Cómo se comunica: el sincronizador corre como tarea del sistema, que no puede
mostrar nada en pantalla, y el programa corre con el usuario que inició sesión.
Se hablan por archivos en la carpeta (`src/status.mjs`):

| Archivo | Lo escribe | Para qué |
|---|---|---|
| `status.json` | el sincronizador | Cómo anda: última pasada, tienda, Aronium, próxima pasada |
| `avisos.json` | el sincronizador | Pedidos web que esperan pago |
| `connector.log` | el sincronizador | Bitácora |
| `config.json` | el programa | Configuración; el sincronizador la relee sola. `"paused": true` = Pausar; `"intervalFromPanel": false` = la frecuencia es la de acá y el panel no la cambia; `"alerts"` = los avisos del programa |
| `comandos/orden.json` | el programa | "Sincronizar ahora" / "Pasada completa": el sincronizador la toma en un segundo |

Si está corriendo lo sabe por el candado de `src/lock.mjs` (no depende de
internet ni de `status.json`). Pausado desde la PC, el sincronizador no lee ni
escribe Aronium pero le sigue avisando a la tienda, así el panel muestra
"pausado desde la PC" en vez de "sin conexión".

`install.ps1` lo compila (`panel/build.ps1`, con el compilador de C# que trae
Windows: no hay que instalar nada), crea los accesos directos y da permiso a
los usuarios de la PC para iniciar la tarea, guardar `config.json` y dejar
órdenes en `comandos/`. No les da permiso sobre `src/`, que corre como
sistema. Sin esos permisos (instalación vieja), el programa pide la clave de
administrador cuando la necesita.

## Uso y diagnóstico

- Panel de la tienda → **Aronium**: estado, ventas web y errores, desde cualquier lado.
- `connector.log`: el registro en la computadora del local.
- `backups/`: una copia de `pos.db` por día (las últimas 14).
- `state.json`: lo que el agente recuerda entre reinicios (no tocar).
- `avisos.json` y `status.json`: lo que muestra el programa de la PC (los reescribe cada pasada).
- **Si no arranca** (después de prender la PC o de un error): Windows lo vuelve
  a abrir solo cada 5 minutos. A mano: programa **Sincronizador Aronium** →
  **Iniciar** (o **Reiniciar**). Para ver por qué se cae: **Abrir en ventana
  (diagnóstico)**, con el sincronizador detenido.
- `npm run revisar`: la misma revisión que `install.ps1 -Prueba`.
- `npm run once`: una pasada a mano. `npm test`: pruebas del agente sobre una
  **copia** de `pos.db` (nunca la base real); con `ARONIUM_TEST_DB=<copia>`,
  sobre una copia de la base del local.

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
