import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'

// La raíz del backend (erelojesadmin.up.railway.app) no tiene página propia:
// lleva al panel, que vive en /app.
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.redirect(302, '/app')
}
