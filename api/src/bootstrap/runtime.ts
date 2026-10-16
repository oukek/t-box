import { createCategoryRepository } from '@t-box/ledger-server/categories/repository'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createVault, loadEncryptionKey } from '../admin/crypto.js'
import { DatabaseChatProvider } from '../admin/runtime.js'
import { ConfigurationService } from '../admin/service.js'
import { AdminStore } from '../admin/store.js'
import { createApp } from '../app.js'
import { getConfig } from '../config.js'
import { ConfigurationCache } from '../configuration/cache.js'
import { createDatabase } from '../database.js'
import { PaymentConfiguration } from '../payments/configuration.js'
import { WechatGateway } from '../payments/wechat.js'
import { PlatformService } from '../platform/service.js'

export async function createRuntime(worker: boolean) {
  const config = getConfig()
  const database = await createDatabase(config)
  const vault = createVault(loadEncryptionKey())
  const configurationCache = new ConfigurationCache(
    database.redis,
    `t-box:${config.mysql.database}`,
  )
  const paymentConfiguration = new PaymentConfiguration(
    database.source,
    vault,
    configurationCache,
  )
  const gateway = new WechatGateway(paymentConfiguration)
  const administration = new ConfigurationService(
    new AdminStore(database.source),
    vault,
    configurationCache,
  )
  const platform = new PlatformService(
    database.source,
    administration,
    gateway,
    paymentConfiguration,
    gateway.authorization,
  )
  const app = createApp({
    taskWorker: worker,
    administration,
    platform,
    trustedProxies: config.trustedProxies,
    bills: createBillRepository(database.source),
    categories: createCategoryRepository(database.source),
    health: database.health,
    close: database.close,
    corsOrigins: config.corsOrigins,
    adminOrigins: config.adminOrigins,
    chatProvider: new DatabaseChatProvider(
      administration,
      platform.billing,
      platform.providerConcurrency,
    ),
    logger: {
      level: 'info',
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url?.split('?')[0],
          id: request.id,
        }),
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        'accountPassword',
        'currentPassword',
        'newPassword',
        'authToken',
        'recoveryCode',
        'codes',
        '*.password',
        'MYSQL_PASSWORD',
        'REDIS_PASSWORD',
        'OPENAI_API_KEY',
        'token',
        '*.token',
      ],
    },
  })
  return { app, config }
}
