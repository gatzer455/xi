# Roadmap

Este documento describe lo que se esta construyendo, lo que sigue y las ideas que estan en estudio. Usa el formato Now/Next/Later, que prioriza por horizonte en lugar de por fecha.

No hay fechas firmes. Lo que esta en Now puede cambiar de prioridad si aparece algo urgente. Lo que esta en Later puede moverse a Next cuando se cumplan las condiciones.

---

## Now (en desarrollo activo)

| Que | Por que | Estado |
|-----|---------|--------|
| Refinamiento de markdown renderer | El renderizado actual es texto plano. Falta: syntax highlighting en code blocks, formato legible de tool calls (no JSON crudo), estilos markdown con tema pi-light, y manejo de casos borde (paths absolutos, code sin lenguaje) | Diseno listo en .develop/02-design/chat-rendering-pi-theme.md |
| CI/CD estable | Las builds automaticas ya funcionan pero requieren ajustes para Windows y macOS en release | Todos los tests pasan. Release v0.1.1 publicado |
| Refinamiento de extension UI | El handler de extensiones funciona, pero hay casos borde que probar | Funciona con pi-approve |

---

## Next (proximo horizonte)

| Que | Por que | Depende de |
|-----|---------|------------|
| Version real en settings | Hoy la version de la aplicacion esta escrita a mano. Deberia leerse de `app.getVersion()` | Nada |
| Release notes inline | Cuando llega una actualizacion, mostrar los cambios en la misma pantalla de ajustes | Updater ya funciona |
| AppImage para Linux | Llegar a usuarios de distribuciones que no usan Debian ni Ubuntu | Encontrar una forma de que linuxdeploy funcione en CI. Ver [docs/discoveries.md](discoveries.md) (seccion CI/CD) |
| Nombre de sesiones automatico | Asignar un nombre a cada sesion basado en el primer mensaje o en inteligencia artificial | Nada |

---

## Later (ideas en estudio)

Estas ideas no tienen prioridad asignada. Aparecen aqui para no perderlas y para que quien llegue al repo sepa que se ha considerado.

| Idea | Notas |
|------|-------|
| Multi-ventana | Una ventana por sesion. Requiere cambios en como Tauri maneja las ventanas |
| Terminal embebida | Mostrar la salida de herramientas en una terminal en lugar de en el chat |
| Crear y eliminar archivos desde el explorador | El explorador hoy solo lee y edita. Faltan operaciones de escritura |
| Vista previa de imagenes en el explorador | Hoy solo muestra archivos de texto |
| Integracion explorador-chat | Poder enviar archivos desde el explorador al chat |
| Que pi pueda elegir el modelo | Que pi decida que modelo usar segun la tarea, en lugar de que el usuario lo fije |
| Paquete RPM para Linux | Para Fedora, openSUSE y derivados |
| Code signing para macOS | Requiere una cuenta de desarrollador de Apple ($99/ano) |
| Firmas de actualizaciones en Windows | Authenticode para el instalador |

---

## Lo que ya se termino

| Funcionalidad | Version |
|---------------|---------|
| Chat con streaming de tokens | 0.1.0 |
| Thinking blocks colapsables | 0.1.0 |
| Tool calls con formato visual | 0.1.0 |
| Gestion de sesiones (crear, listar, renombrar, eliminar) | 0.1.0 |
| Pestanas de sesiones | 0.1.0 |
| Pantalla de ajustes (modelo, thinking, tema, fuente) | 0.1.0 |
| Configuracion de proveedores (7 proveedores) | 0.1.0 |
| Pantalla de bienvenida con deteccion de proveedores | 0.1.0 |
| Auto-update con firma criptografica | 0.1.0 |
| Extension UI handler | 0.1.0 |
| Soporte matematico (LaTeX con temml) | 0.1.0 |
| Explorador de archivos | 0.1.0 |
| Tests unitarios (50+) | 0.1.0 |
| Tests E2E con tauri-driver | 0.1.0 |
| CI/CD en GitHub Actions | 0.1.1 |
| pi-approve en la interfaz de xi | 0.1.0 |
| Release para Linux (deb), Windows (exe, msi) y macOS (dmg, Intel y ARM) | 0.1.1 |
