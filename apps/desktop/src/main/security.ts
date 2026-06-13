import { session } from 'electron'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Dev needs unsafe-inline/unsafe-eval (Vite injects styles, HMR uses eval) plus
// the localhost websocket for hot reload. Prod is locked down: the renderer
// never talks to the network directly — all API traffic goes through the main
// process over IPC — so connect-src stays 'self'.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
].join('; ')

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ')

export function installCsp(): void {
  const csp = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
