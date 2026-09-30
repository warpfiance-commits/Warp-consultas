// Publica el sistema completo:
//   npm run deploy
//   node deploy.mjs --paginas   (solo las páginas; lo usa GitHub Actions)
//
//   1. server.js y demás  →  GitHub  →  Render (se redespliega solo)
//   2. index.html, admin.html  →  Hostinger por FTPS  →  form.warpfinance.co
//   3. Comprueba que lo publicado sea de verdad lo que acabamos de subir.
//
// Las credenciales salen de .env.deploy, que no sube a GitHub.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGINAS = ['index.html', 'admin.html'];
const SITIO = 'https://form.warpfinance.co';

const c = { ok: '\x1b[32m', mal: '\x1b[31m', dim: '\x1b[90m', bold: '\x1b[1m', off: '\x1b[0m' };
const log = (m = '') => console.log(m);
const paso = (m) => log(`\n${c.bold}${m}${c.off}`);
const bien = (m) => log(`  ${c.ok}ok${c.off}  ${m}`);
const mal = (m) => log(`  ${c.mal}falló${c.off}  ${m}`);

function salirCon(mensaje) {
  log(`\n${c.mal}Publicación detenida.${c.off} ${mensaje}\n`);
  process.exit(1);
}

function leerEnv() {
  const f = path.join(ROOT, '.env.deploy');
  // En GitHub Actions no hay .env.deploy: los datos llegan como secrets.
  if (!fs.existsSync(f) && (process.env.GITHUB_ACTIONS || process.env.FTP_HOST)) {
    const env = {};
    for (const k of ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'FTP_DIR']) env[k] = (process.env[k] || '').trim();
    const faltan = Object.keys(env).filter((k) => !env[k]);
    if (faltan.length) salirCon(`Faltan los secrets de GitHub: ${faltan.join(', ')}`);
    return env;
  }
  if (!fs.existsSync(f)) {
    salirCon(
      'Falta .env.deploy.\n' +
        '  Copia .env.deploy.example como .env.deploy y llena los datos de FTP\n' +
        '  (hPanel de Hostinger → Archivos → Cuentas FTP).',
    );
  }
  const env = {};
  for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const faltan = ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'FTP_DIR'].filter((k) => !env[k]);
  if (faltan.length) salirCon(`En .env.deploy falta llenar: ${faltan.join(', ')}`);
  return env;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

// ── 1. Backend: GitHub → Render ──────────────────────────────────────────
function publicarBackend() {
  paso('1. Backend → GitHub → Render');

  const sucio = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  if (sucio) {
    log(`${c.dim}${sucio}${c.off}`);
    salirCon('Hay cambios sin guardar. Haz commit antes de publicar.');
  }

  const pendientes = spawnSync('git', ['log', '--oneline', 'origin/main..HEAD'], {
    cwd: ROOT, encoding: 'utf8',
  }).stdout.trim();

  if (!pendientes) {
    bien('GitHub ya está al día, no hay nada que subir');
    return false;
  }

  log(`${c.dim}${pendientes}${c.off}`);
  const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: ROOT, encoding: 'utf8' });
  if (push.status !== 0) {
    log(`${c.dim}${push.stderr}${c.off}`);
    salirCon('No se pudo subir a GitHub.');
  }
  bien('subido a GitHub · Render redesplegará solo (tarda ~1 min)');
  return true;
}

// ── 2. Páginas: FTPS → Hostinger ─────────────────────────────────────────
function publicarPaginas(env) {
  paso('2. Páginas → Hostinger');

  const dir = env.FTP_DIR.replace(/^\/+|\/+$/g, '');
  const subidas = [];

  for (const pagina of PAGINAS) {
    const local = path.join(ROOT, pagina);
    if (!fs.existsSync(local)) salirCon(`No existe ${pagina}`);

    const destino = `ftp://${env.FTP_HOST}/${dir}/${pagina}`;
    const r = spawnSync(
      'curl',
      ['-K', '-', '--ssl', '--ftp-create-dirs', '-sS', '--connect-timeout', '20', '-T', local, destino],
      // La contraseña va por stdin, no en los argumentos: así no queda
      // visible en la lista de procesos del sistema.
      { input: `user = "${env.FTP_USER}:${env.FTP_PASS}"\n`, encoding: 'utf8' },
    );

    if (r.status !== 0) {
      mal(`${pagina} — ${(r.stderr || '').trim().split('\n').pop()}`);
      salirCon('Revisa FTP_HOST, FTP_USER, FTP_PASS y FTP_DIR en .env.deploy.');
    }
    const local_sha = sha(fs.readFileSync(local));
    bien(`${pagina} subido  ${c.dim}${local_sha}${c.off}`);
    subidas.push({ pagina, local_sha });
  }
  return subidas;
}

// ── 3. Comprobar que lo publicado es lo nuestro ──────────────────────────
async function comprobar(subidas) {
  paso('3. Comprobando el sitio publicado');

  let todoBien = true;
  for (const { pagina, local_sha } of subidas) {
    const url = `${SITIO}/${pagina === 'index.html' ? '' : pagina}`;
    try {
      const resp = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      const publicado = sha(Buffer.from(await resp.arrayBuffer()));
      if (publicado === local_sha) {
        bien(`${url} coincide`);
      } else {
        // Casi siempre es la caché de Hostinger, que tarda un poco en soltar.
        mal(`${url} todavía muestra otra versión ${c.dim}(${publicado} ≠ ${local_sha})${c.off}`);
        todoBien = false;
      }
    } catch (e) {
      mal(`${url} no responde — ${e.message}`);
      todoBien = false;
    }
  }
  return todoBien;
}

// ── 4. Salud del backend ─────────────────────────────────────────────────
async function salud() {
  paso('4. Backend en Render');
  try {
    const r = await fetch('https://warp-consultas.onrender.com/health', { signal: AbortSignal.timeout(90000) });
    const j = await r.json();
    bien(`respondiendo · base de datos: ${j.db} · solicitudes: ${j.solicitudes}`);
  } catch (e) {
    mal(`no responde — ${e.message}`);
    log(`  ${c.dim}Si acabas de subir, Render puede tardar ~1 min en reiniciar.${c.off}`);
  }
}

const soloPaginas = process.argv.includes('--paginas');
const env = leerEnv();
log(`\n${c.bold}Publicando warp-consultas${c.off}`);
if (!soloPaginas) publicarBackend();
const subidas = publicarPaginas(env);
const ok = await comprobar(subidas);
if (!soloPaginas) await salud();

log(
  ok
    ? `\n${c.ok}Publicado.${c.off} ${SITIO} y ${SITIO}/admin.html ya tienen los cambios.\n`
    : `\n${c.mal}Publicado con avisos.${c.off} Revisa lo marcado arriba; si es la caché, espera un minuto y abre el sitio.\n`,
);
