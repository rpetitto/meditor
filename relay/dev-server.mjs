// Run the relay Worker locally under Node (no Cloudflare needed). Used by the tests.
//
//   GLIDE_WEBHOOK_URL=… GLIDE_TOKEN=… node relay/dev-server.mjs   # http://127.0.0.1:8787
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import worker from './src/worker.js';

export function startRelay({ env, port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { GLIDE_WEBHOOK_URL, GLIDE_TOKEN, ALLOWED_ORIGINS, PORT = '8787' } = process.env;
  const server = await startRelay({ env: { GLIDE_WEBHOOK_URL, GLIDE_TOKEN, ALLOWED_ORIGINS }, port: Number(PORT) });
  console.log(`mEditor relay on http://127.0.0.1:${server.address().port} (configured: ${Boolean(GLIDE_WEBHOOK_URL && GLIDE_TOKEN)})`);
}
