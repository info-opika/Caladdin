import { describe, it, expect, vi } from 'vitest';
import { createOpenAiCompatClient } from '../../src/services/llm/openai-compat-client.js';

describe('createOpenAiCompatClient', () => {
  it('sends Authorization, X-Session-Id, temperature=0, parallel_tool_calls=false', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'Hello', tool_calls: [] },
              finish_reason: 'stop',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'X-Routed-Via': 'gemini-2.5-flash',
            'X-Fallback-Attempts': '1',
          },
        },
      ),
    );

    const client = createOpenAiCompatClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      fetchFn,
    });

    const res = await client.complete({
      model: 'auto:caladdin-agent',
      system: 'You are Caladdin',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      sessionId: 'caladdin:user-1:req-1',
      temperature: 0,
      parallelToolCalls: false,
    });

    expect(res.text).toBe('Hello');
    expect(res.routedVia).toBe('gemini-2.5-flash');
    expect(res.fallbackAttempts).toBe(1);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['X-Session-Id']).toBe('caladdin:user-1:req-1');

    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Caladdin' });
  });

  it('parses tool_calls from assistant message', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'create_event', arguments: '{"title":"Sync"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = createOpenAiCompatClient({
      baseUrl: 'http://localhost/v1',
      apiKey: 'k',
      fetchFn,
    });

    const res = await client.complete({
      model: 'auto:caladdin-agent',
      system: 'sys',
      messages: [{ role: 'user', content: 'book sync' }],
      tools: [],
      sessionId: 'caladdin:u:r',
    });

    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.function.name).toBe('create_event');
  });
});
