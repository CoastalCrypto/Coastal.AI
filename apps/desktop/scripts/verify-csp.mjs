// Verify the desktop webview Content-Security-Policy against the REAL built web
// bundle before trusting it in tauri.conf.json. Serves packages/web/dist over a
// throwaway HTTP server with the CSP applied as a response header, loads it in
// headless Chromium, and fails if the page triggers any CSP violation
// (blocked script/style/font/connect/eval). A failing core backend connection
// is a network error, NOT a CSP violation, so it does not trip this check.
//
// Source of truth: reads app.security.csp from tauri.conf.json. If that is null
// (not yet applied), it verifies CANDIDATE_CSP below — set that, verify, then
// copy it into tauri.conf.json and re-run to confirm the configured value.
//
// Usage: node scripts/verify-csp.mjs   (from packages/desktop)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize } from 'node:path'
import playwright from '../../../packages/core/node_modules/playwright/index.js'
const { chromium } = playwright

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', '..', '..', 'packages', 'web', 'dist')
const CONF = join(__dirname, '..', 'src-tauri', 'tauri.conf.json')

// The policy to verify when tauri.conf.json has no csp set yet.
const CANDIDATE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
}

async function resolveCsp() {
  try {
    const conf = JSON.parse(await readFile(CONF, 'utf8'))
    const csp = conf?.app?.security?.csp
    if (typeof csp === 'string' && csp.trim()) return { csp, source: 'tauri.conf.json' }
  } catch (e) {
    console.error('warning: could not read tauri.conf.json:', e.message)
  }
  return { csp: CANDIDATE_CSP, source: 'CANDIDATE_CSP (not yet applied)' }
}

function startServer(csp) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        let filePath = normalize(join(DIST, urlPath))
        if (!filePath.startsWith(DIST)) { res.statusCode = 403; return res.end('forbidden') }
        let s = await stat(filePath).catch(() => null)
        if (!s || s.isDirectory()) filePath = join(DIST, 'index.html') // SPA fallback
        const body = await readFile(filePath)
        res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream')
        res.setHeader('Content-Security-Policy', csp)
        res.end(body)
      } catch {
        res.statusCode = 500; res.end('error')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const { csp, source } = await resolveCsp()
console.log(`Verifying CSP from ${source}:\n  ${csp}\n`)

const server = await startServer(csp)
const port = server.address().port
const url = `http://127.0.0.1:${port}/`

const violations = []
const browser = await chromium.launch()
const page = await browser.newPage()

// Capture real CSP violations from the page (not network failures).
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    // eslint-disable-next-line no-console
    console.error(`CSP_VIOLATION directive=${e.effectiveDirective} blocked=${e.blockedURI} src=${e.sourceFile || ''}`)
  })
})
page.on('console', (msg) => {
  const t = msg.text()
  if (t.startsWith('CSP_VIOLATION') || /content security policy|refused to (load|execute|apply|connect)/i.test(t)) {
    violations.push(t)
  }
})
page.on('pageerror', (err) => {
  if (/content security policy/i.test(err.message)) violations.push(`pageerror: ${err.message}`)
})

await page.goto(url, { waitUntil: 'load', timeout: 30000 })
// Give the SPA + three.js OceanScene time to mount and run.
await page.waitForTimeout(4000)

await browser.close()
server.close()

if (violations.length) {
  console.error(`\n❌ ${violations.length} CSP violation(s):`)
  for (const v of [...new Set(violations)]) console.error('  - ' + v)
  process.exit(1)
}
console.log('✅ No CSP violations against the built web bundle.')
