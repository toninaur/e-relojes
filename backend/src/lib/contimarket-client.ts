import type { ContimarketItem } from './contimarket'

// Cliente de la API de carga masiva de ContiMarket (PDF v1.5 y v2.2.1):
// - POST /ImportProduct: crea o actualiza productos por CodigoProducto.
//   Responde "Ok"; o 400 con [{ codigoproducto, mensaje }]; o 401.
// - POST /ImageManager: borra las fotos de los códigos ["G1700"]. 202 o 400.
// Autenticación Basic con el email y la contraseña del panel de ContiMarket
// del local (variables de entorno del servidor, nunca en la base).

export interface ContimarketCredentials {
  /** https://www.contimarket.com/ (producción) o el entorno de prueba. */
  url: string
  user: string
  password: string
}

export type ImportResult = { ok: true } | { ok: false; rejected: { code: string; message: string }[]; raw: string }

export class ContimarketAuthError extends Error {}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): ContimarketCredentials | null {
  const url = (env.CONTIMARKET_URL ?? '').trim()
  const user = (env.CONTIMARKET_USER ?? '').trim()
  const password = env.CONTIMARKET_PASSWORD ?? ''
  if (!url || !user || !password) return null
  return { url: url.replace(/\/+$/, ''), user, password }
}

export function createContimarketClient(credentials: ContimarketCredentials, fetchImpl: typeof fetch = fetch) {
  const auth = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`

  async function post(path: string, body: unknown) {
    let response: Response
    try {
      response = await fetchImpl(`${credentials.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (error) {
      throw new Error(`Sin conexión con ContiMarket (${credentials.url}): ${error instanceof Error ? error.message : error}`)
    }
    if (response.status === 401 || response.status === 403) {
      throw new ContimarketAuthError('ContiMarket rechazó el usuario o la contraseña (CONTIMARKET_USER / CONTIMARKET_PASSWORD en Railway).')
    }
    return { status: response.status, text: await response.text().catch(() => '') }
  }

  return {
    async importProducts(items: ContimarketItem[]): Promise<ImportResult> {
      const { status, text } = await post('/ImportProduct', items)
      if (status >= 200 && status < 300) return { ok: true }
      if (status === 400) return { ok: false, rejected: parseRejected(text), raw: text.slice(0, 2000) }
      throw new Error(`ContiMarket respondió ${status}: ${text.slice(0, 500)}`)
    },
    async deleteImages(codes: string[]): Promise<boolean> {
      const { status } = await post('/ImageManager', codes)
      return status >= 200 && status < 300
    },
  }
}

/** [{ "codigoproducto": "1234", "mensaje": "Producto con Stock Invalido " }] → por código. */
export function parseRejected(text: string): { code: string; message: string }[] {
  try {
    const data = JSON.parse(text)
    const list = Array.isArray(data) ? data : Array.isArray(data?.errors) ? data.errors : []
    return list
      .map((e: Record<string, unknown>) => ({
        code: String(e.codigoproducto ?? e.CodigoProducto ?? e.codigoProducto ?? '').trim(),
        message: String(e.mensaje ?? e.Mensaje ?? e.message ?? '').trim(),
      }))
      .filter((e: { code: string; message: string }) => e.message)
  } catch {
    return []
  }
}
