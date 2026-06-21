---
# xi Design Tokens — YAML frontmatter
# Spec: https://github.com/google-labs-code/design.md

colors:
  # Light mode — Warm minimal
  light:
    background: "#faf7f0"
    foreground: "#1a1814"
    card: "#ffffff"
    card-foreground: "#1a1814"
    primary: "#e3d9b4"
    primary-foreground: "#1a1814"
    secondary: "#f5f2eb"
    secondary-foreground: "#1a1814"
    muted: "#5a5650"
    muted-foreground: "#8a8680"
    accent: "#f0ede6"
    accent-foreground: "#1a1814"
    destructive: "#c45c4a"
    destructive-foreground: "#ffffff"
    border: "#e0ddd6"
    input: "#e0ddd6"
    ring: "#e3d9b4"
  # Dark mode — Warm dark
  dark:
    background: "#1a1814"
    foreground: "#f0ede6"
    card: "#242118"
    card-foreground: "#f0ede6"
    primary: "#e3d9b4"
    primary-foreground: "#1a1814"
    secondary: "#2d2a22"
    secondary-foreground: "#f0ede6"
    muted: "#6b665c"
    muted-foreground: "#8a8680"
    accent: "#2d2a22"
    accent-foreground: "#f0ede6"
    destructive: "#d4756a"
    destructive-foreground: "#1a1814"
    border: "#3d3830"
    input: "#3d3830"
    ring: "#e3d9b4"

typography:
  font-family:
    sans: "'Adwaita Sans', 'Inter', system-ui, sans-serif"
    mono: "'Adwaita Mono', 'Iosevka', monospace"
  scale:
    xs: "0.75rem"
    sm: "0.875rem"
    base: "1rem"
    lg: "1.125rem"
    xl: "1.25rem"
    2xl: "1.5rem"
  weights:
    regular: 400
    medium: 500
    semibold: 600
    bold: 700

spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  6: "1.5rem"
  8: "2rem"
  12: "3rem"

radius:
  none: "0px"
  sm: "2px"
  md: "4px"
  lg: "6px"

components:
  button:
    borderRadius: "{radius.md}"
    padding: "8px 16px"
    fontWeight: 500
  card:
    borderRadius: "{radius.md}"
    padding: "16px"
  input:
    borderRadius: "{radius.md}"
    padding: "8px 12px"
  topbar:
    height: "48px"
---

# xi — Design System

## Visual Theme & Atmosphere

xi es una app de escritorio para interactuar con un asistente de inteligencia artificial, dirigida a usuarios no-técnicos.

**Personalidad:** Amigable pero profesional. No es un terminal, no es una app genérica. Es una herramienta que se siente accesible pero seria.

**Mood:** Cálido, limpio, sin ruido visual. El usuario debe sentirse en control, no abrumado.

**Densidad:** Baja. El chat con un LLM ya es denso — la interfaz debe respirar.

**Inspiración:** Claude Desktop (estética cálida, editorial), icono de xi (pixel-art, beige), browser-shaped nav.

## Color Palette & Roles

### Light Mode — Warm Minimal

| Rol | Color | Hex | Uso |
|-----|-------|-----|-----|
| Background | Crema cálido | `#faf7f0` | Fondo de página |
| Card | Blanco cálido | `#ffffff` | Superficies elevadas |
| Primary | Beige (del icono) | `#e3d9b4` | Acciones principales, accent de marca |
| Primary text | Marrón oscuro | `#2d2a24` | Texto sobre primary |
| Secondary | Crema claro | `#f5f2eb` | Hover states, superficies secundarias |
| Muted | Gris medio | `#5a5650` | Texto deshabilitado, placeholders |
| Muted FG | Gris cálido | `#8a8680` | Texto muy sutil |
| Foreground | Casi negro cálido | `#1a1814` | Texto principal |
| Border | Gris cálido | `#e0ddd6` | Separadores, bordes de inputs |
| Destructive | Rojo cálido | `#c45c4a` | Errores, eliminar |

### Dark Mode — Warm Dark

