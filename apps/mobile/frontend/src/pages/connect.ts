/**
 * connect.ts — Pantalla de conexión: URL + token de xi-serve.
 *
 * Primera pantalla si no hay ServerConfig persistido, o si la
 * conexión inicial falla. Al conectar con éxito navega a 'projects'.
 */
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { saveServerConfig, buildWsUrl, loadServerConfig } from '../lib/connection-storage.ts';
import { connectToServer } from '../lib/ws-init.ts';

export function ConnectPage(): Page {
  const root = document.createElement('div');
  root.className = 'connect-page';
  const scope = createScope();

  const title = document.createElement('h1');
  title.textContent = 'Conectar a xi-serve';
  root.append(title);

  const existing = loadServerConfig();

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'homeserver.tailnet.ts.net:9876';
  urlInput.value = existing?.url ?? '';
  urlInput.className = 'connect-input';
  root.append(labeled('Servidor', urlInput));

  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = 'token';
  tokenInput.value = existing?.token ?? '';
  tokenInput.className = 'connect-input';
  root.append(labeled('Token', tokenInput));

  const error = document.createElement('div');
  error.className = 'connect-error';
  error.style.display = 'none';
  root.append(error);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'connect-submit';
  submitBtn.textContent = 'Conectar';
  root.append(submitBtn);

  submitBtn.addEventListener('click', () => {
    void submit();
  });

  async function submit(): Promise<void> {
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();
    if (!url || !token) {
      showError('Completa servidor y token.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Conectando…';
    error.style.display = 'none';
    try {
      const config = { url, token };
      await connectToServer(buildWsUrl(config));
      saveServerConfig(config);
      navigate('projects');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Conectar';
    }
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.style.display = 'block';
  }

  return { root, dispose: () => scope.dispose() };
}

function labeled(text: string, input: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'connect-field';
  const span = document.createElement('span');
  span.textContent = text;
  wrap.append(span, input);
  return wrap;
}
