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
// Cloudinary: las tres variables van en Render → Environment, nunca en el código.
const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY     = process.env.CLOUDINARY_API_KEY    || '';
const API_SECRET  = process.env.CLOUDINARY_API_SECRET || '';
if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.log('⚠️  Cloudinary sin configurar (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET) — no se podrán subir documentos');
}
// Acceso heredado de un solo usuario: solo funciona si ADMIN_PASS está definida
// en Render. Los usuarios reales viven en la tabla admin_usuarios.
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
// Primer administrador: se crea al arrancar si no existe ese email.
const ADMIN_INICIAL_EMAIL  = (process.env.ADMIN_INICIAL_EMAIL || '').trim().toLowerCase();
const ADMIN_INICIAL_NOMBRE = process.env.ADMIN_INICIAL_NOMBRE || 'Administrador';
const ADMIN_INICIAL_PASS   = process.env.ADMIN_INICIAL_PASS || '';
const SESION_HORAS = 12;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'warpfiance@gmail.com';
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || '';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
  console.log('✅ SendGrid configurado');
} else {
  console.log('⚠️  SENDGRID_API_KEY no definida — emails desactivados');
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────
// La URL interna de Render (host sin dominio, p. ej. dpg-xxxx-a) va sin SSL;
// las externas (…render.com, Neon, etc.) lo exigen.
function usarSSL(url) {
  if (!url) return false;
  try { return new URL(url).hostname.includes('.'); } catch { return true; }
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usarSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
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
      ref_nombre TEXT, ref_parentesco TEXT, ref_celular TEXT, ref_adicional TEXT, ref_direccion TEXT,
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
  await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS ref_direccion TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_usuarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ultimo_acceso TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_sesiones (
      token TEXT PRIMARY KEY,
      usuario_id UUID NOT NULL REFERENCES admin_usuarios(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expira TIMESTAMPTZ NOT NULL
    );
  `);
  if (ADMIN_INICIAL_EMAIL && ADMIN_INICIAL_PASS) {
    const r = await pool.query(
      `INSERT INTO admin_usuarios (email, nombre, pass_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [ADMIN_INICIAL_EMAIL, ADMIN_INICIAL_NOMBRE, await hashPassword(ADMIN_INICIAL_PASS)]
    );
    if (r.rows.length) console.log(`👤 Administrador inicial creado: ${ADMIN_INICIAL_EMAIL}`);
  }
  // Primer administrador del sistema. Solo va el hash: la contraseña no está en el repo.
  // Si ya existe (o se le cambió la clave desde el panel) no se toca.
  await pool.query(
    `INSERT INTO admin_usuarios (email, nombre, pass_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING`,
    ['admin@warpfinance.co', 'Jenifer Zuluaga', 'scrypt$d3b1df71c72b5c11b7752a86b0993e85$dd499e4142e2af768b88206452ace250ea5ccbbc6db078412f4c64e1e84e8ac3bd66f2818bc58e6a6a5a52765702b53a1cca9c6a1e61afc49c892bdbe6eca4e3']
  );
  console.log('✅ PostgreSQL tablas listas');
}

// ── Contraseñas (scrypt, sin dependencias) ────────────────────────────────────
function scryptAsync(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key)));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await scryptAsync(password, salt)).toString('hex')}`;
}
async function verificarPassword(password, guardado) {
  const [alg, salt, hash] = String(guardado).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  const calculado = await scryptAsync(password, salt);
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}
function igualSeguro(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
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
app.set('trust proxy', 1); // Render va detrás de un proxy: req.ip es la IP real
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use((req, res, next) => {
  console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}`);
  next();
});

