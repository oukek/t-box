import { CalendarHolidayYears1791244822000 } from '@t-box/calendar-server/holiday-migration'
import { LedgerCategoryIcons1791244833000 } from '@t-box/ledger-server/categories/icon-migration'
import { LedgerIconStorage1791244849000 } from '@t-box/ledger-server/categories/icon-storage-migration'
import { LedgerCategoryPresets1791244832000 } from '@t-box/ledger-server/categories/migration'
import {
  LedgerFeatureIntegrity1791244830000,
  LedgerFeatures1791244829000,
  LedgerRecordAttachments1791244831000,
} from '@t-box/ledger-server/features/migration'
import { DataSource } from 'typeorm'
import { getConfig } from '../config.js'
import { entities } from './entities.js'
import { AccountSecurity1791244844000 } from './migrations/AccountSecurity.js'
import { AgentWorkflow1791244823000 } from './migrations/AgentWorkflow.js'
import { AnswerVersions1791244824000 } from './migrations/AnswerVersions.js'
import { ApplicationFiles1791244840000 } from './migrations/ApplicationFiles.js'
import { ApplicationImports1791244834000 } from './migrations/ApplicationImports.js'
import { ApplicationInstallationHealth1791244835000 } from './migrations/ApplicationInstallationHealth.js'
import { ApplicationLifecycleTime1791244821000 } from './migrations/ApplicationLifecycleTime.js'
import { ApplicationPlatform1791244818000 } from './migrations/ApplicationPlatform.js'
import { ApplicationPublicationTime1791244820000 } from './migrations/ApplicationPublicationTime.js'
import { ApplicationPublishing1791244819000 } from './migrations/ApplicationPublishing.js'
import { ApplicationResources1791244803000 } from './migrations/ApplicationResources.js'
import { BillingPayments1791244808000 } from './migrations/BillingPayments.js'
import { CacheWriteUsage1791244811000 } from './migrations/CacheWriteUsage.js'
import { CalendarTime1791244816000 } from './migrations/CalendarTime.js'
import { Categories1791158401000 } from './migrations/Categories.js'
import { ConversationPresentation1791244807000 } from './migrations/ConversationPresentation.js'
import { ConversationResources1791244802000 } from './migrations/ConversationResources.js'
import { ConversationRevision1791244806000 } from './migrations/ConversationRevision.js'
import { CostControl1791244839000 } from './migrations/CostControl.js'
import { CustomerSupport1791244813000 } from './migrations/CustomerSupport.js'
import { DesktopAppearance1791244836000 } from './migrations/DesktopAppearance.js'
import { DesktopLayouts1791244817000 } from './migrations/DesktopLayouts.js'
import { DurableTasks1791244804000 } from './migrations/DurableTasks.js'
import { InitialSchema1791158400000 } from './migrations/InitialSchema.js'
import { LedgerTimestamps1791244801000 } from './migrations/LedgerTimestamps.js'
import { ModelInvocation1791244825000 } from './migrations/ModelInvocation.js'
import { ModelPools1791244847000 } from './migrations/ModelPools.js'
import { Notifications1791244846000 } from './migrations/Notifications.js'
import { Operations1791244838000 } from './migrations/Operations.js'
import { OperationsUtc1791244842000 } from './migrations/OperationsUtc.js'
import { PaymentConfigurationVersion1791244812000 } from './migrations/PaymentConfigurationVersion.js'
import { PaymentQueryThrottle1791244810000 } from './migrations/PaymentQueryThrottle.js'
import { PaymentReconciliation1791244843000 } from './migrations/PaymentReconciliation.js'
import { PaymentRefunds1791244841000 } from './migrations/PaymentRefunds.js'
import { RechargeCatalog1791244815000 } from './migrations/RechargeCatalog.js'
import { RechargeConfiguration1791244814000 } from './migrations/RechargeConfiguration.js'
import { ResourceObjectPaths1791244848000 } from './migrations/ResourceObjectPaths.js'
import { ResourceStorage1791244845000 } from './migrations/ResourceStorage.js'
import { RetireApplicationConfiguration1791244828000 } from './migrations/RetireApplicationConfiguration.js'
import { SharedLedgers1791244800000 } from './migrations/SharedLedgers.js'
import { TaskExecutionKeys1791244805000 } from './migrations/TaskExecutionKeys.js'
import { TaskRecovery1791244837000 } from './migrations/TaskRecovery.js'
import { UnifiedConfiguration1791244827000 } from './migrations/UnifiedConfiguration.js'
import { UsageContextWechat1791244809000 } from './migrations/UsageContextWechat.js'
import { WorkflowPhaseIsolation1791244826000 } from './migrations/WorkflowPhaseIsolation.js'
import 'reflect-metadata'

export function createDataSource(config = getConfig().mysql) {
  const { user, ...options } = config
  return new DataSource({
    type: 'mysql',
    ...options,
    username: user,
    charset: 'utf8mb4_unicode_ci',
    supportBigNumbers: true,
    bigNumberStrings: true,
    entities,
    synchronize: false,
    logging: false,
    migrationsRun: false,
    migrations: [
      InitialSchema1791158400000,
      Categories1791158401000,
      SharedLedgers1791244800000,
      LedgerTimestamps1791244801000,
      ConversationResources1791244802000,
      ApplicationResources1791244803000,
      DurableTasks1791244804000,
      TaskExecutionKeys1791244805000,
      ConversationRevision1791244806000,
      ConversationPresentation1791244807000,
      BillingPayments1791244808000,
      UsageContextWechat1791244809000,
      PaymentQueryThrottle1791244810000,
      CacheWriteUsage1791244811000,
      PaymentConfigurationVersion1791244812000,
      CustomerSupport1791244813000,
      RechargeConfiguration1791244814000,
      RechargeCatalog1791244815000,
      CalendarTime1791244816000,
      DesktopLayouts1791244817000,
      ApplicationPlatform1791244818000,
      ApplicationPublishing1791244819000,
      ApplicationPublicationTime1791244820000,
      ApplicationLifecycleTime1791244821000,
      CalendarHolidayYears1791244822000,
      AgentWorkflow1791244823000,
      AnswerVersions1791244824000,
      ModelInvocation1791244825000,
      WorkflowPhaseIsolation1791244826000,
      UnifiedConfiguration1791244827000,
      RetireApplicationConfiguration1791244828000,
      LedgerFeatures1791244829000,
      LedgerFeatureIntegrity1791244830000,
      LedgerRecordAttachments1791244831000,
      LedgerCategoryPresets1791244832000,
      LedgerCategoryIcons1791244833000,
      ApplicationImports1791244834000,
      ApplicationInstallationHealth1791244835000,
      DesktopAppearance1791244836000,
      TaskRecovery1791244837000,
      Operations1791244838000,
      CostControl1791244839000,
      ApplicationFiles1791244840000,
      PaymentRefunds1791244841000,
      OperationsUtc1791244842000,
      PaymentReconciliation1791244843000,
      AccountSecurity1791244844000,
      ResourceStorage1791244845000,
      Notifications1791244846000,
      ModelPools1791244847000,
      ResourceObjectPaths1791244848000,
      LedgerIconStorage1791244849000,
    ],
    migrationsTransactionMode: 'none',
    migrationsTableName: 'schema_migrations',
    extra: { connectionLimit: 10, waitForConnections: true, queueLimit: 100 },
  })
}
