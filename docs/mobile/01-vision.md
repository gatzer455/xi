# 01 — Visión

## El problema

xi/pi corre en un homeserver (o en el desktop de la casa) y hace trabajo útil: tareas largas, gestión de archivos, búsquedas, automatizaciones. Pero cuando el usuario no está frente a esa máquina, no hay forma razonable de:

- Mandarle un mensaje al agente ("revisá si terminó el build y avisame").
- Ver el progreso de una tarea que quedó corriendo.
- Aprobar o denegar un comando que el agente quiere ejecutar (xi-flow `approve`).
- Retomar una conversación existente o abrir una nueva sobre un proyecto del servidor.

## El hack actual y por qué no alcanza

Hoy se puede llegar a pi desde el celular con **Termux + Tailscale + SSH**:

```
celular → Termux → ssh usuario@homeserver (via tailnet) → pi (TUI)
```

Funciona, pero:

| Problema | Detalle |
|----------|---------|
| Frágil | La sesión SSH muere al bloquear pantalla o cambiar de red. Hay que usar tmux/mosh para paliar, más piezas que se rompen. |
| Ilegible | La TUI de pi está pensada para terminal de escritorio: sin markdown renderizado, sin LaTeX, tablas rotas en 40 columnas. |
| Incómodo de escribir | Teclado de terminal en pantalla táctil, sin autocorrección útil, escapes de shell. |
| Sin notificaciones | Si el agente pide aprobación o termina una tarea, nadie se entera hasta volver a mirar. |
| Barrera de entrada | Requiere saber SSH, tmux y terminal. xi existe justamente para usuarios no-técnicos; el acceso móvil debería mantener esa promesa. |

## El objetivo

Una experiencia móvil que sea **al celular lo que xi es al desktop**: abrir una app (o una URL), ver las conversaciones del servidor, escribir un mensaje, ver la respuesta con streaming y markdown, aprobar comandos con un tap, recibir una notificación cuando algo requiere atención.

En términos de arquitectura: **el celular es una pantalla remota del agente, no un agente**.

El alcance actual es un **piloto de un solo usuario** (el autor, su homeserver, sus dispositivos). Las decisiones de diseño optimizan por eso: menos infraestructura, revocación manual, un cliente a la vez. Generalizar a producto viene después, si el piloto demuestra valor.

## No-objetivos

Tan importante como lo que es, es lo que **no** es:

- **No es xi corriendo en el teléfono.** No se empaqueta pi para Android/iOS, no hay sidecar en el celular, no hay API keys en el celular.
- **No opera sobre el filesystem del teléfono.** El working directory, las sesiones y los archivos son siempre del servidor.
- **No es multi-usuario.** Un homeserver, un dueño, N dispositivos del mismo dueño. Nada de cuentas, permisos por usuario ni tenancy — eso queda explícitamente fuera.
- **No se expone a internet.** El diseño asume una red overlay privada (Tailscale o equivalente). No hay historia de "abrí el puerto 443 en tu router".
- **No reemplaza al desktop.** Editar approve-rules, configurar providers, explorar árboles de archivos grandes: eso sigue siendo territorio del desktop. El móvil prioriza conversación, monitoreo y aprobación.

## Principios de diseño

1. **Servidor como fuente de verdad.** El estado de la conversación vive en el servidor (pi ya persiste sesiones en JSONL). Los clientes son vistas descartables: perder el celular o cerrar la pestaña no pierde nada.
2. **Reconexión como caso normal, no excepcional.** Las conexiones móviles se cortan decenas de veces por hora (pantalla bloqueada, cambio WiFi↔LTE, doze mode). El protocolo debe asumirlo desde el día uno (ver [03-protocolo.md](03-protocolo.md)).
3. **Reutilizar la separación que ya existe.** El frontend de xi solo toca Tauri en dos módulos (`lib/pi/tauri-commands.ts` y `lib/pi/init.ts`). Todo lo demás — streaming pipeline, chat store, reducer, markdown, componentes — es agnóstico del transporte. Esa frontera es el activo principal del proyecto (ver [04-cliente-movil.md](04-cliente-movil.md)).
4. **Seguridad por capas, no por oscuridad.** Tailscale reduce la superficie, pero el daemon igualmente autentica cada conexión: un dispositivo en el tailnet no es automáticamente confiable (ver [05-conectividad-seguridad.md](05-conectividad-seguridad.md)).
5. **Empezar por lo que ya duele.** El MVP es: mandar mensaje, ver respuesta, aprobar comando, recibir push. Explorador de archivos, settings y demás vienen después, si vienen.