const authAdmin = async (req, res, next) => {
  const token = String(req.headers['x-admin-token'] || req.query.token || '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  if (ADMIN_PASS && igualSeguro(token, ADMIN_TOKEN)) {
    req.admin = { id: null, email: ADMIN_USER, nombre: ADMIN_USER };
    return next();
  }
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.nombre FROM admin_sesiones s JOIN admin_usuarios u ON u.id=s.usuario_id
       WHERE s.token=$1 AND s.expira>NOW() AND u.activo`, [token]);
    if (!r.rows.length) return res.status(401).json({ error: 'No autorizado' });
    req.admin = r.rows[0];
    next();
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    refCelular: r.ref_celular, refAdicional: r.ref_adicional, refDireccion: r.ref_direccion,
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
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) throw new Error('Cloudinary sin configurar');
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
    const [r, rj] = await Promise.all([pool.query('SELECT COUNT(*) FROM solicitudes'), pool.query('SELECT COUNT(*) FROM solicitudes_juridica')]);
    res.json({ status: 'ok', db: 'postgresql', solicitudes: Number(r.rows[0].count), solicitudesJuridica: Number(rj.rows[0].count), email: !!SENDGRID_KEY, timestamp: new Date().toISOString() });
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
      // Persona Natural
      u0:'Documento — Frente', u1:'Documento — Reverso',
      u2:'Últimas 3 colillas de pago', u3:'Certificado laboral',
      u4:'RUT actualizado', u5:'Declaración de renta',
      u6:'Extractos bancarios — últimos 3 meses', u7:'Extracto bancario — Mes 2',
      u8:'Extracto bancario — Mes 3', u9:'Extracto banco alternativo',
      u10:'Recibo de servicios públicos', u12:'Documento de garantía / colateral',
      u13:'Selfie sosteniendo cédula', u14:'Reporte DataCrédito Experian',
      selfieLive:'Selfie en vivo', firma:'Firma electrónica',
      // Persona Jurídica
      'j-u0':'Cámara de comercio', 'j-u1':'RUT empresa',
      'j-u2':'Acta nombramiento rep. legal', 'j-u3':'Composición accionaria',
      'j-u4':'Cédula rep. legal — Frontal', 'j-u5':'Cédula rep. legal — Reverso',
      'j-u6':'Selfie rep. legal con cédula', 'j-u7':'Balance general',
      'j-u8':'Estado de resultados (P&G)', 'j-u9':'Declaración de renta empresa',
      'j-u10':'Estados financieros intermedios', 'j-u11':'Extractos bancarios de la empresa',
      'j-u12':'Extracto empresa — Mes 2', 'j-u13':'Extracto empresa — Mes 3',
      'j-u14':'Documento de garantía / colateral', 'j-u15':'Reporte DataCrédito Experian',
      'j-selfieLive':'Selfie en vivo del representante legal',
      // Compatibilidad con registros antiguos (claves descriptivas legacy)
      cedula_frontal:'Cédula Frontal', cedula_reverso:'Cédula Reverso',
      colillas:'Colillas de pago', certificado_laboral:'Certificado laboral',
      extracto_1:'Extracto mes 1', extracto_2:'Extracto mes 2',
      extracto_3:'Extracto mes 3', extracto_alt:'Extracto alternativo',
      rut:'RUT', declaracion_renta:'Declaración de renta',
      servicios:'Recibo servicios', camara:'Cámara de comercio',
      garantia:'Documento garantía', selfie:'Selfie con cédula'
    };

    const firmaRegistro = [
      data.firmaElectronica ? 'Firma escrita: ' + String(data.firmaElectronica).slice(0, 120) : (data.documentos?.firma ? 'Firma dibujada' : null),
      new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
      'IP ' + req.ip
    ].filter(Boolean).join(' · ');
    const nombreDoc = (key) => { const m = key.match(/^(.+)_(\d+)$/); return m && nombresDoc[m[1]] ? nombresDoc[m[1]] + " (archivo " + m[2] + ")" : (nombresDoc[key] || key); };
    const documentosUrls = {};
    // En paralelo: antes se subían uno tras otro y el cliente esperaba la suma de todos.
    if (data.documentos && typeof data.documentos === 'object') {
      await Promise.all(Object.entries(data.documentos).map(async ([key, fileData]) => {
        if (!fileData || !fileData.base64) return;
        const mimeType = fileData.tipo || '';
        try {
          const url = await uploadImageToCloudinary(fileData.base64, fileData.nombre||key, radicado, 'auto');
          documentosUrls[key] = { url, nombre: nombreDoc(key), nombreArchivo: fileData.nombre, tipo: mimeType, validacion: ['verificada','sin_verificar'].includes(fileData.validacion) ? fileData.validacion : undefined };
        } catch(e) {
          console.error(`✗ ${key}:`, e.message);
          documentosUrls[key] = { url: null, nombre: nombreDoc(key), error: e.message };
        }
      }));
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
        $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56
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
        firmaRegistro,
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
      firma_electronica, documentos, ref_direccion
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
      $32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,
      $45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60
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
      // El formulario envía decl_1..decl_6 en este orden (index.html, CONFIG.natural.checks)
      !!(data.declaracionVeracidad ?? data.decl_1), !!(data.autorizacionCentrales ?? data.decl_2),
      !!(data.autorizacionDatos ?? data.decl_3), !!(data.declaracionSarlaft ?? data.decl_4),
      !!(data.declaracionPep ?? data.decl_5), !!(data.autorizacionDebito ?? data.decl_6),
      firmaRegistro,
      JSON.stringify(documentosUrls),
      data.refDireccion||null
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
// Freno a la fuerza bruta: 10 intentos fallidos por IP cada 15 minutos.
const intentosFallidos = new Map();
const VENTANA_MS = 15 * 60 * 1000, MAX_INTENTOS = 10;
function bloqueado(ip) {
  const e = intentosFallidos.get(ip);
  if (!e || Date.now() - e.desde > VENTANA_MS) { intentosFallidos.delete(ip); return false; }
  return e.n >= MAX_INTENTOS;
}
function registrarFallo(ip) {
  const e = intentosFallidos.get(ip);
  if (!e || Date.now() - e.desde > VENTANA_MS) intentosFallidos.set(ip, { n: 1, desde: Date.now() });
  else e.n++;
}

app.post('/api/admin/login', async (req, res) => {
  try {
    const ip = req.ip;
    if (bloqueado(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const usuario = String(req.body.usuario || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const r = await pool.query(`SELECT * FROM admin_usuarios WHERE email=$1 AND activo`, [usuario]);
    const u = r.rows[0];
    if (u && await verificarPassword(password, u.pass_hash)) {
      intentosFallidos.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(`DELETE FROM admin_sesiones WHERE expira<NOW()`);
      await pool.query(
        `INSERT INTO admin_sesiones (token, usuario_id, expira) VALUES ($1,$2,NOW()+($3 || ' hours')::interval)`,
        [token, u.id, String(SESION_HORAS)]);
      await pool.query(`UPDATE admin_usuarios SET ultimo_acceso=NOW() WHERE id=$1`, [u.id]);
      return res.json({ ok: true, token, usuario: { email: u.email, nombre: u.nombre } });
    }
    if (ADMIN_PASS && igualSeguro(usuario, ADMIN_USER.toLowerCase()) && igualSeguro(password, ADMIN_PASS)) {
      intentosFallidos.delete(ip);
      return res.json({ ok: true, token: ADMIN_TOKEN, usuario: { email: ADMIN_USER, nombre: ADMIN_USER } });
    }
    registrarFallo(ip);
    res.status(401).json({ error: 'Credenciales incorrectas' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/logout', authAdmin, async (req, res) => {
  await pool.query(`DELETE FROM admin_sesiones WHERE token=$1`, [String(req.headers['x-admin-token'] || '')]).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/admin/yo', authAdmin, (req, res) => res.json(req.admin));

// ── Usuarios administradores ──────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rowToUsuario = u => ({ id:u.id, email:u.email, nombre:u.nombre, activo:u.activo, createdAt:u.created_at, ultimoAcceso:u.ultimo_acceso });

app.get('/api/admin/usuarios', authAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM admin_usuarios ORDER BY created_at`);
    res.json({ usuarios: r.rows.map(rowToUsuario) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/usuarios', authAdmin, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const nombre = String(req.body.nombre || '').trim();
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email inválido' });
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
    if (password.length < 10) return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres' });
    const r = await pool.query(
      `INSERT INTO admin_usuarios (email, nombre, pass_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, nombre, await hashPassword(password)]);
    if (!r.rows.length) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    await auditLog(null, 'USUARIO_CREADO', req.admin.email, email);
    res.json({ ok: true, usuario: rowToUsuario(r.rows[0]) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Activar/desactivar o cambiar contraseña. Ambas cosas cierran las sesiones abiertas del usuario.
app.patch('/api/admin/usuarios/:id', authAdmin, async (req, res) => {
  try {
    const { activo, password } = req.body;
    if (activo === false && req.admin.id === req.params.id)
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    if (password !== undefined && String(password).length < 10)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres' });
    const r = await pool.query(
      `UPDATE admin_usuarios SET activo=COALESCE($1,activo), pass_hash=COALESCE($2,pass_hash) WHERE id::text=$3 RETURNING *`,
      [typeof activo === 'boolean' ? activo : null, password !== undefined ? await hashPassword(String(password)) : null, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const u = r.rows[0];
    if (activo === false || password !== undefined)
      await pool.query(`DELETE FROM admin_sesiones WHERE usuario_id=$1 AND token<>$2`, [u.id, String(req.headers['x-admin-token'] || '')]);
    const accion = password !== undefined ? 'USUARIO_CAMBIO_CLAVE' : (u.activo ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO');
    await auditLog(null, accion, req.admin.email, u.email);
    res.json({ ok: true, usuario: rowToUsuario(u) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET solicitudes ───────────────────────────────────────────────────────────
app.get('/api/admin/solicitudes', authAdmin, async (req, res) => {
  try {
    let { estado, buscar, limit=100, offset=0 } = req.query;
    limit = Math.min(Number(limit), 200); offset = Number(offset);
    let where = [], params = [], i = 1;
    if (estado && estado !== 'TODAS') { where.push(`estado=$${i++}`); params.push(estado); }
    if (req.query.hoy === '1') where.push(`(created_at AT TIME ZONE 'America/Bogota')::date = (NOW() AT TIME ZONE 'America/Bogota')::date`);
    if (buscar) {
      const terminos = String(buscar).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
      for (const t of terminos) {
        where.push(`translate(lower(concat_ws(' ',primer_nombre,segundo_nombre,primer_apellido,segundo_apellido,num_documento,radicado,email,celular)),'áéíóúüñ','aeiouun') LIKE $${i++}`);
        params.push('%' + t + '%');
      }
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
    const { estado, nota } = req.body;
    const analista = req.admin.nombre;
    const estados = ['RADICADA','EN_ANALISIS','APROBADA','RECHAZADA','DESEMBOLSADA'];
    if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (String(nota||'').trim().length < 3) return res.status(400).json({ error: 'Escribe la nota de decisión antes de cambiar el estado' });
    const r = await pool.query(
      `UPDATE solicitudes SET estado=$1, nota_analista=COALESCE($2,nota_analista), analista=COALESCE($3,analista), updated_at=NOW() WHERE id::text=$4 OR radicado=$4 RETURNING *`,
      [estado, nota||null, analista||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitud(r.rows[0]);
    await auditLog(sol.id, `CAMBIO_ESTADO_${estado}`, req.admin.email, nota||'');
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
    if (req.query.hoy === '1') where.push(`(created_at AT TIME ZONE 'America/Bogota')::date = (NOW() AT TIME ZONE 'America/Bogota')::date`);
    if (buscar) {
      const terminos = String(buscar).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
      for (const t of terminos) {
        where.push(`translate(lower(concat_ws(' ',razon_social,nit,radicado,rep_nombre,rep_apellido,rep_num_doc,rep_email,rep_celular)),'áéíóúüñ','aeiouun') LIKE $${i++}`);
        params.push('%' + t + '%');
      }
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
    const { estado, nota } = req.body;
    const analista = req.admin.nombre;
    const estados = ['RADICADA','EN_ANALISIS','APROBADA','RECHAZADA','DESEMBOLSADA'];
    if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (String(nota||'').trim().length < 3) return res.status(400).json({ error: 'Escribe la nota de decisión antes de cambiar el estado' });
    const r = await pool.query(
      `UPDATE solicitudes_juridica SET estado=$1, nota_analista=COALESCE($2,nota_analista), analista=COALESCE($3,analista), updated_at=NOW() WHERE id::text=$4 OR radicado=$4 RETURNING *`,
      [estado, nota||null, analista||null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const sol = rowToSolicitudJuridica(r.rows[0]);
    await auditLog(sol.id, `CAMBIO_ESTADO_${estado}`, req.admin.email, nota||'');
    res.json({ ok: true, solicitud: sol });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
// ── Contadores pendientes (Natural / Jurídica) ─────────────────────────────────
app.get('/api/admin/contadores', authAdmin, async (req, res) => {
  try {
    const [pendN, pendJ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM solicitudes WHERE estado IN ('RADICADA','EN_ANALISIS')`),
      pool.query(`SELECT COUNT(*) FROM solicitudes_juridica WHERE estado IN ('RADICADA','EN_ANALISIS')`)
    ]);
    res.json({
      pendientesNatural: Number(pendN.rows[0].count),
      pendientesJuridica: Number(pendJ.rows[0].count)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
  try {
    // Natural y jurídica juntas: el panel es de todas las solicitudes.
    const ambas = `(SELECT estado, created_at, monto_solicitado FROM solicitudes
                    UNION ALL SELECT estado, created_at, monto_solicitado FROM solicitudes_juridica) t`;
    const hoyBogota = `(created_at AT TIME ZONE 'America/Bogota')::date = (NOW() AT TIME ZONE 'America/Bogota')::date`;
    const [byEstado, hoyN, montoRes, recN, recJ] = await Promise.all([
      pool.query(`SELECT estado, COUNT(*) AS cnt FROM ${ambas} GROUP BY estado`),
      pool.query(`SELECT COUNT(*) FROM ${ambas} WHERE ${hoyBogota}`),
      pool.query(`SELECT COALESCE(SUM(monto_solicitado),0) AS total FROM ${ambas} WHERE estado IN ('APROBADA','DESEMBOLSADA')`),
      pool.query('SELECT * FROM solicitudes ORDER BY created_at DESC LIMIT 10'),
      pool.query('SELECT * FROM solicitudes_juridica ORDER BY created_at DESC LIMIT 10')
    ]);
    const em = {};
    byEstado.rows.forEach(r => { em[r.estado] = Number(r.cnt); });
    const recientes = [
      ...recN.rows.map(r => ({ ...rowToSolicitud(r), tipo: 'natural' })),
      ...recJ.rows.map(r => ({ ...rowToSolicitudJuridica(r), tipo: 'juridica' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
    res.json({
      total: Object.values(em).reduce((a, b) => a + b, 0),
      radicadas: em['RADICADA']||0, enAnalisis: em['EN_ANALISIS']||0,
      aprobadas: em['APROBADA']||0, rechazadas: em['RECHAZADA']||0,
      desembolsadas: em['DESEMBOLSADA']||0,
      hoy: Number(hoyN.rows[0].count), montoTotal: Number(montoRes.rows[0].total),
      recientes
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Exportar CSV ──────────────────────────────────────────────────────────────
app.get('/api/admin/exportar', authAdmin, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const [nat, jur] = await Promise.all([
      pool.query('SELECT * FROM solicitudes ORDER BY created_at DESC'),
      pool.query('SELECT * FROM solicitudes_juridica ORDER BY created_at DESC')
    ]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Finanzas Inteligentes';
    // Fecha en hora de Bogotá como fecha real de Excel (no texto)
    const fecha = (d) => d ? new Date(new Date(d).getTime() - 5 * 3600 * 1000) : null;
    const num = (x) => x == null || x === '' ? null : Number(x);
    const ESTADOS = { RADICADA:'Radicada', EN_ANALISIS:'En análisis', APROBADA:'Aprobada', RECHAZADA:'Rechazada', DESEMBOLSADA:'Desembolsada' };
    const hoja = (nombre, cols, filas) => {
      const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map(([header, , w, fmt]) => ({ header, width: w || 16, style: fmt ? { numFmt: fmt } : {} }));
      filas.forEach(row => ws.addRow(cols.map(([, f]) => f(row))));
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
      h.alignment = { vertical: 'middle' }; h.height = 22;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    };
    const $ = '"$"#,##0', F = 'dd/mm/yyyy hh:mm';
    hoja('Persona natural', [
      ['Radicado', r => r.radicado, 18], ['Estado', r => ESTADOS[r.estado] || r.estado, 13], ['Fecha', r => fecha(r.created_at), 17, F],
      ['Nombres', r => [r.primer_nombre, r.segundo_nombre].filter(Boolean).join(' '), 20], ['Apellidos', r => [r.primer_apellido, r.segundo_apellido].filter(Boolean).join(' '), 20],
      ['Tipo doc.', r => r.tipo_documento, 18], ['N° documento', r => r.num_documento, 15], ['Email', r => r.email, 28], ['Celular', r => r.celular, 15],
      ['Ciudad', r => r.ciudad, 15], ['Departamento', r => r.departamento, 15],
      ['Monto solicitado', r => num(r.monto_solicitado), 16, $], ['Plazo', r => r.plazo, 11], ['Destino', r => r.destino_credito, 20], ['Garantía', r => r.garantia, 20],
      ['Ingresos', r => num(r.ingresos_mensuales), 14, $], ['Ingresos adicionales', r => num(r.ingresos_adicionales), 14, $],
      ['Egresos', r => num(r.egresos_mensuales), 14, $], ['Obligaciones', r => num(r.obligaciones_financieras), 14, $],
      ['Situación laboral', r => r.situacion_laboral, 20], ['Empresa', r => r.empresa, 22], ['Cargo', r => r.cargo, 18],
      ['Antigüedad', r => r.antiguedad, 15], ['Tipo contrato', r => r.tipo_contrato, 18], ['Vivienda', r => r.tipo_vivienda, 22],
      ['Analista', r => r.analista, 18], ['Nota de decisión', r => r.nota_analista, 34]
    ], nat.rows);
    hoja('Persona jurídica', [
      ['Radicado', r => r.radicado, 18], ['Estado', r => ESTADOS[r.estado] || r.estado, 13], ['Fecha', r => fecha(r.created_at), 17, F],
      ['Razón social', r => r.razon_social, 28], ['NIT', r => r.nit, 15], ['Tipo sociedad', r => r.tipo_sociedad, 16], ['Ciudad', r => r.ciudad, 15],
      ['Representante legal', r => [r.rep_nombre, r.rep_apellido].filter(Boolean).join(' '), 24], ['Doc. representante', r => r.rep_num_doc, 15],
      ['Celular', r => r.rep_celular, 15], ['Email', r => r.rep_email, 28],
      ['Ventas anuales', r => num(r.ventas_anuales), 16, $], ['Ingresos mensuales', r => num(r.ingresos_mensuales), 16, $],
      ['Total activos', r => num(r.total_activos), 16, $], ['Total pasivos', r => num(r.total_pasivos), 16, $],
      ['Egresos', r => num(r.egresos_mensuales), 14, $], ['Obligaciones', r => num(r.obligaciones), 14, $],
      ['Monto solicitado', r => num(r.monto_solicitado), 16, $], ['Plazo', r => r.plazo, 11], ['Destino', r => r.destino_credito, 20], ['Garantía', r => r.garantia, 20],
      ['Analista', r => r.analista, 18], ['Nota de decisión', r => r.nota_analista, 34]
    ], jur.rows);
    const hoyTxt = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="solicitudes-${hoyTxt}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
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
