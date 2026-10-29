// Copia los datos de la base vieja (Neon) a la nueva (Supabase).
// Uso: ORIGEN_URL=... DESTINO_URL=... node migrar-base.mjs
// Lo corre el workflow "Migrar base de datos" con los secrets de GitHub.
//
// - No borra nada en ninguna de las dos bases.
// - Se puede repetir: lo que ya está en destino (mismo id) se salta.
// - Las tablas las crea server.js al arrancar; aquí solo se copian filas
//   de las columnas que existen en ambos lados.
// - Usuarios del panel: si el email ya existe en destino, se le pone la
//   contraseña y el estado que tenía en origen.
import pg from 'pg';

const { ORIGEN_URL, DESTINO_URL } = process.env;
if (!ORIGEN_URL || !DESTINO_URL) { console.error('Faltan ORIGEN_URL y/o DESTINO_URL'); process.exit(1); }

const conectar = url => new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const origen = conectar(ORIGEN_URL), destino = conectar(DESTINO_URL);

async function columnas(cli, tabla) {
  const r = await cli.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [tabla]);
  return new Map(r.rows.map(c => [c.column_name, c.data_type]));
}

async function copiar(tabla, conflicto) {
  const co = await columnas(origen, tabla), cd = await columnas(destino, tabla);
  if (!co.size) { console.log(`${tabla}: no existe en origen, se salta`); return; }
  if (!cd.size) throw new Error(`${tabla} no existe en destino: ¿arrancó el servidor con la base nueva?`);
  const cols = [...co.keys()].filter(c => cd.has(c));
  const faltan = [...co.keys()].filter(c => !cd.has(c));
  if (faltan.length) console.log(`${tabla}: columnas solo en origen (no se copian): ${faltan.join(', ')}`);

  const { rows } = await origen.query(`SELECT ${cols.map(c => `"${c}"`).join(',')} FROM ${tabla}`);
  let nuevas = 0;
  for (const fila of rows) {
    const valores = cols.map(c => {
      const v = fila[c];
      // pg convierte arrays de JS en arrays de Postgres; en columnas JSON van como texto
      return (cd.get(c) === 'json' || cd.get(c) === 'jsonb') && v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const r = await destino.query(
      `INSERT INTO ${tabla} (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ${conflicto}`,
      valores);
    nuevas += r.rowCount;
  }
  console.log(`${tabla}: ${rows.length} en origen, ${nuevas} copiadas o actualizadas`);
}

try {
  await origen.connect(); await destino.connect();
  await copiar('solicitudes', 'ON CONFLICT DO NOTHING');
  await copiar('solicitudes_juridica', 'ON CONFLICT DO NOTHING');
  await copiar('auditoria', 'ON CONFLICT DO NOTHING');
  await copiar('admin_usuarios',
    'ON CONFLICT (email) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, nombre = EXCLUDED.nombre, activo = EXCLUDED.activo');
  // Las sesiones no se copian: cada quien vuelve a iniciar sesión.
  console.log('Migración terminada.');
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  await origen.end().catch(() => {}); await destino.end().catch(() => {});
}
