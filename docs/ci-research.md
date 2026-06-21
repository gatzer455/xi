# Investigación CI/CD — Junio 2026

## Problemas y soluciones encontradas en la comunidad

### 1. 🔴 Sidecar no encontrado por Tauri build (crítico)

**Error:** `resource path 'pi-x86_64-unknown-linux-gnu' doesn't exist`

**Causa raíz:**
`tauri_build::build()` (versión 2.x) valida que los paths de `externalBin` existan durante
compilación (`cargo build`, `cargo test`). Si el binario no está donde Tauri lo espera,
el build falla.

**¿Dónde busca Tauri los sidecars?**
- `externalBin` es relativo al `tauri.conf.json`
- `externalBin: ["pi"]` → busca en `backend/pi-{target_triple}`
- `externalBin: ["binaries/pi"]` → busca en `backend/binaries/pi-{target_triple}`

**Referencias:**
- [Issue #15134](https://github.com/tauri-apps/tauri/issues/15134): "A `binaries/` subdirectory we had been using was **not** the path Tauri resolves"
- [Issue #14602](https://github.com/tauri-apps/tauri/issues/14602): reporta exactamente el mismo error que tenemos
- [PR #14608](https://github.com/tauri-apps/tauri/pull/14608): fix para skippear validación en `cargo check/clippy` (no en build/test)
- [PR #14633](https://github.com/tauri-apps/tauri/pull/14633): fix para copiar external binaries solo durante bundling (merged Dec 2025)

**Nuestra situación:**
| Aspecto | Actual | Debería ser |
|---------|--------|-------------|
| `externalBin` | `["pi"]` | `["binaries/pi"]` |
| Ubicación binario | `backend/binaries/pi-{triple}` | `backend/binaries/pi-{triple}` ✅ |
| Lo que Tauri busca | `backend/pi-{triple}` (no existe) | `backend/binaries/pi-{triple}` (sí existe) |

**Solución:**
Cambiar `externalBin` en `tauri.conf.json` de `["pi"]` a `["binaries/pi"]`.
Esto es **consistente con la documentación oficial** de Tauri 2:
> `"externalBin": ["binaries/my-sidecar"]` requiere `src-tauri/binaries/my-sidecar-{target-triple}`

**Cambios adicionales necesarios:**
1. `tauri.conf.json`: `externalBin: ["binaries/pi", "binaries/pi-sessions"]`
2. `capabilities/default.json`: `"name": "pi"` → `"name": "binaries/pi"`
3. Rust `sidecar("pi")` → sin cambios (sidecar() toma solo el filename, no el path)
4. `build.rs` → sin cambios (ya busca en binaries/)

---

### 2. 🟡 shell().sidecar() — filename vs path

**Docs oficiales:**
> "The `sidecar()` function expects just the filename, NOT the whole path"

Ejemplo:
```json
externalBin: ["binaries/app", "my-sidecar", "../scripts/sidecar"]
```
→ `sidecar("app")`, `sidecar("my-sidecar")`, `sidecar("sidecar")`

Pero las **capabilities** usan el path completo:
```json
"name": "binaries/app"
```

Y JavaScript `Command.sidecar()` también usa el path completo:
```javascript
Command.sidecar('binaries/my-sidecar')
```

**Nuestra situación:**
- `externalBin: ["binaries/pi"]` → Rust `sidecar("pi")` ✅ correcto
- Capabilities: `"name": "binaries/pi"` → hay que actualizar

---

### 3. 🟢 cargo fmt inconsistente (ya resuelto)

**Causa:** `rustfmt` versiones distintas local (1.x) vs CI (2.x). 
Formato automático difiere entre versiones.

**Solución:** Siempre correr `cargo fmt` antes de commit. ✅

---

### 4. 🟢 Flaky test (ya resuelto)

**Causa:** `Date.now()` llamado dos veces en el mismo test podía diferir por 1ms.

**Solución:** Guardar timestamp en variable. ✅

---

### 5. 🟢 Release workflow (ya resuelto)

| Problema | Solución |
|----------|----------|
| Faltaban system deps (libwebkit2gtk) | Agregar step en release.yml |
| No había script "tauri" en package.json | Agregar `"tauri": "npx tauri"` |
| No se instalaban root deps | Agregar `npm ci` en root |

---

### 6. Información adicional

**Sidecars en `cargo test`:**
- Issue [#13767](https://github.com/tauri-apps/tauri/issues/13767): sidecars no funcionan en tests
  porque el path se resuelve en `target/debug/deps/` en vez de `target/debug/`
- PR [#3234](https://github.com/tauri-apps/tauri/pull/3234): fix merged Jan 2026

**Cross-compilation con bun:**
- `bun build --compile --target=bun-windows-x64` funciona desde Linux
- Requiere LLVM tools y xwin para Windows SDK headers
- Nuestro `build-pi.sh --target windows` ya maneja esto

---

## Resumen de cambios propuestos

| Archivo | Cambio |
|---------|--------|
| `backend/tauri.conf.json` | `externalBin: ["pi"]` → `["binaries/pi", "binaries/pi-sessions"]` |
| `backend/capabilities/default.json` | `"name": "pi"` → `"name": "binaries/pi"` |
| `backend/capabilities/default.json` | `"name": "pi-sessions"` → `"name": "binaries/pi-sessions"` |
| `backend/build.rs` | Probablemente simplificable (Tauri 2.6+ maneja sidecars) |
| CI workflow | Ya incluye build de sidecar antes de cargo build/test |
