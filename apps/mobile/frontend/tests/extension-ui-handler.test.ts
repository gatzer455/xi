import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tryHandleExtensionUIRequest,
  setDialogRenderer,
  clearDialogRenderer,
  setExtensionUIBus,
} from '../src/lib/extension-ui-handler.ts';

describe('extension-ui-handler', () => {
  beforeEach(() => {
    clearDialogRenderer();
    setExtensionUIBus({ sendCommand: vi.fn() } as any);
  });

  it('ignores non-extension_ui_request lines', async () => {
    expect(await tryHandleExtensionUIRequest('{"type":"message_update"}')).toBe(false);
    expect(await tryHandleExtensionUIRequest('not json')).toBe(false);
  });

  it('treats notify as fire-and-forget (no dialog, no response)', async () => {
    const sendCommand = vi.fn();
    setExtensionUIBus({ sendCommand } as any);
    const handled = await tryHandleExtensionUIRequest(
      JSON.stringify({ type: 'extension_ui_request', id: '1', method: 'notify', message: 'hi' }),
    );
    expect(handled).toBe(true);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('treats setStatus as fire-and-forget (no dialog, no response)', async () => {
    const sendCommand = vi.fn();
    setExtensionUIBus({ sendCommand } as any);
    const handled = await tryHandleExtensionUIRequest(
      JSON.stringify({ type: 'extension_ui_request', id: '1', method: 'setStatus', message: 'working' }),
    );
    expect(handled).toBe(true);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('auto-denies an interactive request when no dialog renderer is registered', async () => {
    const sendCommand = vi.fn();
    setExtensionUIBus({ sendCommand } as any);
    await tryHandleExtensionUIRequest(
      JSON.stringify({ type: 'extension_ui_request', id: '42', method: 'confirm', title: 't', message: 'm' }),
    );
    expect(sendCommand).toHaveBeenCalledWith(
      JSON.stringify({ type: 'extension_ui_response', id: '42', cancelled: true }),
    );
  });

  it('routes an interactive request to the registered dialog renderer and sends its response', async () => {
    const sendCommand = vi.fn();
    setExtensionUIBus({ sendCommand } as any);
    setDialogRenderer(async (method) => {
      expect(method).toBe('confirm');
      return { confirmed: true };
    });
    await tryHandleExtensionUIRequest(
      JSON.stringify({ type: 'extension_ui_request', id: '7', method: 'confirm', title: 't', message: 'm' }),
    );
    expect(sendCommand).toHaveBeenCalledWith(
      JSON.stringify({ type: 'extension_ui_response', id: '7', confirmed: true }),
    );
  });
});
