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
