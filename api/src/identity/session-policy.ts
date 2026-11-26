/** Persist the client category in the server-generated device label, including QR flows. */
export function sessionDevice(device: string, client: unknown): string {
  return client === 'mac' ? `Mac 版 · ${device}` : client === 'pwa' ? `PWA · ${device}` : device
}
export function sessionDays(device: string): 7 | 30 {
  return device.startsWith('Mac 版 · ') || device.startsWith('PWA · ') ? 30 : 7
}
// Native action credentials have their own fixed expiry and remain bound to their parent login.
export const renewalExpiry = `CASE WHEN device='T方舟 快捷指令' THEN expires_at ELSE GREATEST(expires_at,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL (CASE WHEN device LIKE 'Mac 版 · %' OR device LIKE 'PWA · %' THEN 30 ELSE 7 END) DAY)) END`
