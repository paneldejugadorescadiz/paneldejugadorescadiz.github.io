# Panel de jugadores Cádiz

Web estática (GitHub Pages) con un listado de jugadores de Cádiz nacidos entre 2003 y 2007. De uso personal: **los datos solo se ven con una cuenta que tenga permiso**.

## Cómo funciona

```
Navegador ──(sesión de Supabase Auth)──► Supabase (tabla players)
                                              │
                         la base de datos decide con RLS si esa cuenta puede leer
```

- El repositorio solo contiene el código. **No hay datos en él**: viven en Supabase y solo se entregan a cuentas con permiso.
- La clave `publishable` de `js/config.js` es pública por diseño. Sin una sesión con permiso, la base de datos no devuelve nada.
- Cada cuenta tiene dos permisos **independientes**, guardados en la tabla `access`:
  - **Ver los datos** (`can_view`): puede leer los jugadores en `index.html`.
  - **Administrador** (`is_admin`): puede entrar en `admin.html` y gestionar permisos.
- Quitar un permiso surte efecto al instante: la base de datos lo comprueba en cada consulta.
- Nadie puede registrarse desde la web. Las cuentas las crea el propietario en Supabase.

## Gestionar cuentas

1. **Crear una cuenta:** en Supabase, *Authentication → Users → Add user* (correo y contraseña, con *Auto Confirm User* marcado).
2. La cuenta aparece sola en `admin.html`, **sin ningún permiso**.
3. En `admin.html`, activa *Ver los datos* y/o *Administrador*. Para retirar el acceso, desmarca la casilla.
4. Para borrar una cuenta del todo: *Authentication → Users* en Supabase.

Un administrador no puede quitarse a sí mismo el permiso de administrador, para no quedarse fuera.

## Desactivar el registro (importante)

En Supabase: *Authentication → Sign In / Providers → User Signups* → desactiva **Allow new users to sign up**. Así, aunque alguien llame a la API directamente, no puede crear cuentas.

## Estructura

| Ruta | Para qué sirve |
| --- | --- |
| `index.html`, `js/app.js` | Web con inicio de sesión, buscador y filtros |
| `admin.html`, `js/admin.js` | Gestión de cuentas y permisos |
| `js/auth.js`, `js/config.js` | Cliente de Supabase y sesión |
| `css/style.css` | Estilos |
| `supabase/migrations/` | SQL de las tablas y las políticas de seguridad |
| `supabase/functions/regenerate-lists/` | Función sin uso por ahora (ver abajo) |
| `.github/workflows/keepalive.yml` | Consulta periódica para que Supabase no se pause |

## Mantener Supabase activo

El plan gratuito de Supabase pausa los proyectos tras unos 7 días con poca actividad. `keepalive.yml` hace una consulta inocua cada 3 días. GitHub desactiva los workflows programados cuando un repositorio pasa 60 días sin actividad; si ocurre, vuelve a activarlo en la pestaña *Actions*.

## Pendiente

- **Bot de extracción:** la tabla `scrape_queue` y las columnas `position` y `photo_url` ya existen. Falta el script.
- La función `regenerate-lists` y el token `GITHUB_TOKEN` quedaron de la primera versión, que generaba listas JSON públicas. Ya no se usan; se reaprovecharán para lanzar el bot desde el panel.

## Datos personales

Aunque las fichas sean públicas, siguen siendo datos personales (RGPD). Conviene:

- Guardar solo lo necesario.
- Revisar las condiciones de uso de La Preferente antes de importar datos.
- Mantener el contacto de retirada de datos del pie de la web.
