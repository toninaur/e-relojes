# Conector tienda → ContiMarket

Manda a ContiMarket los productos de la tienda con el mismo precio y stock.
Corre en el servidor (Railway), aparte de la sincronización con Aronium, que
es prioritaria: el agente del local no cambia y, si ContiMarket falla, la
tienda y la caja siguen igual. Arquitectura completa (con la del conector de
Aronium): documento "Arquitectura del sincronizador Aronium ↔ tienda online".

```
Aronium ──(agente del local)──▶ Tienda (Medusa) ──(módulo contimarket, aparte)──▶ ContiMarket
```

## Qué hace

| Momento | Qué manda |
|---|---|
| Después de cada pasada del agente de Aronium que cambió algo (con 15 s de demora) | Los productos cuya huella cambió |
| Cada 5 minutos (`jobs/contimarket-push.ts`) | Lo mismo: capta reservas de pedidos web, ofertas y ediciones del panel |
| Una vez por día, o "Sincronizar todo ahora" en el panel | Todo |

Una pasada por vez; si piden otra mientras corre, se hace una más al terminar.
Todo error queda en el módulo (panel → ContiMarket).

## Cada producto (`lib/contimarket.ts`)

| ContiMarket | De dónde sale |
|---|---|
| CodigoProducto | SKU de la tienda (= código de Aronium) |
| Nombre | Título del producto |
| DescripcionBreve / DescripcionCompleta | Descripción de la tienda; si falta, "Reloj Casio MTP-V001… Color: … Malla: … Referencia …" (nunca vacías) |
| PrecioCatalogo | Precio normal (el de Aronium) |
| PrecioContinental | Regla del panel: el mismo, el de oferta vigente o un porcentaje menos |
| Stock | Stock disponible de la tienda (stock − reservado). 0 si está oculto, si no va a ContiMarket o si hay menos unidades que la regla de "última unidad" |
| Peso y medidas | Por tipo de producto (`DEFAULT_DIMENSIONS`), cambiables por tipo |
| Caracteristicas | Marca, tipo, color, malla, características y referencia |
| Imagen | Hasta 3 fotos de la tienda (URLs públicas) |

- Se manda solo lo que cambió (huella por producto en `contimarket_product`).
- Un producto que ContiMarket nunca recibió y que no va (stock 0) no se crea.
- Para sacar un producto de ContiMarket se manda con stock 0: la API no borra.
- Tandas de 200 productos y menos de 9 MB (el límite de ContiMarket es 10 MB).
- Si ContiMarket rechaza algunos productos de una tanda, quedan marcados con
  su motivo y el resto se manda de nuevo sin ellos. Los rechazados se
  reintentan en la pasada siguiente.

## API de ContiMarket (`lib/contimarket-client.ts`)

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `POST /ImportProduct` | Crea o actualiza por `CodigoProducto` | `"Ok"`; 400 `[{codigoproducto, mensaje}]`; 401 |
| `POST /ImageManager` | Borra las fotos de los códigos `["G1700"]` | 202 o 400 |

Autenticación Basic con el email y la contraseña del panel de ContiMarket del
local. Producción `https://www.contimarket.com/`; prueba
`https://comercios.contimarket.com` (puerto 10443 según el PDF v1.5, 8443 según
el v2.2.1).

## Instalación

1. En Railway, servicio backend → Variables: `CONTIMARKET_URL`,
   `CONTIMARKET_USER`, `CONTIMARKET_PASSWORD` (ver DEPLOY.md). No van en el
   panel ni en el código.
2. Deploy (la migración crea las tablas `contimarket_settings`,
   `contimarket_product` y `contimarket_run`).
3. Panel → ContiMarket: elegir qué productos van, el precio especial y la
   regla de la última unidad, y encender.

## Pendiente

- Probar contra el entorno de prueba de ContiMarket: si un producto con error
  rechaza toda la tanda (el conector ya cubre los dos casos), si reenviar las
  fotos las duplica (habría que borrarlas antes con `/ImageManager`), si
  acepta códigos con puntos (`T118.410.16.057.00`) y cuántas fotos acepta.
- Decisiones del local: qué productos, precio especial y última unidad (hoy:
  todos los publicados, el mismo precio, desde 1 unidad; el conector está
  apagado hasta que se encienda).

## Pruebas

- `backend/src/lib/__tests__/contimarket.unit.spec.ts`: armado de cada
  producto, stock y precio, qué se manda, tandas y el cliente HTTP (15).
- Probado el 20/11/2026 contra un ContiMarket simulado con los 597 productos
  publicados de la base local: primer envío (3 tandas, 0,19 MB como máximo),
  segunda pasada sin envíos, 2 rechazados en medio de una tanda (el resto se
  reenvió), reintento de los rechazados, producto ocultado (stock 0) y
  contraseña rechazada.
