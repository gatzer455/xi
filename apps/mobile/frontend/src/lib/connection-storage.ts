/**
 * connection-storage.ts — Persistencia de URL + token del servidor xi-serve.
 *
 * Config en runtime (no horneada en build time): la primera apertura
 * (o settings) pide URL + token, persistidos en localStorage. Cambiar
 * de servidor no requiere recompilar el APK (ver docs/mobile/04).
 */

export interface ServerConfig {
  url: string;
  token: string;
}

const KEY = 'xi.serverConfig';

export function loadServerConfig(): ServerConfig | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string' && parsed.url && parsed.token) {
      return { url: parsed.url, token: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveServerConfig(config: ServerConfig): void {
  localStorage.setItem(KEY, JSON.stringify(config));
}

/** Arma la URL de conexión `ws(s)://host/ws?token=...` a partir de lo
 *  que el usuario tipeó (acepta con o sin esquema/path — normaliza). */
export function buildWsUrl(config: ServerConfig): string {
  let base = config.url.trim();
  if (!/^wss?:\/\//.test(base)) {
    base = `ws://${base}`;
  }
  base = base.replace(/\/ws\/?$/, '').replace(/\/+$/, '');
  return `${base}/ws?token=${encodeURIComponent(config.token)}`;
}
