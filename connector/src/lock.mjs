import { createHash } from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ROOT } from './config.mjs'

// Un solo agente por carpeta: la tarea programada y alguien que corre
// "npm start" a mano a la vez escribirían state.json los dos. El candado es un
// "named pipe" de Windows (un socket en otros sistemas): si el proceso muere,
// el sistema lo libera solo, sin archivos que limpiar ni números de proceso
// reutilizados.

const id = createHash('sha256').update(ROOT.toLowerCase()).digest('hex').slice(0, 16)
const address = process.platform === 'win32' ? `\\\\.\\pipe\\sincronizador-aronium-${id}` : path.join(os.tmpdir(), `sincronizador-aronium-${id}.sock`)

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end())
    server.once('error', (error) => resolve(error.code ?? 'error'))
    server.listen(address, () => {
      // No impide que el proceso termine (--once).
      server.unref()
      resolve('ok')
    })
  })
}

/** ¿Hay un agente vivo escuchando? */
function alive() {
  return new Promise((resolve) => {
    const socket = net.connect(address, () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** @returns {Promise<boolean>} true si este proceso quedó como el único agente. */
export async function acquireLock() {
  const first = await listen()
  if (first === 'ok') return true
  // Fuera de Windows, un socket de un proceso que murió queda como archivo.
  if (process.platform !== 'win32' && first === 'EADDRINUSE' && !(await alive())) {
    const fs = await import('node:fs')
    fs.rmSync(address, { force: true })
    return (await listen()) === 'ok'
  }
  return false
}
