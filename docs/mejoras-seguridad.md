# Auditoría de seguridad y rendimiento — xi

> **Versión auditada:** v0.3.6 (tag `39bad7b`)
> **Fecha:** 2026-07-11
> **Alcance:** configuración de Tauri/CSP, capabilities, IPC (archivos, auth, sesiones), spawn del sidecar pi, ejecución de shell (xi-tools), pipeline de streaming/render del frontend y capa de red de Exa.

Este documento recoge las oportunidades de mejora detectadas en un escaneo de seguridad y
rendimiento, priorizadas en cuatro niveles: **crítico**, **alto**, **medio** y **bajo**.
Cada hallazgo incluye el archivo y línea de referencia, el porqué del riesgo y una
propuesta concreta de remediación.

---

## TL;DR

El hallazgo de mayor apalancamiento es que **el WebView corre sin CSP (`csp: null`) con
`withGlobalTauri: true`**, y sobre esa base hay un conjunto de comandos IPC muy poderosos:
escritura/lectura de archivos **sin confinamiento de ruta** y un comando que **devuelve la
API key en texto plano** al frontend. Ninguno es explotable de forma trivial hoy (el render
de markdown mitiga el XSS obvio), pero la combinación convierte cualquier inyección de
script futura en compromiso total de host + robo de claves.

En rendimiento, el problema real es que el streaming **re-renderiza el buffer completo con
highlight.js en cada frame**, un costo que crece de forma aproximadamente cuadrática con la
longitud del mensaje.

| #  | Severidad   | Área         | Hallazgo |
|----|-------------|--------------|----------|
| 1  | 🔴 Crítico  | Seguridad    | CSP deshabilitada (`csp: null`) + `withGlobalTauri` + `innerHTML` de salida del modelo |
| 2  | 🟠 Alto     | Seguridad    | `files.rs`: read/write/list sin confinamiento de ruta ni validación de traversal |
| 3  | 🟠 Alto     | Seguridad    | `get_api_key` devuelve la clave completa en claro al renderer |
| 4  | 🟠 Alto     | Rendimiento  | Streaming re-renderiza buffer completo + re-highlight de todo el código cada frame (≈cuadrático) |
| 5  | 🟡 Medio    | Seguridad    | Sin sanitizador DOM (DOMPurify); se confía solo en `html:false` de markdown-it |
| 6  | 🟡 Medio    | Seguridad    | API keys en `auth.json` en texto plano; sin keychain del SO; `chmod 600` no aplica en Windows |
| 7  | 🟡 Medio    | Seguridad    | `brush-core`/`brush-builtins` como git dep sin `rev`/`tag` pin (supply chain) |
| 8  | 🟡 Medio    | Rendimiento  | `reconcileDom` compara `outerHTML` (serialización) de cada bloque por frame |
| 9  | 🔵 Bajo     | Rendimiento  | Comandos de archivos síncronos bloquean el hilo principal de Tauri |
| 10 | 🔵 Bajo     | Rendimiento  | Doble throttle redundante (state-sync 50 ms + SmoothStreamer 200 ms) |

---

## Modelo de amenaza

Es importante encuadrar la explotabilidad para no sobre/infra-valorar la severidad:

- Los comandos `files.rs` y `get_api_key` **solo son alcanzables desde el JS del WebView**,
  no desde pi/LLM directamente. pi hace sus operaciones de archivo a través de **xi-tools**
  (un sidecar aparte), no de estos comandos.
- Por lo tanto, la ruta de ataque realista para estos comandos es un **compromiso del
  WebView**: XSS a través del contenido renderizado, o una dependencia npm comprometida en
  el bundle del frontend.
