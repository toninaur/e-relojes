import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaContainer } from '@medusajs/framework'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ARONIUM_MODULE } from '../modules/aronium'
import type AroniumModuleService from '../modules/aronium/service'

// Clave propia del agente de Aronium. Solo sirve para las rutas
// /aronium-agent/* (sincronizar y ventas web): si alguien la saca de la PC del
// local, no puede administrar la tienda (a diferencia de una clave secreta de
// administrador). En la base se guarda solo su hash SHA-256.

const PREFIX = 'arag_'

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Panel → Aronium → "Generar clave": crea una nueva (la anterior deja de andar). */
export async function generateAgentToken(container: MedusaContainer): Promise<string> {
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const token = `${PREFIX}${randomBytes(32).toString('hex')}`
  const data = { token_hash: hash(token), token_created_at: new Date() }
  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  if (agent) await aronium.updateAroniumAgents({ id: agent.id, ...data })
  else await aronium.createAroniumAgents(data)
  return token
}

/** Middleware de /aronium-agent/*: `Authorization: Bearer arag_…`. */
export async function aroniumAgentAuth(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token.startsWith(PREFIX)) {
    res.status(401).json({ message: 'Falta la clave del conector (Authorization: Bearer arag_…).' })
    return
  }
  const aronium: AroniumModuleService = req.scope.resolve(ARONIUM_MODULE)
  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  const expected = agent?.token_hash ? Buffer.from(agent.token_hash, 'hex') : null
  const given = Buffer.from(hash(token), 'hex')
  if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    res.status(401).json({ message: 'La clave del conector no es válida. Generá una nueva en el panel → Aronium.' })
    return
  }
  next()
}
