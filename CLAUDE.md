# warp-consultas

Sistema de solicitudes de crédito de **Finanzas Inteligentes**: formulario
público y panel de administración interno. Es un sistema **independiente de
warpfinance.co** (el sitio principal, en React + Firebase). Este repositorio
solo contiene Finanzas Inteligentes; no mezclar cambios de warpfinance aquí.

## Aislamiento en Hostinger

Finanzas Inteligentes vive en `form.warpfinance.co`, carpeta
`/public_html/form` dentro del plan Premium. **`/public_html` es el sitio
principal de warpfinance: nunca publicar ahí.** La publicación usa una cuenta
FTP propia (`u858606443.deployform`) cuyo directorio es solo `/public_html/form`.
Hay otras cuentas FTP (`deploy`, `pruebas01`) que apuntan a otras carpetas y
no deben usarse para publicar.

## Cómo está desplegado (importante)

El README está desactualizado: dice Railway, pero **hoy no se usa Railway**.

| Parte | Dónde vive | Cómo se publica |
|---|---|---|
| `index.html`, `admin.html` | Hostinger — `form.warpfinance.co` | push a GitHub → Action `publicar-paginas.yml` sube por FTPS |
| `server.js` | Render (cuenta propia, GitHub warpfiance-commits) — `warp-consultas-t6sj.onrender.com`, Ohio | push a GitHub, Render redespliega solo (Blueprint `render.yaml`) |
| PostgreSQL | Neon, proyecto en AWS us-east-2 (Ohio), plan gratis sin vencimiento | — (`DATABASE_URL` en Render) |

Desde 2026-09-30 se usa este Render + Neon. El servicio viejo
`warp-consultas.onrender.com` estaba en una cuenta de Render a la que nadie
tiene acceso; sus datos (4 solicitudes de prueba) se dejaron atrás.

Las páginas y el backend están en **servidores distintos**. Por eso el HTML
llama a la API con la URL absoluta de Render. Si la página se sirve desde
el propio Render (`…onrender.com/admin`), usa `location.origin`.

## Trabajar en local

```bash
npm run dev      # http://localhost:5180
```

Recarga el navegador al guardar. Sin dependencias, es `dev.mjs` en Node puro.

El puerto es 5180 y no 5173 porque **5173 lo ocupa el Vite del proyecto
warpfinance**, que suele estar corriendo en paralelo.

> **Cuidado:** el panel en local pega contra la API de producción, con datos
> reales. Aprobar o rechazar una solicitud desde localhost **la cambia de
> verdad**. No hay entorno de pruebas todavía.

## Publicar

```bash
npm run deploy
```

Sube el backend a GitHub (→ Render) y las páginas a Hostinger, y después
verifica que lo publicado coincida byte a byte con lo local.

Normalmente basta con `git push`: Render redespliega el backend y la Action
`.github/workflows/publicar-paginas.yml` sube las páginas cuando cambian
(`node deploy.mjs --paginas`). Las credenciales FTP van como secrets de GitHub
(`FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_DIR`).

`npm run deploy` queda como camino manual; requiere `.env.deploy` (no está en
git, plantilla en `.env.deploy.example`).

## Acceso al panel

Usuarios en la tabla `admin_usuarios` (contraseñas con scrypt), sesiones de
12 h en `admin_sesiones`. Se gestionan desde la sección Usuarios del panel.
El primer administrador se crea al arrancar desde las variables de Render
`ADMIN_INICIAL_EMAIL`, `ADMIN_INICIAL_NOMBRE`, `ADMIN_INICIAL_PASS` (solo si ese
email no existe; no pisa cambios hechos desde el panel). El acceso viejo
`ADMIN_USER`/`ADMIN_PASS` solo funciona si `ADMIN_PASS` está definida en Render.

El panel se refresca solo cada 30 s (no mientras hay un detalle abierto).

## Pendientes conocidos

- **Migrar a dominio propio** cuando se compre (hoy es un subdominio de
  warpfinance.co). Nota: el plan Premium marca 3/3 sitios, hay que liberar un
  cupo o subir de plan. Al migrar: nueva carpeta y cuenta FTP, actualizar
  `FTP_*` en GitHub, la URL en `mantener-despierto.yml` si cambia el backend.
- **Repo limpio para migración:** renombrar `Warp-consultas` a un nombre sin
  "warp", y evaluar cuentas de servicio propias de la empresa (GitHub, Render,
  Neon hoy están bajo warpfiance-commits / warpfiance@gmail.com).
- **Demora de Render gratis:** hoy se mitiga con `mantener-despierto.yml`
  (GitHub, cada 5 min); mejor cron-job.org cada 2 min, o Render Starter.
- **Secreto de Cloudinary en el código.** `server.js` todavía trae escritos
  `CLOUDINARY_API_KEY`/`API_SECRET`. El repositorio es público: pasarlos a
  Render y rotarlos. (La clave y el token de admin ya se quitaron del código.)
- **XSS en el panel.** Los datos del formulario público se pintan en admin.html
  sin escapar; un nombre con HTML podría robar la sesión de un admin. Existe el
  helper `esc()` en admin.html, falta aplicarlo en las tablas y el detalle.
- El README menciona Railway y SQLite; ya no aplica ninguno de los dos.
- No hay entorno de pruebas separado del de producción.

## Cuidado al editar

Antes de tocar `index.html` o `admin.html`, verifica que la copia local
coincida con lo publicado:

```bash
curl -s https://form.warpfinance.co/admin.html | diff - admin.html
```

Ya pasó una vez que producción tenía cambios (todo el diseño móvil) que nunca
volvieron al repositorio, y editar sobre la copia vieja los habría borrado.
