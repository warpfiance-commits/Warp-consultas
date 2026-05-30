const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Documentos locales (PDFs) ─────────────────────────────────────────────────
const DOCS_DIR = path.join(__dirname, 'documentos');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

// ── Credenciales ──────────────────────────────────────────────────────────────
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME || 'dtoq5nbz4';
const API_KEY     = process.env.CLOUDINARY_API_KEY    || '985348958691353';
const API_SECRET  = process.env.CLOUDINARY_API_SECRET || 'N8mnqMCA_xVtSzxL4p13YVvhnLM';
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'WarpAdmin2024!';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'warp-token-secreto-2024';

// ── PostgreSQL (con manejo seguro) ────────────────────────────────────────────
let pool = null;
let dbReady = false;

function initPool() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('⚠️  DATABASE_URL no definida. Arrancando sin DB...');
    return;
  }
  pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
  });
  pool.on('error', (err) => {
    console.error('Pool error:', err.message);
  });
}

async function initDB() {
  if (!pool) return false;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitudes (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        radicado              TEXT UNIQUE NOT NULL,
        estado                TEXT NOT NULL DEFAULT 'RADICADA',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tipo_documento        TEXT, num_documento TEXT,
        primer_nombre         TEXT, segundo_nombre TEXT,
        primer_apellido       TEXT, segundo_apellido TEXT,
        fecha_nacimiento      TEXT, pais_nacimiento TEXT,
        ciudad_nacimiento     TEXT, genero TEXT,
        celular               TEXT, telefono_alt TEXT,
        email                 TEXT, email_alt TEXT,
        departamento          TEXT, ciudad TEXT,
        barrio                TEXT, direccion TEXT,
        tipo_vivienda         TEXT, tiempo_vivienda TEXT,
        ingresos_mensuales         NUMERIC, fuente_ingresos TEXT,
        ingresos_adicionales       NUMERIC, concepto_ingresos_ad TEXT,
        egresos_mensuales          NUMERIC, obligaciones_financieras NUMERIC,
        banco TEXT, tipo_cuenta TEXT, numero_cuenta TEXT, otras_cuentas TEXT,
        monto_solicitado      NUMERIC, plazo TEXT, garantia TEXT, destino_credito TEXT,
        situacion_laboral     TEXT, sector_economico TEXT,
        empresa TEXT, nit_empresa TEXT, cargo TEXT,
        antiguedad TEXT, tipo_contrato TEXT,
        telefono_trabajo TEXT, direccion_trabajo TEXT,
        estado_civil TEXT, nivel_educativo TEXT, numero_dependientes TEXT,
        ref_nombre TEXT, ref_parentesco TEXT, ref_celular TEXT, ref_adicional TEXT,
        declaracion_veracidad     BOOLEAN DEFAULT FALSE,
        autorizacion_centrales    BOOLEAN DEFAULT FALSE,
        autorizacion_datos        BOOLEAN DEFAULT FALSE,
        declaracion_sarlaft       BOOLEAN DEFAULT FALSE,
        declaracion_pep           BOOLEAN DEFAULT FALSE,
        autorizacion_debito       BOOLEAN DEFAULT FALSE,
        firma_electronica         TEXT,
        documentos            JSONB DEFAULT '{}',
        nota_analista         TEXT, analista TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auditoria (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        solicitud_id  UUID REFERENCES solicitudes(id) ON DELETE CASCADE,
        accion        TEXT NOT NULL,
        usuario       TEXT NOT NULL DEFAULT 'sistema',
        detalle       TEXT DEFAULT '',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sol_estado ON solicitudes(estado);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sol_created ON solicitudes(created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_sol ON auditoria(solicitud_id);`);
    dbReady = true;
    console.log('✅ PostgreSQL tablas listas');
    return true;
  } catch(e) {
    console.error('❌ Error iniciando DB:', e.message);
    return false;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use((req, res, next) => {
  console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}`);
  next();
});

const requireDB = (req, res, next) => {
  if (!dbReady) return res.status(503).json({ error: 'Base de datos no disponible. Contacte al administrador.' });
  next();
};
const authAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'No autorizado' });
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function generarRadicado() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const rand = Math.floor(Math.random()*9000)+1000;
  return `WRP-${yy}${mm}${dd}-${rand}`;
}

