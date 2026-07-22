/**
 * main.tsx — Entry point de xi mobile (SolidJS).
 *
 * App shell apilado: chip de conexión + pantalla activa + input bar.
 */
import { render } from 'solid-js/web';
import { navigate } from 'xi-ui/lib/nav.ts';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { loadServerConfig, buildWsUrl } from './lib/connection-storage.ts';
import { connectToServer } from './lib/ws-init.ts';
import { ConnectionChip } from './components/connection-chip';
import { OutputBoard } from './components/output-board';
import { InputBar } from './components/input-bar';

function App() {
  return (
    <>
      <div id="conn-chip"><ConnectionChip /></div>
      <div id="screen" class="output-board"><OutputBoard /></div>
      <div id="input-bar"><InputBar /></div>
    </>
  );
}

render(() => <App />, document.getElementById('app')!);

async function init(): Promise<void> {
  addEntry('system', 'xi mobile starting...');

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

void init();
