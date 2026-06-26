/**
 * reducer.test.ts — Tests tabla-driven del reducer puro.
 *
 * @vitest-environment node
 *
 * Verifica:
 * - Cada event type con state vacío y poblado
 * - Secuencia completa de streaming
 * - mergeToolCallStates preserva state en message_update y agent_end
 * - reconcileMessages preserva streamingMessage en get_messages
 * - tool_execution_* con toolCallId inexistente → no-op
 * - Inmutabilidad: Object.freeze(state) antes de reduce → no falla
 *   (el reducer nunca muta el state entrante)
 */

import { describe, it, expect } from 'vitest';
import { reduce, initialChatState, mergeToolCallStates, type ChatEvent } from '../../src/lib/chat/reducer.ts';
import type { ChatState, ChatMessage, Part, ChatSession } from '../../src/lib/chat/types.ts';

// ─── Helpers ──────────────────────────────────────────────

const session: ChatSession = { id: 's1', file: '/path.jsonl', name: 'test', messageCount: 0 };

function emptyState(): ChatState {
  return initialChatState(session);
}

function userMsg(id: string, text: string, timestamp = 1000): ChatMessage {
  return {
    id: id,
    role: 'user',
    parts: [{ type: 'text', text }],
    timestamp,
  };
}

function assistantMsg(id: string, parts: Part[], timestamp = 2000, isStreaming = false): ChatMessage {
  return {
    id,
    role: 'assistant',
    parts,
    timestamp,
    isStreaming,
  };
}

function toolCallPart(toolCallId: string, state: 'pending' | 'running' | 'completed' | 'failed' = 'pending'): Part {
  return {
    type: 'toolCall',
    toolCallId,
    name: 'bash',
    arguments: { command: 'ls' },
    state,
  };
}

function textPart(text: string): Part {
  return { type: 'text', text };
}

function thinkingPart(text: string): Part {
  return { type: 'thinking', text };
}

/** Ejecuta reduce y verifica inmutabilidad: freeze del state entrante. */
function reduceFrozen(state: ChatState, event: ChatEvent): ChatState {
  // Deep freeze del state para detectar mutaciones.
  deepFreeze(state);
  return reduce(state, event);
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) deepFreeze(item);
  } else {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

// ─── init ─────────────────────────────────────────────────

describe('reduce — init', () => {
  it('state nuevo con session y messages', () => {
    const msgs = [userMsg('user_1', 'hola')];
    const state = reduceFrozen(emptyState(), { type: 'init', session, messages: msgs });
    expect(state.session).toBe(session);
    expect(state.messages).toBe(msgs);
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  it('init con session null', () => {
    const state = reduceFrozen(emptyState(), { type: 'init', session: null, messages: [] });
    expect(state.session).toBeNull();
    expect(state.messages).toEqual([]);
  });
});

// ─── agent_start ──────────────────────────────────────────

describe('reduce — agent_start', () => {
  it('setea isStreaming true', () => {
    const state = reduceFrozen(emptyState(), { type: 'agent_start' });
    expect(state.isStreaming).toBe(true);
  });

  it('preserva messages existentes', () => {
    const initial = { ...emptyState(), messages: [userMsg('user_1', 'hola')] };
    const state = reduceFrozen(initial, { type: 'agent_start' });
    expect(state.messages).toHaveLength(1);
  });
});

// ─── message_start ────────────────────────────────────────

describe('reduce — message_start', () => {
  it('agrega message nuevo y setea streamingMessageId', () => {
    const msg = assistantMsg('assistant_1', [textPart('hi')], 1000, true);
    const state = reduceFrozen(emptyState(), { type: 'message_start', message: msg });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toBe(msg);
    expect(state.isStreaming).toBe(true);
    expect(state.streamingMessageId).toBe('assistant_1');
  });

  it('reemplaza message existente por ID', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('assistant_1', [textPart('old')])] };
    const msg = assistantMsg('assistant_1', [textPart('new')], 1000, true);
    const state = reduceFrozen(initial, { type: 'message_start', message: msg });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].parts).toEqual([textPart('new')]);
  });
});

// ─── message_update ───────────────────────────────────────