async function auditLog(solicitudId, accion, usuario, detalle) {
  try {
    await pool.query(
      `INSERT INTO auditoria (solicitud_id, accion, usuario, detalle) VALUES ($1,$2,$3,$4)`,
      [solicitudId, accion, usuario || 'sistema', detalle || '']
    );
  } catch(e) { console.error('auditLog error:', e.message); }
}

function rowToSolicitud(r) {
  if (!r) return null;
  return {
    id: r.id, radicado: r.radicado, estado: r.estado,
    createdAt: r.created_at, updatedAt: r.updated_at,
    tipoDocumento: r.tipo_documento, numDocumento: r.num_documento,
    primerNombre: r.primer_nombre, segundoNombre: r.segundo_nombre,
    primerApellido: r.primer_apellido, segundoApellido: r.segundo_apellido,
    fechaNacimiento: r.fecha_nacimiento, paisNacimiento: r.pais_nacimiento,
    ciudadNacimiento: r.ciudad_nacimiento, genero: r.genero,
    celular: r.celular, telefonoAlt: r.telefono_alt,
    email: r.email, emailAlt: r.email_alt,
    departamento: r.departamento, ciudad: r.ciudad,
    barrio: r.barrio, direccion: r.direccion,
    tipoVivienda: r.tipo_vivienda, tiempoVivienda: r.tiempo_vivienda,
    ingresosMensuales: r.ingresos_mensuales ? Number(r.ingresos_mensuales) : null,
    fuenteIngresos: r.fuente_ingresos,
    ingresosAdicionales: r.ingresos_adicionales ? Number(r.ingresos_adicionales) : null,
    conceptoIngresosAd: r.concepto_ingresos_ad,
    egresosMensuales: r.egresos_mensuales ? Number(r.egresos_mensuales) : null,
    obligacionesFinancieras: r.obligaciones_financieras ? Number(r.obligaciones_financieras) : null,
    banco: r.banco, tipoCuenta: r.tipo_cuenta,
    numeroCuenta: r.numero_cuenta, otrasCuentas: r.otras_cuentas,
    montoSolicitado: r.monto_solicitado ? Number(r.monto_solicitado) : null,
    plazo: r.plazo, garantia: r.garantia, destinoCredito: r.destino_credito,
    situacionLaboral: r.situacion_laboral, sectorEconomico: r.sector_economico,
    empresa: r.empresa, nitEmpresa: r.nit_empresa, cargo: r.cargo,
    antiguedad: r.antiguedad, tipoContrato: r.tipo_contrato,
    telefonoTrabajo: r.telefono_trabajo, direccionTrabajo: r.direccion_trabajo,
    estadoCivil: r.estado_civil, nivelEducativo: r.nivel_educativo,
    numeroDependientes: r.numero_dependientes,
    refNombre: r.ref_nombre, refParentesco: r.ref_parentesco,
    refCelular: r.ref_celular, refAdicional: r.ref_adicional,
    declaracionVeracidad: r.declaracion_veracidad,
    autorizacionCentrales: r.autorizacion_centrales,
    autorizacionDatos: r.autorizacion_datos,
    declaracionSarlaft: r.declaracion_sarlaft,
    declaracionPep: r.declaracion_pep,
    autorizacionDebito: r.autorizacion_debito,
    firmaElectronica: r.firma_electronica,
    documentos: r.documentos || {},
    notaAnalista: r.nota_analista, analista: r.analista,
  };
}

// ── Cloudinary ────────────────────────────────────────────────────────────────
async function uploadImageToCloudinary(base64Data, fileName, folder) {
  const mimeMatch = base64Data.match(/data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `warp-solicitudes/${folder}/${Date.now()}_${(fileName||'img').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const signature = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`).digest('hex');
  const boundary = '----WarpBoundary' + Math.random().toString(36).substr(2);
  const fileData = Buffer.from(base64, 'base64');
  let body = '';
  const addField = (name, value) => { body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`; };
  addField('api_key', API_KEY); addField('timestamp', timestamp);
  addField('signature', signature); addField('public_id', publicId);
  const bodyBefore = Buffer.from(body, 'utf8');
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName||'image'}"\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const bodyAfter = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const requestBody = Buffer.concat([bodyBefore, fileHeader, fileData, bodyAfter]);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/image/upload`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': requestBody.length }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.secure_url) resolve(json.secure_url);
          else reject(new Error(json.error?.message || 'Upload failed'));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(requestBody); req.end();
  });
}

