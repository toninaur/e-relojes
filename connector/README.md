# Agente Aronium → tienda online

El conector tiene tres partes:

| Parte | Dónde corre | Qué hace |
|---|---|---|
| Agente (esta carpeta) | Computadora del local, junto a Aronium | Cada 5 minutos lee la base de Aronium (solo lectura) y manda el catálogo entero a la tienda. Si no puede leerla, avisa el error. |
| Servidor (`backend/src/lib/aronium-sync.ts`, módulo `backend/src/modules/aronium`) | Backend de la tienda | Compara con la tienda, aplica los cambios, crea los productos nuevos, pide las fotos que faltan y guarda el historial. |
| Panel (`backend/src/admin/routes/aronium`) | Panel de la tienda → **Aronium** | Estado del agente (conectado, sin conexión, con errores), productos nuevos para completar e historial de cambios (precio anterior → nuevo). |

Rutas, con clave secreta de API: `POST /admin/aronium/sync` (catálogo o error),
`POST /admin/aronium/images` (fotos que pidió la tienda) y
`GET /admin/aronium/status` (lo que muestra el panel).

| En Aronium | En la tienda |
|---|---|
| Código del producto | SKU de la variante (es lo que los une) |
| Precio | Precio normal. Las ofertas (lista "Ofertas") no se tocan |
| Stock (suma de los depósitos, o el de `warehouseId`) | Stock del local. Lo vendido online y no entregado queda reservado y se descuenta |
| Producto desactivado | Stock 0 (no se vende online) |
| Código que no existe en la tienda | Producto nuevo **en borrador**, con nombre, descripción, categoría, marca y tipo cuando se pueden deducir (ver abajo). La foto de Aronium, si tiene, llega en un segundo paso |

Al crear un borrador, `backend/src/lib/aronium-classify.ts` completa:

- **Categoría:** por el grupo de Aronium, si se llama igual que una categoría
  o figura en `GROUP_ALIASES` (`backend/src/lib/catalog-taxonomy.ts`; completar
  con los grupos reales del local). Sin grupo, por el tipo (lentes, perfumes,
  billeteras…) o por la marca Casio. Un reloj sin grupo queda sin categoría,
  porque el nombre no dice si es de caballero o de dama.
- **Marca:** la que aparece al principio del nombre ("Tissot PRX…",
  "G-Shock…" → Casio, "MK5774" → Michael Kors).
- **Tipo:** por palabras del nombre (billetera, lentes, EDP…) o por la marca
  si vende una sola cosa (Curren → Reloj, Ray-Ban → Lentes de sol).

Lo que falta (categoría, marca, tipo, color, foto) se ve en panel → Aronium,
en "Productos nuevos para completar".

Título, fotos, descripción y características de un producto que ya existe se
manejan en el panel: el conector no las pisa. Precio y stock se cambian siempre
en Aronium: la tienda compara en cada pasada, así que un cambio hecho en el panel
vuelve al valor de Aronium a los pocos minutos.

Para que un producto con variantes (por ejemplo, colores) quede conectado, cada
variante lleva como SKU el código de Aronium de ese modelo.

## Instalación en el local

1. Instalar [Node.js](https://nodejs.org) 22.13 o más nuevo (LTS).
2. Copiar esta carpeta a la computadora, por ejemplo `C:\ConectorAronium`.
3. En el panel de la tienda: Settings → Secret API Keys → crear una clave
   ("Conector Aronium").
4. Copiar `config.example.json` como `config.json` y completar:
   - `storeUrl`: URL del backend (el del panel, sin `/app`).
   - `apiKey`: la clave `sk_...` del paso 3.
   - `aroniumDb`: la base de Aronium. La de siempre es
     `%LOCALAPPDATA%\Aronium\Data\pos.db`; si no está ahí, Aronium la muestra en
     Configuración → Base de datos → "Abrir ubicación".
   - `warehouseId`: `null` suma todos los depósitos; un número usa solo ese.
5. En PowerShell, dentro de la carpeta:
   `powershell -ExecutionPolicy Bypass -File install.ps1`
   Hace una pasada de prueba y deja una tarea programada que arranca sola al
   iniciar sesión.

Para quitarlo: `install.ps1 -Uninstall`.

## Uso y diagnóstico

- Panel de la tienda → **Aronium**: el estado y los errores, desde cualquier lado.
- `connector.log`: el registro en la computadora del local.
- `npm run once`: una pasada a mano.

Aronium Pro (varias cajas) usa SQL Server en vez de `pos.db`: este conector
lee solo la versión con `pos.db`.

## Pendiente

- ContiMarket: actualizar stock y precio en ContiMarket y traer de ahí fotos y
  descripciones. Falta que ContiMarket le dé al cliente acceso a su API.
