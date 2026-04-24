import { OpenRouter } from '@openrouter/agent';
import { stepCountIs, maxCost } from '@openrouter/agent/stop-conditions';
import { loadConfig } from './config.js';
import { buildSystemPrompt } from './system-prompt.js';
import { tools } from './tools/index.js';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_done' }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'error'; message: string };

export interface AgentResult {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function runAgent(
  input: string | ChatMessage[],
  options?: {
    onEvent?: (event: AgentEvent) => void;
    signal?: AbortSignal;
  }
): Promise<AgentResult> {
  const config = loadConfig();
  const client = new OpenRouter({ apiKey: config.apiKey });
  const instructions = buildSystemPrompt();

  const result = client.callModel({
    model: config.model,
    instructions,
    input: input as string,
    tools,
    stopWhen: [stepCountIs(config.maxSteps), maxCost(config.maxCost)],
  });

  if (options?.onEvent) {
    let lastTextLen = 0;
    const callNames = new Map<string, string>();

    for await (const item of result.getItemsStream()) {
      if (options?.signal?.aborted) break;

      if (item.type === 'message') {
        const msg = item as { content?: { text: string }[] };
        const text = msg.content
          ?.filter((c): c is { text: string } => 'text' in c)
          .map((c) => c.text)
          .join('') ?? '';
        if (text.length > lastTextLen) {
          options.onEvent({ type: 'text', delta: text.slice(lastTextLen) });
          lastTextLen = text.length;
        }
      } else if (item.type === 'function_call') {
        const fc = item as { callId: string; name: string; arguments?: string; status?: string };
        callNames.set(fc.callId, fc.name);
        if (fc.status === 'completed') {
          let args: Record<string, unknown> = {};
          try {
            if (fc.arguments) args = JSON.parse(fc.arguments);
          } catch { /* ignore */ }
          options.onEvent({ type: 'tool_call', name: fc.name, callId: fc.callId, args });
        }
      } else if (item.type === 'function_call_output') {
        const fco = item as { callId: string; output: unknown };
        const out = typeof fco.output === 'string' ? fco.output : JSON.stringify(fco.output);
        options.onEvent({
          type: 'tool_result',
          name: callNames.get(fco.callId) ?? 'unknown',
          callId: fco.callId,
          output: out.length > 200 ? out.slice(0, 200) + '…' : out,
        });
      } else if (item.type === 'reasoning') {
        const r = item as { summary?: { text: string }[] };
        const text = r.summary?.map((s) => s.text).join('') ?? '';
        if (text) options.onEvent({ type: 'reasoning', delta: text });
      }
    }
  }

  const response = await result.getResponse();
  return {
    text: response.outputText ?? '',
    usage: response.usage ? {
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0,
    } : undefined,
  };
}

export async function runAgentWithRetry(
  input: string | ChatMessage[],
  options?: {
    onEvent?: (event: AgentEvent) => void;
    signal?: AbortSignal;
    maxRetries?: number;
  }
): Promise<AgentResult> {
  const maxRetries = options?.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runAgent(input, options);
    } catch (err: unknown) {
      const e = err as { status?: number; statusCode?: number };
      const s = e?.status ?? e?.statusCode;
      if (!(s === 429 || (s !== undefined && s >= 500 && s < 600)) || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)));
    }
  }
  throw new Error('Unreachable');
}