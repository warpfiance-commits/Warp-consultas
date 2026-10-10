# warp-consultas

Sistema de solicitudes de crédito de **Finanzas Inteligentes**: formulario
público y panel de administración interno. Es un sistema **independiente de
warpfinance.co** (el sitio principal, en React + Firebase). Este repositorio
solo contiene Finanzas Inteligentes; no mezclar cambios de warpfinance aquí.

## Aislamiento en Hostinger

Finanzas Inteligentes vive en `form.warpfinance.co`, carpeta
`/public_html/form` dentro del plan Premium. **`/public_html` es el sitio
principal de warpfinance: nunca publicar ahí.** Cada sistema tiene su cuenta
FTP, encerrada en su carpeta, y nunca se comparten:

| Sistema | Repo | Cuenta FTP | Carpeta |
|---|---|---|---|
| Finanzas Inteligentes | `Warp-consultas` (secrets `FTP_*`) | `u858606443.deployfinanzas` | `/public_html/form` |
| warpfinance.co | `warpfinance-funcional` (secrets `FTP_*`) | `u858606443.deploy` | `/public_html` |

`pruebas01` (apunta a `/public_html/public_html`) no se usa. La carpeta del
formulario lleva la marca `finanzas-inteligentes.txt`; el deploy de warpfinance
tiene un freno que cancela si la ve.

### Si form.warpfinance.co "no abre" o muestra otra página

1. `curl -s https://form.warpfinance.co/ | grep -o "<title>[^<]*"` — debe decir
   "Solicitud de Crédito". Si dice "Warp Finance", alguien publicó encima.
2. GitHub Actions → **Revisar carpeta en Hostinger** (sin parámetros) lista la carpeta.
3. Mismo workflow con `borrar` = archivos ajenos (p. ej. `assets .htaccess
   .ftp-deploy-sync-state-v2.json`). Nunca borra index.html ni admin.html.
4. **Publicar páginas en Hostinger** → Run workflow, para restaurar el formulario.
5. Buscar la causa: `gh run list -R warpfiance-commits/warpfinance-funcional` y
   `gh secret list -R warpfiance-commits/warpfinance-funcional` (fecha de cambio).

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

- **Claves en texto plano en ~/.claude/settings.json** (reglas de permiso viejas de la sesión
  de warpfinance): una API key de Brevo y un client secret de Google. Rotarlas y borrar esas líneas.
- **Opcional:** cambiar la contraseña de `deployfinanzas` (estuvo un día en los secrets de
  warpfinance-funcional) y actualizar `FTP_PASS` en este repo.
- **Monitoreo del formulario:** UptimeRobot con monitor de palabra clave "Solicitud de Crédito"
  en https://form.warpfinance.co para enterarse en minutos si alguien lo pisa.

- **Incidente 2026-10-08:** el proyecto warpfinance-funcional (workflow `deploy.yml`, server-dir `../`)
  quedó con la cuenta FTP `deployfinanzas` en sus secrets y publicó warpfinance dentro de
  `/public_html/form`, tumbando el formulario. Se limpió con el workflow "Revisar carpeta en
  Hostinger" y se republicó. La carpeta lleva la marca `finanzas-inteligentes.txt`. Desde el
  2026-10-09 el deploy de warpfinance tiene un freno (paso "Verificar destino FTP") que cancela
  si ve esa marca, y usa server-dir `./` pensado para la cuenta `u858606443.deploy`. Falta que
  sus secrets FTP_* usen esa cuenta.

- **Migrar a dominio propio** cuando se compre (hoy es un subdominio de
  warpfinance.co). Nota: el plan Premium marca 3/3 sitios, hay que liberar un
  cupo o subir de plan. Al migrar: nueva carpeta y cuenta FTP, actualizar
  `FTP_*` en GitHub, la URL en `mantener-despierto.yml` si cambia el backend.
- **Repo limpio para migración:** renombrar `Warp-consultas` a un nombre sin
  "warp", y evaluar cuentas de servicio propias de la empresa (GitHub, Render,
  Neon hoy están bajo warpfiance-commits / warpfiance@gmail.com).
- **Demora de Render gratis:** hoy se mitiga con `mantener-despierto.yml`
  (GitHub, cada 5 min); mejor cron-job.org cada 2 min, o Render Starter.
- **Borrar la clave vieja de Cloudinary** (la que empieza por `985348`) en la
  consola de Cloudinary: estuvo en el repo público. Las claves nuevas ya viven
  solo en las variables de Render (`CLOUDINARY_*`); el código no trae ninguna.
- **Validación profesional de identidad (KYC).** Hoy la foto del documento se
  valida en el navegador (Tesseract.js): que parezca el documento del tipo
  elegido y que el número coincida. No detecta falsificaciones. Evaluar un
  proveedor KYC en Colombia (Truora, MetaMap…) que cruce con Registraduría y
  compare la cara con la selfie. Las fotos "sin verificar" se marcan en el panel.
- **Score:** scorecard experta de 100 puntos por las 5 C, en `admin.html` (`calcScore`). La cuota se
  estima con `TASA_MENSUAL` = 2 % M.V. de referencia: poner la tasa real. Cuando haya
  historial de pagos (pagó / no pagó), recalibrar con regresión logística (WoE + PDO).
  Personas jurídicas aún no tienen score.
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
