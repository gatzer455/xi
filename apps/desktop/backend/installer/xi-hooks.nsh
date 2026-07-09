; ═══════════════════════════════════════════════════════════════
; xi — NSIS Installer Hooks
;
; Personalizaciones del instalador: branding, comportamiento
; post-install y limpieza pre-uninstall.
;
; Incluido vía `installerHooks` en tauri.conf.json.
; ═══════════════════════════════════════════════════════════════

; ── Hook: Pre-Install ──────────────────────────────────────────
; Se ejecuta antes de copiar archivos, registrar registry y
; crear accesos directos.
!macro NSIS_HOOK_PREINSTALL
  ; Mostrar banner informativo al inicio
  DetailPrint "╔══════════════════════════════════════╗"
  DetailPrint "║        xi — Tu agente LLM           ║"
  DetailPrint "║  Hecho con 💜 por gatzer            ║"
  DetailPrint "╚══════════════════════════════════════╝"
!macroend

; ── Hook: Post-Install ─────────────────────────────────────────
; Se ejecuta después de copiar todos los archivos, registrar
; keys y crear accesos directos.
!macro NSIS_HOOK_POSTINSTALL
  ; Mensaje de éxito
  DetailPrint "✓ xi instalado correctamente"

  ; Eliminar el placeholder de lado del usuario y reemplazar
  ; con un accesso directo real en el menú de inicio.
  ; (Tauri ya crea el suyo, pero aseguramos consistencia)
!macroend

; ── Hook: Pre-Uninstall ────────────────────────────────────────
; Se ejecuta antes de remover archivos, registry y accesos.
!macro NSIS_HOOK_PREUNINSTALL
  ; Intentar cerrar xi gracefulmente si está corriendo
  ; (nsis_tauri_utils::KillProcess se encarga del force kill
  ;  si no responde)
  DetailPrint "Cerrando xi..."
!macroend

; ── Hook: Post-Uninstall ───────────────────────────────────────
; Se ejecuta después de remover todo.
!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "✓ xi desinstalado correctamente"
  DetailPrint "  Los datos de configuración pueden persistir"
  DetailPrint "  en %APPDATA%/com.xi.app si no se seleccionó"
  DetailPrint "  'Eliminar datos de la aplicación'."
!macroend
