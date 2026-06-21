# Descubrimientos técnicos

Decisiones y aprendizajes durante el desarrollo de xi.

---

## 1. Tauri: estructura de carpetas custom

**Pregunta:** ¿Se puede usar `frontend/` y `backend/` en vez de `src-tauri/` y `src/`?

**Respuesta:** Sí. Tauri no depende del nombre de la carpeta. El CLI busca recursivamente `tauri.conf.json` desde el cwd. Los paths como `frontendDist` son relativos al archivo de config.

```json
// backend/tauri.conf.json
{
  "build": {
    "beforeDevCommand": "npm run dev --prefix ./frontend",  // cwd = xi/
    "frontendDist": "../frontend/dist"                       // relativo a backend/
  }
}
```

**Fuentes:**
- [Stack Overflow: customize src-tauri folder](https://stackoverflow.com/questions/76694744)
- [GitHub issue #2643](https://github.com/tauri-apps/tauri/issues/2643)

---

## 2. Dependencias del sistema en Linux

Tauri usa el WebView nativo del sistema. En Linux (Fedora) se necesitan:

```bash
sudo dnf install -y webkit2gtk4.1-devel libsoup3-devel gtk3-devel javascriptcoregtk4.1-devel
```

| Paquete | Para qué |
|---------|----------|
| `webkit2gtk4.1-devel` | Motor de rendering web (WebKit) |
| `libsoup3-devel` | HTTP entre WebView y Rust |
| `gtk3-devel` | Gestión de ventanas |
| `javascriptcoregtk4.1-devel` | Motor JavaScript |

---

## 3. Empaquetar pi como binario standalone

### El problema

pi es un script de Node.js (`dist/cli.js`). Para usuarios no técnicos no podemos pedir que instalen Node.js.

### Opciones evaluadas

| Opción | Resultado |
|--------|-----------|
| **Node.js SEA** (`--build-sea`) | ❌ No funciona — bugs de postject, inyección ELF corrupta, ESM/CJS mixto falla |
| **pkg (@yao-pkg/pkg)** | ⚠️ Funciona pero es una dependencia externa más, fork de vercel/pkg archivado |
| **fossilize** | ⚠️ Crea el binario pero la inyección SEA falla (mismos bugs de postject) |
| **bun --compile** | ✅ Funciona perfecto — un solo paso, binario nativo |

### La solución: bun

```bash
bun build node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  --compile --outfile pi
```

- **1 comando** vs 5+ con Node.js SEA
- **Binario nativo** (no blob inyectado en Node.js)
- **101MB** para pi v0.79.3
- Pi Studio usa exactamente este enfoque

### ¿Por qué bun funciona donde Node.js no?

| Problema | Node.js SEA | Bun |
|----------|-------------|-----|
| `import.meta.url` + `require()` mezclados | Falla en bundle | Bun lo resuelve internamente |
| Postject bugs | Issues conocidos (#76, #92) | No necesita postject |
| Pasos manuales | 5+ herramientas | 1 comando |

---

## 4. Versiones de Node.js

| Versión | Status | `--build-sea` |
|---------|--------|---------------|
| v22 | Maintenance LTS | ❌ No disponible |
| v24 | Active LTS | ❌ No disponible (PR #62190 pendiente) |
| v25 | End of Life | ✅ Disponible (pero EOL) |
| v26 | Current | ✅ Disponible |

**Recomendación:** Quedarse en v24 LTS y usar bun para compilar sidecars.

---

## 5. Frontend vanilla para Tauri

**Decisión:** Usar vanilla TypeScript + Vite, sin frameworks.

**Patrón de 4 capas** (copiado de musicologo):

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| 1. Rendering | `components/*.ts`, `pages/*.ts` | Funciones → HTMLElement |
| 2. Reactivity | `lib/signal.ts` | Signal<T> (25 líneas) |
| 3. Routing | `router.ts` | Hash-based (80 líneas) |
| 4. State | `lib/state.ts` | Signals globales |

**Ventajas:**
- 0 dependencias de runtime (excepto marked para markdown)
- Cero framework upgrades
- La IA puede escribir todo (createElement es universal)
- Bundle mínimo

---

## 6. Tauri sidecars: cómo Tauri resuelve el path

### El problema

`app.shell().sidecar("X")` falla con `No such file or directory (os error 2)` en `tauri dev`, aunque el binario exista donde dice `externalBin` en `tauri.conf.json`.

### La causa real

Leyendo el código fuente de `tauri-plugin-shell@2.3.5/src/process/mod.rs:106-117`:

```rust
fn relative_command_path(command: &Path) -> crate::Result<PathBuf> {
    let exe_path = platform::current_exe()?;       // /path/to/target/debug/xi-backend
    let exe_dir = exe_path.parent()?;              // /path/to/target/debug
    let base_dir = if exe_dir.ends_with("deps") {  // tests: subir un nivel
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    let mut command_path = base_dir.join(command); // /path/to/target/debug/<command>
    // ...
}
```

**Conclusión:** El path final es literalmente `<dir_del_exe>/<lo_que_le_pasé_a_sidecar>`. Tauri no agrega el target triple, no busca en `binaries/`, no consulta el manifest de `externalBin`. Solo concatena.

### Tres reglas concretas

1. **El string que pasás a `sidecar("X")` es el nombre literal del archivo**, sin prefijo de directorio.
2. **El binario debe vivir en `target/<profile>/X`**, donde `<profile>` es `debug` o `release`.
3. **`externalBin: ["X"]` en `tauri.conf.json` es solo metadata para el bundler** (en `tauri build` lo incluye en el bundle). En `tauri dev` no se usa para resolver el path.

### El "bug" del prefijo `binaries/`

La doc oficial muestra `binaries/my-sidecar` como convención. Muchos tutoriales (y la estructura por defecto de Tauri 1) lo repiten. **Pero en Tauri 2, ese prefijo es parte del nombre**, no un directorio que Tauri entienda. Si ponés `externalBin: ["binaries/pi"]`, Tauri busca `target/debug/binaries/pi`, no `target/debug/pi`.

Confirmado en [issue tauri-apps/tauri#15134](https://github.com/tauri-apps/tauri/issues/15134) (marzo 2026): "A `binaries/` subdirectory was not the path Tauri resolves — `externalBin` resolves relative to `src-tauri/`, not `src-tauri/binaries/`."

### Los recursos del sidecar: el segundo bug en cascada

Una vez que el sidecar arranca, **pi (compilado con bun) busca sus propios recursos al lado del binario**. `getThemesDir()` retorna `dirname(exe) + "/theme"`, y lee `theme/dark.json` y `theme/light.json` de ahí.

En dev, el "lado del binario" es `target/debug/`. Si esos archivos solo están donde los pusiste como fuente, pi muere con `ENOENT`.

### La solución: `build.rs`

Un script de build que se ejecuta automáticamente en cada `cargo build` (incluido por `tauri dev`). Estándar de Rust, no requiere scripts externos ni hooks manuales.

```rust
// backend/build.rs
fn main() {
    tauri_build::build();
    let paths = resolve_paths();
    copy_sidecar(&paths);
    copy_theme_dir(&paths);
}

fn copy_sidecar(paths: &BuildPaths) {
    let source = paths.manifest_dir.join(&paths.sidecar_name);
    let dest = paths.target_profile_dir.join(&paths.sidecar_name);
    if !source.exists() { return; }
    fs::create_dir_all(&paths.target_profile_dir).ok();
    copy_if_newer(&source, &dest);
}

fn copy_theme_dir(paths: &BuildPaths) {
    // pi busca theme/dark.json al lado del binario
    let source_dir = paths.manifest_dir.join("theme");
    let dest_dir = paths.target_profile_dir.join("theme");
    if !source_dir.exists() { return; }
    fs::create_dir_all(&dest_dir).ok();
    for entry in fs::read_dir(&source_dir).unwrap().flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let dest = dest_dir.join(path.file_name().unwrap());
        copy_if_newer(&path, &dest);
    }
}
```

### Estructura final del proyecto

```
backend/
  pi-x86_64-unknown-linux-gnu    # fuente del sidecar (compilado con bun)
  theme/                          # fuentes de los recursos de pi
    dark.json
    light.json
  build.rs                        # copia ambos a target/debug/ automáticamente
  src/...
  tauri.conf.json                 # externalBin: ["pi"], NO "binaries/pi"
  capabilities/default.json       # name: "pi", sidecar: true

# Después de cargo build / tauri dev:
backend/target/debug/
  pi                              # ← lo que Tauri sidecar("pi") va a buscar
  pi-x86_64-unknown-linux-gnu     # ← copia del source
  theme/                          # ← lo que pi (bun) va a buscar
    dark.json
    light.json
```

### Caveats

- **`cargo clean` borra `target/debug/theme/`** porque está dentro del directorio que limpia. El siguiente `cargo build` lo regenera automáticamente.
- **Si agregás archivos a `theme/` después del primer build, el `build.rs` no se re-ejecuta automáticamente** porque solo registramos `rerun-if-changed=theme/` (no los archivos individuales). Workaround: `touch build.rs` o un build limpio.
- **El flag `--no-themes` de pi NO evita la carga de temas builtin** — solo afecta los custom themes en `~/.pi/agent/`. Tenés que shippear `theme/` igual.

### Referencias

- [Issue tauri-apps/tauri#1298](https://github.com/tauri-apps/tauri/issues/1298) — bug original `externalBin` en dev (2021)
- [Issue tauri-apps/tauri#4780](https://github.com/tauri-apps/tauri/issues/4780) — "No such file or directory" en dev
- [Issue tauri-apps/tauri#15134](https://github.com/tauri-apps/tauri/issues/15134) — path resolution explícito (marzo 2026)
- [Doc oficial Tauri 2 sidecars](https://v2.tauri.app/develop/sidecar/)

---

## 7. Comunicación frontend ↔ pi

```
Frontend (WebView)
  ↓ invoke("send_prompt", { message })
Tauri Core (Rust)
  ↓ stdin.write(JSONL)
pi --mode rpc (sidecar)
  ↓ stdout (JSONL events)
Tauri Core (Rust)
  ↓ app.emit("pi:raw", line)
Frontend (WebView)
  ↓ listen("pi:raw", handler)
```

El protocolo RPC de pi usa JSONL (JSON Lines) sobre stdin/stdout.

---

## 8. Metodología: buscar antes de hackear

Cuando un problema de tooling se siente como "un bug que requiere un workaround", vale la pena:

1. **Buscar en el código fuente del crate/framework** (`cargo doc`, leer la implementación real, no la doc). En este caso, leer `tauri-plugin-shell/src/process/mod.rs` reveló que `sidecar("X")` resuelve a `<exe_dir>/X` sin más.
2. **Buscar issues recientes** con filtro de fecha. Issues de 2022-2024 sobre Tauri sidecars tienen workarounds obsoletos; marzo 2026+ tiene la info correcta.
3. **Distinguir entre bug y feature**: la falta de "auto-copia" de `externalBin` en dev no es un bug — es un feature que nunca se implementó. Hay que aceptarlo y manejarlo.

**Anti-patrón que evitamos:** agregar un `scripts/before-dev.sh` que copia el sidecar a mano. Reemplazado por `build.rs`, que es idiomático Rust, automático, y CI-friendly.

---

## 9. pi-sessions: descubrir el sessionDir como lo hace pi TUI

**El problema (Etapa 4):** `pi-sessions list <cwd>` retornaba `{"sessions": []}` aunque el proyecto tenía 3 sesiones en `.pi/sessions/`. El binario se ejecuta desde `target/debug/`, así que `process.cwd()` apunta a esa carpeta, no al proyecto. Resultado: `SessionManager.list(cwd)` resolvía siempre al default global `~/.pi/agent/sessions/<encoded-cwd>/`, que estaba vacío para ese cwd.

**El error que cometí primero:** asumí que podía arreglarlo pasando el cwd como `current_dir` del sub-proceso Tauri. Eso no funciona — `process.cwd()` del binario se setea al lanzar, no al ejecutar. El binario lee su cwd del ejecutable, no del parent.

**La solución correcta — replicar lo que hace el pi TUI:**

```ts
// backend/scripts/pi-sessions.ts
import { SettingsManager, SessionManager } from "@earendil-works/pi-coding-agent";

function getDefaultSessionDir(cwd: string): string {
  // Replicado de dist/core/session-manager.js:220-225 de pi.
  // Si pi cambia la fórmula, replicar acá.
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(homedir(), ".pi", "agent", "sessions", safePath);
}

function resolveSessionDir(cwd: string): string {
  const sm = SettingsManager.create(cwd);          // ← clave: el cwd va como argumento
  const raw = sm.getSessionDir();                  // ".pi/sessions" (relativo) o undefined
  if (!raw) return getDefaultSessionDir(cwd);      // default: ~/.pi/agent/sessions/<encoded>/
  if (!isAbsolute(raw)) return resolve(cwd, raw);  // relativo → absoluto contra cwd
  return raw;
}

const sessionDir = resolveSessionDir(cwd);
const sessions = await SessionManager.list(cwd, sessionDir);
```

`SettingsManager.create(cwd)` lee `<cwd>/.pi/settings.json` y lo mergea con `~/.pi/agent/settings.json` (project sobreescribe global). Es exactamente lo que hace `agent-session-runtime.js:150` del TUI:

```js
const sessionDir = this.session.sessionManager.getSessionDir();
const sessionManager = SessionManager.create(this.cwd, sessionDir);
```

**Por qué `getDefaultSessionDir` no se importa de pi:** bun `--compile` no resuelve sub-paths no listados en `package.json#exports` de pi. Lo replicamos localmente (4 líneas) con un comentario explícito: "si pi cambia la fórmula, replicar acá".

**Aprendizaje:** cuando un sub-proceso necesita comportarse como otro proceso del mismo producto, **replicar su código de inicialización, no adaptar el sub-proceso a su entorno**. Asumir que `process.cwd()` refleja el cwd del usuario es el anti-patrón.

**Verificación empírica:** `pi-sessions list /home/nego/Documentos/03-proyectos/xi` retorna las 3 sesiones con sus nombres, parentSessionPath, y messageCount correctos.

---

## Referencias

- [Tauri Sidecars docs](https://v2.tauri.app/develop/sidecar/)
- [pi RPC docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi Studio](https://github.com/shixin-guo/pi-studio) — referencia de implementación
- [bun --compile](https://bun.sh/docs/bundler/executables)

## 10. Custodia de claves del updater (Etapa 7)

### El problema

`tauri-plugin-updater` requiere un par de claves (público/privado) generadas con `minisign`. La clave privada firma los bundles en cada release; la pública se embebe en el binario y verifica la firma antes de instalar. Si alguien obtiene la clave privada, puede firmar updates maliciosos que xi instalaría sin chistar.

### Setup local (desarrollo)

```bash
# Generar el par (una sola vez por máquina dev)
npx tauri signer generate -w ~/.tauri/xi.key -p "<passphrase>"

# Esto crea:
#   ~/.tauri/xi.key      ← PRIVATE (nunca commitear, mode 0600)
#   ~/.tauri/xi.key.pub  ← PUBLIC (se embebe en tauri.conf.json)
```

La pubkey va como string literal en `backend/tauri.conf.json` bajo `plugins.updater.pubkey`. Es público por diseño — el riesgo está en la private key.

### Custodia

| Dónde | Qué | Notas |
|-------|-----|-------|
| `~/.tauri/xi.key` | private key (local) | Solo el dev la tiene. Mode 0600. |
| Password manager (1Password) | private key + passphrase | Backup. Si perdés ambas, xi se congela. |
| GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY`) | private key (CI) | Contenido completo del archivo, incluyendo header. |
| GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) | passphrase (CI) | Separado de la key, nunca en el mismo secret. |
| `backend/tauri.conf.json` | public key (público) | Se distribuye con la app. |
| Repositorio git | nada de la private key | `xi.key` y `xi.key.pub` en `.gitignore` (defensa en profundidad). |

### Rotación (escenario catastrophic: key filtrada)

1. Generar nuevo par: `npx tauri signer generate -w ~/.tauri/xi.key.new -p "..."`.
2. Actualizar pubkey en `backend/tauri.conf.json`.
3. Rebuild + release: tag `v0.3.0` con la nueva key.
4. Update `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` en GitHub Secrets.
5. Los users con versiones < v0.3.0 no pueden actualizar (la firma con la key vieja no valida con la pubkey nueva en el binario viejo). Tendrían que bajar manualmente la nueva versión.

### Caveats

- Si la passphrase está vacía, hay un bug conocido en tauri-signer entre v0.7.4 y v0.8.0 que genera keys rotas. Usar passphrase de al menos 8 caracteres.
- La pubkey NO cambia entre versiones. Es un secret de la app, no de la versión.
- El sidecar `pi` se reemplaza atómicamente con cada update de xi (el updater reemplaza el bundle completo). La Etapa 8 se ocupa del caso "quiero actualizar pi sin esperar release de xi".

## 11. Testing del updater sin release real

### Setup de un mock server local

```bash
# 1. Crear un directorio con un latest.json fake y un bundle fake
mkdir -p /tmp/xi-mock-update
cd /tmp/xi-mock-update

cat > latest.json <<EOF
{
  "version": "99.0.0",
  "notes": "Test update",
  "pub_date": "2026-06-18T00:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "url": "http://localhost:8787/xi-fake.AppImage",
      "signature": "fake-sig"
    }
  }
}
EOF

# 2. Servir con python
python3 -m http.server 8787

# 3. En otra terminal, apuntar tauri.conf.json al mock
#    (cambiar endpoints[0] a http://localhost:8787/latest.json)

# 4. npm run tauri dev
# 5. Esperar 2.5s → checkForUpdate() corre → ve v99.0.0 → "update ready"
# 6. NO hacer click en Reiniciar (la signature es fake y va a fallar)
```

El bundle fake no es un AppImage real, así que `downloadAndInstall` va a fallar al verificar la firma. Esto sirve para testear el flow hasta "ready" pero no el apply real. Para testear el apply end-to-end, hay que firmar el bundle con la key local — eso requiere un release real (vía el workflow o manualmente con `tauri build`).

### Referencias

- [tauri-plugin-updater docs](https://v2.tauri.app/plugin/updater/)
- [tauri-action examples](https://github.com/tauri-apps/tauri-action/tree/dev/examples)
- [minisign](https://jedisct1.github.io/minisign/)

## 12. Sidecar pi como bun-binary: implicaciones (Etapa 8)

### El problema

xi compila el CLI de pi con `bun build --compile` para distribuirlo como binario standalone. Esto trae 2 consecuencias que no son obvias:

1. **`pi update --self` no funciona.** pi detecta que corre como bun-binary (chequea `import.meta.url.includes("$bunfs")` o similar) y para ese caso `getSelfUpdateCommand()` retorna `undefined`. El user que corra `pi update --self` ve: "pi cannot self-update this installation. Download from: https://github.com/earendil-works/pi-mono/releases/latest".

2. **`pi --version` retorna "0.0.0"** porque el `package.json` no se incluye automáticamente en el bundle compilado. La versión real está en `node_modules/@earendil-works/pi-coding-agent/package.json` (típicamente `0.79.x`), pero el binario standalone no tiene acceso a ese path.

### El modelo: xi+pi son una unidad

Por las razones de arriba, **xi y pi se distribuyen juntos atómicamente**. Cuando hago un release de xi v0.2.0, ese release incluye una versión pinneada de pi (ej: v0.80.1). El user no puede actualizar pi independientemente — necesita un release de xi.

**Implicaciones de UX**:
- El user no ve "hay un pi nuevo" como algo accionable. No hay botón "Actualizar pi" en settings.
- En su lugar, en "Acerca de" ve `xi v0.2.0 — pi v0.80.1` (las dos versiones juntas). Cuando hay un release de xi con un pi más nuevo, las dos cambian atómicamente.
- El "latest de pi upstream" en `https://pi.dev/api/latest-version` no se muestra al user — sería una falsa promesa. Solo lo veo yo como dev en el debug panel, para saber cuándo hacer un release de xi.

### El fix: 2 partes

**Parte 1 — el script de build** (`scripts/build-pi.sh`):

1. Instalar pi via npm: `npm install @earendil-works/pi-coding-agent@latest --silent`.
2. Extraer la versión real con `node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"`.
3. Reemplazar el `package.json` del proyecto con uno que tenga la versión real (no hardcoded) y el `name` correcto.
4. Compilar con `bun build --compile --compile-autoload-package-json`. El flag `--compile-autoload-package-json` le dice a bun que mantenga accesible el package.json del cwd en runtime.
5. Copiar el binario + el `package.json` a `backend/binaries/`. El script tiene un check al final que falla si `pi --version` no retorna la versión esperada.

**Parte 2 — el env var en el spawn** (`backend/src/commands/pi_process.rs`):

pi detecta el directorio del package.json con esta lógica (en `config.js:getPackageDir()`):

```ts
export function getPackageDir(): string {
    if (process.env.PI_PACKAGE_DIR) return normalizePath(process.env.PI_PACKAGE_DIR);
    if (isBunBinary) return dirname(process.execPath);
    // ... Node.js path
}
```

Para bun-binary, retorna `dirname(process.execPath)` — el directorio del binario. Si ese directorio tiene un `package.json` con `name` y `version`, pi los lee correctamente. Pero por defecto ese directorio no tiene el `package.json` (Tauri no lo copia al bundle).

El fix: pasamos `PI_PACKAGE_DIR=<resource_dir>` al spawn del sidecar. Así, pi busca el package.json en el resource dir (que Tauri sí conoce), no en el directorio del binario.

```rust
// backend/src/commands/pi_process.rs
let sidecar_command = app
    .shell()
    .sidecar("pi")?
    .args(args)
    .env("PI_PACKAGE_DIR", get_sidecar_dir(&app, "pi"))
    .current_dir(&cwd);
```

### Verificación

```bash
$ bash scripts/build-pi.sh
...
✅ Verificación OK: pi --version retorna 0.79.8
```

El script tiene un check al final que falla si `pi --version` no retorna la versión esperada — protege contra regresiones.

### Endpoints útiles

- `https://pi.dev/api/latest-version`: texto plano con la última versión de pi (ej: `"0.80.1\n"`). Usado por el command `get_pi_upstream_version` (debug panel).
- `https://github.com/earendil-works/pi-mono/releases`: binarios pre-compilados de pi para todas las plataformas (formato `pi-{os}-{arch}.tar.gz` o `.zip`).
- `https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md`: para saber qué cambió entre versiones de pi.

### Alternativas evaluadas (descartadas)

- **Hacer que el binario de pi se actualice solo via `pi update --self`**: no funciona (es bun-binary).
- **Reemplazar el binario de pi en runtime desde xi**: problemas de permisos (macOS bundle, Linux AppImage), lock (Windows), complejidad innecesaria. La Etapa 7 ya cubre "xi se actualiza con su pi incluido".
- **Mostrar al user "hay un pi nuevo, actualizá xi"**: sería fake promise porque el user no puede forzar un release de xi.

## 13. Auth de pi y onboarding (Etapa 9)

### El problema de auth en pi

El `auth.json` de pi (`~/.pi/agent/auth.json`) tiene una estructura **multi-provider y multi-tipo**:

```json
{
  "anthropic":    { "type": "api_key", "key": "sk-ant-..." },
  "openrouter":   { "type": "api_key", "key": "sk-or-..." },
  "github-copilot": { "type": "oauth", "refresh": "...", "access": "...", "expires": 12345 }
}
```

- **Tipos de credencial**: `"api_key"` (string) o `"oauth"` (refresh + access + expires).
- **Providers totales**: 30+ (Anthropic, OpenAI, Google, OpenRouter, Groq, DeepSeek, Mistral, xAI, Cerebras, Bedrock, Vertex AI, etc.).
- **Providers con OAuth**: 3 (Anthropic, GitHub Copilot, OpenAI Codex).
- **Archivo se lee con `chmod 600`** (owner read+write).

### El RPC de pi no expone auth

`pi-mono` tiene 2 modos de uso: TUI (terminal) y RPC (lo que usa xi). El modo RPC expone comandos como `prompt`, `set_model`, `get_available_models`, etc. **Pero no expone `login`, `set_api_key`, ni nada relacionado con auth**. La razón: pi asume que el usuario ya configuró sus credenciales antes de invocar el binario.

**Implicación para xi**: no podemos hacer login OAuth via el sidecar. Si el user quiere usar GitHub Copilot, tiene que correr `pi login` en una terminal. xi solo puede escribir el `auth.json` directamente (es solo un JSON file en el FS).

### Por qué no implementar OAuth en xi

OAuth requiere un **server local** (para Anthropic y OpenAI Codex, que usan Authorization Code + PKCE con callback en `http://localhost:53692/callback` y `http://localhost:1455/auth/callback` respectivamente). GitHub Copilot usa device flow (sin server local, pero requiere polling).

**Tradeoffs de implementar el server local en xi**:

| Aspecto | Costo |
|---------|-------|
| Complejidad | Alta. Hay que escribir un HTTP server en Rust con un comando Tauri, coordinar el timing con el browser abierto, persistir tokens. |
| Riesgo legal/TOS | Gris. Los CLIENT_IDs de Anthropic y GitHub Copilot están base64-encoded en el código de pi-mono — no son IDs públicos autorizados para terceros. OpenAI Codex sí tiene un ID público. |
| Mantenimiento | Continuo. Si los providers rotan CLIENT_IDs, cambian flows, o cambian ports, hay que actualizar xi. |
| Beneficio para el user | Moderado. El user no sale de la app, pero tiene que autorizar en el browser igual. |

**Decisión**: no implementar OAuth en esta etapa. xi cubre los 6 providers con API key (Anthropic, OpenAI, Google, OpenRouter, Groq, OpenCode Go, DeepSeek — 99% de los users no-técnicos). Los 3 providers OAuth se difieren para una v2.

### El formato del auth.json: por qué este y no uno propio

El formato escrito por xi es **idéntico** al que pi-mono espera. Razón: pi ya lo lee, y si xi escribe algo distinto, se rompe la compatibilidad. Es más simple respetar el formato y dejar que pi lo parsee.

```rust
// Backend command set_api_key
entries.insert(
    provider,
    serde_json::json!({
        "type": "api_key",
        "key": api_key,
    }),
);
```

**No encriptamos la key en disco**: el `auth.json` de pi es texto plano. Encriptarlo requeriría un crypto layer que pi no soporta. El OS-level protection (`chmod 600`) es la protección estándar y suficiente.

### Atomic write: por qué importa

Si el proceso de xi se mata a mitad de un `write()` normal, el `auth.json` queda **truncado o corrupto**. pi no podría leerlo en el próximo startup. Para evitar esto, xi usa el patrón estándar de atomic write:

```
1. Escribir a auth.json.tmp
2. fsync (forzar flush al disco)
3. rename auth.json.tmp → auth.json (atómico en el mismo filesystem)
4. Si el rename falla, borrar el .tmp
```

El `rename` es atómico en POSIX (y en Windows con `MoveFileEx` con flag `MOVEFILE_REPLACE_EXISTING`). El archivo siempre está en estado válido: o el viejo, o el nuevo.

### Permisos: chmod 600 + chmod 700

xi crea el directorio `~/.pi/agent/` con `chmod 700` (owner-only) y el archivo `auth.json` con `chmod 600` (owner read+write). Es lo que pi espera y lo que el OS recomienda para secretos.

**Limitación**: si el archivo ya existía con otros permisos (ej: el user lo editó a mano), xi **no los cambia** — solo respeta los existentes. Es responsabilidad del user mantenerlo seguro.

### Endpoints de validación por provider

Cada provider tiene un endpoint "ligero" pensado para validar la key sin gastar tokens:

| Provider | Endpoint | Método | Header/Auth |
|----------|----------|--------|-------------|
| Anthropic | `https://api.anthropic.com/v1/messages` | POST con body mínimo (max_tokens: 1) | `x-api-key: <key>`, `anthropic-version: 2023-06-01` |
| OpenAI | `https://api.openai.com/v1/models` | GET | `Authorization: Bearer <key>` |
| Google | `https://generativelanguage.googleapis.com/v1beta/models?key=<key>` | GET | query param |
| OpenRouter | `https://openrouter.ai/api/v1/auth/key` | GET | `Authorization: Bearer <key>` |
| Groq | `https://api.groq.com/openai/v1/models` | GET | `Authorization: Bearer <key>` |
| OpenCode Go | `https://api.opencode.ai/v1/models` | GET | `Authorization: Bearer <key>` |
| DeepSeek | `https://api.deepseek.com/v1/models` | GET | `Authorization: Bearer <key>` |

**Interpretación del status**:
- 2xx → key válida
- 401/403 → "API key inválida"
- 429 → "Rate limit. Esperá unos minutos."
- 5xx → "El provider tuvo un error. Intentá de nuevo."
- Timeout (5s) → "No se pudo conectar al provider (timeout)"
- Network error → "No se pudo conectar al provider (sin red)"

**Anthropic no tiene endpoint "listar models"**: usa `/v1/messages` con un body mínimo (`max_tokens: 1`, `messages: [{role: "user", content: "hi"}]`). El request cuesta prácticamente nada (1 token).

### El flow completo de "save"

1. User pega key en el form de Settings → click "Guardar".
2. Frontend llama a `setApiKey(provider, apiKey)` (Tauri command).
3. Backend lee/parsea `~/.pi/agent/auth.json`.
4. Backend mergea la entry: `{ provider: { type: "api_key", key: "..." } }`.
5. Backend escribe a `auth.json.tmp`, `fsync`, `rename` atómico.
6. Backend aplica `chmod 600`.
7. Frontend llama a `loadAuthStatus()` para refrescar `configuredProviders`.
8. Frontend llama a `loadModels()` para refrescar el dropdown de "Modelo" (porque ahora hay un provider nuevo).
9. La banderita de welcome se actualiza: si `hasAnyProvider === true`, se esconde.

**No se reinicia pi**. La próxima vez que el user interactúe, pi lee el auth.json actualizado (o cuando se le pregunta via `get_available_models`).

### Por qué no usar pi para escribir el auth.json

Podríamos exponer un command en pi que haga `setApiKey` via RPC. Pero:
- Requiere modificar pi-mono (upstream). Estamos atados a su release cycle.
- Agrega una superficie de ataque (un command más en el RPC).
- No hay beneficio: el formato del archivo es público, no es secreto de pi.

Es más simple escribir el archivo directamente desde Rust y dejar que pi lo lea como siempre.

### Mostrar vs enviar la key completa: el patrón "Ver" on-demand

Mostrar la API key completa en la UI es un riesgo de seguridad innecesario. La key ya está protegida por `chmod 600` en disco; enviarla al WebView y mostrarla en el DOM la expone a:

- Otros procesos que lean la memoria del WebView.
- Bugs de UI que filtren el valor (autocomplete, logs, screenshots, etc).
- Si el user hace click en un campo equivocado y se copia al clipboard.

**Patrón "Ver" on-demand**: el backend **nunca** envía la key completa en `get_auth_status`. Solo envía metadata pública (`has_key: bool`, `last4: string|null`). La key completa solo viaja por IPC cuando el user hace click en "Ver" — el wrapper frontend llama a `get_api_key(provider)`, que retorna `Some(key)` solo si el provider existe y es `api_key`.

**Por qué `last4` es seguro**: 4 caracteres de una key de ~50 chars da 46 bits de entropía ocultos. Suficiente para identificar visualmente la key ("ah, esa es la que termina en 604f") sin permitir reconstruirla. Es el patrón estándar de GitHub, AWS, Stripe, Google Cloud.

**Side effects a tener en cuenta al mostrar la key**:
- El input cambia de `type=password` a `type=text` (visible).
- Después de Guardar o Eliminar, el modo Ver se cancela automáticamente (la key puede haber cambiado).
- El input nunca persiste la key en localStorage ni en signals — solo en el DOM mientras se muestra.

### Eliminar providers: idempotencia y confirm inline

El command `delete_api_key(provider)` es **idempotente**: si el provider no existe, no es error (es un no-op). Esto simplifica el manejo de race conditions: si el user hace click en Eliminar dos veces rápido, ambos clicks se procesan sin error.

**Confirm inline en vez de modal**: el primer click cambia el botón a "¿Seguro? Sí" con estilo rojo prominente. El segundo click confirma. Auto-cancela después de 5 segundos. Es reversible (pueden volver a guardar la key), así que un modal bloqueante sería fricción innecesaria. El patrón de pi mismo (editar models.json) tampoco pide confirmación.

**Side effect importante**: si el provider eliminado es el activo del modelo actual, pi va a fallar la próxima vez que intente usar ese modelo. El dropdown de "Modelo" se refresca via `loadModels()` después del delete, así que el user ve el cambio inmediatamente. Si estaba usándolo, tiene que elegir otro.

---

## 13. Lecciones aprendidas (Etapa 9)

### 13.1 TDZ de const/let en closures — la ventana negra

**Bug**: en `renderProviderSection` (`frontend/src/pages/settings.ts`), `updateProviderUI` se llamaba antes de declarar `keyInput`, `viewBtn`, `deleteBtn` que usaba dentro. Resultado: `ReferenceError: Cannot access 'keyInput' before initialization`. El render de la página entera se rompía — la ventana de settings quedaba **negra** (solo el background del body, sin contenido).

**Causa**: `const` y `let` en JavaScript/TypeScript tienen **Temporal Dead Zone (TDZ)**. A diferencia de `var` (que se hoistea a `undefined`), las variables `const`/`let` no se pueden acceder hasta que se ejecute su declaración. Si una closure intenta leer una `const` antes de su declaración, lanza ReferenceError.

**Patrón del bug**:

```ts
// 1. Define la función (todavía no accede a vars)
const updateProviderUI = (configured) => {
  // ... usa keyInput, viewBtn, deleteBtn (todavía no declarados)
};

// 2. LLAMA la función (explota si esas vars están en TDZ)
updateProviderUI(appState.configuredProviders.value);

// 3. AHORA declara las vars
const keyInput = document.createElement('input');
const viewBtn = document.createElement('button');
```

**Patrón seguro**: declarar las variables **antes** de cualquier código que las use. O usar una `function` declaration (que se hoistea entera), no una arrow function que captura variables.

**Fix aplicado**: mover la llamada a `updateProviderUI` y la suscripción a `appState.configuredProviders.subscribe` para que se ejecuten **después** de las declaraciones de `keyInput`/`viewBtn`/`deleteBtn` (commit `fix(etapa9): TDZ en renderProviderSection`).

**Prevención**: cuando una sub-función (closure) referencia variables que se declaran más abajo en el mismo scope, hacer un check mental: *¿se ejecuta esa sub-función antes de la declaración?*. Si sí, mover la llamada o la declaración. Herramientas útiles: `tsc --noEmit --strict` o ESLint con `no-use-before-define` activado.

### 13.2 serde naming convention: snake_case (Rust) vs camelCase (TS)

**Bug**: `get_auth_status` retornaba `{ id, has_key: true, last4: "604f" }` (snake_case, idiomático de Rust). El frontend esperaba `{ id, hasKey: true, last4: "604f" }` (camelCase, idiomático de JS). Resultado: `provider.hasKey` era `undefined` → `!active.hasKey` era `true` → el UI mostraba "OAuth — no editable" para providers que en realidad SÍ tenían API key (opencode-go, openrouter, etc.).

**Causa**: cuando se usa `#[derive(Serialize)]` en Rust **sin** `#[serde(rename_all = "camelCase")]`, el struct se serializa con los field names exactos de Rust (snake_case por convención). Tauri **no** transforma automáticamente entre Rust y JS conventions para retornos de commands custom.

```rust
// MAL: serializa como { id, has_key, last4 }
#[derive(Serialize)]
pub struct ProviderInfo {
    pub id: String,
    pub has_key: bool,    // ← snake_case en JSON
    pub last4: Option<String>,
}

// BIEN: serializa como { id, hasKey, last4 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub has_key: bool,    // ← renombrado a hasKey en JSON
    pub last4: Option<String>,
}
```

**Convención del proyecto**: otros structs del backend YA tienen `#[serde(rename_all = "camelCase")]` (ver `pi_sessions.rs:24`, `recents.rs:35`). El de `ProviderInfo` se olvidó en el commit `1f889c7` que lo creó.

**Prevención**: cuando se crea un struct nuevo que se retorna al frontend vía Tauri command, agregar el `#[serde(rename_all = "camelCase")]` desde el principio. Es 1 línea y previene el mismatch entero. Para los **argumentos** de los commands, Tauri 2 SÍ convierte snake_case → camelCase automáticamente, pero para **retornos** no.

**Troubleshooting rápido**: si un campo que esperás ver en el frontend es `undefined`, lo más probable es que sea un mismatch de naming. Abrir el WebView DevTools, inspeccionar el JSON que llega via IPC, y comparar con el nombre que usa el TS.

---

## 14. pi en modo RPC no soporta permisos de tools (Etapa 5)

**Hallazgo**: durante el cierre de la Etapa 5, descubrimos que **pi en modo RPC no tiene un mecanismo para que el frontend apruebe o deniegue tools antes de que se ejecuten**. El evento `tool_execution_start` llega **DESPUÉS** de que pi ya decidió ejecutar, y no hay un evento intermedio de `permission_request` en el JSONL.

**Implicación**: la validación 4 de la Etapa 5 ("El usuario puede aprobar/denegar herramientas peligrosas") no se puede implementar con la versión actual de pi. xi no tiene control sobre qué tools ejecuta pi o no — pi corre como un proceso con los permisos del usuario y ejecuta bash/read/edit/write libremente.

**Confirmado en la doc oficial** (`docs/security.md` de pi-coding-agent):
> "Pi does not include a built-in sandbox. Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the pi process."

> "Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt."

**Lo que sí podemos hacer (futuro)**:

1. **Extension de pi (más correcto)**: escribir una extension de pi que intercepta tools peligrosas (`bash`, `edit`, `write`) y emite un evento custom de `permission_request` en el JSONL antes de ejecutar. xi lo maneja con UI de approve/deny y responde con allow/deny. Trabajo: varios días. Requiere aprender la API de extensions de pi (TypeScript, corre dentro de pi).

2. **Kill switch en xi (más rápido)**: botón de "abortar" en la UI que envía un `abort` command a pi cuando está ejecutando una tool. NO es prevent approve/deny, pero reacciona si el user ve algo mal. Trabajo: 1-2 horas. Aceptable para v2.

3. **Gondolin sandbox (más seguro pero más invasivo)**: pi puede correr con un sandbox de micro-VM que aísla las tools del sistema host. NO es approve/deny interactivo, pero limita el daño si pi ejecuta algo destructivo. Trabajo: setup + config de Gondolin. Cambia el deploy (requiere Gondolin instalado).

**Decisión de scope (Etapa 5)**: marcamos la etapa como completada con 3/4 validaciones. La 4ta se documenta como limitación upstream y se difiere a v2 cuando decidamos cuál opción tomar. Para el MVP, xi asume que el user usa pi en un entorno confiado (su propia máquina, un repo de su propiedad) — que es exactamente la posición oficial de pi.

**Recomendación futura**: si esto es importante para usuarios no-técnicos, empezar por el kill switch (#2) por velocidad, y mientras tanto diseñar la extension (#1) como solución definitiva.

---

## 15. tauri-plugin-shell: truncamiento de output grande (bug #7684)

### El problema

`pi-sessions list` con un workspace de 35 sesiones (~220KB de JSON, 200KB solo en `firstMessage`) fallaba con:
```
failed to parse pi-sessions output: EOF while parsing a string at line 1 column 73728
```

73728 = 72KB = 64KB (pipe buffer de Linux) + 8KB (BufReader interno). El output se truncaba exactamente ahí, sin importar el tamaño real del JSON.

### La causa real

`tauri-plugin-shell` pasa los eventos de stdout del sidecar por su **event loop proxy interno**. Cuando el volumen de datos supera la capacidad del proxy (~72KB en la práctica), los eventos se pierden silenciosamente. Es un bug conocido y confirmado por el equipo de Tauri:

> "events are lost because the internal event loop proxy is full/busy handling previous events and we ignore that error hence the skipped events"
> — [tauri-apps/tauri#7684](https://github.com/tauri-apps/tauri/issues/7684)

El proxy se satura porque cada chunk de stdout se convierte en un evento que pasa por el event loop de Tauri. Con output grande, el event loop no alcanza a procesar todos los eventos antes de que el pipe se llene y el reader thread se bloquee.

### Bugs en cascada que intentamos primero

1. **`output()` inserta `\n` entre chunks** ([#3090](https://github.com/tauri-apps/plugins-workspace/issues/3090)): el método `output()` del shell plugin agrega un byte `\n` después de cada chunk recibido. Si el chunk boundary cae dentro de un string JSON, inserta un control character (0x0A) inválido. → error: `control character (\u0000-\u001F) found while parsing a string`.

2. **Race condition en `spawn()` + `recv()` manual**: al usar `spawn()` en vez de `output()`, el evento `Terminated` puede llegar antes de que todos los `Stdout` eventos se procesen. Si haces `break` al recibir `Terminated`, pierdes los últimos chunks. → mismo error EOF, mismo truncamiento.

Ambos son síntomas del mismo problema de fondo: el shell plugin de Tauri **no es confiable para outputs grandes**.

### La solución: bypassar el shell plugin

En vez de usar `app.shell().sidecar("pi-sessions").args().output()`, usamos `std::process::Command` directamente, que usa pipes nativas del OS con buffering ilimitado, sin pasar por ningún event loop proxy.

```rust
use std::process::Command;

fn resolve_sidecar_path() -> Result<PathBuf, String> {
    // std::env::current_exe() → target/debug/xi-backend
    // el sidecar está en el mismo directorio
    let exe = std::env::current_exe()...;
    let exe_dir = exe.parent()...;
    let bin_path = exe_dir.join("pi-sessions");
    if !bin_path.exists() { return Err(...); }
    Ok(bin_path)
}

async fn run_pi_sessions(args: Vec<String>) -> Result<String, String> {
    let bin_path = resolve_sidecar_path()?;
    // spawn_blocking porque Command::output() es bloqueante
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&bin_path).args(&args).output()
    }).await??;
    String::from_utf8(output.stdout)...
}
```

Esto es exactamente lo que recomienda el equipo de Tauri en el issue #7684:
> "Runs the command directly in Rust using `Command::new("python").arg(...).output()`, rather than relying on Tauri's implementation."

### Por qué solo pasa con workspaces grandes

Workspaces con pocas sesiones y `firstMessage` cortos generan JSON <64KB, que cabe en un solo chunk del pipe. El proxy no se satura y todo llega bien. Solo cuando el output supera ~72KB (35+ sesiones con mensajes largos) se dispara el bug.

### Implicación para el sidecar `pi`

El sidecar `pi` (modo RPC) también pasa por el shell plugin de Tauri. Aunque su output es JSONL línea por línea (cada línea <8KB), un bug similar podría manifestarse si pi emite muchos eventos en ráfaga. **Recomendación**: si se ven eventos perdidos en el flujo de chat, migrar el spawn de `pi` al mismo patrón (`std::process::Command` + lectura manual del pipe), en vez de `app.shell().sidecar("pi").spawn()`.

### Referencias

- [tauri-apps/tauri#7684](https://github.com/tauri-apps/tauri/issues/7684) — bug original del event loop proxy
- [tauri-apps/plugins-workspace#3090](https://github.com/tauri-apps/plugins-workspace/issues/3090) — `output()` inserta `\n` entre chunks
- [tauri-apps/plugins-workspace#1632](https://github.com/tauri-apps/plugins-workspace/issues/1632) — datos sin `\n` final no se envían
- [tauri-apps/plugins-workspace#1471](https://github.com/auri-apps/plugins-workspace/issues/1471) — encoding incorrecto de stdout
- [PR #1231](https://github.com/tauri-apps/plugins-workspace/pull/1231) — `set_raw_out(true)` para output sin newline scanning
- [PR #9698](https://github.com/tauri-apps/tauri/pull/9698) — fix parcial con retry de eventos (no resuelve outputs muy grandes)