- Ese es exactamente el motivo por el que **`csp: null` (hallazgo #1) es el eje**: es el
  multiplicador que convierte cualquier foothold de script en acceso total al IPC.

---

## 🔴 Crítico

### 1. CSP deshabilitada + `withGlobalTauri` + render por `innerHTML`

**Ubicación:**
- `apps/desktop/backend/tauri.conf.json:14` → `"csp": null`
- `apps/desktop/backend/tauri.conf.json:12` → `"withGlobalTauri": true`
- Render por `innerHTML` de salida del modelo:
  - `apps/desktop/frontend/src/components/chat-bubble.ts:147`
  - `apps/desktop/frontend/src/lib/smooth-streamer.ts:142`
  - `apps/desktop/frontend/src/components/thinking-chip.ts:62`
  - `apps/desktop/frontend/src/components/file-preview.ts:145`

**Riesgo:** el contenido renderizado es *prompt-injectable* (lo controla parcialmente
cualquiera que influya en lo que responde el LLM, o el contenido de un `.md` abierto en el
explorer). Hoy el XSS obvio está tapado porque markdown-it corre con `html: false` y valida
esquemas de link. Pero **sin CSP no hay defensa en profundidad**: si cualquier vector de
script pasa (un edge case de markdown-it/temml/highlight.js, una dependencia npm
comprometida en el bundle, o código futuro que renderice HTML sin escapar), el atacante
obtiene `window.__TAURI__` completo y puede invocar los comandos de los hallazgos #2 y #3 →
leer/escribir cualquier archivo del usuario y exfiltrar las API keys.

**Remediación:**
- Definir una CSP estricta en `tauri.conf.json`, por ejemplo:
  ```json
  "csp": "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:"
  ```
  Ajustar `style-src`/`font-src` a lo que realmente necesiten highlight.js y temml
  (idealmente sin `'unsafe-inline'`, moviendo estilos a hojas propias).
- Evaluar apagar `withGlobalTauri` y exponer solo los comandos necesarios vía
  `@tauri-apps/api`.
- Efecto: sube la barra de "un XSS = game over" a "un XSS necesita además evadir la CSP".

---

## 🟠 Alto

### 2. `files.rs` — sin confinamiento de ruta ni protección de traversal

**Ubicación:**
- `apps/desktop/backend/src/commands/files.rs:45` (`list_files`)
- `apps/desktop/backend/src/commands/files.rs:132` (`read_file`)
- `apps/desktop/backend/src/commands/files.rs:161` (`write_file`)
- Registrados en IPC: `apps/desktop/backend/src/main.rs:75-77`

**Riesgo:** los tres comandos toman una **ruta absoluta arbitraria** del frontend sin validar
que caiga dentro del working directory:
- `write_file` sobreescribe **cualquier** archivo escribible por el usuario, **sin límite de
  tamaño ni tipo**, y hace `create_dir_all` del padre. Rutas como `~/.pi/agent/auth.json`,
  `~/.bashrc` o `~/.config/autostart/*.desktop` se escriben sin chequeo.
- `read_file` lee cualquier archivo `<1 MB` en cualquier ruta.

El diseño del comando no debería confiar en una ruta sin validar, independientemente de que
hoy solo sea alcanzable bajo el escenario del hallazgo #1.

**Remediación:**
- Recibir el working dir en el backend (o guardarlo en estado) y validar con
  `path.canonicalize()` que la ruta resuelta empiece con la raíz permitida.
- Rechazar symlinks que escapen del confinamiento.
- Añadir límite de tamaño a `write_file`.
  ```rust
  fn confine(root: &Path, requested: &Path) -> Result<PathBuf, String> {
      let resolved = requested.canonicalize().map_err(|e| e.to_string())?;
      if !resolved.starts_with(root) {
          return Err("ruta fuera del directorio permitido".into());
      }
      Ok(resolved)
  }
  ```

### 3. `get_api_key` devuelve la clave en texto plano al renderer

**Ubicación:** `apps/desktop/backend/src/commands/auth_config.rs:138`

**Riesgo:** el comando retorna la API key **completa** a JS. El resto del diseño es cuidadoso
(solo expone `last4` en `get_auth_status`, y comenta explícitamente que "la key completa
NUNCA viaja al frontend"), pero `get_api_key` es exactamente ese canal, y bajo el hallazgo #1
es un objetivo de exfiltración de un solo `invoke()`.

**Remediación:**
- Eliminar la función "Ver clave completa" del UI, o reemplazarla por un flujo de
  reautenticación.
- Si debe existir, no retornar la clave a JS: abrir un diálogo **nativo de Rust** que la
  muestre. Nunca cruzar el secreto a la capa web.

### 4. Streaming re-renderiza el buffer completo (highlight.js) en cada frame

**Ubicación:**
- `apps/desktop/frontend/src/lib/smooth-streamer.ts:120` → `renderStreamingMarkdown(this.buffer)`
- `apps/desktop/frontend/src/lib/markdown.ts:137` → highlight.js por cada code fence

**Riesgo:** en cada render (~200 ms) se pasa el **buffer completo** y se re-ejecuta
highlight.js sobre **todos** los code fences. A medida que el mensaje crece, cada frame
re-parsea y re-resalta todo lo anterior: costo O(n) por frame × N frames ≈ **cuadrático**
sobre el total del stream. En respuestas largas con bloques de código grandes produce jank
creciente hacia el final.

**Remediación:**
- El prefijo estable del buffer no cambia entre frames → cachear su HTML y solo
  re-renderizar el último bloque mutable, o memoizar el resultado de highlight por bloque
  cerrado.
- `reconcileDom` ya asume prefijo estable, así que el render puede aprovechar la misma
  invariante.

---

## 🟡 Medio

### 5. Sin sanitizador DOM como defensa en profundidad

**Ubicación:** `apps/desktop/frontend/src/lib/markdown.ts:47` (config markdown-it)

**Riesgo:** el pipeline confía en `html: false` de markdown-it más el `validateLink` por
defecto. Es una mitigación real y correcta, pero no hay DOMPurify. temml corre con
`throwOnError: false` y highlight.js emite HTML — superficie que conviene pasar por un
sanitizador antes del `innerHTML`, sobre todo mientras el hallazgo #1 siga abierto.

**Remediación:** pasar el output de `renderMarkdown` por DOMPurify con allowlist de
tags/atributos antes de asignarlo a `innerHTML`.

### 6. API keys en texto plano en disco

**Ubicación:** `apps/desktop/backend/src/commands/atomic.rs:63` (`chmod 600` bajo `#[cfg(unix)]`)

**Riesgo:** `auth.json` y `exa-config.json` guardan las claves sin cifrar. El `chmod 600` se
aplica solo en Unix — en **Windows no hay equivalente** y el archivo queda con la ACL por
defecto.

**Remediación:** usar el keychain del SO (crate `keyring`), o al menos documentar el gap en
Windows y aplicar una ACL restrictiva allí.

### 7. Dependencia git sin pin

**Ubicación:** `packages/xi-tools/Cargo.toml:22-23`

**Riesgo:** `brush-core` y `brush-builtins` apuntan a `github.com/reubeno/brush` **sin
`rev`/`tag`/`branch`**. `Cargo.lock` fija el commit hoy (los builds son reproducibles desde el
lockfile), pero un `cargo update` traería el HEAD de la rama por defecto sin revisión. Para el
componente que ejecuta shell, es la dependencia donde más importa pinear.

**Remediación:** fijar `rev = "<commit>"` explícito en el manifiesto.

### 8. `reconcileDom` compara `outerHTML` por bloque en cada frame

**Ubicación:** `apps/desktop/frontend/src/lib/smooth-streamer.ts:151`

**Riesgo:** `newKids[stable].outerHTML !== oldKids[stable].outerHTML` serializa cada bloque
del DOM a string por frame para el diff. Costo O(tamaño total del HTML) por render,
redundante con el hallazgo #4.

**Remediación:** comparar contra el string de HTML ya generado por bloque (evitar
re-serializar el DOM), o hashear bloques cerrados.

---

## 🔵 Bajo

### 9. Comandos de archivo síncronos bloquean el hilo principal

**Ubicación:** `apps/desktop/backend/src/commands/files.rs` (`pub fn`, no `async`)

**Riesgo:** Tauri corre los comandos síncronos en el hilo principal, bloqueando la UI durante
la I/O. Con `<1 MB` es leve, pero `list_files` sobre un directorio grande se nota.

**Remediación:** convertir a `async` con `tokio::fs` (como ya hace `auth_config.rs`).

### 10. Doble throttle redundante

**Ubicación:**
- `apps/desktop/frontend/src/lib/pi/state-sync.ts:81` (throttle 50 ms)
- `apps/desktop/frontend/src/lib/smooth-streamer.ts:22` (throttle 200 ms)

**Riesgo:** `state-sync` limita a 50 ms y alimenta un store que luego `SmoothStreamer` vuelve a
espaciar a 200 ms — trabajo de mapeo/dispatch que se descarta. Benigno, pero simplificable a
un solo punto de control.

**Remediación:** unificar en un único throttle (preferiblemente el del render).

---

## Recomendación de orden de trabajo

1. **CSP + `files.rs` confinamiento + quitar `get_api_key`→JS** (hallazgos #1-#3): es un
   bloque coherente; cierra la ruta de escalada completa y es lo que un pentest marcaría
   primero.
2. **Cache del prefijo de streaming** (hallazgo #4): mayor ganancia de rendimiento percibido,
   sin cambiar la arquitectura de 3 capas.
3. El resto como higiene incremental (#5-#10).

Los ítems más autocontenidos y de mayor impacto/riesgo-bajo para empezar son el
**confinamiento de ruta en `files.rs` (#2)** y la **CSP (#1)**.
