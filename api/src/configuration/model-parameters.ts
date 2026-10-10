import type { ConfigurationSnapshot } from '@t-box/shared'
/** Optional parameters are omitted unless explicitly enabled, retaining provider compatibility. */
export function modelParameters(
  snapshot?: ConfigurationSnapshot,
  reasoning = false,
) {
  const values = snapshot?.values || {}
  const effort = values['ai.parameters.reasoningEffort']
  return {
    ...(values['ai.parameters.temperatureEnabled'] === true
      ? { temperature: Number(values['ai.parameters.temperature']) }
      : {}),
    ...(values['ai.parameters.topPEnabled'] === true
      ? { top_p: Number(values['ai.parameters.topP']) }
      : {}),
    ...(reasoning && ['low', 'medium', 'high'].includes(String(effort))
      ? { effort: effort as 'low' | 'medium' | 'high' }
      : {}),
  }
}
