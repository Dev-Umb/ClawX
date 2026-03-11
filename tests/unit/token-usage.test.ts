import { describe, expect, it } from 'vitest';
import { parseUsageEntriesFromJsonl } from '@electron/utils/token-usage-core';

describe('parseUsageEntriesFromJsonl', () => {
  it('extracts assistant usage entries in reverse chronological order', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          usage: {
            input: 100,
            output: 50,
            total: 150,
            cost: { total: 0.0012 },
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:05:00.000Z',
        message: {
          role: 'assistant',
          modelRef: 'claude-sonnet',
          provider: 'anthropic',
          usage: {
            promptTokens: 200,
            completionTokens: 80,
            cacheRead: 25,
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:06:00.000Z',
        message: {
          role: 'user',
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-02-28T10:05:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        totalTokens: 305,
        costUsd: undefined,
        pointsSpent: undefined,
      },
      {
        timestamp: '2026-02-28T10:00:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'gpt-5',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costUsd: 0.0012,
        pointsSpent: 2,
      },
    ]);
  });

  it('skips lines without assistant usage', () => {
    const jsonl = [
      JSON.stringify({ type: 'message', timestamp: '2026-02-28T10:00:00.000Z', message: { role: 'assistant' } }),
      JSON.stringify({ type: 'message', timestamp: '2026-02-28T10:01:00.000Z', message: { role: 'user', usage: { total: 123 } } }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([]);
  });

  it('returns all matching entries when no limit is provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: { role: 'assistant', model: 'm1', usage: { total: 10 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:01:00.000Z',
        message: { role: 'assistant', model: 'm2', usage: { total: 20 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:02:00.000Z',
        message: { role: 'assistant', model: 'm3', usage: { total: 30 } },
      }),
    ].join('\n');

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.model)).toEqual(['m3', 'm2', 'm1']);
  });

  it('still supports explicit limits when provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: { role: 'assistant', model: 'm1', usage: { total: 10 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:01:00.000Z',
        message: { role: 'assistant', model: 'm2', usage: { total: 20 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:02:00.000Z',
        message: { role: 'assistant', model: 'm3', usage: { total: 30 } },
      }),
    ].join('\n');

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' }, 2);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.model)).toEqual(['m3', 'm2']);
  });

  it('estimates cost when transcript cost is zero', () => {
    const jsonl = JSON.stringify({
      type: 'message',
      timestamp: '2026-03-10T20:08:40.568Z',
      message: {
        role: 'assistant',
        model: 'doubao-seed-2.0-lite',
        provider: 'clawx-cloud',
        usage: {
          input: 18720,
          output: 133,
          totalTokens: 18853,
          cost: { total: 0 },
        },
      },
    });

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'main' });
    expect(entries).toHaveLength(1);
    expect(entries[0].costUsd).toBeCloseTo(0.077008, 6);
    expect(entries[0].pointsSpent).toBe(78);
  });

  it('prefers explicit transcript points over cost conversion', () => {
    const jsonl = JSON.stringify({
      type: 'message',
      timestamp: '2026-03-11T10:08:40.568Z',
      message: {
        role: 'assistant',
        model: 'doubao-seed-2.0-lite',
        provider: 'clawx-cloud',
        usage: {
          input: 1000,
          output: 100,
          totalTokens: 1100,
          cost: { total: 1.9999 },
          points: 42,
        },
      },
    });

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'main' });
    expect(entries).toHaveLength(1);
    expect(entries[0].pointsSpent).toBe(42);
  });

  it('includes cache tokens in clawx-cloud points estimation', () => {
    const jsonl = JSON.stringify({
      type: 'message',
      timestamp: '2026-03-11T07:31:14.970Z',
      message: {
        role: 'assistant',
        model: 'doubao-seed-2.0-lite',
        provider: 'clawx-cloud',
        usage: {
          input: 33914,
          output: 13,
          cacheRead: 1592,
          totalTokens: 35519,
          cost: { total: 0 },
        },
      },
    });

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'main' });
    expect(entries).toHaveLength(1);
    expect(entries[0].costUsd).toBeCloseTo(0.142232, 6);
    expect(entries[0].pointsSpent).toBe(143);
  });
});
