/**
 * Apps use @submit.prevent for local UI actions. Sandbox forms must be enabled
 * for the submit event to reach them; artifact CSP still forbids native form
 * navigation. Popups and top-level navigation remain disallowed.
 */
export const APPLICATION_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads'
