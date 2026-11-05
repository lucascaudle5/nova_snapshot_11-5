/* global URL, process */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const readJson = async (p) => JSON.parse(await readFile(resolve(root, p), 'utf8'))
// Room convention: artifacts/dist/<room>.html is served with artifacts/fixtures/<room>.json and the room's own fake host artifacts/<room>/host.js.
// Habits predates it and keeps replies.json + harness/host-app.js. Any other artifact is the plain selftest harness (no app host).
const roomOf = (artifact) => { const prefix = 'artifacts/dist/', suffix = '.html'; if (!artifact.startsWith(prefix) || !artifact.endsWith(suffix)) return null; const name = artifact.slice(prefix.length, -suffix.length); return /^[a-z][a-z0-9_-]{0,31}$/.test(name) ? name : null }
const port = Number(process.env.NOVA_HARNESS_PORT || 4285)
const safe = (p) => { const out = resolve(root, p); if (!relative(root, out) || relative(root, out).startsWith('..' + sep)) throw new Error('artifact path is outside workspace'); return out }
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(404).end(); return }
  if (url.pathname === '/health') { res.writeHead(200).end('ok'); return }
  if (url.pathname.startsWith('/assets/')) {
    try { const asset = await readFile(safe('docs/design/mockup-v1-habits' + url.pathname)); res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }).end(asset) }
    catch { res.writeHead(404).end() }
    return
  }
  const artifact = url.searchParams.get('artifact') || 'artifacts/harness/selftest.html'
  let html
  try { html = await readFile(safe(artifact), 'utf8') } catch { res.writeHead(404).end('Artifact not found'); return }
  const room = roomOf(artifact)
  let fixtures, roomHost = ''
  try {
    fixtures = await readJson(room && room !== 'habits' ? `artifacts/fixtures/${room}.json` : 'artifacts/fixtures/replies.json')
    if (room && room !== 'habits') roomHost = await readFile(safe(`artifacts/${room}/host.js`), 'utf8')
  } catch { res.writeHead(500).end(`Room ${room} needs artifacts/fixtures/${room}.json and artifacts/${room}/host.js`); return }
  const cfg = { ...Object.fromEntries(url.searchParams), app: Boolean(room) }
  const boot = `window.__NOVA_HARNESS_CONFIG__=${JSON.stringify(cfg)};window.__NOVA_HARNESS_FIXTURES__=${JSON.stringify(fixtures)};`
  html = html.replace('/* NOVA_KIT_CSS */', await readFile(safe('artifacts/kit/nova-kit.css'), 'utf8'))
    .replace('/* NOVA_KIT_JS */', await readFile(safe('artifacts/kit/nova-kit.js'), 'utf8'))
    .replace('/* NOVA_HOST_BOOT */', boot + await readFile(safe('artifacts/harness/host.js'), 'utf8') + (room === 'habits' ? await readFile(safe('artifacts/harness/host-app.js'), 'utf8') : roomHost) + `\nvar w=Number((window.__NOVA_HARNESS_CONFIG__||{}).width);if(w>0)document.querySelector('.nova-artifact').style.maxWidth=Math.min(1680,w)+'px';`)
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data:; connect-src 'none'; font-src https://fonts.gstatic.com" })
  res.end(html)
})
server.listen(port, '127.0.0.1')
process.on('SIGINT', () => server.close(() => process.exit(0)))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
