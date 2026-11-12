# Conector Aronium → tienda online

Programa que corre en la computadora del local donde está Aronium. Cada 5
minutos lee la base de Aronium (solo lectura) y le manda a la tienda lo que
cambió.

| En Aronium | En la tienda |
|---|---|
| Código del producto | SKU de la variante (es lo que los une) |
| Precio | Precio normal. Las ofertas (lista "Ofertas") no se tocan |
| Stock (suma de los depósitos, o el de `warehouseId`) | Stock del local. Lo vendido online y no entregado queda reservado y se descuenta |
| Producto desactivado | Stock 0 (no se vende online) |
| Código que no existe en la tienda | Producto nuevo **en borrador**, con nombre, descripción, foto y categoría (si un grupo de Aronium se llama igual que una categoría) |

Título, fotos, descripción y características de un producto que ya existe se
manejan en el panel: el conector no las pisa. Precio y stock se cambian siempre
en Aronium; un cambio en el panel vuelve al valor de Aronium en la próxima
sincronización completa (una vez por día).

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

- `connector.log`: qué se mandó en cada pasada y los errores.
- `npm run once`: una pasada a mano (solo los cambios).
- `npm run full`: manda todo de nuevo.
- `state.json` guarda qué se mandó; borrarlo fuerza una sincronización completa.

Aronium Pro (varias cajas) usa SQL Server en vez de `pos.db`: este conector
lee solo la versión con `pos.db`.

## Pendiente

- ContiMarket: actualizar stock y precio en ContiMarket y traer de ahí fotos y
  descripciones. Falta que ContiMarket le dé al cliente acceso a su API.
