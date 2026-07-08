/**
 * mapping.test.ts — Tests para mapAgentMessage (pi → xi).
 *
 * @vitest-environment node
 *
 * Cubre: cada rol de AgentMessage, cada tipo de content block,
 * contenido vacío, contenido inválido, determinismo de IDs,
 * bashExecution con exitCode, compaction, branchSummary ignorado.
 */

import { describe, it, expect } from 'vitest';
import {
  mapAgentMessage,
  messageId,
  stringifyContent,
  extractText,
  groupToolCalls,
  actionName,
} from '../../src/lib/chat/mapping.ts';
import type { ToolCallPart, ToolGroupSummary } from '../../src/lib/chat/types.ts';
import type { ChatMessage } from '../../src/lib/chat/types.ts';

// ─── messageId ────────────────────────────────────────────

describe('messageId', () => {
  it('genera `${role}_${timestamp}`', () => {
    expect(messageId('assistant', 1700000000)).toBe('assistant_1700000000');
  });

  it('es determinístico: mismo input → mismo output', () => {
    expect(messageId('user', 123)).toBe(messageId('user', 123));
  });

  it('diferencia roles con mismo timestamp', () => {
    expect(messageId('user', 100)).not.toBe(messageId('assistant', 100));
  });
});

// ─── stringifyContent ─────────────────────────────────────

describe('stringifyContent', () => {
  it('string → tal cual', () => {
    expect(stringifyContent('hola')).toBe('hola');
  });

  it('array de TextContent → join con \\n\\n', () => {
    expect(stringifyContent([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])).toBe('a\n\nb');
  });

  it('array vacío → string vacío', () => {
    expect(stringifyContent([])).toBe('');
  });

  it('null → string vacío', () => {
    expect(stringifyContent(null)).toBe('');
  });

  it('array con blocks no-text → los ignora', () => {
    expect(stringifyContent([
      { type: 'image', data: 'x' },
      { type: 'text', text: 'ok' },
    ])).toBe('ok');
  });
});

// ─── mapAgentMessage — entrada ────────────────────────────

