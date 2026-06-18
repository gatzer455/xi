# NOTAS — xi

Ideas, decisiones pendientes, y temas a pulir que surgen durante el desarrollo.
No son compromisos, son capturas para no olvidar.

---

## Nombre de sesiones — ¿amigable o prompt?

**Contexto:** pi asigna a cada sesión un nombre críptico (basado en su
sessionId UUID, ej. `a3f8c9d1-...`). Como nombre de tab en el top bar
del browser-shaped layout, no es legible.

**Opciones discutidas (Etapa de pulir UI, no ahora):**

1. **Auto: fecha de creación** — ej. `2026-06-18 14:32`. Cero fricción,
   siempre legible. El usuario lo puede renombrar después (ya existe la
   lógica de `handleRename` en sessions.ts).
2. **Prompt al crear** — el modal de "+ Nueva conversación" pide un
   nombre, con la fecha como default. Más fricción, mejor DX.
3. **Híbrido** — fecha como default, prompt solo si el usuario quiere
   renombrar antes de crear. Botón "Renombrar" en la tab.

**Decisión:** pospuesto para la fase de pulir interfaz. Por ahora se
usa el nombre de pi. Anotado para no perderlo.

---

## Activar el updater de xi (Etapa 7) — pasos finales

**Contexto:** el updater está implementado y commiteado, pero `endpoints: []`
en `backend/tauri.conf.json` (placeholder hasta que exista el repo de releases).
Tampoco hay repo de GitHub configurado todavía, ni secrets de CI. Cuando llegue
el momento de hacer el primer release, hay que hacer estos pasos.

### Pasos

1. **Crear el repo de xi en GitHub** (público o privado según se decida).
2. **Llenar el endpoint** en `backend/tauri.conf.json`:
   ```json
   "endpoints": [
     "https://github.com/{owner}/{repo}/releases/latest/download/latest.json"
   ]
   ```
3. **Rotar la key de dev** (la que está embebida ahora es de `~/.tauri/xi.key`
   con passphrase de dev). Generar una nueva para producción:
   ```bash
   npx tauri signer generate -w ~/.tauri/xi.prod.key -p "<passphrase-fuerte>"
   ```
   Copiar el contenido de `xi.prod.key.pub` a `plugins.updater.pubkey`.
4. **Configurar GitHub Secrets** en el repo (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: contenido completo de `xi.prod.key` (incluyendo header).
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: passphrase.
5. **Backup local** de `xi.prod.key` + passphrase en 1Password o similar. Si se
   pierde, xi se congela en la última versión firmada (escenario catastrophic).
6. **Primer release**:
   ```bash
   git tag v0.1.0
   git push --tags
   ```
   El workflow `.github/workflows/release.yml` se dispara, builda para las 3
   plataformas, y crea un release en estado `draft`. Revisar los artifacts y
   publicar manualmente.
7. **Verificar end-to-end**:
   - Bajar la versión publicada, instalarla.
   - Hacer un cambio chico (ej. bumpear version en `package.json`).
   - Commit + tag `v0.1.1` + push.
   - Abrir la app v0.1.0 — el banner debería aparecer con "v0.1.1 lista".
   - Click en "Reiniciar" → la app se reabre en v0.1.1.

### Pendientes chicos de la Etapa 7 (no bloquean)

- **`app.getVersion()` en lugar de hardcoded "0.1.0"** — hoy la versión en
  settings está hardcoded. Usar `import { getVersion } from '@tauri-apps/api/app'`
  para leer la versión real del binario.
- **Release notes inline en sección settings** — hoy solo se muestra el status
  ("v0.2.0 lista para aplicar"). Mostrar las primeras líneas del `body` (que
  es markdown) con un expandible para ver todo.
- **Cross-compile del sidecar pi a Windows** — el workflow tiene
  `continue-on-error: true` en `build-pi.sh` y `build-pi-sessions.sh` porque
  cross-compilar bun a Windows desde linux/macOS no funciona bien. Hoy
  distribuimos linux + macOS; Windows necesita un runner de windows
  (probablemente con `bun build --compile --target=bun-windows-x64`).
- **macOS codesign + notarization** — los builds de macOS van sin firmar,
  el user ve un warning de "developer cannot be verified" la primera vez.
  Necesita Apple Developer ID ($99/año) y configurar `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` en GitHub Secrets. Aceptable para v1 si distribuimos
  por fuera de la App Store; bloqueante si queremos Mac App Store.

---

## Otros pendientes
- (vacío — agregar aquí cuando surjan)
