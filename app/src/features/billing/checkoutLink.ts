/** Only the opaque ticket controls lookup. URL flags can never approve paying for another user. */
export function checkoutTicket(hash: string): string | null {
  const [path, query] = hash.split('?')
  if (path !== '#/pay/wechat') {
    return null
  }
  const params = new URLSearchParams(query)
  const values = params.getAll('ticket')
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0]!) ? values[0]! : null
}

let pendingTicket: string | null = null
let authenticatedTicket: string | null = null
export function clearCheckoutTicket() {
  pendingTicket = null
  authenticatedTicket = null
}
export function markCheckoutAuthenticated(ticket: string) {
  authenticatedTicket = /^[a-f0-9]{64}$/.test(ticket) ? ticket : null
}
export function takeCheckoutAuthentication(ticket: string) {
  const authenticated = authenticatedTicket === ticket
  authenticatedTicket = null
  return authenticated
}
/** Consume the address before OAuth too, so the pre-redirect history entry is safe to revisit. */
export function captureCheckoutLink() {
  if (location.hash.split('?')[0] !== '#/pay/wechat') {
    return undefined
  }
  const ticket = checkoutTicket(location.hash)
  if (ticket) {
    pendingTicket = ticket
  }
  history.replaceState(null, '', `${location.pathname}${location.search}#/pay/wechat`)
  return ticket ? `#/pay/wechat?ticket=${ticket}` : undefined
}
export function takeCheckoutTicket() {
  captureCheckoutLink()
  const ticket = pendingTicket
  pendingTicket = null
  return ticket
}
