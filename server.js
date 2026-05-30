const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { solicitudes: [], auditoria: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dtoq5nbz4';
const API_KEY    = process.env.CLOUDINARY_API_KEY    || '985348958691353';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || 'N8mnqMCA_xVtSzxL4p13YVvhnLM';

const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'WarpAdmin2024!';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'warp-token-secreto-2024';

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

function generarRadicado() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const rand = Math.floor(Math.random()*9000)+1000;
  return `WRP-${yy}${mm}${dd}-${rand}`;
}

function auditLog(solicitudId, accion, usuario, detalle) {
  const db = readDB();
  db.auditoria.unshift({ id: uuidv4(), solicitudId, accion, usuario: usuario||'sistema', detalle: detalle||'', createdAt: new Date().toISOString() });
  if (db.auditoria.length > 500) db.auditoria = db.auditoria.slice(0, 500);
  writeDB(db);
}

async function uploadToCloudinary(base64Data, fileName, folder) {
  // Detectar tipo
  const mimeMatch = base64Data.match(/data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const isPdf = mimeType.includes('pdf');
  const resourceType = isPdf ? 'raw' : 'image';

  // Limpiar base64
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `warp-solicitudes/${folder}/${Date.now()}_${(fileName||'doc').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  // Firma correcta incluyendo resource_type para raw
  const paramsToSign = isPdf
    ? `public_id=${publicId}&timestamp=${timestamp}`
    : `public_id=${publicId}&timestamp=${timestamp}`;
  
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex');

  // Construir form data
  const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
  const fileData = Buffer.from(base64, 'base64');
  
  let body = '';
  const addField = (name, value) => {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  };
  
  addField('api_key', API_KEY);
  addField('timestamp', timestamp);
  addField('signature', signature);
  addField('public_id', publicId);

  const bodyBefore = Buffer.from(body, 'utf8');
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName||'file'}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const bodyAfter = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const requestBody = Buffer.concat([bodyBefore, fileHeader, fileData, bodyAfter]);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': requestBody.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('Cloudinary response:', json.secure_url || json.error);
          if (json.secure_url) resolve(json.secure_url);
          else reject(new Error(json.error?.message || JSON.stringify(json)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

app.get('/health', (req, res) => {
  const db = readDB();
  res.json({ status: 'ok', solicitudes: db.solicitudes.length, timestamp: new Date().toISOString() });
});

app.post('/api/solicitudes', async (req, res) => {
  try {
    const db = readDB();
    const id = uuidv4();
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
    if (data.documentos && typeof data.documentos === 'object') {
      for (const [key, fileData] of Object.entries(data.documentos)) {
        if (fileData && fileData.base64) {
          try {
            console.log(`Subiendo: ${key} (${fileData.tipo})`);
            const url = await uploadToCloudinary(fileData.base64, fileData.nombre||key, radicado);
            documentosUrls[key] = { url, nombre: nombresDoc[key]||key, nombreArchivo: fileData.nombre };
            console.log(`✓ ${key}: ${url}`);
          } catch(e) {
            console.error(`✗ ${key}:`, e.message);
            documentosUrls[key] = { url: null, nombre: nombresDoc[key]||key, error: e.message };
          }
        }
      }
    }

    const solicitud = {
      id, radicado, estado: 'RADICADA',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      tipoDocumento: data.tipoDocumento||null, numDocumento: data.numDocumento||null,
      primerNombre: data.primerNombre||null, segundoNombre: data.segundoNombre||null,
      primerApellido: data.primerApellido||null, segundoApellido: data.segundoApellido||null,
      fechaNacimiento: data.fechaNacimiento||null, paisNacimiento: data.paisNacimiento||null,
      ciudadNacimiento: data.ciudadNacimiento||null, genero: data.genero||null,
      celular: data.celular||null, telefonoAlt: data.telefonoAlt||null,
      email: data.email||null, emailAlt: data.emailAlt||null,
      departamento: data.departamento||null, ciudad: data.ciudad||null,
      barrio: data.barrio||null, direccion: data.direccion||null,
      tipoVivienda: data.tipoVivienda||null, tiempoVivienda: data.tiempoVivienda||null,
      ingresosMensuales: data.ingresosMensuales?Number(data.ingresosMensuales):null,
      fuenteIngresos: data.fuenteIngresos||null,
      ingresosAdicionales: data.ingresosAdicionales?Number(data.ingresosAdicionales):null,
      conceptoIngresosAd: data.conceptoIngresosAd||null,
      egresosMensuales: data.egresosMensuales?Number(data.egresosMensuales):null,
      obligacionesFinancieras: data.obligacionesFinancieras?Number(data.obligacionesFinancieras):null,
      banco: data.banco||null, tipoCuenta: data.tipoCuenta||null,
      numeroCuenta: data.numeroCuenta||null, otrasCuentas: data.otrasCuentas||null,
      montoSolicitado: data.montoSolicitado?Number(data.montoSolicitado):null,
      plazo: data.plazo||null, garantia: data.garantia||null, destinoCredito: data.destinoCredito||null,
      situacionLaboral: data.situacionLaboral||null, sectorEconomico: data.sectorEconomico||null,
      empresa: data.empresa||null, nitEmpresa: data.nitEmpresa||null,
      cargo: data.cargo||null, antiguedad: data.antiguedad||null,
      tipoContrato: data.tipoContrato||null, telefonoTrabajo: data.telefonoTrabajo||null,
      direccionTrabajo: data.direccionTrabajo||null,
      estadoCivil: data.estadoCivil||null, nivelEducativo: data.nivelEducativo||null,
      numeroDependientes: data.numeroDependientes||null,
      refNombre: data.refNombre||null, refParentesco: data.refParentesco||null,
      refCelular: data.refCelular||null, refAdicional: data.refAdicional||null,
      declaracionVeracidad: !!data.declaracionVeracidad,
      autorizacionCentrales: !!data.autorizacionCentrales,
      autorizacionDatos: !!data.autorizacionDatos,
      declaracionSarlaft: !!data.declaracionSarlaft,
      declaracionPep: !!data.declaracionPep,
      autorizacionDebito: !!data.autorizacionDebito,
      firmaElectronica: data.firmaElectronica||null,
      documentos: documentosUrls,
      notaAnalista: null, analista: null
    };

    db.solicitudes.unshift(solicitud);
    writeDB(db);
    auditLog(id, 'SOLICITUD_CREADA', 'solicitante', `Radicado: ${radicado} | Docs: ${Object.keys(documentosUrls).length}`);
    res.status(201).json({ ok: true, radicado, mensaje: '¡Solicitud enviada exitosamente!' });
  } catch(err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Error guardando la solicitud.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { usuario, password } = req.body;
  if (usuario === ADMIN_USER && password === ADMIN_PASS) return res.json({ ok: true, token: ADMIN_TOKEN });
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.get('/api/admin/solicitudes', authAdmin, (req, res) => {
  let { estado, buscar, limit=100, offset=0 } = req.query;
  const db = readDB();
  let lista = db.solicitudes;
  if (estado && estado !== 'TODAS') lista = lista.filter(s => s.estado === estado);
  if (buscar) {
    const q = buscar.toLowerCase();
    lista = lista.filter(s =>
      (s.primerNombre||'').toLowerCase().includes(q) ||
      (s.primerApellido||'').toLowerCase().includes(q) ||
      (s.numDocumento||'').toLowerCase().includes(q) ||
      (s.radicado||'').toLowerCase().includes(q) ||
      (s.email||'').toLowerCase().includes(q) ||
      (s.celular||'').toLowerCase().includes(q));
  }
  const total = lista.length;
  lista = lista.slice(Number(offset), Number(offset)+Number(limit));
  res.json({ solicitudes: lista, total });
});

app.get('/api/admin/solicitudes/:id', authAdmin, (req, res) => {
  const db = readDB();
  const sol = db.solicitudes.find(s => s.id === req.params.id || s.radicado === req.params.id);
  if (!sol) return res.status(404).json({ error: 'No encontrada' });
  const auditoria = db.auditoria.filter(a => a.solicitudId === sol.id);
  res.json({ ...sol, auditoria });
});

app.patch('/api/admin/solicitudes/:id/estado', authAdmin, (req, res) => {
  const { estado, nota, analista } = req.body;
  const estados = ['RADICADA','EN_ANALISIS','APROBADA','RECHAZADA','DESEMBOLSADA'];
  if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  const db = readDB();
  const idx = db.solicitudes.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  db.solicitudes[idx].estado = estado;
  db.solicitudes[idx].notaAnalista = nota || db.solicitudes[idx].notaAnalista;
  db.solicitudes[idx].analista = analista || db.solicitudes[idx].analista;
  db.solicitudes[idx].updatedAt = new Date().toISOString();
  writeDB(db);
  auditLog(req.params.id, `CAMBIO_ESTADO_${estado}`, analista||'admin', nota||'');
  res.json({ ok: true, solicitud: db.solicitudes[idx] });
});

app.get('/api/admin/dashboard', authAdmin, (req, res) => {
  const db = readDB();
  const hoy = new Date().toISOString().slice(0,10);
  const total = db.solicitudes.length;
  const radicadas = db.solicitudes.filter(s=>s.estado==='RADICADA').length;
  const enAnalisis = db.solicitudes.filter(s=>s.estado==='EN_ANALISIS').length;
  const aprobadas = db.solicitudes.filter(s=>s.estado==='APROBADA').length;
  const rechazadas = db.solicitudes.filter(s=>s.estado==='RECHAZADA').length;
  const hoyN = db.solicitudes.filter(s=>s.createdAt.startsWith(hoy)).length;
  const montoTotal = db.solicitudes.filter(s=>['APROBADA','DESEMBOLSADA'].includes(s.estado)).reduce((a,s)=>a+(s.montoSolicitado||0),0);
  const recientes = db.solicitudes.slice(0,10).map(({id,radicado,primerNombre,primerApellido,montoSolicitado,estado,createdAt})=>({id,radicado,primerNombre,primerApellido,montoSolicitado,estado,createdAt}));
  res.json({ total, radicadas, enAnalisis, aprobadas, rechazadas, hoy: hoyN, montoTotal, recientes });
});

app.get('/api/admin/exportar', authAdmin, (req, res) => {
  const db = readDB();
  const cols = ['radicado','estado','createdAt','primerNombre','primerApellido','tipoDocumento','numDocumento','email','celular','ciudad','departamento','montoSolicitado','plazo','destinoCredito','ingresosMensuales','egresosMensuales','obligacionesFinancieras','situacionLaboral','tipoContrato','empresa','garantia','firmaElectronica','notaAnalista'];
  let csv = cols.join(',') + '\n';
  for (const s of db.solicitudes) {
    csv += cols.map(c => `"${(s[c]!=null?s[c]:'').toString().replace(/"/g,'""')}"`).join(',') + '\n';
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="solicitudes-warp.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/admin/auditoria', authAdmin, (req, res) => {
  const db = readDB();
  res.json({ logs: db.auditoria.slice(0,200) });
});

app.get('/admin', (req, res) => {
  const f = path.join(__dirname, 'admin.html');
  fs.existsSync(f) ? res.sendFile(f) : res.send('<h2>Admin not found</h2>');
});

app.get('*', (req, res) => {
  const f = path.join(__dirname, 'index.html');
  fs.existsSync(f) ? res.sendFile(f) : res.json({ ok: true, msg: 'Warp Solicitudes API' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Warp Solicitudes en puerto ${PORT}`);
  console.log(`☁️  Cloudinary: ${CLOUD_NAME}`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
