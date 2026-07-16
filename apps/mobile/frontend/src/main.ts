/**
 * main.ts — Entry point de xi mobile.
 *
 * App shell apilado: chip de conexión + pantalla activa + input bar.
 * A diferencia de desktop (main.ts conecta antes de montar), acá
 * montamos el shell primero y navegamos a 'connect' o 'projects' —
 * si hay ServerConfig persistido, ProjectsPage muestra su propio
 * "conectando…" mientras `connectToServer` resuelve en background.
 */
import { appState } from 'xi-ui/lib/state.ts';
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

const w = window as unknown as Record<string, unknown>;
w.__XI_APP_STATE = appState;
w.__XI_NAVIGATE = navigate;

void main();
