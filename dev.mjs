// Servidor de desarrollo con recarga automática (sin dependencias).
//   npm run dev  →  http://localhost:5173
//
// Sirve index.html y admin.html desde esta carpeta y recarga el navegador
// solo al guardar. La API sigue apuntando a Render, igual que en producción,
// así que lo que ves acá es exactamente lo que verás publicado.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 5180 y no 5173: ese lo ocupa el Vite de warpfinance.
const PORT = process.env.DEV_PORT || 5180;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Script que se inyecta en cada HTML: escucha avisos de cambio y recarga.
const RELOAD_SNIPPET = `
<script>
(() => {
  let caido = false;
  const conectar = () => {
    const es = new EventSource('/__reload');
    es.onmessage = () => location.reload();
    es.onopen = () => { if (caido) location.reload(); };
    es.onerror = () => { caido = true; es.close(); setTimeout(conectar, 1000); };
  };
  conectar();
})();
</script>`;

/** @type {Set<import('node:http').ServerResponse>} */
const clientes = new Set();

function avisarRecarga() {
  for (const res of clientes) res.write('data: reload\n\n');
}

// Evita recargas múltiples cuando el editor guarda en varios pasos.
let pendiente = null;
fs.watch(ROOT, { recursive: true }, (_evento, archivo) => {
  if (!archivo) return;
  const f = archivo.replaceAll('\\', '/');
  if (f.startsWith('.git/') || f.startsWith('node_modules/') || f.includes('~')) return;
  if (!/\.(html|css|js|json|svg|png|jpe?g|webp)$/i.test(f)) return;
  clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    console.log(`  ↻ ${f}`);
    avisarRecarga();
  }, 80);
});

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }

  // Mismas rutas que server.js en producción.
  let rel = url === '/' ? 'index.html' : url === '/admin' ? 'admin.html' : url.slice(1);

  // Nunca dejar salir de la carpeta del proyecto.
  const archivo = path.join(ROOT, rel);
  if (!archivo.startsWith(ROOT)) {
    res.writeHead(403).end('Prohibido');
    return;
  }

  fs.readFile(archivo, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>404</h2><p>No existe <code>${rel}</code></p>`);
      return;
    }
    const ext = path.extname(archivo).toLowerCase();
    const tipo = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      let html = buf.toString('utf8');
      html = html.includes('</body>')
        ? html.replace(/<\/body>/i, RELOAD_SNIPPET + '\n</body>')
        : html + RELOAD_SNIPPET;
      buf = Buffer.from(html, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`\n  Warp consultas · desarrollo\n`);
  console.log(`  Formulario   http://localhost:${PORT}/`);
  console.log(`  Admin        http://localhost:${PORT}/admin`);
  console.log(`\n  API          https://warp-consultas.onrender.com  (datos reales)`);
  console.log(`  Guarda un archivo y el navegador se recarga solo.\n`);
});
