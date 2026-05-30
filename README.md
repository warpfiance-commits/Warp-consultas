# Warp Solicitudes — Sistema independiente de formulario de crédito

## Estructura
```
warp-solicitudes/
├── backend/
│   ├── server.js       ← Express + SQLite
│   ├── package.json
│   └── railway.toml
└── frontend/
    ├── index.html      ← Formulario público (5 pasos)
    └── admin.html      ← Panel admin (login, solicitudes, auditoría)
```

## Deploy en Railway (backend + frontend juntos)

Railway sirve tanto el backend como el frontend estático.

### Pasos:

1. Crear nuevo repositorio en GitHub: `warp-solicitudes`
2. Subir TODA esta carpeta al repo
3. Ir a [railway.app](https://railway.app) → New Project → Deploy from GitHub
4. Seleccionar el repo `warp-solicitudes`
5. En Settings → Root Directory: escribir `backend`
6. Variables de entorno (Settings → Variables):
   ```
   ADMIN_USER=admin
   ADMIN_PASS=TuContraseñaSegura2024!
   ADMIN_TOKEN=tu-token-secreto-largo
   PORT=3000
   ```
7. Railway asigna una URL automáticamente: `https://warp-solicitudes-xxxx.up.railway.app`

### URLs resultantes:
- **Formulario público:** `https://tu-url.railway.app/`
- **Panel admin:** `https://tu-url.railway.app/admin`
- **API health:** `https://tu-url.railway.app/health`

## Credenciales por defecto (CAMBIAR antes de producción)
- Usuario: `admin`
- Contraseña: `WarpAdmin2024!`

## Base de datos
SQLite local en `backend/solicitudes.db`. Railway persiste el archivo entre deploys.
Para mayor robustez en producción, agregar Railway PostgreSQL y migrar.

## Funcionalidades
### Formulario público (/):
- 5 pasos: Identidad → Financiero → Laboral → Documentos → Declaraciones
- Genera radicado automático (WRP-AAMMDD-XXXX)
- Guarda en SQLite

### Panel admin (/admin):
- Login con usuario/contraseña
- Dashboard con estadísticas
- Listado con búsqueda y filtros por estado
- Ver detalle completo de cada solicitud
- Aprobar / Rechazar / Poner en análisis
- Log de auditoría inmutable
- Exportar CSV para Excel

## Test local
```bash
cd backend
npm install
node server.js
# Formulario: http://localhost:3001
# Admin: http://localhost:3001/admin
```