describe('reduce — message_update', () => {
  it('reemplaza message existente', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('assistant_1', [textPart('ho')])] };
    const updated = assistantMsg('assistant_1', [textPart('hola')], 1000);
    const state = reduceFrozen(initial, { type: 'message_update', message: updated });
    expect(state.messages[0].parts).toEqual([textPart('hola')]);
    expect(state.messages[0].isStreaming).toBe(true);
    expect(state.streamingMessageId).toBe('assistant_1');
  });

  it('agrega message si no existe', () => {
    const updated = assistantMsg('assistant_99', [textPart('new')], 1000);
    const state = reduceFrozen(emptyState(), { type: 'message_update', message: updated });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('assistant_99');
  });

  it('preserva ToolCallPart.state de la versión existente (D8)', () => {
    const existing = assistantMsg('assistant_1', [toolCallPart('tc_1', 'running')]);
    const initial = { ...emptyState(), messages: [existing] };
    // pi reenvía el message con el toolCall pero state='pending' (pi no tiene state).
    const updated = assistantMsg('assistant_1', [toolCallPart('tc_1', 'pending')], 1000);
    const state = reduceFrozen(initial, { type: 'message_update', message: updated });
    const part = state.messages[0].parts[0] as any;
    expect(part.state).toBe('running'); // preservado
  });

  it('preserva state solo de toolCalls que matchean toolCallId', () => {
    const existing = assistantMsg('assistant_1', [
      toolCallPart('tc_1', 'running'),
      toolCallPart('tc_2', 'completed'),
    ]);
    const initial = { ...emptyState(), messages: [existing] };
    const updated = assistantMsg('assistant_1', [
      toolCallPart('tc_1', 'pending'),
      toolCallPart('tc_2', 'pending'),
    ], 1000);
    const state = reduceFrozen(initial, { type: 'message_update', message: updated });
    const parts = state.messages[0].parts as any[];
    expect(parts[0].state).toBe('running');
    expect(parts[1].state).toBe('completed');
  });

  it('toolCall nuevo (sin match) → state del incoming', () => {
    const existing = assistantMsg('assistant_1', [toolCallPart('tc_1', 'running')]);
    const initial = { ...emptyState(), messages: [existing] };
    const updated = assistantMsg('assistant_1', [
      toolCallPart('tc_1', 'pending'),
      toolCallPart('tc_new', 'pending'),
    ], 1000);
    const state = reduceFrozen(initial, { type: 'message_update', message: updated });
    const parts = state.messages[0].parts as any[];
    expect(parts[1].state).toBe('pending');
  });
});

// ─── message_end ──────────────────────────────────────────

describe('reduce — message_end', () => {
  it('marca isStreaming false en el message', () => {
    const initial = {
      ...emptyState(),
      messages: [assistantMsg('assistant_1', [textPart('hola')], 1000, true)],
      isStreaming: true,
      streamingMessageId: 'assistant_1',
    };
    const finalMsg = assistantMsg('assistant_1', [textPart('hola')], 1000);
    const state = reduceFrozen(initial, { type: 'message_end', message: finalMsg });
    expect(state.messages[0].isStreaming).toBe(false);
  });

  it('preserva ToolCallPart.state', () => {
    const initial = {
      ...emptyState(),
      messages: [assistantMsg('assistant_1', [toolCallPart('tc_1', 'completed')])],
    };
    const finalMsg = assistantMsg('assistant_1', [toolCallPart('tc_1', 'pending')], 1000);
    const state = reduceFrozen(initial, { type: 'message_end', message: finalMsg });
    expect((state.messages[0].parts[0] as any).state).toBe('completed');
  });
});

// ─── tool_execution_start / end ───────────────────────────

describe('reduce — tool_execution_start', () => {
  it('setea state=running en ToolCallPart matcheado', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'pending')])] };
    const state = reduceFrozen(initial, { type: 'tool_execution_start', toolCallId: 'tc_1' });
    expect((state.messages[0].parts[0] as any).state).toBe('running');
  });

  it('toolCallId inexistente → no-op (misma referencia)', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'pending')])] };
    const state = reduce(initial, { type: 'tool_execution_start', toolCallId: 'nope' });
    expect(state).toBe(initial); // misma referencia
  });

  it('state ya en running → no-op (misma referencia)', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'running')])] };
    const state = reduce(initial, { type: 'tool_execution_start', toolCallId: 'tc_1' });
    expect(state).toBe(initial);
  });
});

describe('reduce — tool_execution_end', () => {
  it('isError false → state=completed', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'running')])] };
    const state = reduceFrozen(initial, { type: 'tool_execution_end', toolCallId: 'tc_1', isError: false });
    expect((state.messages[0].parts[0] as any).state).toBe('completed');
  });

  it('isError true → state=failed', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'running')])] };
    const state = reduceFrozen(initial, { type: 'tool_execution_end', toolCallId: 'tc_1', isError: true });
    expect((state.messages[0].parts[0] as any).state).toBe('failed');
  });

  it('toolCallId inexistente → no-op', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'running')])] };
    const state = reduce(initial, { type: 'tool_execution_end', toolCallId: 'nope', isError: false });
    expect(state).toBe(initial);
  });

  it('busca en todos los messages', () => {
    const initial = {
      ...emptyState(),
      messages: [
        userMsg('u_1', 'x'),
        assistantMsg('a_2', [toolCallPart('tc_99', 'pending')]),
      ],
    };
    const state = reduceFrozen(initial, { type: 'tool_execution_end', toolCallId: 'tc_99', isError: false });
    expect((state.messages[1].parts[0] as any).state).toBe('completed');
  });
});

