import type { AppRelease } from '@t-box/app-contracts'
import { calculatorManifest } from '@t-box/calculator-contracts'

export const calculatorRelease: AppRelease = {
  appId: 'calculator',
  releaseId: 'calculator-1.0.0',
  manifest: calculatorManifest,
  protocol: 1,
  kind: 'system',
  platforms: ['web', 'android', 'ios'],
  runtime: {
    type: 'web',
    entryUrl: 'http://localhost:5176/',
    integrity: 'sha256-' + '0'.repeat(64),
  },
  backend: { type: 'local', binding: 'calculator' },
  permissions: ['calculator.calculate', 'storage'],
  clientTools: ['calculator_fill_expression'],
  defaultInstalled: true,
}
