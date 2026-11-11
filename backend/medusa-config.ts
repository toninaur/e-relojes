import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// URL pública del backend. Las fotos de productos se guardan con esta base
// (`<url>/static/...`), así que en el deploy tiene que ser la URL real.
const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'
// Sin Redis (local, demo) Medusa usa sus módulos en memoria. Con REDIS_URL
// pasa eventos, workflows, locks y caché a Redis (tienda en producción).
const REDIS_URL = process.env.REDIS_URL

const redisModules = REDIS_URL
  ? [
      { resolve: '@medusajs/medusa/event-bus-redis', options: { redisUrl: REDIS_URL } },
      { resolve: '@medusajs/medusa/workflow-engine-redis', options: { redis: { redisUrl: REDIS_URL } } },
      {
        resolve: '@medusajs/medusa/locking',
        options: {
          providers: [
            { resolve: '@medusajs/medusa/locking-redis', id: 'locking-redis', is_default: true, options: { redisUrl: REDIS_URL } },
          ],
        },
      },
      {
        resolve: '@medusajs/medusa/caching',
        options: {
          providers: [
            { resolve: '@medusajs/medusa/caching-redis', id: 'caching-redis', is_default: true, options: { redisUrl: REDIS_URL } },
          ],
        },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: { backend_url: `${BACKEND_URL}/static` },
          },
        ],
      },
    },
    ...redisModules,
  ],
})
