import { configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'
import { aroniumAgentAuth } from '../lib/aronium-agent-auth'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // Agentes viejos (clave secreta de administrador): el catálogo entero y
      // fotos (base64).
      method: ['POST'],
      matcher: '/admin/aronium/*',
      bodyParser: { sizeLimit: '25mb' },
    },
    {
      // Agente del local con su clave propia (lib/aronium-agent-auth.ts).
      matcher: '/aronium-agent/*',
      bodyParser: { sizeLimit: '25mb' },
      middlewares: [aroniumAgentAuth],
    },
  ],
})
