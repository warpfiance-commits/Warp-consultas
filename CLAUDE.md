# warp-consultas

Sistema de solicitudes de crédito de Warp Finance: formulario público y panel
de administración interno.

## Cómo está desplegado (importante)

El README está desactualizado: dice Railway, pero **hoy no se usa Railway**.

| Parte | Dónde vive | Cómo se publica |
|---|---|---|
| `index.html`, `admin.html` | Hostinger — `form.warpfinance.co` | FTPS (`npm run deploy`) |
| `server.js` + PostgreSQL | Render — `warp-consultas.onrender.com` | push a GitHub, Render redespliega solo |

Las páginas y el backend están en **servidores distintos**. Por eso el HTML
llama a la API con la URL absoluta de Render (`const API = '...onrender.com'`),
no con `window.location.origin`.

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

Requiere `.env.deploy` con las credenciales FTP de Hostinger — no está en git.
Plantilla en `.env.deploy.example`.

## Pendientes conocidos

- **Credenciales en el código.** `server.js` líneas 19-26 tienen escritas la
  contraseña de admin, el secreto de Cloudinary y tokens. El repositorio es
  público en GitHub. Deberían pasar a variables de entorno en Render y luego
  rotarse.
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
