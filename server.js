const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Docs locales (PDFs) ───────────────────────────────────────────────────────
const DOCS_DIR = path.join(__dirname, 'documentos');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

// ── Credenciales ──────────────────────────────────────────────────────────────
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME || 'dtoq5nbz4';
const API_KEY     = process.env.CLOUDINARY_API_KEY    || '985348958691353';
const API_SECRET  = process.env.CLOUDINARY_API_SECRET || 'N8mnqMCA_xVtSzxL4p13YVvhnLM';
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'WarpAdmin2024!';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'warp-token-secreto-2024';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'warpfiance@gmail.com';
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || '';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
  console.log('✅ SendGrid configurado');
} else {
  console.log('⚠️  SENDGRID_API_KEY no definida — emails desactivados');
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  max: 10
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      radicado TEXT UNIQUE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'RADICADA',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tipo_documento TEXT, num_documento TEXT,
      primer_nombre TEXT, segundo_nombre TEXT,
      primer_apellido TEXT, segundo_apellido TEXT,
      fecha_nacimiento TEXT, pais_nacimiento TEXT,
      ciudad_nacimiento TEXT, genero TEXT,
      celular TEXT, telefono_alt TEXT,
      email TEXT, email_alt TEXT,
      departamento TEXT, ciudad TEXT,
      barrio TEXT, direccion TEXT,
      tipo_vivienda TEXT, tiempo_vivienda TEXT,
      ingresos_mensuales NUMERIC, fuente_ingresos TEXT,
      ingresos_adicionales NUMERIC, concepto_ingresos_ad TEXT,
      egresos_mensuales NUMERIC, obligaciones_financieras NUMERIC,
      banco TEXT, tipo_cuenta TEXT, numero_cuenta TEXT, otras_cuentas TEXT,
      monto_solicitado NUMERIC, plazo TEXT, garantia TEXT, destino_credito TEXT,
      situacion_laboral TEXT, sector_economico TEXT,
      empresa TEXT, nit_empresa TEXT, cargo TEXT,
      antiguedad TEXT, tipo_contrato TEXT,
      telefono_trabajo TEXT, direccion_trabajo TEXT,
      estado_civil TEXT, nivel_educativo TEXT, numero_dependientes TEXT,
      ref_nombre TEXT, ref_parentesco TEXT, ref_celular TEXT, ref_adicional TEXT,
      declaracion_veracidad BOOLEAN DEFAULT FALSE,
      autorizacion_centrales BOOLEAN DEFAULT FALSE,
      autorizacion_datos BOOLEAN DEFAULT FALSE,
      declaracion_sarlaft BOOLEAN DEFAULT FALSE,
      declaracion_pep BOOLEAN DEFAULT FALSE,
      autorizacion_debito BOOLEAN DEFAULT FALSE,
      firma_electronica TEXT,
      documentos JSONB DEFAULT '{}',
      nota_analista TEXT, analista TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_juridica (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      radicado TEXT UNIQUE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'RADICADA',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      razon_social TEXT, nit TEXT, tipo_sociedad TEXT,
      fecha_constitucion TEXT, actividad_economica TEXT, sector_economico TEXT,
      num_empleados TEXT, departamento TEXT, ciudad TEXT, direccion_comercial TEXT,
      rep_nombre TEXT, rep_segundo_nombre TEXT, rep_apellido TEXT,
      rep_tipo_doc TEXT, rep_num_doc TEXT, rep_cargo TEXT,
      rep_celular TEXT, rep_email TEXT, rep_fecha_nac TEXT,
      ventas_anuales NUMERIC, ingresos_mensuales NUMERIC,
      total_activos NUMERIC, total_pasivos NUMERIC,
      egresos_mensuales NUMERIC, obligaciones NUMERIC,
      banco TEXT, tipo_cuenta TEXT, numero_cuenta TEXT,
      monto_solicitado NUMERIC, plazo TEXT, garantia TEXT, destino_credito TEXT,
      antiguedad_empresa TEXT, sucursales TEXT, mercado TEXT, proveedores TEXT,
      descripcion_actividad TEXT,
      socio_principal TEXT, porcentaje_part TEXT, otros_socios TEXT, grupo_economico TEXT,
      ref_empresa TEXT, ref_contacto TEXT, ref_telefono TEXT, ref_relacion TEXT,
      decl_1 BOOLEAN DEFAULT FALSE, decl_2 BOOLEAN DEFAULT FALSE,
      decl_3 BOOLEAN DEFAULT FALSE, decl_4 BOOLEAN DEFAULT FALSE,
      decl_5 BOOLEAN DEFAULT FALSE, decl_6 BOOLEAN DEFAULT FALSE,
      decl_7 BOOLEAN DEFAULT FALSE, decl_8 BOOLEAN DEFAULT FALSE,
      firma_electronica TEXT,
      documentos JSONB DEFAULT '{}',
      nota_analista TEXT, analista TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      solicitud_id UUID,
      accion TEXT NOT NULL,
      usuario TEXT NOT NULL DEFAULT 'sistema',
      detalle TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sol_estado ON solicitudes(estado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sol_created ON solicitudes(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_solj_estado ON solicitudes_juridica(estado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_solj_created ON solicitudes_juridica(created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_sol ON auditoria(solicitud_id);`);
  console.log('✅ PostgreSQL tablas listas');
}

// ── Emails ────────────────────────────────────────────────────────────────────
async function enviarEmailAdmin(sol) {
  if (!SENDGRID_KEY) return;
  const monto = sol.montoSolicitado ? `$${Number(sol.montoSolicitado).toLocaleString('es-CO')}` : 'No especificado';
  try {
    await sgMail.send({
      to: ADMIN_EMAIL,
      from: { email: ADMIN_EMAIL, name: 'Financial Services' },
      subject: `📋 Nueva solicitud ${sol.radicado} — ${sol.primerNombre} ${sol.primerApellido}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1B5E20;padding:20px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px">FINANCIAL SERVICES</h1>
            <p style="color:#A5D6A7;margin:5px 0 0">Nueva solicitud de crédito</p>
          </div>
          <div style="background:#f9f9f9;padding:24px">
            <div style="background:#fff;border-radius:8px;padding:20px;border-left:4px solid #4CAF50">
              <h2 style="color:#1B5E20;margin:0 0 16px">Radicado: ${sol.radicado}</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#666;width:40%">Nombre completo</td><td style="padding:6px 0;font-weight:bold">${sol.primerNombre} ${sol.segundoNombre||''} ${sol.primerApellido} ${sol.segundoApellido||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Documento</td><td style="padding:6px 0">${sol.tipoDocumento||''} ${sol.numDocumento||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Celular</td><td style="padding:6px 0">${sol.celular||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${sol.email||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Ciudad</td><td style="padding:6px 0">${sol.ciudad||''}, ${sol.departamento||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Monto solicitado</td><td style="padding:6px 0;font-weight:bold;color:#1B5E20;font-size:18px">${monto}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Plazo</td><td style="padding:6px 0">${sol.plazo||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Destino</td><td style="padding:6px 0">${sol.destinoCredito||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Ingresos mensuales</td><td style="padding:6px 0">${sol.ingresosMensuales ? '$'+Number(sol.ingresosMensuales).toLocaleString('es-CO') : ''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Situación laboral</td><td style="padding:6px 0">${sol.situacionLaboral||''}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Documentos adjuntos</td><td style="padding:6px 0">${Object.keys(sol.documentos||{}).length} archivos</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin-top:20px">
              <a href="https://warp-consultas-production.up.railway.app/admin" style="background:#4CAF50;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold">Ver en el Panel Admin</a>
            </div>
            <p style="color:#999;font-size:12px;text-align:center;margin-top:20px">Financial Services · ${new Date().toLocaleString('es-CO')}</p>
          </div>
        </div>
      `
    });
    console.log(`📧 Email admin enviado para ${sol.radicado}`);
  } catch(e) {
    console.error('Email admin error:', e.message);
  }
}

async function enviarEmailCliente(sol) {
  if (!SENDGRID_KEY || !sol.email) return;
  const monto = sol.montoSolicitado ? `$${Number(sol.montoSolicitado).toLocaleString('es-CO')}` : '';
  try {
    await sgMail.send({
      to: sol.email,
      from: { email: ADMIN_EMAIL, name: 'Financial Services' },
      subject: `✅ Solicitud recibida — Radicado ${sol.radicado}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1B5E20;padding:20px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px">FINANCIAL SERVICES</h1>
          </div>
          <div style="background:#f9f9f9;padding:24px">
            <h2 style="color:#1B5E20">¡Hola, ${sol.primerNombre}!</h2>
            <p style="color:#333">Recibimos tu solicitud de crédito correctamente. Un asesor se pondrá en contacto contigo en las próximas <strong>24 horas hábiles</strong>.</p>
            <div style="background:#fff;border-radius:8px;padding:20px;text-align:center;margin:20px 0;border:2px solid #4CAF50">
              <p style="color:#666;margin:0 0 8px;font-size:14px">Tu número de radicado es</p>
              <p style="color:#1B5E20;font-size:28px;font-weight:bold;margin:0;letter-spacing:2px">${sol.radicado}</p>
              ${monto ? `<p style="color:#666;margin:8px 0 0;font-size:14px">Monto solicitado: <strong>${monto}</strong></p>` : ''}
            </div>
            <p style="color:#333">Guarda este número para hacer seguimiento a tu solicitud.</p>
            <p style="color:#999;font-size:12px;text-align:center;margin-top:30px">Financial Services · ${new Date().toLocaleString('es-CO')}</p>
          </div>
        </div>
      `
    });
    console.log(`📧 Email cliente enviado a ${sol.email}`);
  } catch(e) {
    console.error('Email cliente error:', e.message);
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
      [solicitudId, accion, usuario||'sistema', detalle||'']
    );
  } catch(e) { console.error('auditLog error:', e.message); }
}

function rowToSolicitud(r) {
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
    notaAnalista: r.nota_analista, analista: r.analista
  };
}

function rowToSolicitudJuridica(r) {
  return {
    id: r.id, radicado: r.radicado, estado: r.estado,
    createdAt: r.created_at, updatedAt: r.updated_at,
    tipoPersona: 'juridica',
    razonSocial: r.razon_social, nit: r.nit, tipoSociedad: r.tipo_sociedad,
    fechaConstitucion: r.fecha_constitucion, actividadEconomica: r.actividad_economica,
    sectorEconomico: r.sector_economico, numEmpleados: r.num_empleados,
    departamento: r.departamento, ciudad: r.ciudad, direccionComercial: r.direccion_comercial,
    repNombre: r.rep_nombre, repSegundoNombre: r.rep_segundo_nombre, repApellido: r.rep_apellido,
    repTipoDoc: r.rep_tipo_doc, repNumDoc: r.rep_num_doc, repCargo: r.rep_cargo,
    repCelular: r.rep_celular, repEmail: r.rep_email, repFechaNac: r.rep_fecha_nac,
    ventasAnuales: r.ventas_anuales ? Number(r.ventas_anuales) : null,
    ingresosMensuales: r.ingresos_mensuales ? Number(r.ingresos_mensuales) : null,
    totalActivos: r.total_activos ? Number(r.total_activos) : null,
    totalPasivos: r.total_pasivos ? Number(r.total_pasivos) : null,
    egresosMensuales: r.egresos_mensuales ? Number(r.egresos_mensuales) : null,
    obligaciones: r.obligaciones ? Number(r.obligaciones) : null,
    banco: r.banco, tipoCuenta: r.tipo_cuenta, numeroCuenta: r.numero_cuenta,
    montoSolicitado: r.monto_solicitado ? Number(r.monto_solicitado) : null,
    plazo: r.plazo, garantia: r.garantia, destinoCredito: r.destino_credito,
    antiguedadEmpresa: r.antiguedad_empresa, sucursales: r.sucursales,
    mercado: r.mercado, proveedores: r.proveedores,
    descripcionActividad: r.descripcion_actividad,
    socioPrincipal: r.socio_principal, porcentajePart: r.porcentaje_part,
    otrosSocios: r.otros_socios, grupoEconomico: r.grupo_economico,
    refEmpresa: r.ref_empresa, refContacto: r.ref_contacto,
    refTelefono: r.ref_telefono, refRelacion: r.ref_relacion,
    decl1: r.decl_1, decl2: r.decl_2, decl3: r.decl_3, decl4: r.decl_4,
    decl5: r.decl_5, decl6: r.decl_6, decl7: r.decl_7, decl8: r.decl_8,
    firmaElectronica: r.firma_electronica,
    documentos: r.documentos || {},
    notaAnalista: r.nota_analista, analista: r.analista
  };
}

// ── Cloudinary ────────────────────────────────────────────────────────────────
// resourceType: 'auto' deja que Cloudinary detecte si es imagen, PDF, etc.
// Esto reemplaza el guardado local de PDFs (Railway borra el disco en cada deploy).
async function uploadImageToCloudinary(base64Data, fileName, folder, resourceType = 'auto') {
  const mimeMatch = base64Data.match(/data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `warp-solicitudes/${folder}/${Date.now()}_${(fileName||'img').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const signature = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`).digest('hex');
  const boundary = '----WarpBoundary' + Math.random().toString(36).substr(2);
  const fileData = Buffer.from(base64, 'base64');
  let body = '';
  const addField = (n, v) => { body += `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`; };
  addField('api_key', API_KEY); addField('timestamp', timestamp);
  addField('signature', signature); addField('public_id', publicId);
  const bodyBefore = Buffer.from(body, 'utf8');
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName||'image'}"\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const bodyAfter = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const requestBody = Buffer.concat([bodyBefore, fileHeader, fileData, bodyAfter]);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
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
  try {
    const r = await pool.query('SELECT COUNT(*) FROM solicitudes');
    res.json({ status: 'ok', db: 'postgresql', solicitudes: Number(r.rows[0].count), email: !!SENDGRID_KEY, timestamp: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ status: 'error', db: e.message });
  }
});

// ── POST /api/solicitudes ─────────────────────────────────────────────────────
app.post('/api/solicitudes', async (req, res) => {
  try {
    const radicado = generarRadicado();
    const data = req.body;
    const esJuridica = data.tipoPersona === 'juridica';

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
    if (data.documentos && typeof data.documentos === 'object') {
      for (const [key, fileData] of Object.entries(data.documentos)) {
        if (fileData && fileData.base64) {
          try {
            const mimeType = fileData.tipo || '';
            // Todo sube a Cloudinary (resource_type=auto detecta imagen/PDF/etc).
            // Railway borra el disco local en cada deploy, por eso ya no se usa saveDocumentLocally.
            const url = await uploadImageToCloudinary(fileData.base64, fileData.nombre||key, radicado, 'auto');
            documentosUrls[key] = { url, nombre: nombresDoc[key]||key, nombreArchivo: fileData.nombre, tipo: mimeType };
          } catch(e) {
            console.error(`✗ ${key}:`, e.message);
            documentosUrls[key] = { url: null, nombre: nombresDoc[key]||key, error: e.message };
          }
        }
      }
    }

    // ══ PERSONA JURÍDICA ══════════════════════════════════════════════════════
    if (esJuridica) {
      const qj = `INSERT INTO solicitudes_juridica (
        radicado, razon_social, nit, tipo_sociedad, fecha_constitucion,
        actividad_economica, sector_economico, num_empleados, departamento, ciudad,
        direccion_comercial, rep_nombre, rep_segundo_nombre, rep_apellido, rep_tipo_doc,
        rep_num_doc, rep_cargo, rep_celular, rep_email, rep_fecha_nac,
        ventas_anuales, ingresos_mensuales, total_activos, total_pasivos,
        egresos_mensuales, obligaciones, banco, tipo_cuenta, numero_cuenta,
        monto_solicitado, plazo, garantia, destino_credito,
        antiguedad_empresa, sucursales, mercado, proveedores, descripcion_actividad,
        socio_principal, porcentaje_part, otros_socios, grupo_economico,
        ref_empresa, ref_contacto, ref_telefono, ref_relacion,
        decl_1, decl_2, decl_3, decl_4, decl_5, decl_6, decl_7, decl_8,
        firma_electronica, documentos
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,
        $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54
      ) RETURNING id, radicado`;

      const valuesJ = [
        radicado,
        data['j-razonSocial']||null, data['j-nit']||null, data['j-tipoSociedad']||null, data['j-fechaConstitucion']||null,
        data['j-actividadEconomica']||null, data['j-sectorEconomico']||null, data['j-numEmpleados']||null,
        data['j-departamento']||null, data['j-ciudad']||null,
        data['j-direccionComercial']||null, data['j-repNombre']||null, data['j-repSegundoNombre']||null,
        data['j-repApellido']||null, data['j-repTipoDoc']||null,
        data['j-repNumDoc']||null, data['j-repCargo']||null, data['j-repCelular']||null,
        data['j-repEmail']||null, data['j-repFechaNac']||null,
        data['j-ventasAnuales'] ? Number(data['j-ventasAnuales']) : null,
        data['j-ingresosMensuales'] ? Number(data['j-ingresosMensuales']) : null,
        data['j-totalActivos'] ? Number(data['j-totalActivos']) : null,
        data['j-totalPasivos'] ? Number(data['j-totalPasivos']) : null,
        data['j-egresosMensuales'] ? Number(data['j-egresosMensuales']) : null,
        data['j-obligaciones'] ? Number(data['j-obligaciones']) : null,
        data['j-banco']||null, data['j-tipoCuenta']||null, data['j-numeroCuenta']||null,
        data['j-montoSolicitado'] ? Number(data['j-montoSolicitado']) : null,
        data['j-plazo']||null, data['j-garantia']||null, data['j-destinoCredito']||null,
        data['j-antiguedadEmpresa']||null, data['j-sucursales']||null, data['j-mercado']||null,
        data['j-proveedores']||null, data['j-descripcionActividad']||null,
        data['j-socioPrincipal']||null, data['j-porcentajePart']||null,
        data['j-otrosSocios']||null, data['j-grupoEconomico']||null,
        data['j-refEmpresa']||null, data['j-refContacto']||null,
        data['j-refTelefono']||null, data['j-refRelacion']||null,
        !!data.decl_1, !!data.decl_2, !!data.decl_3, !!data.decl_4,
        !!data.decl_5, !!data.decl_6, !!data.decl_7, !!data.decl_8,
        data.firmaElectronica||null,
        JSON.stringify(documentosUrls)
      ];

      const resultJ = await pool.query(qj, valuesJ);
      const { id: idJ } = resultJ.rows[0];
      await auditLog(idJ, 'SOLICITUD_CREADA', 'solicitante', `[Jurídica] Radicado: ${radicado} | Docs: ${Object.keys(documentosUrls).length}`);

      const solJ = { ...rowToSolicitudJuridica({ id: idJ, radicado }), ...data, radicado, documentos: documentosUrls };
      enviarEmailAdmin(solJ);
      enviarEmailCliente(solJ);

      return res.status(201).json({ ok: true, radicado, mensaje: '¡Solicitud enviada exitosamente!' });
    }

    // ══ PERSONA NATURAL ═══════════════════════════════════════════════════════
    const q = `INSERT INTO solicitudes (
      radicado, tipo_documento, num_documento, primer_nombre, segundo_nombre,
      primer_apellido, segundo_apellido, fecha_nacimiento, pais_nacimiento,
      ciudad_nacimiento, genero, celular, telefono_alt, email, email_alt,
      departamento, ciudad, barrio, direccion, tipo_vivienda, tiempo_vivienda,
      ingresos_mensuales, fuente_ingresos, ingresos_adicionales, concepto_ingresos_ad,
      egresos_mensuales, obligaciones_financieras, banco, tipo_cuenta, numero_cuenta, otras_cuentas,
      monto_solicitado, plazo, garantia, destino_credito,
      situacion_laboral, sector_economico, empresa, nit_empresa, cargo,
      antiguedad, tipo_contrato, telefono_trabajo, direccion_trabajo,
      estado_civil, nivel_educativo, numero_dependientes,
      ref_nombre, ref_parentesco, ref_celular, ref_adicional,
      declaracion_veracidad, autorizacion_centrales, autorizacion_datos,
      declaracion_sarlaft, declaracion_pep, autorizacion_debito,
      firma_electronica, documentos
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
      $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,
      $45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59
    ) RETURNING id, radicado`;

    const values = [
      radicado,
      data.tipoDocumento||null, data.numDocumento||null,
      data.primerNombre||null, data.segundoNombre||null,
      data.primerApellido||null, data.segundoApellido||null,
      data.fechaNacimiento||null, data.paisNacimiento||null,
      data.ciudadNacimiento||null, data.genero||null,
      data.celular||null, data.telefonoAlt||null,
      data.email||null, data.emailAlt||null,
      data.departamento||null, data.ciudad||null,
      data.barrio||null, data.direccion||null,
      data.tipoVivienda||null, data.tiempoVivienda||null,
      data.ingresosMensuales ? Number(data.ingresosMensuales) : null,
      data.fuenteIngresos||null,
      data.ingresosAdicionales ? Number(data.ingresosAdicionales) : null,
      data.conceptoIngresosAd||null,
      data.egresosMensuales ? Number(data.egresosMensuales) : null,
      data.obligacionesFinancieras ? Number(data.obligacionesFinancieras) : null,
      data.banco||null, data.tipoCuenta||null,
      data.numeroCuenta||null, data.otrasCuentas||null,
      data.montoSolicitado ? Number(data.montoSolicitado) : null,
      data.plazo||null, data.garantia||null, data.destinoCredito||null,
      data.situacionLaboral||null, data.sectorEconomico||null,
      data.empresa||null, data.nitEmpresa||null, data.cargo||null,
      data.antiguedad||null, data.tipoContrato||null,
      data.telefonoTrabajo||null, data.direccionTrabajo||null,
      data.estadoCivil||null, data.nivelEducativo||null,
      data.numeroDependientes||null,
      data.refNombre||null, data.refParentesco||null,
      data.refCelular||null, data.refAdicional||null,
      !!data.declaracionVeracidad, !!data.autorizacionCentrales,
      !!data.autorizacionDatos, !!data.declaracionSarlaft,
      !!data.declaracionPep, !!data.autorizacionDebito,
      data.firmaElectronica||null,
      JSON.stringify(documentosUrls)
    ];

    const result = await pool.query(q, values);
    const { id } = result.rows[0];
    await auditLog(id, 'SOLICITUD_CREADA', 'solicitante', `Radicado: ${radicado} | Docs: ${Object.keys(documentosUrls).length}`);

    const sol = { ...rowToSolicitud({ id, radicado, ...result.rows[0] }), ...data, radicado, documentos: documentosUrls };
    enviarEmailAdmin(sol);
    enviarEmailCliente(sol);

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
app.get('/api/admin/solicitudes', authAdmin, async (req, res) => {
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
    const wc = where.length ? 'WHERE '+where.join(' AND ') : '';
    const countRes = await pool.query(`SELECT COUNT(*) FROM solicitudes ${wc}`, params);
    params.push(limit, offset);
    const rows = await pool.query(`SELECT * FROM solicitudes ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, params);
    res.json({ solicitudes: rows.rows.map(rowToSolicitud), total: Number(countRes.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET solicitud :id ─────────────────────────────────────────────────────────
app.get('/api/admin/solicitudes/:id', authAdmin, async (req, res) => {
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
app.patch('/api/admin/solicitudes/:id/estado', authAdmin, async (req, res) => {
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

// ── GET solicitudes JURÍDICA ───────────────────────────────────────────────────
app.get('/api/admin/solicitudes-juridica', authAdmin, async (req, res) => {
  try {
    let { estado, buscar, limit=100, offset=0 } = req.query;
    limit = Math.min(Number(limit), 200); offset = Number(offset);
    let where = [], params = [], i = 1;
    if (estado && estado !== 'TODAS') { where.push(`estado=$${i++}`); params.push(estado); }
    if (buscar) {
      const q = `%${buscar.toLowerCase()}%`;
      where.push(`(LOWER(razon_social) LIKE $${i} OR LOWER(nit) LIKE $${i} OR LOWER(radicado) LIKE $${i} OR LOWER(rep_email) LIKE $${i} OR LOWER(rep_celular) LIKE $${i} OR LOWER(rep_nombre) LIKE $${i})`);
      params.push(q); i++;
    }
    const wc = where.length ? 'WHERE '+where.join(' AND ') : '';
    const countRes = await pool.query(`SELECT COUNT(*) FROM solicitudes_juridica ${wc}`, params);
    params.push(limit, offset);
    const rows = await pool.query(`SELECT * FROM solicitudes_juridica ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, params);
    res.json({ solicitudes: rows.rows.map(rowToSolicitudJuridica), total: Number(countRes.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET solicitud JURÍDICA :id ─────────────────────────────────────────────────
app.get('/api/admin/solicitudes-juridica/:id', authAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM solicitudes_juridica WHERE id::text=$1 OR radicado=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitudJuridica(r.rows[0]);
    const audit = await pool.query(`SELECT * FROM auditoria WHERE solicitud_id=$1 ORDER BY created_at DESC`, [sol.id]);
    sol.auditoria = audit.rows.map(a => ({ id:a.id, solicitudId:a.solicitud_id, accion:a.accion, usuario:a.usuario, detalle:a.detalle, createdAt:a.created_at }));
    res.json(sol);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH estado JURÍDICA ──────────────────────────────────────────────────────
app.patch('/api/admin/solicitudes-juridica/:id/estado', authAdmin, async (req, res) => {
  try {
    const { estado, nota, analista } = req.body;
    const estados = ['RADICADA','EN_ANALISIS','APROBADA','RECHAZADA','DESEMBOLSADA'];
    if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    const r = await pool.query(
      `UPDATE solicitudes_juridica SET estado=$1, nota_analista=COALESCE($2,nota_analista), analista=COALESCE($3,analista), updated_at=NOW() WHERE id::text=$4 OR radicado=$4 RETURNING *`,
      [estado, nota||null, analista||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitudJuridica(r.rows[0]);
    await auditLog(sol.id, `CAMBIO_ESTADO_${estado}`, analista||'admin', nota||'');
    res.json({ ok: true, solicitud: sol });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0,10);
    const [total, byEstado, hoyN, montoRes, recientes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM solicitudes'),
      pool.query('SELECT estado, COUNT(*) as cnt FROM solicitudes GROUP BY estado'),
      pool.query(`SELECT COUNT(*) FROM solicitudes WHERE created_at::date=$1`, [hoy]),
      pool.query(`SELECT COALESCE(SUM(monto_solicitado),0) as total FROM solicitudes WHERE estado IN ('APROBADA','DESEMBOLSADA')`),
      pool.query('SELECT id,radicado,primer_nombre,primer_apellido,monto_solicitado,estado,created_at FROM solicitudes ORDER BY created_at DESC LIMIT 10')
    ]);
    const em = {};
    byEstado.rows.forEach(r => { em[r.estado] = Number(r.cnt); });
    res.json({
      total: Number(total.rows[0].count),
      radicadas: em['RADICADA']||0, enAnalisis: em['EN_ANALISIS']||0,
      aprobadas: em['APROBADA']||0, rechazadas: em['RECHAZADA']||0,
      desembolsadas: em['DESEMBOLSADA']||0,
      hoy: Number(hoyN.rows[0].count), montoTotal: Number(montoRes.rows[0].total),
      recientes: recientes.rows.map(r => ({ id:r.id, radicado:r.radicado, primerNombre:r.primer_nombre, primerApellido:r.primer_apellido, montoSolicitado:r.monto_solicitado?Number(r.monto_solicitado):null, estado:r.estado, createdAt:r.created_at }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Exportar CSV ──────────────────────────────────────────────────────────────
app.get('/api/admin/exportar', authAdmin, async (req, res) => {
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
app.get('/api/admin/auditoria', authAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM auditoria ORDER BY created_at DESC LIMIT 200');
    res.json({ logs: r.rows.map(a => ({ id:a.id, solicitudId:a.solicitud_id, accion:a.accion, usuario:a.usuario, detalle:a.detalle, createdAt:a.created_at })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HTML ──────────────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const f = path.join(__dirname, 'admin.html');
  fs.existsSync(f) ? res.sendFile(f) : res.send('<h2>Admin not found</h2>');
});
app.get('*', (req, res) => {
  const f = path.join(__dirname, 'index.html');
  fs.existsSync(f) ? res.sendFile(f) : res.json({ ok:true, msg:'Financial Services API' });
});

// ── Arranque ──────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Financial Services en puerto ${PORT}`);
    console.log(`🐘 PostgreSQL conectado`);
    console.log(`📧 Email: ${SENDGRID_KEY ? 'activo' : 'inactivo (falta SENDGRID_API_KEY)'}`);
    console.log(`🌐 http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('❌ Error DB:', err.message);
  process.exit(1);
});