describe('mapAgentMessage — entradas inválidas', () => {
  it('null → null', () => {
    expect(mapAgentMessage(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(mapAgentMessage(undefined)).toBeNull();
  });

  it('string → null', () => {
    expect(mapAgentMessage('hola')).toBeNull();
  });

  it('objeto sin role → null', () => {
    expect(mapAgentMessage({ content: 'hola' })).toBeNull();
  });

  it('role desconocido → null', () => {
    expect(mapAgentMessage({ role: 'wat', content: 'x', timestamp: 1 })).toBeNull();
  });
});

// ─── user ─────────────────────────────────────────────────

describe('mapAgentMessage — user', () => {
  it('content string → TextPart', () => {
    const raw = { role: 'user', content: 'hola', timestamp: 1000 };
    const m = mapAgentMessage(raw);
    expect(m).not.toBeNull();
    expect(m!.role).toBe('user');
    expect(m!.id).toBe('user_1000');
    expect(m!.parts).toEqual([{ type: 'text', text: 'hola' }]);
    expect(m!.metadata).toBeUndefined();
  });

  it('content array → TextPart con texto concatenado', () => {
    const raw = {
      role: 'user',
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      timestamp: 2000,
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts).toEqual([{ type: 'text', text: 'a\n\nb' }]);
  });

  it('sin timestamp → usa contador incremental (id estable)', () => {
    const first = mapAgentMessage({ role: 'user', content: 'x' })!;
    const second = mapAgentMessage({ role: 'user', content: 'y' })!;
    expect(typeof first.timestamp).toBe('number');
    expect(typeof second.timestamp).toBe('number');
    expect(second.timestamp).toBeGreaterThan(first.timestamp);
  });
});

// ─── assistant ────────────────────────────────────────────

describe('mapAgentMessage — assistant', () => {
  it('text block → TextPart', () => {
    const raw = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hola' }],
      timestamp: 3000,
      model: 'gpt-4',
      provider: 'openai',
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
      stopReason: 'stop',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.role).toBe('assistant');
    expect(m.id).toBe('assistant_3000');
    expect(m.parts).toEqual([{ type: 'text', text: 'hola' }]);
  });

  it('thinking block → ThinkingPart', () => {
    const raw = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'pienso luego existo' }],
      timestamp: 3100,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts[0]).toEqual({ type: 'thinking', text: 'pienso luego existo' });
  });

  it('thinking block con `content` legacy → ThinkingPart', () => {
    const raw = {
      role: 'assistant',
      content: [{ type: 'thinking', content: 'legacy' }],
      timestamp: 3101,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts[0]).toEqual({ type: 'thinking', text: 'legacy' });
  });

  it('toolCall block → ToolCallPart con state=pending', () => {
    const raw = {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'tc_abc',
        name: 'bash',
        arguments: { command: 'ls' },
      }],
      timestamp: 3200,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'toolUse',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts[0]).toEqual({
      type: 'toolCall',
      toolCallId: 'tc_abc',
      name: 'bash',
      arguments: { command: 'ls' },
      state: 'pending',
    });
  });

  it('toolCall sin id → toolCallId vacío', () => {
    const raw = {
      role: 'assistant',
      content: [{ type: 'toolCall', name: 'bash', arguments: {} }],
      timestamp: 3201,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'toolUse',
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).toolCallId).toBe('');
  });

  it('blocks mixtos preservan orden', () => {
    const raw = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 't1' },
        { type: 'text', text: 'answer' },
        { type: 'toolCall', id: 'tc1', name: 'bash', arguments: {} },
        { type: 'text', text: 'after' },
      ],
      timestamp: 3300,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'toolUse',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts.map(p => p.type)).toEqual(
      ['thinking', 'text', 'toolCall', 'text']
    );
  });

  it('content vacío → parts vacío', () => {
    const raw = {
      role: 'assistant',
      content: [],
      timestamp: 3400,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts).toEqual([]);
  });

  it('block desconocido → ignorado', () => {
    const raw = {
      role: 'assistant',
      content: [
        { type: 'image', data: 'x' },
        { type: 'text', text: 'ok' },
      ],
      timestamp: 3401,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    };
    const m = mapAgentMessage(raw)!;
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].type).toBe('text');
  });
});

// ─── assistant metadata ───────────────────────────────────

describe('mapAgentMessage — assistant metadata', () => {
  const baseRaw = {
    role: 'assistant',
    content: [],
    timestamp: 4000,
    model: 'claude-sonnet',
    provider: 'anthropic',
    usage: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, totalTokens: 360 },
    stopReason: 'stop' as const,
  };

  it('sin usage → metadata undefined', () => {
    const m = mapAgentMessage({ ...baseRaw, usage: undefined, timestamp: 4001 })!;
    expect(m.metadata).toBeUndefined();
  });

  it('con usage → metadata populada', () => {
    const m = mapAgentMessage(baseRaw)!;
    expect(m.metadata).toEqual({
      model: 'claude-sonnet',
      provider: 'anthropic',
      usage: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360 },
      stopReason: 'stop',
    });
  });

  it('errorMessage → se propaga', () => {
    const m = mapAgentMessage({ ...baseRaw, errorMessage: 'oops', stopReason: 'error', timestamp: 4002 })!;
    expect(m.metadata!.errorMessage).toBe('oops');
    expect(m.metadata!.stopReason).toBe('error');
  });

  it('stopReason desconocido → fallback a stop', () => {
    const m = mapAgentMessage({ ...baseRaw, stopReason: 'wat', timestamp: 4003 })!;
    expect(m.metadata!.stopReason).toBe('stop');
  });

  it('usage con total (legacy) → fallback de totalTokens', () => {
    const m = mapAgentMessage({
      ...baseRaw,
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
      timestamp: 4004,
    })!;
    expect(m.metadata!.usage.total).toBe(3);
  });
});

