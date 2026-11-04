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

## Favoritos

Cada jugador tiene una estrella ☆. Los favoritos son **por cuenta**: cada una ve y cambia solo los suyos (tabla `favorites` con RLS, y solo si la cuenta tiene *Ver los datos*). El botón *★ Favoritos* de la web enseña únicamente tus favoritos, agrupados por posición, y respeta el buscador, el año y el club.

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
| `scripts/scrape-players.mjs`, `scripts/lib/ficha.mjs` | Bot de extracción de fichas y lector de fichas |
| `scripts/crawl-teams.mjs`, `scripts/lib/team.mjs` | Bot de equipos: recorre plantillas y llena la cola de fichas |
| `.github/workflows/crawl-teams.yml` | Lanza el bot de equipos a mano |
| `.github/workflows/scrape-players.yml` | Lanza el bot a mano desde la pestaña *Actions* |
| `.github/workflows/keepalive.yml` | Consulta periódica para que Supabase no se pause |

## Mantener Supabase activo

El plan gratuito de Supabase pausa los proyectos tras unos 7 días con poca actividad. `keepalive.yml` hace una consulta inocua cada 3 días. GitHub desactiva los workflows programados cuando un repositorio pasa 60 días sin actividad; si ocurre, vuelve a activarlo en la pestaña *Actions*.

## Bot de extracción

Lee fichas de jugadores de La Preferente y las guarda en la tabla `players`. Trabaja con una **cola** (`scrape_queue`): solo procesa las URLs que tú metes en ella.

**Preparación (una vez):** en GitHub, *Settings → Secrets and variables → Actions → New repository secret*, con el nombre `SUPABASE_SERVICE_ROLE_KEY` y la clave secreta (`service_role`) de Supabase, que está en *Project Settings → API Keys*. Esa clave nunca va en el código ni en el chat.

**Cada prueba:**

1. **Añadir URLs a la cola**, en el *SQL Editor* de Supabase:
   ```sql
   insert into public.scrape_queue (url) values
     ('https://www.lapreferente.com/J000000C0/club/nombre.html'),
     ('https://www.lapreferente.com/J000001C0/club/otro.html')
   on conflict (url) do nothing;
   ```
2. **Ejecutar:** *Actions → Bot de extracción → Run workflow*, con el número de fichas (por defecto 10, máximo 50).
3. **Ver el resultado:** en *Table Editor → scrape_queue*. Cada URL tiene `status` (`done`, `skipped`, `failed` o `pending`), `attempts`, `note` con el motivo y, si no entendió la página, `snippet` con el principio del texto para saber qué corregir. Los jugadores guardados aparecen en `players`.

**Llenar la cola sola (bot de equipos):** en vez de pegar enlaces, siembra un equipo y deja que el bot recorra plantillas.

1. Siembra un equipo de la provincia en el *SQL Editor*:
   ```sql
   insert into public.team_queue (url) values
     ('https://www.lapreferente.com/E165C26706/cd-rayo-sanluque%C3%B1o')
   on conflict (url) do nothing;
   ```
2. *Actions → Bot de equipos → Run workflow* (5 equipos por ejecución). Por cada equipo mira la provincia de su cabecera (`(Cádiz) - Fundado…`); si es Cádiz, añade a `scrape_queue` a los jugadores cuya edad encaja con 2003–2007 (o sin edad) y añade a `team_queue` los equipos de su competición. Los de otras provincias quedan `skipped: otra_provincia` y no se siguen.
3. Después, *Actions → Bot de extracción* lee las fichas. La ficha decide el año de nacimiento real.

Solo se descubren los equipos que salen en la clasificación de cada plantilla (su competición). Para llegar a juveniles u otras categorías, siembra un equipo de esa categoría.

**Qué hace y qué no:**

- Respeta el `robots.txt`, solo visita `lapreferente.com`, espera 5 segundos entre peticiones y se identifica como `paneldejugadorescadiz-bot`.
- Solo chicos: descarta (como `skipped: femenino`) las fichas cuya categoría o club sean femeninos.
- Guarda nombre, año de nacimiento, club, categoría, posición, enlace a la ficha y enlace a la foto. **No guarda** la fecha de nacimiento completa ni el lugar de nacimiento. Solo guarda los nacidos entre 2003 y 2007; el resto queda como `skipped`.
- Se detiene si la web responde 403, 429 o 503, si aparece una verificación de Cloudflare, o tras tres fallos seguidos. Una ficha bloqueada vuelve a la cola y se reintenta hasta 3 veces.
- Los registros de GitHub son públicos, así que solo muestran identificadores de ficha, nunca nombres.
- La ejecución termina en rojo si alguna ficha falla o si se detiene: es intencionado, para que lo veas.
- La foto se guarda por ahora como enlace al original. Copiarla a un almacenamiento privado queda para cuando el bot lea bien las fichas.

## Pendiente

- La función `regenerate-lists` y el token `GITHUB_TOKEN` quedaron de la primera versión, que generaba listas JSON públicas. Ya no se usan; se reaprovecharán para lanzar el bot desde el panel de administrador.
- Subir las fotos a un almacenamiento privado.

## Datos personales

Aunque las fichas sean públicas, siguen siendo datos personales (RGPD). Conviene:

- Guardar solo lo necesario.
- Revisar las condiciones de uso de La Preferente antes de importar datos.
- Mantener el contacto de retirada de datos del pie de la web.
