/**
 * store.test.ts — Tests del ChatStore (wrapper reactivo sobre reducer).
 *
 * @vitest-environment node
 *
 * Verifica:
 * - dispatch actualiza las signals messages$ e isStreaming$
 * - signals NO se disparan si el event es no-op (reducer devuelve misma ref)
 * - getState retorna el snapshot actual
 * - Estado inicial correcto
 */

import { describe, it, expect, vi } from 'vitest';
import { createChatStore } from 'xi-ui/lib/chat/store.ts';
import type { ChatMessage, ChatSession, Part } from 'xi-ui/lib/chat/types.ts';

const session: ChatSession = { id: 's1', file: '/p.jsonl', name: 'test', messageCount: 0 };

function textMsg(id: string, text: string, timestamp = 1000): ChatMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
    timestamp,
  };
}

describe('createChatStore — estado inicial', () => {
  it('messages$ inicia vacío', () => {
    const store = createChatStore('tab-1');
    expect(store.messages$.value).toEqual([]);
  });

  it('isStreaming$ inicia false', () => {
    const store = createChatStore('tab-1');
    expect(store.isStreaming$.value).toBe(false);
  });

  it('sessionId se asigna', () => {
    const store = createChatStore('tab-1');
    expect(store.sessionId).toBe('tab-1');
  });

  it('con session inicial → state.session populado', () => {
    const store = createChatStore('tab-1', session);
    expect(store.getState().session).toBe(session);
  });

  it('sin session inicial → state.session null', () => {
    const store = createChatStore('tab-1');
    expect(store.getState().session).toBeNull();
  });
});

describe('createChatStore — dispatch', () => {
  it('init popula messages$', () => {
    const store = createChatStore('tab-1');
    const msgs = [textMsg('user_1', 'hola')];
    store.dispatch({ type: 'init', session, messages: msgs });
    expect(store.messages$.value).toBe(msgs);
    expect(store.getState().messages).toBe(msgs);
  });

  it('agent_start setea isStreaming$ true', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'agent_start' });
    expect(store.isStreaming$.value).toBe(true);
  });

  it('message_start agrega message y setea streamingMessageId', () => {
    const store = createChatStore('tab-1');
    const msg: ChatMessage = {
      id: 'assistant_1', role: 'assistant',
      parts: [{ type: 'text', text: 'hi' } as Part],
      timestamp: 2000, isStreaming: true,
    };
    store.dispatch({ type: 'agent_start' });
    store.dispatch({ type: 'message_start', message: msg });
    expect(store.messages$.value).toHaveLength(1);
    expect(store.getState().streamingMessageId).toBe('assistant_1');
  });

  it('message_update reemplaza message', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'message_start', message: {
      id: 'a_1', role: 'assistant', parts: [{ type: 'text', text: 'ho' }],
      timestamp: 1000, isStreaming: true,
    }});
    store.dispatch({ type: 'message_update', message: {
      id: 'a_1', role: 'assistant', parts: [{ type: 'text', text: 'hola' }],
      timestamp: 1000,
    }});
    const parts = store.messages$.value[0].parts as any[];
    expect(parts[0].text).toBe('hola');
  });

  it('agent_end setea isStreaming false', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'agent_start' });
    store.dispatch({ type: 'agent_end', messages: [] });
    expect(store.isStreaming$.value).toBe(false);
    expect(store.getState().streamingMessageId).toBeNull();
  });

  it('response_get_state actualiza session', () => {
    const store = createChatStore('tab-1');
    const newSession: ChatSession = { id: 's2', file: '/other.jsonl', name: 'other', messageCount: 5 };
    store.dispatch({ type: 'response_get_state', session: newSession });
    expect(store.getState().session).toBe(newSession);
  });
});

describe('createChatStore — signals no se disparan en no-op', () => {
  it('tool_execution_* sin match → messages$ NO se dispara', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'init', session, messages: [] });

    const spy = vi.fn();
    store.messages$.subscribe(spy);
    // spy ya se llamó una vez al suscribirse (valor inicial).
    spy.mockClear();

    // tool_execution_start con toolCallId inexistente → reducer no-op.
    store.dispatch({ type: 'tool_execution_start', toolCallId: 'nope' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('tool_execution_* state sin cambio → messages$ NO se dispara', () => {
    const store = createChatStore('tab-1');
    // assistant con toolCall ya en 'running'
    store.dispatch({ type: 'init', session, messages: [{
      id: 'a_1', role: 'assistant',
      parts: [{ type: 'toolCall', toolCallId: 'tc_1', name: 'bash', arguments: {}, state: 'running' }],
      timestamp: 1000,
    }]});

    const spy = vi.fn();
    store.messages$.subscribe(spy);
    spy.mockClear();

    // tool_execution_start de tc_1 ya running → no-op.
    store.dispatch({ type: 'tool_execution_start', toolCallId: 'tc_1' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('isStreaming$ NO se dispara si no cambia', () => {
    const store = createChatStore('tab-1');
    // isStreaming ya false.
    const spy = vi.fn();
    store.isStreaming$.subscribe(spy);
    spy.mockClear();

    // agent_end cuando ya isStreaming=false → reducer devuelve
    // {...state, isStreaming: false} — isStreaming no cambia de ref
    // pero messages sí (nuevo array). isStreaming$ no se dispara.
    store.dispatch({ type: 'agent_end', messages: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createChatStore — getState', () => {
  it('retorna snapshot actual', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'init', session, messages: [textMsg('u_1', 'x')] });
    const state = store.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.session).toBe(session);
  });

  it('refleja cambios después de dispatch', () => {
    const store = createChatStore('tab-1');
    store.dispatch({ type: 'agent_start' });
    expect(store.getState().isStreaming).toBe(true);
    store.dispatch({ type: 'agent_end', messages: [] });
    expect(store.getState().isStreaming).toBe(false);
  });
});

describe('createChatStore — secuencia completa', () => {
  it('streaming lifecycle end-to-end', () => {
    const store = createChatStore('tab-1');

    store.dispatch({ type: 'agent_start' });
    expect(store.isStreaming$.value).toBe(true);

    store.dispatch({ type: 'message_start', message: {
      id: 'a_1', role: 'assistant',
      parts: [{ type: 'text', text: 'h' }],
      timestamp: 1000, isStreaming: true,
    }});
    expect(store.messages$.value).toHaveLength(1);

    store.dispatch({ type: 'message_update', message: {
      id: 'a_1', role: 'assistant',
      parts: [{ type: 'text', text: 'hola' }],
      timestamp: 1000,
    }});
    expect((store.messages$.value[0].parts[0] as any).text).toBe('hola');

    store.dispatch({ type: 'message_end', message: {
      id: 'a_1', role: 'assistant',
      parts: [{ type: 'text', text: 'hola' }],
      timestamp: 1000,
    }});
    expect(store.messages$.value[0].isStreaming).toBe(false);

    store.dispatch({ type: 'agent_end', messages: [{
      id: 'a_1', role: 'assistant',
      parts: [{ type: 'text', text: 'hola' }],
      timestamp: 1000,
    }]});
    expect(store.isStreaming$.value).toBe(false);
    expect(store.getState().streamingMessageId).toBeNull();
  });
});
