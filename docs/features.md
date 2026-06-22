# Funcionalidades de xi

Catalogo de lo implementado hasta la version 0.1.1. Cada seccion describe una funcionalidad, como se usa y en que consiste.

---

## Chat con pi

La pantalla principal. El usuario escribe un mensaje y pi responde en tiempo real, con los tokens apareciendo a medida que se generan.

Durante la respuesta, pi puede mostrar:

- **Bloques de pensamiento**: el razonamiento interno de pi, colapsables para no ocupar espacio. El usuario puede expandirlos si le interesa.
- **Llamadas a herramientas**: cuando pi ejecuta comandos o accede a archivos. El resultado de cada herramienta se muestra colapsado debajo.
- **Matematicas**: si la respuesta contiene expresiones en LaTeX, se renderizan como MathML usando la libreria temml.

Los mensajes del usuario aparecen alineados a la derecha. Los del asistente, a la izquierda.

---

## Gestion de sesiones

Las sesiones permiten tener varias conversaciones separadas con pi. Cada sesion tiene su propio historial.

Desde la pantalla de sesiones se puede:

- **Crear una sesion nueva**. Se abre automaticamente en el chat.
- **Cambiar entre sesiones**. La conversacion activa se muestra en el chat.
- **Renombrar una sesion**. Por defecto llevan el nombre que pi les asigna.
- **Eliminar una sesion**. Se borra el archivo de historial.

Las sesiones activas se muestran como pestanas en la parte superior del chat. Se puede tener varias abiertas al mismo tiempo.

---

## Configuracion

Pantalla de ajustes con las siguientes secciones:

- **Modelo**: permite elegir el modelo de lenguaje que usa pi (por ejemplo, Claude Sonnet, GPT-4, Gemini). Tambien se configura el nivel de razonamiento (thinking).
- **Proveedores**: configuracion de API keys para siete proveedores: Anthropic, OpenAI, Google, OpenRouter, Groq, OpenCode Go y DeepSeek. Las keys se guardan en un archivo con permisos 600 (solo el usuario propietario).
- **Apariencia**: tema claro, oscuro o seguimiento del sistema. Tamano de fuente.
- **Acerca de**: muestra la version de xi y la version de pi que esta usando el sidecar.

---

## Pantalla de bienvenida

La primera pantalla que ve el usuario al abrir la aplicacion. Muestra:

- Un parrafo breve que explica que es xi y que puede hacer.
- Un boton para seleccionar una carpeta de trabajo.
- La lista de proyectos recientes.
- Un enlace de ayuda.
- Un boton para ir a configuracion (visible solo si no hay proveedores configurados).

Cuando el usuario selecciona una carpeta, la aplicacion navega automaticamente a la pantalla de sesiones.

---

## Explorador de archivos

Permite navegar los archivos del proyecto actual y editarlos. Incluye:

- Arbol de directorios con breadcrumb de navegacion.
- Vista previa de archivos de texto.
- Editor de texto plano.

El explorador no permite crear ni eliminar archivos por ahora.

---

## Extension UI handler

xi intercepta las solicitudes interactivas que hacen las extensiones de pi. Cuando una extension necesita una decision del usuario (aprobar un comando, seleccionar una opcion, ingresar texto), xi muestra un dialogo en la interfaz.

Las extensiones que usan este mecanismo incluyen:

- **pi-approve**: extension que拦截 llamadas a herramientas potencialmente peligrosas (borrar archivos, ejecutar comandos). Muestra un dialogo donde el usuario puede aprobar o rechazar la operacion.

El mecanismo funciona asi: la extension emite un evento `extension_ui_request` con el tipo de interaccion, y xi lo traduce a un dialogo nativo.

---

## Actualizaciones automaticas

La aplicacion se actualiza sola cuando hay una nueva version. Usa el plugin `tauri-plugin-updater` con firmas criptograficas.

Cada archivo binario que se distribuye lleva una firma `.sig` generada con la clave privada del proyecto. El updater verifica la firma antes de instalar la actualizacion.

Las actualizaciones se publican como releases de GitHub. El flujo es:

1. Se pushea un tag `v*` al repositorio.
2. GitHub Actions compila la aplicacion para Linux, Windows y macOS.
3. Los archivos compilados se suben al release.
4. La aplicacion detecta la nueva version y ofrece actualizarse.

---

## Soporte para varios idiomas

La aplicacion esta en espanol neutro latinoamericano. Pi, el motor, responde en el idioma que se le pida.

---

## Pagina de versiones

La seccion "Acerca de" en los ajustes muestra la version de xi (tomada de `app.getVersion()`) y la version de pi (consultada al sidecar con `pi --version`).

---

## Lo que no esta implementado

- **Crear y eliminar archivos** desde el explorador. Solo se pueden ver y editar.
- **Multi-ventana**. La aplicacion usa una sola ventana.
- **Terminal embebida**. La salida de herramientas se muestra en el chat, no en una terminal separada.
- **AppImage y RPM**. Solo se distribuye `.deb` para Linux. Ver [docs/roadmap.md](docs/roadmap.md).