| Rol | Color | Hex | Uso |
|-----|-------|-----|-----|
| Background | Marrón muy oscuro | `#1a1814` | Fondo de página |
| Card | Marrón oscuro | `#242118` | Superficies elevadas |
| Primary | Beige | `#e3d9b4` | Acciones principales (se mantiene) |
| Primary text | Marrón muy oscuro | `#1a1814` | Texto sobre primary |
| Secondary | Marrón medio | `#2d2a22` | Hover states |
| Muted | Gris medio | `#6b665c` | Texto deshabilitado |
| Muted FG | Gris cálido | `#8a8680` | Placeholders |
| Foreground | Crema | `#f0ede6` | Texto principal |
| Border | Marrón medio | `#3d3830` | Separadores |
| Destructive | Rojo claro | `#d4756a` | Errores |

### Notas sobre dark mode

- El dark no es negro puro — es un marrón muy oscuro (`#1a1814`) con undertone cálido
- El primary `#e3d9b4` se mantiene igual en ambos modos — es el color de marca
- El texto en dark es crema (`#f0ede6`), no blanco puro
- Los borders en dark son marrón medio, no gris frío

## Typography Rules

### Font Stack

- **UI / Body:** Adwaita Sans (variante customizada de Inter para GNOME)
- **Code / Mono:** Adwaita Mono (Iosevka configurado para parecerse a Adwaita Sans)

### Type Scale

| Nivel | Tamaño | Peso | Uso |
|-------|--------|------|-----|
| xs | 12px | 400 | Captions, metadata, badges |
| sm | 14px | 400 | Labels, texto secundario |
| base | 16px | 400 | Body text, inputs |
| lg | 18px | 500 | Subtítulos, card titles |
| xl | 20px | 600 | Headings de sección |
| 2xl | 24px | 700 | Títulos de página |

### Reglas

- No usar italic (GUI guidelines de GNOME lo desaconsejan)
- No usar ALL CAPS
- Line height: 1.5 para body, 1.3 para headings
- Usar pesos 400/500/600/700 (no más de 4)

## Layout Principles

### Grid

- Base unit: 4px (todos los spacings son múltiplos de 4)
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px

### App Shell — Browser-Shaped

```
┌─────────────────────────────────────┐
│ TOP BAR (48px)                      │
│ logo | project | tabs |   | settings│
├─────────────────────────────────────┤
│                                     │
│ CONTENT AREA (flex: 1)              │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ INPUT BAR                           │
│ textarea                    [enviar]│
└─────────────────────────────────────┘
```

- Top bar fija arriba (48px)
- Input bar fija abajo
- Content area scrollable
- Sin sidebar — toda la navegación está en el top bar

### Elevation

- Bordes sutiles para separar secciones (no sombras)
- Bordes: 1px solid `--border`
- Sombras: none (estilo flat)

## Components

### Top Bar

- Height: 48px
- Background: `--card`
- Border-bottom: 1px solid `--border`
- Font: mono (Adwaita Mono) para project path
- Logo: 28×28px, border-radius: 4px, background: `--primary`
- Project pill: `--secondary` background, border, border-radius: 4px
- Tabs: border-radius: 4px, gap: 2px

### Button

- Primary: `--primary` bg, `--primary-foreground` text
- Secondary: `--secondary` bg, `--secondary-foreground` text
- Border-radius: 4px
- Padding: 8px 16px
- Font-weight: 500
- Hover: darken 10%

### Card

- Background: `--card`
- Border: 1px solid `--border`
- Border-radius: 4px
- Padding: 16px

### Input

- Background: `--background`
- Border: 1px solid `--input`
- Border-radius: 4px
- Padding: 8px 12px
- Focus: border-color `--ring`
- Font: mono

### Chat Bubble

- User: `--primary` background, `--primary-foreground` text
- Assistant: `--card` background, `--card-foreground` text, border
- Border-radius: 4px (cuadrado, no redondeado)
- Padding: 12px 16px

## Guidelines

### Do's

- Usar siempre tokens CSS variables, nunca colores hardcodeados
- Mantener la densidad baja — respirar, no apretar
- Usar Adwaita Sans para UI, Adwaita Mono solo para code
- Border-radius consistente: 4px para componentes, 4px para top bar
- Usar la paleta warm como base, no inventar colores
- El color `#e3d9b4` es el color de marca — usarlo con moderación

### Don'ts

- No usar sombras (estilo flat)
- No usar italic
- No usar ALL CAPS
- No usar border-radius > 6px (profesional, no redondeado)
- No usar negro `#000000` ni blanco `#ffffff` para backgrounds grandes
- No mezclar fonts diferentes para el mismo tipo de contenido
- No usar colores fríos (azules, grises fríos) — mantener la paleta cálida
