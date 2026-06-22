# Descubrimientos tecnicos

Resumen de decisiones y lecciones para lectura rapida por LLM.

---

## Sidecar resolution en Tauri 2

`app.shell().sidecar("X")` busca en `<target/debug|release>/X`. No agrega target triple, no revisa `binaries/`, no consulta `externalBin`. El path es literal.

`externalBin` es solo metadata para el bundler (empaquetado). No influye en dev.

Reglas:
- `sidecar("pi")` busca `target/debug/pi` (sin triple, sin prefijo).
- `build.rs` copia el binario de `backend/binaries/pi-{triple}` a `target/debug/pi`.
- `externalBin: ["binaries/pi"]` → Tauri busca el source en `backend/binaries/pi-{triple}`.
- Capabilities usan `"name": "binaries/pi"` (path completo desde tauri.conf.json).

Bug conocido: `tauri-plugin-shell` pierde eventos para stdout >72KB (tauri#7684). Workaround: usar `std::process::Command` directo en vez de `sidecar().spawn()`.

---

## pi como bun-binary

`bun build --compile` produce binario standalone. Implicaciones:
- `pi update --self` no funciona (bun-binary no puede actualizarse solo).
- `pi --version` retorna "0.0.0" sin package.json al lado.

Fix: `scripts/build-pi.sh` genera package.json con version real, lo copia a `backend/binaries/` junto al binario. `build.rs` lo copia a `target/debug/`. En spawn, se pasa `PI_PACKAGE_DIR=<dir>` para que pi lo encuentre.

xi y pi se distribuyen atomicamente. Un release de xi incluye una version fija de pi.

---

## pi-sessions: session dir resolution

`pi-sessions list <cwd>` replica la logica de `SessionManager` de pi:
1. Lee `<cwd>/.pi/settings.json` via `SettingsManager.create(cwd)`.
2. Si `sessionDir` es relativo, lo resuelve contra cwd. Si es absoluto, lo usa directo.
3. Si no hay `sessionDir`, usa default: `~/.pi/agent/sessions/--<cwd encoded>--`.

No se puede importar `getDefaultSessionDir` de pi (bun --compile no resuelve sub-paths). Se replica localmente (4 lineas) con comentario: "si pi cambia la formula, replicar aca".

---

## Auth de pi

`~/.pi/agent/auth.json` es multi-provider, multi-tipo:
```json
{ "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "github-copilot": { "type": "oauth", "refresh": "...", "access": "...", "expires": 12345 } }
```

xi escribe el auth.json directamente (mismo formato que pi). Usa atomic write (tmp + fsync + rename) para evitar corruption.

xi no implementa OAuth (requiere server local, riesgo legal, mantenimiento continuo). Solo API keys para 7 proveedores. OAuth se difiere.

Validacion de keys: cada provider tiene endpoint ligero (GET models o POST con max_tokens:1). 2xx = valida, 401/403 = invalida, 429 = rate limit, 5xx = error provider.

Patron "Ver" on-demand: backend nunca envia key completa en `get_auth_status`. Solo `{ has_key, last4 }`. La key viaja por IPC solo cuando el usuario hace clic en "Ver".

---

## Cuidados con serde (Rust -> frontend)

Los structs que se retornan al frontend via Tauri command necesitan `#[serde(rename_all = "camelCase")]`. Tauri 2 NO convierte snake_case a camelCase en retornos (si en argumentos).

Sintoma: campo `undefined` en frontend. Fix: agregar el atributo al struct.

---

## CI/CD lecciones

| Problema | Causa | Fix |
|----------|-------|-----|
| sidecar no encontrado | externalBin sin `binaries/` prefix | `externalBin: ["binaries/pi"]` |
| frontendDist no existe | `cargo test --all-targets` necesita `frontend/dist/` | Build frontend antes de tests |
| clippy sin sidecar | `cargo clippy` valida externalBin | Build sidecar en lint job |
| E2E sin WebKitWebDriver | Faltaba `webkit2gtk-driver` en apt | Agregar al install |
| E2E sin frontendDist | Lo mismo que tests | Build frontend en E2E job |
| linuxdeploy en release | AppImage requiere FUSE, no disponible en CI | Usar `--bundles deb` |
| Windows build-pi.sh | Bash script ejecutado en PowerShell | Agregar `shell: bash` |
| macOS universal build | `x86_64-apple-darwin` target no instalado | `rustup target add`, o builds separados |
| Windows sidecar .exe | build.rs busca sin extension | Agregar chequeo de .exe en Windows |
| Tauri-action version mismatch | tag v0.1.1 pero config dice 0.1.0 | Bumpear version en tauri.conf.json |

---

## pi-approve

Extension de pi que intercepta tool calls peligrosos. Flujo:
1. pi-approve emite `extension_ui_request` por stdout.
2. Backend intercepta (busca `type == "extension_ui_request"`), crea oneshot channel, emite evento al frontend.
3. Frontend muestra dialogo (select/confirm). Usuario responde.
4. Backend escribe `{ type: "extension_ui_response", id, value }` al stdin de pi.

Para verificar si carga: agregar `console.error("[pi-approve] Loaded")` al inicio de la extension. Si no aparece, pi no la auto-descubre en modo RPC.

---

## Formato de pi RPC

Protocolo JSONL sobre stdin/stdout. Eventos clave:

| Evento | Direccion | Contenido |
|--------|-----------|-----------|
| `pi:raw` | pi -> frontend | Linea JSONL del stdout de pi |
| `extension_ui_request` | pi -> frontend | `{ type, id, method, title, options }` |
| `extension_ui_response` | frontend -> pi | `{ type: "extension_ui_response", id, value }` |
| `prompt` | frontend -> pi | Mensaje del usuario |
| `abort` | frontend -> pi | Cancelar generacion actual |

---

## Recursos que pi necesita al lado del binario

pi (bun-binary) busca en `dirname(exe)`:
- `theme/dark.json` y `theme/light.json` (temas builtin). `build.rs` los copia a `target/debug/theme/`.
- `package.json` (version). `build.rs` lo copia de `backend/binaries/package.json`.

`--no-themes` no evita carga de temas builtin, solo custom themes.

---

## Anti-patrones documentados

- Usar `scripts/before-dev.sh` para copiar sidecar a mano. En vez: `build.rs` (idiomatico Rust, automatico, CI-friendly).
- Asumir que `process.cwd()` del sidecar refleja el cwd del usuario. En vez: pasar cwd como argumento y resolver paths explicitamente.
- Usar `tauri-plugin-shell` para outputs grandes (>72KB). En vez: `std::process::Command` directo.
- Olvidar `#[serde(rename_all = "camelCase")]` en structs que retornan al frontend.
- Llamar closures antes de declarar las variables que capturan (TDZ de const/let).
