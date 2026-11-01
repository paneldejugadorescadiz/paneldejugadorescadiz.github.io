# Panel de jugadores Cádiz

Web estática (GitHub Pages) con un listado de jugadores de Cádiz de 2003 a 2007, a partir de datos públicos de [La Preferente](https://www.lapreferente.com/).

## Cómo funciona

```
Supabase (tabla players)  ──►  GitHub Action  ──►  data/*.json  ──►  Web pública
        ▲                          ▲
        │                          │
   Panel admin  ──► Edge Function ─┘   (botón "Regenerar listas")
```

- La **web pública** (`index.html`) solo lee los archivos de `data/`. No depende de Supabase, así que sigue funcionando aunque la base de datos esté pausada.
- **Supabase** guarda los datos en la tabla `players`: lectura pública, escritura solo para usuarios con rol `admin`.
- El **panel de administrador** (`admin.html`) permite iniciar sesión y pulsar **Regenerar listas**.
- El botón llama a la Edge Function `regenerate-lists`, que comprueba que eres administrador y lanza el workflow `regenerate-lists.yml`. Este lee la tabla, genera los JSON y los sube al repositorio como un commit.
- Si una regeneración sale mal, basta con volver al commit anterior desde GitHub (`Revert`).

## Estructura

| Ruta | Para qué sirve |
| --- | --- |
| `index.html`, `css/`, `js/app.js` | Web pública con buscador y filtros |
| `admin.html`, `js/admin.js` | Panel de administrador |
| `js/config.js` | URL y clave pública de Supabase |
| `data/` | JSON generados (`players.json`, `by-year/`, `meta.json`) |
| `scripts/export-players.mjs` | Genera los JSON desde Supabase |
| `supabase/functions/regenerate-lists/` | Función que lanza la regeneración |
| `supabase/migrations/` | SQL de la tabla y sus políticas de seguridad |
| `.github/workflows/` | `regenerate-lists.yml` y `keepalive.yml` |

## Puesta en marcha

1. **GitHub Pages:** en el repositorio, *Settings → Pages → Deploy from a branch → `main` / `/ (root)`*.
2. **Usuario administrador:** en Supabase, *Authentication → Users → Add user*. Después hay que darle el rol:
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
   where email = 'tu-correo@ejemplo.com';
   ```
3. **Token de GitHub para el botón:** crea un token *fine-grained* limitado a este repositorio con el permiso **Actions: Read and write**, y guárdalo en Supabase como secreto `GITHUB_TOKEN` (*Edge Functions → Secrets*).
4. Entra en `admin.html`, inicia sesión y pulsa **Regenerar listas**.

## Mantener Supabase activo

El plan gratuito de Supabase pausa los proyectos tras unos 7 días con poca actividad. `keepalive.yml` hace una consulta cada 3 días para evitarlo. Ojo: GitHub desactiva los workflows programados cuando un repositorio pasa 60 días sin actividad; si ocurre, vuelve a activarlo en la pestaña *Actions*.

## Datos personales

Los datos son públicos, pero siguen siendo datos personales (RGPD), y muchos jugadores eran menores cuando se publicaron. Conviene:

- Guardar solo lo necesario (nombre, año, club, categoría, temporada, enlace a la fuente), sin fotos.
- Revisar las condiciones de uso de La Preferente antes de importar datos.
- Ofrecer un contacto para pedir la retirada de un dato.
