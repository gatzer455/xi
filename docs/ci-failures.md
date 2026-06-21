# Diagnóstico de fallos CI/CD

## Fallos observados

### 1. 🔴 Sidecar no encontrado por Tauri build
**Error:** `resource path 'pi-x86_64-unknown-linux-gnu' doesn't exist`
**Jobs afectados:** CI (test, build, e2e), Release (ubuntu, windows, macos)
**Descripción:**
- Tauri 2 verifica que los binarios definidos en `externalBin` existan durante `tauri_build::build()`
- El binario se compila con `build-pi.sh` y se copia a `backend/binaries/`
- Tauri espera encontrarlo en `backend/binaries/` según su target triple
- Pero `tauri_build::build()` falla antes de que nuestro `build.rs` pueda copiarlo
- **Intentos de solución:**
  - `1507cf1`: build.rs busca en binaries/ primero (falló)
  - `3ae4fcb`: copiar sidecar ANTES de tauri_build::build() (falló)

### 2. 🟡 cargo fmt inconsistente
**Error:** `cargo fmt --check` falla en CI pero pasa local
**Jobs afectados:** CI (lint)
**Descripción:**
- Después de editar build.rs, el formato de Rust cambia entre local y CI
- Posiblemente versiones de `rustfmt` distintas
- **Solución:** `cargo fmt` local y commit (3b29da1)

### 3. 🟢 Flaky test (timestamp)
**Error:** `guarda mensajes de la tab vieja antes de cambiar` - 1ms de diferencia en Date.now()
**Jobs afectados:** CI (test)
**Descripción:**
- Test llamaba `Date.now()` dos veces, podía diferir por 1ms
- **Solución:** Guardar timestamp en variable (3b29da1) ✅

### 4. 🟢 Release - system deps faltantes
**Error:** `gdk-sys v0.18.2` build failure
**Jobs afectados:** Release (ubuntu)
**Descripción:**
- El release workflow no instalaba libwebkit2gtk-4.1-dev y otras deps
- **Solución:** Agregar `Install system deps (Linux)` step (659bac7) ✅

### 5. 🟢 Release - tauri-action script
**Error:** `npm error Missing script: "tauri"`
**Jobs afectados:** Release (all platforms)
**Descripción:**
- tauri-action ejecuta `npm run tauri build` por defecto
- Nuestro package.json no tenía script "tauri"
- **Solución:** Agregar script "tauri": "npx tauri" (560ef4d) ✅

### 6. 🟢 Release - root deps
**Error:** `npm error could not determine executable to run`
**Jobs afectados:** Release (all platforms)
**Descripción:**
- El root package.json tiene `@tauri-apps/cli` como devDependency
- El release workflow no instalaba root deps (solo frontend)
- **Solución:** Agregar `npm ci` en root (e1951fc) ✅
