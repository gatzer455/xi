# Edit Tool Panic Log

> Bitácora de fallos del comando `edit` de xi-tools durante la sesión
> del sistema de paneles (rama `feat/panel-system`, julio 2026).

## Datos del bug

- **Binario**: `xi-tools` (Rust) - `src/edit.rs`
- **Línea del pánico**: `256:61` en todos los casos
- **Error**: `index out of bounds: the len is X but the index is X`
- **Patrón**: `len == index` (off-by-one: el índice apunta exactamente al final del slice)
- **Archivos afectados**: `layout.css` (3 veces), `panel-manager.ts` (1 vez)

## Instancias

### 1. `layout.css` — `.chat-content-row` (edit 1/3)

```
thread 'main' (246625) panicked at src/edit.rs:256:61:
index out of bounds: the len is 860 but the index is 860
```

**Contexto**: Se intentó reemplazar el bloque `.chat-content-row` con 4 líneas (flex + flex-direction + min-height). El bloque original tenía 3 líneas (flex + flex-direction).

**Acción**: Se usó `sed` vía bash para sortear el pánico.

**Archivo final**: `apps/desktop/frontend/src/styles/layout.css`, línea 415 (original), ~874 líneas después de la inserción.

### 2. `layout.css` — `.chat-content-row` (edit 2/3)

```
thread 'main' (246660) panicked at src/edit.rs:256:61:
index out of bounds: the len is 868 but the index is 868
```

**Contexto**: Mismo reemplazo, archivo con +8 líneas por la inserción anterior. El pánico persiste aunque el archivo cambió de tamaño.

**Acción**: Se usó `awk` + `sed` para localizar las líneas exactas y editar con `sed`.

### 3. `layout.css` — `.output-content` (edit 3/3)

```
thread 'main' (263464) panicked at src/edit.rs:256:61:
index out of bounds: the len is 874 but the index is 874
```

**Contexto**: Se intentó reemplazar `.output-content { height: 100%; box-sizing: border-box; }` por `.output-board { ... }` + `.output-content { flex: 1; min-height: 0; }`.

**Acción**: Se usó `python3` con `str.replace()`.

### 4. `panel-manager.ts` — `openSessionTab` insertion

```
thread 'main' (269251) panicked at src/edit.rs:256:61:
index out of bounds: the len is 294 but the index is 294
```

**Contexto**: Se intentó reemplazar el bloque `setActiveTabId(id); navigate('explorer'); return id; }` con el mismo bloque + `openSessionTab()` function.

**Acción**: Se usó `python3` con `str.replace()`.

## Hipótesis

El pánico ocurre en `src/edit.rs:256:61`. El error `len == index` sugiere un
**off-by-one** en el algoritmo de hashline que calcula en qué línea del archivo
original aplicar el reemplazo. 

El algoritmo de hashline:
1. Lee el archivo completo
2. Busca el `oldText` como substring
3. Cuenta cuántas líneas hay antes del match → `line_start`
4. Cuenta cuántos `\n` hay en `oldText` → `line_count`
5. Calcula `line_end = line_start + line_count`
6. **Accede a `lines[line_end]`** → aquí paniquea si `line_end == lines.len()`

El `line_end` debería ser `min(line_start + line_count, lines.len() - 1)` o
el bloque debería terminar antes de acceder al array si `line_end >= lines.len()`.

## Mitigación temporal

Usar `python3 -c "..."` con `str.replace()` para reemplazos en archivos
donde el edit tool paniquea. Alternativamente, `sed` para líneas exactas.

```python
python3 -c "
with open('path', 'r') as f:
    content = f.read()
content = content.replace('old', 'new', 1)
with open('path', 'w') as f:
    f.write(content)
"
```

## Workaround para el dev

Si al editar un archivo el tool paniquea:

1. Leer las líneas exactas alrededor del match con `sed -n 'N,Mp'`
2. Copiar el contenido a un `python3` inline con `str.replace()`
3. Alternativamente, usar `sed -i 's/old/new/'` para reemplazos simples

El equipo de xi-tools debería considerar un fix en `hashtext` o en la lógica
de bounds checking de `edit.rs:256`.
