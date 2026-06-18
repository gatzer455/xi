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

## Otros pendientes
- (vacío — agregar aquí cuando surjan)
