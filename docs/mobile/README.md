# xi mobile — Acceso remoto desde el celular

Diseño del acceso móvil a xi/pi corriendo en un homeserver. El celular **no** ejecuta el agente: es una pantalla remota. El agente, las sesiones, las API keys y el filesystem viven en el servidor.

**Estado:** Fases 1–3 completas — servidor, paquete compartido `xi-ui`, y app Android validada en dispositivo real (APK debug + adb reverse contra xi-serve local: streaming fluido en el WebView). Queda Fase 4 (uso diario) y probar contra el homeserver vía Tailscale. Ver [06-roadmap-mvp.md](06-roadmap-mvp.md). Es un **piloto de un solo usuario** — las decisiones optimizan por eso, no por producto general.

## El problema en una frase

Hoy la única forma de hablar con pi desde el celular es Termux + Tailscale + SSH — funciona, pero es frágil, incómodo de escribir, se corta al bloquear la pantalla, y no muestra streaming, markdown ni approvals de forma usable.

## La tesis en una frase

xi ya está partido en dos mitades — una UI que solo conoce eventos JSONL (detrás de `PiEventBus`, ya mergeado), y un backend que solo spawnea pi y hace pipe de stdin/stdout — así que el trabajo real es **reemplazar el puente Tauri IPC por un puente de red**, no construir una app desde cero.

## Documentos

| Doc | Contenido |
|-----|-----------|
| [01-vision.md](01-vision.md) | Problema, objetivo, no-objetivos |
| [02-arquitectura.md](02-arquitectura.md) | xi-serve, responsabilidades, modelo de sesiones |
| [03-protocolo.md](03-protocolo.md) | Protocolo WS: passthrough + invoke, resync, extension UI |
| [04-cliente-movil.md](04-cliente-movil.md) | App Tauri 2 + paquete compartido `xi-ui` |
| [05-conectividad-seguridad.md](05-conectividad-seguridad.md) | Tailscale, token, whitelist, modelo de amenaza |
| [06-roadmap-mvp.md](06-roadmap-mvp.md) | Fases de implementación |

## Decisiones tomadas (resumen)

1. **Cliente:** app Tauri 2 (Android primero) en `apps/mobile`, dentro del monorepo. Comparte el pipeline de chat **y los estilos** vía paquete workspace (`packages/xi-ui`) — un solo diseño, dos layouts. PWA y nativo: descartados.
2. **Servidor:** `packages/xi-serve` (Rust, ya existe como passthrough) crece a: token estático, whitelist de proyectos, `ensure_extensions()`, gestión de sesiones, archivos read-only.
3. **Config en runtime:** la app pide URL + token en settings y los persiste. Nada horneado en build time.
4. **Auth:** token estático único generado por xi-serve. Pairing QR multi-dispositivo: futuro.
5. **Reconexión:** resync total (`get_state`/`get_messages`) en cada reconexión. Sin ring buffer ni números de secuencia.
6. **Alcance del piloto:** chat con streaming + sesiones + approve/ask + explorador read-only. Sin push (ntfy después).
7. **Red:** Tailscale como capa de conectividad. El daemon nunca se expone a internet.
8. **Desktop:** intocado funcionalmente. Se limpia el código mobile que se le filtró (`WsEventBus`, `mobile.ts`, `__XI_SERVE_URL__` migran a `apps/mobile` / `packages/xi-ui`).