function saveDocumentLocally(base64Data, fileName, radicado) {
  const docDir = path.join(DOCS_DIR, radicado);
  if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const safeName = `${Date.now()}_${(fileName||'documento.pdf').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  fs.writeFileSync(path.join(docDir, safeName), Buffer.from(base64, 'base64'));
  return `/docs/${radicado}/${safeName}`;
}

// ── Servir PDFs ───────────────────────────────────────────────────────────────
app.get('/docs/:radicado/:filename', (req, res) => {
  const filePath = path.join(DOCS_DIR, req.params.radicado, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
    res.sendFile(filePath);
  } else res.status(404).json({ error: 'Archivo no encontrado' });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  if (!dbReady) return res.status(503).json({ status: 'error', db: 'no conectada', msg: 'DATABASE_URL no configurada o DB inalcanzable' });
  try {
    const r = await pool.query('SELECT COUNT(*) FROM solicitudes');
    res.json({ status: 'ok', db: 'postgresql', solicitudes: Number(r.rows[0].count), timestamp: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ status: 'error', db: e.message });
  }
});

// ── POST /api/solicitudes ─────────────────────────────────────────────────────
app.post('/api/solicitudes', requireDB, async (req, res) => {
  try {
    const radicado = generarRadicado();
    const data = req.body;
    const nombresDoc = {
      cedula_frontal:'Cédula Frontal', cedula_reverso:'Cédula Reverso',
      colillas:'Colillas de pago', certificado_laboral:'Certificado laboral',
      extracto_1:'Extracto mes 1', extracto_2:'Extracto mes 2',
      extracto_3:'Extracto mes 3', extracto_alt:'Extracto alternativo',
      rut:'RUT', declaracion_renta:'Declaración de renta',
      servicios:'Recibo servicios', camara:'Cámara de comercio',
      garantia:'Documento garantía', selfie:'Selfie con cédula'
    };
    const documentosUrls = {};
    const nombreSolicitante = `${data.primerNombre||''}_${data.primerApellido||''}`.replace(/\s+/g,'_');
    for (const [key, nombre] of Object.entries(nombresDoc)) {
      if (data[key] && data[key].length > 100) {
        try {
          const isPdf = data[key].startsWith('data:application/pdf') || (data[key+'_nombre']||'').endsWith('.pdf');
          documentosUrls[key] = isPdf
            ? saveDocumentLocally(data[key], `${nombreSolicitante}_${nombre}.pdf`, radicado)
            : await uploadImageToCloudinary(data[key], `${nombreSolicitante}_${nombre}`, radicado);
        } catch(e) { console.error(`Doc ${key}:`, e.message); documentosUrls[key] = null; }
      }
    }
    const q = `INSERT INTO solicitudes (
        radicado,tipo_documento,num_documento,primer_nombre,segundo_nombre,
        primer_apellido,segundo_apellido,fecha_nacimiento,pais_nacimiento,
        ciudad_nacimiento,genero,celular,telefono_alt,email,email_alt,
        departamento,ciudad,barrio,direccion,tipo_vivienda,tiempo_vivienda,
        ingresos_mensuales,fuente_ingresos,ingresos_adicionales,concepto_ingresos_ad,
        egresos_mensuales,obligaciones_financieras,banco,tipo_cuenta,numero_cuenta,otras_cuentas,
        monto_solicitado,plazo,garantia,destino_credito,
        situacion_laboral,sector_economico,empresa,nit_empresa,cargo,
        antiguedad,tipo_contrato,telefono_trabajo,direccion_trabajo,
        estado_civil,nivel_educativo,numero_dependientes,
        ref_nombre,ref_parentesco,ref_celular,ref_adicional,
        declaracion_veracidad,autorizacion_centrales,autorizacion_datos,
        declaracion_sarlaft,declaracion_pep,autorizacion_debito,
        firma_electronica,documentos
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
        $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,
        $45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59
      ) RETURNING id, radicado`;
    const values = [
      radicado,
      data.tipoDocumento||null,data.numDocumento||null,data.primerNombre||null,data.segundoNombre||null,
      data.primerApellido||null,data.segundoApellido||null,data.fechaNacimiento||null,data.paisNacimiento||null,
      data.ciudadNacimiento||null,data.genero||null,data.celular||null,data.telefonoAlt||null,
      data.email||null,data.emailAlt||null,data.departamento||null,data.ciudad||null,
      data.barrio||null,data.direccion||null,data.tipoVivienda||null,data.tiempoVivienda||null,
      data.ingresosMensuales?Number(data.ingresosMensuales):null,data.fuenteIngresos||null,
      data.ingresosAdicionales?Number(data.ingresosAdicionales):null,data.conceptoIngresosAd||null,
      data.egresosMensuales?Number(data.egresosMensuales):null,
      data.obligacionesFinancieras?Number(data.obligacionesFinancieras):null,
      data.banco||null,data.tipoCuenta||null,data.numeroCuenta||null,data.otrasCuentas||null,
      data.montoSolicitado?Number(data.montoSolicitado):null,data.plazo||null,
      data.garantia||null,data.destinoCredito||null,data.situacionLaboral||null,
      data.sectorEconomico||null,data.empresa||null,data.nitEmpresa||null,data.cargo||null,
      data.antiguedad||null,data.tipoContrato||null,data.telefonoTrabajo||null,data.direccionTrabajo||null,
      data.estadoCivil||null,data.nivelEducativo||null,data.numeroDependientes||null,
      data.refNombre||null,data.refParentesco||null,data.refCelular||null,data.refAdicional||null,
      !!data.declaracionVeracidad,!!data.autorizacionCentrales,!!data.autorizacionDatos,
      !!data.declaracionSarlaft,!!data.declaracionPep,!!data.autorizacionDebito,
      data.firmaElectronica||null,JSON.stringify(documentosUrls)
    ];
    const result = await pool.query(q, values);
    const { id } = result.rows[0];
    await auditLog(id,'SOLICITUD_CREADA','solicitante',`Radicado: ${radicado} | Docs: ${Object.keys(documentosUrls).length}`);
    res.status(201).json({ ok: true, radicado, mensaje: '¡Solicitud enviada exitosamente!' });
  } catch(err) {
    console.error('Error POST solicitud:', err.message);
    res.status(500).json({ error: 'Error guardando la solicitud.' });
  }
});

// ── Admin login ───────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { usuario, password } = req.body;
  if (usuario === ADMIN_USER && password === ADMIN_PASS) return res.json({ ok: true, token: ADMIN_TOKEN });
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

// ── GET solicitudes ───────────────────────────────────────────────────────────
app.get('/api/admin/solicitudes', authAdmin, requireDB, async (req, res) => {
  try {
    let { estado, buscar, limit=100, offset=0 } = req.query;
    limit = Math.min(Number(limit), 200); offset = Number(offset);
    let where = [], params = [], i = 1;
    if (estado && estado !== 'TODAS') { where.push(`estado=$${i++}`); params.push(estado); }
    if (buscar) {
      const q = `%${buscar.toLowerCase()}%`;
      where.push(`(LOWER(primer_nombre) LIKE $${i} OR LOWER(primer_apellido) LIKE $${i} OR LOWER(num_documento) LIKE $${i} OR LOWER(radicado) LIKE $${i} OR LOWER(email) LIKE $${i} OR LOWER(celular) LIKE $${i})`);
      params.push(q); i++;
    }
    const whereClause = where.length ? 'WHERE '+where.join(' AND ') : '';
    const countRes = await pool.query(`SELECT COUNT(*) FROM solicitudes ${whereClause}`, params);
    params.push(limit, offset);
    const rows = await pool.query(`SELECT * FROM solicitudes ${whereClause} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, params);
    res.json({ solicitudes: rows.rows.map(rowToSolicitud), total: Number(countRes.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET solicitud por id ──────────────────────────────────────────────────────
app.get('/api/admin/solicitudes/:id', authAdmin, requireDB, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM solicitudes WHERE id::text=$1 OR radicado=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitud(r.rows[0]);
    const audit = await pool.query(`SELECT * FROM auditoria WHERE solicitud_id=$1 ORDER BY created_at DESC`, [sol.id]);
    sol.auditoria = audit.rows.map(a => ({ id:a.id, solicitudId:a.solicitud_id, accion:a.accion, usuario:a.usuario, detalle:a.detalle, createdAt:a.created_at }));
    res.json(sol);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH estado ──────────────────────────────────────────────────────────────
app.patch('/api/admin/solicitudes/:id/estado', authAdmin, requireDB, async (req, res) => {
  try {
    const { estado, nota, analista } = req.body;
    const estados = ['RADICADA','EN_ANALISIS','APROBADA','RECHAZADA','DESEMBOLSADA'];
    if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    const r = await pool.query(
      `UPDATE solicitudes SET estado=$1, nota_analista=COALESCE($2,nota_analista), analista=COALESCE($3,analista), updated_at=NOW() WHERE id::text=$4 OR radicado=$4 RETURNING *`,
      [estado, nota||null, analista||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitud(r.rows[0]);
    await auditLog(sol.id, `CAMBIO_ESTADO_${estado}`, analista||'admin', nota||'');
    res.json({ ok: true, solicitud: sol });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/admin/dashboard', authAdmin, requireDB, async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0,10);
    const [total, byEstado, hoyN, montoRes, recientes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM solicitudes'),
      pool.query('SELECT estado, COUNT(*) as cnt FROM solicitudes GROUP BY estado'),
      pool.query('SELECT COUNT(*) FROM solicitudes WHERE created_at::date=$1', [hoy]),
      pool.query("SELECT COALESCE(SUM(monto_solicitado),0) as total FROM solicitudes WHERE estado IN ('APROBADA','DESEMBOLSADA')"),
      pool.query('SELECT id,radicado,primer_nombre,primer_apellido,monto_solicitado,estado,created_at FROM solicitudes ORDER BY created_at DESC LIMIT 10')
    ]);
    const estadosMap = {};
    byEstado.rows.forEach(r => { estadosMap[r.estado] = Number(r.cnt); });
    res.json({
      total: Number(total.rows[0].count),
      radicadas: estadosMap['RADICADA']||0, enAnalisis: estadosMap['EN_ANALISIS']||0,
      aprobadas: estadosMap['APROBADA']||0, rechazadas: estadosMap['RECHAZADA']||0,
      desembolsadas: estadosMap['DESEMBOLSADA']||0,
      hoy: Number(hoyN.rows[0].count), montoTotal: Number(montoRes.rows[0].total),
      recientes: recientes.rows.map(r => ({ id:r.id, radicado:r.radicado, primerNombre:r.primer_nombre, primerApellido:r.primer_apellido, montoSolicitado:r.monto_solicitado?Number(r.monto_solicitado):null, estado:r.estado, createdAt:r.created_at }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Exportar CSV ──────────────────────────────────────────────────────────────
app.get('/api/admin/exportar', authAdmin, requireDB, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM solicitudes ORDER BY created_at DESC');
    const cols = ['radicado','estado','created_at','primer_nombre','primer_apellido','tipo_documento','num_documento','email','celular','ciudad','departamento','monto_solicitado','plazo','destino_credito','ingresos_mensuales','egresos_mensuales','obligaciones_financieras','situacion_laboral','tipo_contrato','empresa','garantia','firma_electronica','nota_analista'];
    const headers = ['Radicado','Estado','Fecha','Primer Nombre','Primer Apellido','Tipo Doc','N° Doc','Email','Celular','Ciudad','Departamento','Monto','Plazo','Destino','Ingresos','Egresos','Obligaciones','Situación Lab.','Tipo Contrato','Empresa','Garantía','Firma','Nota Analista'];
    let csv = headers.join(',') + '\n';
    for (const s of r.rows) csv += cols.map(c => `"${(s[c]!=null?s[c]:'').toString().replace(/"/g,'""')}"`).join(',') + '\n';
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="solicitudes-financial-services.csv"');
    res.send('\uFEFF' + csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Auditoría ─────────────────────────────────────────────────────────────────
app.get('/api/admin/auditoria', authAdmin, requireDB, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM auditoria ORDER BY created_at DESC LIMIT 200');
    res.json({ logs: r.rows.map(a => ({ id:a.id, solicitudId:a.solicitud_id, accion:a.accion, usuario:a.usuario, detalle:a.detalle, createdAt:a.created_at })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Páginas HTML ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const f = path.join(__dirname, 'admin.html');
  fs.existsSync(f) ? res.sendFile(f) : res.send('<h2>Admin not found</h2>');
});
app.get('*', (req, res) => {
  const f = path.join(__dirname, 'index.html');
  fs.existsSync(f) ? res.sendFile(f) : res.json({ ok:true, msg:'Financial Services API' });
});

// ── Arranque ──────────────────────────────────────────────────────────────────
initPool();

app.listen(PORT, async () => {
  console.log(`\n🚀 Financial Services en puerto ${PORT}`);
  console.log(`📁 Docs: ${DOCS_DIR}`);
  console.log(`🐘 DATABASE_URL: ${process.env.DATABASE_URL ? 'definida' : '⚠️ NO DEFINIDA'}`);
  await initDB();
  console.log(`🌐 http://localhost:${PORT}\n`);
});
