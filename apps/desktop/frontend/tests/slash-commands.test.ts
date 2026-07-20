/**
 * slash-commands.test.ts — Tests del dispatcher de slash commands.
 *
 * Cubre el parseo `/cmd args` → RpcCommand tipado, la validación
 * contra get_commands, y los outcomes (handled/prompt/unknown).
 * Los side effects (sendPiCommand, navigate, dispatch) se mockean
 * para inspeccionar el JSON exacto que xi manda a pi.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => {
  function mockSignal<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      get value() { return value; },
      set value(v: T) {
        if (v === value) return;
        value = v;
        subs.forEach((fn) => fn(value));
      },
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => { subs.delete(fn); };
      },
    };
  }
  const activeTabId = mockSignal<string | null>('tab-1');
  return {
    createMockAppState: () => ({ activeTabId }),
    activeTabId,
  };
});

const sendPiCommand = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());

vi.mock('xi-ui/lib/state.ts', () => ({ appState: mockState.createMockAppState() }));
vi.mock('xi-ui/lib/pi/tauri-commands.ts', () => ({ sendPiCommand }));
vi.mock('xi-ui/lib/debug-panel.ts', () => ({ addEntry: vi.fn() }));
vi.mock('xi-ui/lib/nav.ts', () => ({ navigate }));
vi.mock('xi-ui/lib/chat/stores.ts', () => ({
  getStore: () => ({ dispatch }),
}));

import {
  dispatchSlashCommand,
  setKnownExtensionCommands,
  requestExtensionCommands,
  BUILTIN_SLASH_COMMANDS,
} from 'xi-ui/lib/pi/slash-commands.ts';

// ─── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  sendPiCommand.mockReset();
  navigate.mockReset();
  dispatch.mockReset();
  sendPiCommand.mockResolvedValue(undefined);
  // Baseline determinístico: cache cargado y vacío. Los tests de
  // builtins no tocan el default branch; los de cache lo sobreescriben.
  // El race real (loaded=false) se prueba aparte con vi.resetModules.
  setKnownExtensionCommands([]);
});

// ─── Builtins → RPC tipado ───────────────────────────────────────────────

describe('dispatchSlashCommand — builtins', () => {
  test('/compact envía {type:"compact"}', async () => {
    const out = await dispatchSlashCommand('/compact');
    expect(out.kind).toBe('handled');
    expect(sendPiCommand).toHaveBeenCalledOnce();
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'compact' });
  });

  test('/compact con instrucciones pasa customInstructions', async () => {
    await dispatchSlashCommand('/compact enfocá solo en la auth');
    const sent = JSON.parse(sendPiCommand.mock.calls[0][0]);
    expect(sent).toEqual({ type: 'compact', customInstructions: 'enfocá solo en la auth' });
  });

  test('/new envía {type:"new_session"}', async () => {
    const out = await dispatchSlashCommand('/new');
    expect(out.kind).toBe('handled');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'new_session' });
  });

  test('/name <nombre> envía set_session_name', async () => {
    const out = await dispatchSlashCommand('/name mi sesión');
    expect(out.kind).toBe('handled');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'set_session_name', name: 'mi sesión' });
  });

  test('/name sin arg no envía nada y muestra feedback', async () => {
    const out = await dispatchSlashCommand('/name');
    expect(out.kind).toBe('handled');
    expect(sendPiCommand).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
    const msg = dispatch.mock.calls[0][0].message;
    expect(msg.parts[0].text).toContain('Uso');
  });

  test('/clone envía {type:"clone"}', async () => {
    const out = await dispatchSlashCommand('/clone');
    expect(out.kind).toBe('handled');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'clone' });
  });

  test('/bash <cmd> envía {type:"bash", command}', async () => {
    const out = await dispatchSlashCommand('/bash ls -la');
    expect(out.kind).toBe('handled');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'bash', command: 'ls -la' });
  });

  test('/bash sin arg no envía nada', async () => {
    await dispatchSlashCommand('/bash');
    expect(sendPiCommand).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  test('/export con ruta pasa outputPath', async () => {
    await dispatchSlashCommand('/export /tmp/sesion.html');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({
      type: 'export_html', outputPath: '/tmp/sesion.html',
    });
  });

  test('/export sin ruta omite outputPath', async () => {
    await dispatchSlashCommand('/export');
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'export_html' });
  });
});

// ─── /settings y /help (locales) ──────────────────────────────────────────

describe('dispatchSlashCommand — locales', () => {
  test('/settings navega a settings', async () => {
    const out = await dispatchSlashCommand('/settings');
    expect(out.kind).toBe('handled');
    expect(navigate).toHaveBeenCalledWith('settings');
    expect(sendPiCommand).not.toHaveBeenCalled();
  });

  test('/help muestra mensaje local con la lista de builtins', async () => {
    const out = await dispatchSlashCommand('/help');
    expect(out.kind).toBe('handled');
    expect(dispatch).toHaveBeenCalledOnce();
    const msg = dispatch.mock.calls[0][0].message;
    expect(msg.role).toBe('assistant');
    const text = msg.parts[0].text;
    for (const c of BUILTIN_SLASH_COMMANDS) {
      expect(text).toContain(`/${c.name}`);
    }
  });
});

// ─── Validación contra get_commands ──────────────────────────────────────

describe('dispatchSlashCommand — extensión/skill/prompt', () => {
  test('comando en cache → outcome prompt (pi expande)', async () => {
    setKnownExtensionCommands([{ name: 'skill:escritor' }, { name: 'mi-prompt' }]);
    const out = await dispatchSlashCommand('/skill:escritor redactá X');
    expect(out.kind).toBe('prompt');
    expect(sendPiCommand).not.toHaveBeenCalled(); // no lo manda como RPC
    // El caller (input.ts) lo manda como prompt común.
  });

  test('cache cargado pero vacío → estricto: unknown (no mandar al LLM)', async () => {
    setKnownExtensionCommands([]);
    const out = await dispatchSlashCommand('/cualquiera arg');
    expect(out).toEqual({ kind: 'unknown', name: 'cualquiera' });
    expect(sendPiCommand).not.toHaveBeenCalled();
  });

  test('cache no cargado todavía (race del init) → leniente: prompt', async () => {
    // El race real es “get_commands nunca respondió” (loaded=false),
    // distinto de “cargó vacío”. Reimportamos el módulo para estado fresco.
    vi.resetModules();
    const mod = await import('xi-ui/lib/pi/slash-commands.ts');
    const out = await mod.dispatchSlashCommand('/cualquiera arg');
    expect(out.kind).toBe('prompt');
  });

  test('no builtin ni en cache → unknown, no envía', async () => {
    setKnownExtensionCommands([{ name: 'skill:escritor' }]);
    const out = await dispatchSlashCommand('/foo');
    expect(out).toEqual({ kind: 'unknown', name: 'foo' });
    expect(sendPiCommand).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce(); // mensaje de error local
    expect(dispatch.mock.calls[0][0].message.parts[0].text).toContain('/foo');
  });
});

// ─── Cache helpers ───────────────────────────────────────────────────────

describe('cache de get_commands', () => {
  test('requestExtensionCommands envía {type:"get_commands"}', () => {
    requestExtensionCommands();
    expect(sendPiCommand).toHaveBeenCalledOnce();
    expect(JSON.parse(sendPiCommand.mock.calls[0][0])).toEqual({ type: 'get_commands' });
  });

  test('setKnownExtensionCommands puebla el cache (afecta validación)', async () => {
    setKnownExtensionCommands([{ name: 'mi-cmd' }]);
    expect((await dispatchSlashCommand('/mi-cmd')).kind).toBe('prompt');
    expect((await dispatchSlashCommand('/otro')).kind).toBe('unknown');
  });
});