// ─── toolResult ───────────────────────────────────────────

describe('mapAgentMessage — toolResult', () => {
  it('mapea toolCallId, toolName, output, isError', () => {
    const raw = {
      role: 'toolResult',
      toolCallId: 'tc_abc',
      toolName: 'bash',
      content: [{ type: 'text', text: 'file.txt' }],
      isError: false,
      timestamp: 5000,
    };
    const m = mapAgentMessage(raw)!;
    expect(m.role).toBe('toolResult');
    expect(m.id).toBe('toolResult_5000');
    expect(m.parts).toEqual([{
      type: 'toolResult',
      toolCallId: 'tc_abc',
      toolName: 'bash',
      result: { output: 'file.txt' },
      isError: false,
    }]);
  });

  it('isError true → isError true', () => {
    const raw = {
      role: 'toolResult',
      toolCallId: 'tc_err',
      toolName: 'grep',
      content: [{ type: 'text', text: 'not found' }],
      isError: true,
      timestamp: 5100,
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).isError).toBe(true);
  });

  it('sin toolCallId → toolCallId vacío', () => {
    const raw = {
      role: 'toolResult',
      toolName: 'bash',
      content: 'ok',
      isError: false,
      timestamp: 5200,
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).toolCallId).toBe('');
  });
});

// ─── bashExecution ────────────────────────────────────────

describe('mapAgentMessage — bashExecution', () => {
  it('exitCode 0 → isError false, toolName bash', () => {
    const raw = {
      role: 'bashExecution',
      command: 'ls',
      output: 'file.txt',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 6000,
    };
    const m = mapAgentMessage(raw)!;
    expect(m.role).toBe('toolResult');
    const part = m.parts[0] as any;
    expect(part.toolName).toBe('bash');
    expect(part.isError).toBe(false);
    expect(part.result.output).toBe('$ ls\nfile.txt');
  });

  it('exitCode != 0 → isError true', () => {
    const raw = {
      role: 'bashExecution',
      command: 'false',
      output: '',
      exitCode: 1,
      cancelled: false,
      truncated: false,
      timestamp: 6100,
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).isError).toBe(true);
  });

  it('sin command → output sin prefix $', () => {
    const raw = {
      role: 'bashExecution',
      command: '',
      output: 'just output',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 6200,
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).result.output).toBe('just output');
  });
});

// ─── Tool call grouping ──────────────────────────────────

describe('actionName', () => {
  it('mapea tools conocidas a verbos en español', () => {
    expect(actionName('bash')).toBe('Ejecutó');
    expect(actionName('read')).toBe('Leyó');
    expect(actionName('edit')).toBe('Editó');
    expect(actionName('write')).toBe('Escribió');
    expect(actionName('grep')).toBe('Buscó');
    expect(actionName('find')).toBe('Buscó');
    expect(actionName('ls')).toBe('Listó');
    expect(actionName('ask')).toBe('Preguntó');
  });

  it('usa el nombre raw si no está mapeado', () => {
    expect(actionName('custom_tool')).toBe('custom_tool');
    expect(actionName('unknown')).toBe('unknown');
  });
});

