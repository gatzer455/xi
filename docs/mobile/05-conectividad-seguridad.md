# 05 — Conectividad y seguridad

## El modelo de amenaza, sin eufemismos

xi-serve expone por la red **un agente que ejecuta comandos de shell y edita archivos en el homeserver**. Quien pueda hablarle al daemon puede, en el límite, ejecutar código en el servidor — no es un bug, es la función. Por eso el diseño es de capas: cada una asume que la anterior puede fallar.

```
Capa 1: Red        — el daemon no es alcanzable desde internet (Tailscale)
Capa 2: Identidad  — token estático; sin token no hay conexión
Capa 3: Capacidad  — whitelist de proyectos; el API remoto expone menos que el IPC local
Capa 4: Supervisión— approve/ask remotos: el humano ve lo que el agente hace
```

## Capa 1 — Red: Tailscale

- **Bind exclusivo al tailnet.** xi-serve escucha solo en la IP de la interfaz `tailscale0`, jamás en `0.0.0.0`. Verificable con `ss -tlnp`.
- El tráfico dentro del tailnet ya viaja cifrado por WireGuard. TLS explícito (`tailscale cert` emite certificados válidos para el nombre MagicDNS) es opcional para el piloto; se vuelve necesario si algún día una PWA exige contexto seguro.
- **ACLs de Tailscale** como refuerzo opcional: permitir solo a los dispositivos del dueño alcanzar el puerto de xi-serve.
- Túneles públicos (Cloudflare Tunnel, ngrok): descartados por diseño — contradicen el no-objetivo de exposición a internet.

## Capa 2 — Identidad: token estático

Estar en el tailnet ≠ ser de confianza (un laptop prestado, un nodo compartido). El daemon autentica cada conexión:

- xi-serve **genera un token aleatorio (256 bits) al primer arranque** y lo guarda en su config (`~/.pi/config/xi-serve.json`). Lo imprime una vez por consola para copiarlo.
- El cliente lo envía en el handshake del WS (`/ws?token=…` — query param porque la API de WebSocket del navegador no permite headers). Mismatch → close inmediato.
- **Revocar = regenerar** el token en el server (borrar el campo del config y reiniciar). Se pega el nuevo en settings del celular.
- Cada intento fallido se loggea (con la IP de origen). Sin rate limit explícito: con 256 bits de entropía, fuerza bruta ya es computacionalmente inviable sin necesidad de limitar intentos — el rate limit defendería contra un PIN corto, no contra esto.

**Diferido a futuro multi-dispositivo:** pairing por QR con código de un solo uso, device tokens individuales, revocación por dispositivo, CLI `xi-serve devices/revoke`. Para un usuario con un teléfono, un token que se copia una vez da la misma seguridad efectiva con una fracción del código.

## Capa 3 — Capacidad: el API remoto es más chico que el IPC local

| Capacidad | Desktop (IPC) | Remoto (xi-serve) |
|-----------|---------------|-------------------|
| Prompt, abort, cambiar modelo/thinking | ✅ | ✅ |
| Sesiones (crear, listar, cambiar) | ✅ | ✅ solo en proyectos whitelisteados |
| Leer archivos de proyectos | ✅ | ✅ solo dentro de la whitelist, read-only |
| Escribir archivos desde la UI | ✅ | ❌ (el agente escribe; el humano remoto no edita directo) |
| API keys de providers (leer/escribir) | ✅ | ❌ nunca (`xi_get_auth_status` devuelve solo nombres de providers) |
| Editar approve-rules | ✅ | ❌ |
| Abrir proyecto en path arbitrario | ✅ | ❌ solo la whitelist del config |

**La whitelist de proyectos es la decisión más importante de esta tabla**: acota el radio del agente remoto a directorios elegidos deliberadamente, en vez de "todo lo que el usuario del proceso pueda tocar".

**Sin whitelist de tipos de comando pi** (passthrough): quien tiene el token puede promptear al agente, que es estrictamente más poder que cualquier comando RPC individual — filtrar tipos de comando no agrega seguridad real. La contención efectiva son las approve-rules y la whitelist de proyectos.

## Capa 4 — Supervisión: approvals y visibilidad

- **xi-flow sigue mandando.** Las approve-rules del servidor (`~/.pi/agent/approve-rules.json`) aplican igual con clientes remotos. Garantizado porque xi-serve ejecuta `ensure_extensions()` al arrancar ([02](02-arquitectura.md)) — en un homeserver headless nadie más instala xi-flow.
- **La ejecución de shell ya viene contenida**: xi-tools (brush-core + processkit) es la misma ruta de ejecución que en desktop. Recomendación para uso remoto: perfil de approve-rules más estricto — el costo de un tap extra en el celular es bajo; el de un `rm` desatendido no.
- **Timeout de approve = denegar** (nunca aprobar por silencio). Requests pendientes sin cliente conectado se encolan y re-entregan al conectar ([03](03-protocolo.md)).
- **Diferido:** log de auditoría estructurado (qué comando, qué dispositivo, cada approve con su resolución) y notificaciones ntfy — llegan cuando el piloto valide el flujo básico.

## Riesgos residuales y posturas

| Riesgo | Postura |
|--------|---------|
| Celular robado/desbloqueado con la app abierta | Regenerar el token en el server. Biometría al abrir: futuro (plugin Tauri). |
| Compromiso de un nodo del tailnet | Capa 2 sigue en pie: sin token no hay sesión. |
| El agente mismo hace algo destructivo | No es un riesgo nuevo del móvil — es el riesgo de pi. Mitigaciones de siempre: approve-rules, whitelist, el usuario. El móvil lo *mejora*: una tarea desatendida pasa a tener a alguien mirando. |
| Bug en xi-serve explotable desde el tailnet | Superficie mínima: sin token válido solo existe el close del handshake. Dependencias mínimas (tokio + tungstenite, sin framework HTTP). |
| XSS vía markdown renderizado | Mismo pipeline de sanitización que desktop (markdown-it sin HTML crudo); el contenido viene de un LLM que lee páginas web. |
