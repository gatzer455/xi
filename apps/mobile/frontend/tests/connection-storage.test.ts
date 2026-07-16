import { describe, it, expect, beforeEach } from 'vitest';
import { loadServerConfig, saveServerConfig, buildWsUrl } from '../src/lib/connection-storage.ts';

describe('connection-storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(loadServerConfig()).toBeNull();
    saveServerConfig({ url: 'host:9876', token: 'abc' });
    expect(loadServerConfig()).toEqual({ url: 'host:9876', token: 'abc' });
  });

  it('normalizes a bare host:port into a ws:// url with token', () => {
    expect(buildWsUrl({ url: 'homeserver:9876', token: 'tok' }))
      .toBe('ws://homeserver:9876/ws?token=tok');
  });

  it('accepts an explicit scheme and trailing /ws', () => {
    expect(buildWsUrl({ url: 'wss://homeserver:9876/ws', token: 'tok' }))
      .toBe('wss://homeserver:9876/ws?token=tok');
  });

  it('encodes the token', () => {
    expect(buildWsUrl({ url: 'host:9876', token: 'a b' }))
      .toBe('ws://host:9876/ws?token=a%20b');
  });
});