describe('groupToolCalls', () => {
  function tc(name: string, state: ToolCallPart['state'], id = '1'): ToolCallPart {
    return { type: 'toolCall', toolCallId: id, name, arguments: {}, state };
  }

  it('agrupa tools del mismo tipo', () => {
    const parts = [tc('edit', 'completed', '1'), tc('edit', 'completed', '2')];
    const groups = groupToolCalls(parts);
    expect(groups).toHaveLength(1);
    expect(groups[0].action).toBe('Editó');
    expect(groups[0].count).toBe(2);
  });

  it('separa herramientas distintas', () => {
    const parts = [tc('edit', 'completed', '1'), tc('read', 'completed', '2')];
    const groups = groupToolCalls(parts);
    expect(groups).toHaveLength(2);
    expect(groups[0].action).toBe('Editó');
    expect(groups[1].action).toBe('Leyó');
  });

  it('tools fallidas se agrupan como Error al X', () => {
    const parts = [tc('edit', 'failed', '1'), tc('edit', 'failed', '2')];
    const groups = groupToolCalls(parts);
    expect(groups).toHaveLength(1);
    expect(groups[0].action).toBe('Error al edit');
    expect(groups[0].count).toBe(2);
  });

  it('mezcla estados: success + failed se separan en distintos grupos', () => {
    const parts = [
      tc('edit', 'completed', '1'),
      tc('edit', 'failed', '2'),
    ];
    const groups = groupToolCalls(parts);
    expect(groups).toHaveLength(2);
    expect(groups[0].action).toBe('Editó');
    expect(groups[1].action).toBe('Error al edit');
  });

  it('array vacío → array vacío', () => {
    expect(groupToolCalls([])).toEqual([]);
  });
});

// ─── compactionSummary ────────────────────────────────────

describe('mapAgentMessage — compactionSummary', () => {
  it('mapea summary y tokensBefore', () => {
    const raw = {
      role: 'compactionSummary',
      summary: 'contexto viejo',
      tokensBefore: 50000,
      timestamp: 7000,
    };
    const m = mapAgentMessage(raw)!;
    expect(m.role).toBe('compaction');
    expect(m.id).toBe('compaction_7000');
    expect(m.parts).toEqual([{
      type: 'compaction',
      summary: 'contexto viejo',
      tokensBefore: 50000,
    }]);
  });

  it('sin tokensBefore → 0', () => {
    const raw = {
      role: 'compactionSummary',
      summary: '',
      timestamp: 7100,
    };
    const m = mapAgentMessage(raw)!;
    expect((m.parts[0] as any).tokensBefore).toBe(0);
  });
});

// ─── ignorados ────────────────────────────────────────────

describe('mapAgentMessage — roles ignorados', () => {
  it('branchSummary → null', () => {
    expect(mapAgentMessage({ role: 'branchSummary', summary: 'x', fromId: 'y', timestamp: 1 })).toBeNull();
  });

  it('custom → null', () => {
    expect(mapAgentMessage({ role: 'custom', customType: 'foo', content: 'x', display: true, timestamp: 1 })).toBeNull();
  });

  it('notification → null', () => {
    expect(mapAgentMessage({ role: 'notification', content: 'x', timestamp: 1 })).toBeNull();
  });
});

// ─── extractText ──────────────────────────────────────────

describe('extractText', () => {
  it('concatena TextPart.text', () => {
    const msg: ChatMessage = {
      id: 'assistant_1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'hello ' },
        { type: 'thinking', text: 'pienso' },
        { type: 'text', text: 'world' },
      ],
      timestamp: 1,
    };
    expect(extractText(msg)).toBe('hello world');
  });

  it('sin TextPart → string vacío', () => {
    const msg: ChatMessage = {
      id: 'assistant_2',
      role: 'assistant',
      parts: [{ type: 'thinking', text: 'pienso' }],
      timestamp: 2,
    };
    expect(extractText(msg)).toBe('');
  });
});

// ─── determinismo ─────────────────────────────────────────

describe('mapAgentMessage — determinismo', () => {
  it('mismo raw → mismo ID', () => {
    const raw = {
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
      timestamp: 9000,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    };
    const a = mapAgentMessage(raw)!;
    const b = mapAgentMessage(raw)!;
    expect(a.id).toBe(b.id);
  });

  it('diferente timestamp → diferente ID', () => {
    const mk = (ts: number) => mapAgentMessage({
      role: 'user',
      content: 'x',
      timestamp: ts,
    })!;
    expect(mk(1).id).not.toBe(mk(2).id);
  });
});
