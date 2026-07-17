# 04 — Cliente móvil

**Decidido: app Tauri 2 (Android primero) en `apps/mobile`, dentro del monorepo**, compartiendo el pipeline de chat y los estilos con desktop vía un paquete workspace. Descartados: PWA servida por xi-serve (se prefirió app con identidad propia y camino a push/biometría) y nativo Kotlin/Swift (reescribir el streaming markdown con reconciliación — lo más caro del proyecto — para mantener dos frontends para siempre).

## El activo: el pipeline ya es agnóstico del transporte

El frontend habla con pi exclusivamente a través de `PiEventBus` (ya mergeado). Todo lo demás — streaming (`state-sync` → `SmoothStreamer` → `reconcileDom`), chat store y reducer, markdown+LaTeX, componentes, signals, routing — funciona igual con eventos que llegan por WebSocket. Meses de trabajo fino de anti-flicker que se reusan tal cual.

## El paquete compartido: `packages/xi-ui`

El grueso de `apps/desktop/frontend/src` migra a un paquete del workspace, consumido por ambas apps:

| Va a `xi-ui` | Se queda en desktop | Va a mobile |
|---|---|---|
| `lib/chat/` (types, store, reducer, mapping) | `TauriEventBus`, `tauri-commands.ts` | `WsEventBus` |
| `lib/pi/` transport (interfaz), event-parser, state-sync, types | `init.ts` desktop (elige TauriEventBus) | Entry point propio + init mobile |
| `smooth-streamer.ts`, `signal.ts`, `nav.ts` | Páginas desktop (welcome, settings, explorer desktop) | Pantalla conexión (URL + token) |
| Markdown + `format-tool-call` + `icons` | `updater.ts`, integración Tauri desktop | Layout móvil (navegación apilada) |
| Componentes de chat (bubble, chips, dialogs) | | Approve/ask como bottom sheet |
| **`styles/`: tokens, theme, markdown, components** | | Explorador read-only móvil |

**Los estilos van en el paquete**: `tokens.css`, `theme.css`, `markdown.css` son la identidad visual de xi. Un solo diseño, dos layouts — cambiar un token cambia ambas apps.

Con esto, desktop queda **sin una sola línea que sepa que existe un modo remoto**: mueren `mobile.ts`, el define `__XI_SERVE_URL__` de `vite.config.ts` y la detección build-time en `init.ts`. La interfaz `PiEventBus` no es código mobile — es la frontera de transporte que hace todo esto posible (y hace testeable la capa pi sin mockear Tauri).

## Configuración en runtime

La primera apertura (o settings) pide **URL del servidor + token**, persistidos en localStorage. Cambiar de servidor no requiere recompilar nada. Esto reemplaza el esquema anterior de URL horneada en build time, que obligaba a recompilar el APK por cada cambio de servidor.

## Adaptaciones de UI

En orden de impacto:

1. **Layout responsive.** Navegación por pantallas apiladas (proyectos → sesiones → conversación). El routing hash-based propio (`lib/nav.ts`) ya modela vistas como estados.
2. **Estado de conexión visible.** Chip permanente "conectado / reconectando / sin conexión" alimentado por el estado de `WsEventBus`. En desktop no existe porque no puede pasar.
3. **Input táctil.** Textarea que crece, enviar con botón, dictado del SO gratis por ser input web estándar.
4. **Approve/ask como bottom sheet.** Comando en monospace, botones grandes Aprobar/Denegar — es LA interacción móvil por excelencia.
5. **Tool calls y thinking colapsados por defecto** en 390 px de ancho.
6. **Tablas y code blocks** con scroll horizontal propio (patrón ya presente en los estilos markdown; verificar en viewport angosto).

## Riesgo a validar temprano

El WebView de Android (System WebView) contra el pipeline de streaming — el trabajo anti-flicker se probó en WebKitGTK/WebView2. Probar con una conversación real apenas el chat móvil renderice; plan B: bajar el throttle de eventos para el cliente móvil.