// ─── agent_end ────────────────────────────────────────────

describe('reduce — agent_end', () => {
  it('reemplaza todos los messages con los de pi', () => {
    const initial = { ...emptyState(), isStreaming: true, streamingMessageId: 'a_1' };
    const piMsgs = [userMsg('user_1', 'hola'), assistantMsg('assistant_1', [textPart('chau')])];
    const state = reduceFrozen(initial, { type: 'agent_end', messages: piMsgs });
    expect(state.messages).toEqual(piMsgs);
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  it('preserva ToolCallPart.state al reconciliar (D8)', () => {
    const existing = assistantMsg('a_1', [toolCallPart('tc_1', 'completed')]);
    const initial = { ...emptyState(), messages: [existing] };
    // pi reenvía con state='pending' (pi no tiene state).
    const piMsgs = [assistantMsg('a_1', [toolCallPart('tc_1', 'pending')])];
    const state = reduceFrozen(initial, { type: 'agent_end', messages: piMsgs });
    expect((state.messages[0].parts[0] as any).state).toBe('completed');
  });

  it('agrega messages locales que pi no reportó', () => {
    const localUser = userMsg('user_optimistic', 'msg local', 500);
    const initial = { ...emptyState(), messages: [localUser] };
    const piMsgs = [assistantMsg('a_1', [textPart('response')])];
    const state = reduceFrozen(initial, { type: 'agent_end', messages: piMsgs });
    expect(state.messages).toHaveLength(2);
    expect(state.messages.some(m => m.id === 'user_optimistic')).toBe(true);
  });

  it('state vacío + agent_end → messages de pi', () => {
    const piMsgs = [userMsg('user_1', 'hola')];
    const state = reduceFrozen(emptyState(), { type: 'agent_end', messages: piMsgs });
    expect(state.messages).toEqual(piMsgs);
    expect(state.isStreaming).toBe(false);
  });
});

// ─── response_get_messages ────────────────────────────────

describe('reduce — response_get_messages', () => {
  it('sin streaming → reemplaza todos', () => {
    const initial = { ...emptyState(), messages: [userMsg('u_old', 'old')] };
    const piMsgs = [userMsg('u_new', 'new')];
    const state = reduceFrozen(initial, { type: 'response_get_messages', messages: piMsgs });
    expect(state.messages).toEqual(piMsgs);
  });

  it('con streaming → preserva isStreaming del streamingMessageId', () => {
    const initial = {
      ...emptyState(),
      messages: [assistantMsg('a_stream', [textPart('partial')], 1000, true)],
      isStreaming: true,
      streamingMessageId: 'a_stream',
    };
    // get_messages trae el mismo ID pero sin isStreaming.
    const piMsgs = [assistantMsg('a_stream', [textPart('partial')], 1000, false)];
    const state = reduceFrozen(initial, { type: 'response_get_messages', messages: piMsgs });
    expect(state.messages[0].isStreaming).toBe(true);
  });

  it('streamingMessageId no en piMsgs → no marca nada', () => {
    const initial = {
      ...emptyState(),
      isStreaming: true,
      streamingMessageId: 'a_ghost',
    };
    const piMsgs = [userMsg('u_1', 'hola')];
    const state = reduceFrozen(initial, { type: 'response_get_messages', messages: piMsgs });
    expect(state.messages[0].isStreaming).toBeUndefined();
  });
});

// ─── response_get_state ───────────────────────────────────

describe('reduce — response_get_state', () => {
  it('actualiza session', () => {
    const newSession: ChatSession = { id: 's2', file: '/other.jsonl', name: 'other', messageCount: 5 };
    const state = reduceFrozen(emptyState(), { type: 'response_get_state', session: newSession });
    expect(state.session).toBe(newSession);
  });

  it('session null', () => {
    const state = reduceFrozen(emptyState(), { type: 'response_get_state', session: null });
    expect(state.session).toBeNull();
  });

  it('preserva messages', () => {
    const initial = { ...emptyState(), messages: [userMsg('u_1', 'x')] };
    const state = reduceFrozen(initial, { type: 'response_get_state', session: session });
    expect(state.messages).toHaveLength(1);
  });
});

// ─── mergeToolCallStates (unit) ───────────────────────────

describe('mergeToolCallStates', () => {
  it('preserva state de toolCalls matcheados', () => {
    const incoming = assistantMsg('a_1', [toolCallPart('tc_1', 'pending')]);
    const existing = assistantMsg('a_1', [toolCallPart('tc_1', 'completed')]);
    const merged = mergeToolCallStates(incoming, existing);
    expect((merged.parts[0] as any).state).toBe('completed');
  });

  it('sin toolCalls → devuelve incoming tal cual (parts)', () => {
    const incoming = assistantMsg('a_1', [textPart('x')]);
    const existing = assistantMsg('a_1', [textPart('y')]);
    const merged = mergeToolCallStates(incoming, existing);
    expect(merged.parts).toEqual([textPart('x')]);
  });

  it('no muta incoming', () => {
    const incoming = assistantMsg('a_1', [toolCallPart('tc_1', 'pending')]);
    const existing = assistantMsg('a_1', [toolCallPart('tc_1', 'completed')]);
    deepFreeze(incoming);
    mergeToolCallStates(incoming, existing);
    // Si no tiró, está bien.
    expect((incoming.parts[0] as any).state).toBe('pending');
  });
});

// ─── Secuencia completa de streaming ──────────────────────

describe('reduce — secuencia completa de streaming', () => {
  it('agent_start → message_start → update* → tool_exec → end → agent_end', () => {
    let state = emptyState();

    // 1. agent_start
    state = reduce(state, { type: 'agent_start' });
    expect(state.isStreaming).toBe(true);

    // 2. message_start (assistant con tool call pending)
    state = reduce(state, {
      type: 'message_start',
      message: assistantMsg('a_1', [textPart('thinking...'), toolCallPart('tc_1', 'pending')], 1000, true),
    });
    expect(state.streamingMessageId).toBe('a_1');
    expect((state.messages[0].parts[1] as any).state).toBe('pending');

    // 3. message_update (más texto, tool call sigue pending en pi)
    state = reduce(state, {
      type: 'message_update',
      message: assistantMsg('a_1', [textPart('thinking... running tool'), toolCallPart('tc_1', 'pending')], 1000),
    });
    expect(state.messages[0].parts[0]).toEqual(textPart('thinking... running tool'));

    // 4. tool_execution_start
    state = reduce(state, { type: 'tool_execution_start', toolCallId: 'tc_1' });
    expect((state.messages[0].parts[1] as any).state).toBe('running');

    // 5. message_update (pi reenvía, state debe preservarse)
    state = reduce(state, {
      type: 'message_update',
      message: assistantMsg('a_1', [textPart('thinking... running tool'), toolCallPart('tc_1', 'pending')], 1000),
    });
    expect((state.messages[0].parts[1] as any).state).toBe('running');

    // 6. tool_execution_end
    state = reduce(state, { type: 'tool_execution_end', toolCallId: 'tc_1', isError: false });
    expect((state.messages[0].parts[1] as any).state).toBe('completed');

    // 7. message_end
    state = reduce(state, {
      type: 'message_end',
      message: assistantMsg('a_1', [textPart('done'), toolCallPart('tc_1', 'pending')], 1000),
    });
    expect(state.messages[0].isStreaming).toBe(false);
    expect((state.messages[0].parts[1] as any).state).toBe('completed');

    // 8. agent_end (pi reenvía todo, state debe preservarse)
    state = reduce(state, {
      type: 'agent_end',
      messages: [assistantMsg('a_1', [textPart('done'), toolCallPart('tc_1', 'pending')], 1000)],
    });
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
    expect((state.messages[0].parts[1] as any).state).toBe('completed');
  });
});

// ─── Inmutabilidad ────────────────────────────────────────

describe('reduce — inmutabilidad', () => {
  it('no muta el state entrante (Object.freeze)', () => {
    const initial = {
      ...emptyState(),
      messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'pending')])],
    };
    deepFreeze(initial);
    // Si reduce muta, Object.freeze tira TypeError en strict mode.
    const state = reduce(initial, { type: 'tool_execution_start', toolCallId: 'tc_1' });
    expect((state.messages[0].parts[0] as any).state).toBe('running');
    expect((initial.messages[0].parts[0] as any).state).toBe('pending');
  });

  it('no muta el message entrante en message_update', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'running')])] };
    const incoming = assistantMsg('a_1', [toolCallPart('tc_1', 'pending')], 1000);
    deepFreeze(initial);
    deepFreeze(incoming);
    const state = reduce(initial, { type: 'message_update', message: incoming });
    expect((state.messages[0].parts[0] as any).state).toBe('running');
    expect((incoming.parts[0] as any).state).toBe('pending');
  });

  it('no muta el array messages entrante en agent_end', () => {
    const initial = { ...emptyState(), messages: [assistantMsg('a_1', [toolCallPart('tc_1', 'completed')])] };
    const piMsgs = [assistantMsg('a_1', [toolCallPart('tc_1', 'pending')])];
    deepFreeze(initial);
    deepFreeze(piMsgs);
    const state = reduce(initial, { type: 'agent_end', messages: piMsgs });
    expect((state.messages[0].parts[0] as any).state).toBe('completed');
    expect((piMsgs[0].parts[0] as any).state).toBe('pending');
  });
});
