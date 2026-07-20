/**
 * main.ts — Entry point de xi mobile.
 *
 * App shell apilado: chip de conexión + pantalla activa + input bar.
 * A diferencia de desktop (main.ts conecta antes de montar), acá
 * montamos el shell primero y navegamos a 'connect' o 'projects' —
 * si hay ServerConfig persistido, ProjectsPage muestra su propio
 * "conectando…" mientras `connectToServer` resuelve en background.
 */
// ── Estilos (orden del cascade = orden de estos imports) ──
// Ver apps/desktop/frontend/src/main.ts: mismo bug de dev server. Los
// <link> relativos a packages/xi-ui escapan del root de Vite y caen al
// SPA fallback; importarlos acá los sirve correcto en dev y build.
import 'xi-ui/styles/theme.css';
import 'xi-ui/styles/tokens.css';
import './styles/layout.css';
import 'xi-ui/styles/components.css';
import 'xi-ui/styles/markdown.css';

import { navigate } from 'xi-ui/lib/nav.ts';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { loadServerConfig, buildWsUrl } from './lib/connection-storage.ts';
import { connectToServer } from './lib/ws-init.ts';
import { ConnectionChip } from './components/connection-chip.ts';
import { OutputBoard } from './components/output-board.ts';
import { InputBar } from './components/input-bar.ts';

function mountShell(): void {
  document.getElementById('conn-chip')!.append(ConnectionChip());
  document.getElementById('screen')!.append(OutputBoard());
  document.getElementById('input-bar')!.append(InputBar());
}

async function main(): Promise<void> {
  addEntry('system', 'xi mobile starting...');
  mountShell();

  const config = loadServerConfig();
  if (!config) {
    navigate('connect');
    return;
  }

  navigate('projects');
  try {
    await connectToServer(buildWsUrl(config));
  } catch (err) {
    addEntry('system', `Connect failed: ${err}`);
    navigate('connect');
  }
}

void main();
