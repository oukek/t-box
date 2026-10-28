import type { DataSource } from 'typeorm'
import type { ConfigurationService } from '../admin/service.js'
import type { WechatAccountConfiguration } from '../identity/wechat-configuration.js'
import type { MemoryCache } from '../memory/cache.js'
import type { PaymentConfiguration } from '../payments/configuration.js'
import type { PaymentGateway } from '../payments/gateway.js'
import type { WechatAuthorization } from '../payments/wechat-authorization.js'
import { BabyDiaryService } from '@t-box/baby-diary-server'
import { calculatorBackend } from '@t-box/calculator-server'
import { CalendarService } from '@t-box/calendar-server/service'
import { converterBackend } from '@t-box/converter-server'
import { FinanceService } from '@t-box/ledger-server/finance/service'
import { LedgerAccess } from '@t-box/ledger-server/ledgers/access'
import { createLedgerRows } from '@t-box/ledger-server/ledgers/create'
import { LedgerService } from '@t-box/ledger-server/ledgers/service'
import { StatisticsService } from '@t-box/ledger-server/statistics/service'
import { TimeService } from '@t-box/time-server/service'
import { ResourceAccessRegistry } from '../agent/access.js'
import { ApplicationCatalogMonitor } from '../application-platform/catalog-monitor.js'
import {
  builtinKinds,
  deployedApplications,
  deploymentIssues,
} from '../application-platform/catalog.js'
import { HostDownloadConfiguration } from '../application-platform/download-settings.js'
import { ApplicationPlatform } from '../application-platform/service.js'
import { ApplicationMarketPolicy } from '../application-platform/settings.js'
import { createApplicationResourceAdapters } from '../applications/registry.js'
import { ProviderConcurrency } from '../billing/concurrency.js'
import { BillingPricingService } from '../billing/pricing.js'
import { BillingService } from '../billing/service.js'
import { ConversationArchive } from '../chat/archive.js'
import { DesktopService } from '../desktop/service.js'
import { AvatarService } from '../identity/avatars.js'
import { AccountSecurityService } from '../identity/security.js'
import { IdentityService } from '../identity/service.js'
import { WechatLoginService } from '../identity/wechat-login.js'
import { MemoryService } from '../memory/store.js'
import { NotificationService } from '../notifications/service.js'
import { OperationsService } from '../operations/service.js'
import { WechatCheckoutLinks } from '../payments/checkout-links.js'
import { PaymentReconciliationService } from '../payments/reconciliation.js'
import { PaymentRefundService } from '../payments/refunds.js'
import { PaymentService } from '../payments/service.js'
import { ImageTools } from '../resources/images.js'
import { PrivateApplicationFiles } from '../resources/private-files.js'
import { ResourceService } from '../resources/service.js'
import { CustomerSupportService } from '../support/service.js'
import { TaskStore } from '../tasks/store.js'

export class PlatformService {
  readonly memory: MemoryService
  readonly applicationCatalogUpdates: ApplicationCatalogMonitor
  readonly applications: ApplicationPlatform
  readonly desktop: DesktopService
  readonly privateFiles: PrivateApplicationFiles
  readonly babyDiary: BabyDiaryService
  readonly calendar: CalendarService
  readonly time: TimeService
  readonly pricing: BillingPricingService
  readonly support: CustomerSupportService
  readonly billing: BillingService
  readonly providerConcurrency: ProviderConcurrency
  readonly payments: PaymentService
  readonly refunds: PaymentRefundService
  readonly paymentReconciliation: PaymentReconciliationService
  readonly tasks: TaskStore
  readonly notifications: NotificationService
  readonly operations: OperationsService
  readonly identity: IdentityService
  readonly wechatLogin?: WechatLoginService
  readonly avatars: AvatarService
  readonly checkoutLinks?: WechatCheckoutLinks
  readonly accountSecurity: AccountSecurityService
  readonly access: LedgerAccess
  readonly ledgers: LedgerService
  readonly statistics: StatisticsService
  readonly finance: FinanceService
  readonly resources: ResourceService
  readonly conversations: ConversationArchive
  readonly images: ImageTools
  constructor(
    source: DataSource,
    configuration?: ConfigurationService,
    gateway?: PaymentGateway,
    readonly paymentConfiguration?: PaymentConfiguration,
    readonly wechatAuthorization?: WechatAuthorization,
    resources?: ResourceService,
    memoryCache?: MemoryCache,
    wechatAccount?: WechatAccountConfiguration,
  ) {
    this.memory = new MemoryService(
      source,
      memoryCache,
      configuration?.configuration,
    )
    this.applicationCatalogUpdates = new ApplicationCatalogMonitor(source)
    this.applications = new ApplicationPlatform(
      source,
      deployedApplications,
      builtinKinds,
      { shellMigrations: ['ledger', 'calendar', 'time'], deploymentIssues, marketPolicy: new ApplicationMarketPolicy(source, configuration?.cache), downloads: new HostDownloadConfiguration(source, configuration?.cache) },
    )
    this.privateFiles = new PrivateApplicationFiles(source, this.applications)
    this.babyDiary = new BabyDiaryService(
      source,
      this.privateFiles.port('baby-diary'),
    )
    this.privateFiles.bind('baby-diary', this.babyDiary.mediaPolicy)
    this.applications.bind('baby-diary', this.babyDiary.backend())
    this.applications.bind('calculator', calculatorBackend)
    this.applications.bind('converter', converterBackend)
    this.desktop = new DesktopService(source, this.applications)
    this.calendar = new CalendarService(source, configuration?.cache)
    this.time = new TimeService(source)
    this.support = new CustomerSupportService(source, configuration?.cache)
    this.billing = new BillingService(
      source,
      configuration?.configuration,
      configuration?.cache,
    )
    this.pricing = new BillingPricingService(this.billing.catalog)
    this.providerConcurrency = new ProviderConcurrency(source)
    this.payments = new PaymentService(source, this.billing, gateway)
    if (paymentConfiguration) {
      this.checkoutLinks = new WechatCheckoutLinks(source, this.payments, paymentConfiguration)
    }
    this.refunds = new PaymentRefundService(source, this.billing, gateway)
    this.paymentReconciliation = new PaymentReconciliationService(
      source,
      gateway,
      paymentConfiguration,
    )
    this.tasks = new TaskStore(source)
    this.notifications = new NotificationService(source)
    this.operations = new OperationsService(source)
    // Runtime composition always supplies the WeChat account. Internal service
    // fixtures can construct the platform without an external identity provider.
    this.identity = new IdentityService(source, (db, userId) =>
      createLedgerRows(db, userId, { name: '我的账本', template: 'daily' }), wechatAccount ? 'wechat' : 'internal')
    if (wechatAccount) {
      this.wechatLogin = new WechatLoginService(wechatAccount, this.identity)
    }
    this.accountSecurity = new AccountSecurityService(this.identity)
    this.access = new LedgerAccess(source, this.identity)
    this.ledgers = new LedgerService(this.access)
    this.statistics = new StatisticsService(this.access)
    this.finance = new FinanceService(this.access, this.statistics)
    this.resources = resources ?? new ResourceService(source)
    this.avatars = new AvatarService(this.identity, this.resources)
    this.conversations = new ConversationArchive(
      source,
      new ResourceAccessRegistry(createApplicationResourceAdapters(this)),
      this.memory,
    )
    this.images = new ImageTools(
      this.resources,
      configuration,
      this.billing,
      this.providerConcurrency,
    )
  }
}
