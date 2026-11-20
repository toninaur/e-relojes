import { errorMessage } from './log.mjs'

// Comunicación con la tienda. Con la clave del conector (token arag_…) usa las
// rutas /aronium-agent/*; con la clave secreta de administrador vieja
// (apiKey), las /admin/aronium/* (solo catálogo, sin ventas web).

export function createApi(config) {
  const useToken = Boolean(config.token)
  const base = useToken ? '/aronium-agent' : '/admin/aronium'
  const auth = useToken ? `Bearer ${config.token}` : `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`

  // Diferencia entre el reloj de esta PC y el de la tienda (encabezado Date de
  // cada respuesta, con precisión de un segundo). null hasta la primera.
  let clockSkewMs = null

  async function request(method, pathname, body) {
    let response
    try {
      response = await fetch(new URL(`${base}${pathname}`, config.storeUrl), {
        method,
        headers: { 'content-type': 'application/json', authorization: auth },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (error) {
      throw new Error(`Sin conexión con la tienda (${config.storeUrl}): ${errorMessage(error)}`)
    }
    const serverDate = Date.parse(response.headers.get('date') ?? '')
    if (Number.isFinite(serverDate)) clockSkewMs = Date.now() - serverDate
    if (response.status === 401) {
      throw new Error(useToken ? 'La tienda rechazó la clave del conector: generá una nueva en el panel → Aronium.' : 'La tienda rechazó la clave (apiKey): revisá config.json.')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`La tienda respondió ${response.status}: ${text.slice(0, 500)}`)
    }
    return response.json()
  }

  return {
    supportsWebSales: useToken,
    /** Cuánto adelanta (+) o atrasa (−) esta PC respecto de la tienda, en ms. */
    clockSkewMs: () => clockSkewMs,
    sync: (body) => request('POST', '/sync', body),
    images: (body) => request('POST', '/images', body),
    webSalesWork: () => request('GET', '/web-sales?limit=20'),
    webSaleResult: (id, body) => request('POST', `/web-sales/${encodeURIComponent(id)}`, body),
  }
}
