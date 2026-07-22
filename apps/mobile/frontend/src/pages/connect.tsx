/**
 * connect.tsx — Pantalla de conexión: URL + token de xi-serve.
 */
import { createSignal } from 'solid-js';
import { navigate } from 'xi-ui/lib/nav.ts';
import { saveServerConfig, buildWsUrl, loadServerConfig } from '../lib/connection-storage.ts';
import { connectToServer } from '../lib/ws-init.ts';

export function ConnectPage() {
  const existing = loadServerConfig();

  const [url, setUrl] = createSignal(existing?.url ?? '');
  const [token, setToken] = createSignal(existing?.token ?? '');
  const [error, setError] = createSignal('');
  const [connecting, setConnecting] = createSignal(false);

  async function submit() {
    const u = url().trim();
    const t = token().trim();
    if (!u || !t) {
      setError('Completa servidor y token.');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const config = { url: u, token: t };
      await connectToServer(buildWsUrl(config));
      saveServerConfig(config);
      navigate('projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div class="connect-page">
      <h1>Conectar a xi-serve</h1>
      <label class="connect-field">
        <span>Servidor</span>
        <input
          type="text"
          placeholder="homeserver.tailnet.ts.net:9876"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          class="connect-input"
        />
      </label>
      <label class="connect-field">
        <span>Token</span>
        <input
          type="password"
          placeholder="token"
          value={token()}
          onInput={(e) => setToken(e.currentTarget.value)}
          class="connect-input"
        />
      </label>
      {error() && <div class="connect-error">{error()}</div>}
      <button
        class="connect-submit"
        disabled={connecting()}
        onClick={submit}
      >
        {connecting() ? 'Conectando…' : 'Conectar'}
      </button>
    </div>
  );
}
