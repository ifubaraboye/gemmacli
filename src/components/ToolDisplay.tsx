import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../agent.js';
import type { DisplayConfig } from '../config.js';
import { parseUnifiedDiff, renderDiffForTerminal } from '../utils/diff.js';

export type ToolEvent =
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string; diffData?: { success?: boolean; path?: string; replacements?: number; isNew?: boolean; diff?: string; error?: string } };

export interface ToolDisplayProps {
  events: ToolEvent[];
  display: DisplayConfig;
  isActive?: boolean;
}

type ToolFormatter = (name: string, args: Record<string, unknown>) => string;

const DEFAULT_FORMATTERS: Record<string, ToolFormatter> = {
  shell: (_n, a) => `command=${trunc(String(a.command ?? ''))}`,
  file_read: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  file_write: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  file_edit: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  glob: (_n, a) => `pattern=${trunc(String(a.pattern ?? ''))}`,
  grep: (_n, a) => `pattern=${trunc(String(a.pattern ?? ''))}`,
  list_dir: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  web_search: (_n, a) => `query=${trunc(String(a.query ?? ''))}`,
  web_fetch: (_n, a) => `url=${trunc(String(a.url ?? ''))}`,
  view_image: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  js_repl: (_n, a) => `code=${trunc(String(a.code ?? ''))}`,
  sub_agent: (_n, a) => `task=${trunc(String(a.task ?? ''))}`,
  plan: (_n, a) => `action=${trunc(String(a.action ?? ''))}`,
  request_input: (_n, a) => `question=${trunc(String(a.question ?? ''))}`,
  custom: (_n, a) => `action=${trunc(String(a.action ?? ''))}`,
};

const TOOL_LABELS: Record<string, { past: string; noun: string }> = {
  shell: { past: 'Ran', noun: 'shell command' },
  file_read: { past: 'Read', noun: 'file' },
  file_write: { past: 'Wrote', noun: 'file' },
  file_edit: { past: 'Edited', noun: 'file' },
  glob: { past: 'Explored', noun: 'pattern' },
  grep: { past: 'Searched', noun: 'pattern' },
  list_dir: { past: 'Listed', noun: 'directory' },
  web_search: { past: 'Fetched', noun: 'search' },
  web_fetch: { past: 'Fetched', noun: 'page' },
  view_image: { past: 'Viewed', noun: 'image' },
  js_repl: { past: 'Evaluated', noun: 'expression' },
  sub_agent: { past: 'Spawned', noun: 'sub-agent' },
  plan: { past: 'Updated', noun: 'plan' },
  request_input: { past: 'Asked', noun: 'question' },
  custom: { past: 'Ran', noun: 'action' },
};

const TOOL_COLORS: Record<string, string> = {
  shell: 'red',
  file_write: 'yellow',
  file_edit: 'yellow',
  web_search: 'magenta',
  web_fetch: 'magenta',
};

function trunc(s: string, max = 50): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function plural(n: number, noun: string): string {
  if (n === 1) return `1 ${noun}`;
  if (noun.endsWith('y')) return `${n} ${noun.slice(0, -1)}ies`;
  return `${n} ${noun}s`;
}

function defaultFormatter(_name: string, args: Record<string, unknown>): string {
  const key = Object.keys(args)[0];
  if (!key) return '';
  return `${key}=${trunc(String(args[key]))}`;
}

interface ToolResult {
  success?: boolean;
  path?: string;
  replacements?: number;
  isNew?: boolean;
  diff?: string;
  error?: string;
}

type DiffData = { success?: boolean; path?: string; replacements?: number; isNew?: boolean; diff?: string; error?: string };

function parseToolResult(output: string, diffData?: DiffData): ToolResult {
  if (diffData) return diffData;
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

const MAX_DIFF_LINES = 50;

function renderDiffOutput(result: ToolResult): React.ReactNode {
  if (!result.diff) return null;

  const parsed = parseUnifiedDiff(result.diff);
  const diffLines = renderDiffForTerminal(parsed, MAX_DIFF_LINES);
  const summary = `Updated ${parsed.path} with ${parsed.additions} addition${parsed.additions === 1 ? '' : 's'} and ${parsed.removals} removal${parsed.removals === 1 ? '' : 's'}`;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>└ {summary}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {diffLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

export function ToolDisplay({ events, display, isActive = false }: ToolDisplayProps) {
  if (display.toolDisplay === 'hidden') return null;

  if (display.toolDisplay === 'emoji') {
    return <EmojiDisplay events={events} isActive={isActive} />;
  }

  if (display.toolDisplay === 'minimal') {
    return <MinimalDisplay events={events} />;
  }

  return <GroupedDisplay events={events} isActive={isActive} />;
}

function EmojiDisplay({ events, isActive }: { events: ToolEvent[]; isActive: boolean }) {
  const lines: React.ReactNode[] = [];
  const toolStart = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'tool_call') {
      toolStart.set(event.callId, Date.now());
      const color = TOOL_COLORS[event.name] ?? 'yellow';
      const formatter = DEFAULT_FORMATTERS[event.name] ?? defaultFormatter;
      const argStr = formatter(event.name, event.args);
      lines.push(
        <Text key={`call-${event.callId}`}>
          <Text color={color}>⚡</Text>
          <Text dimColor>
            {' '}{event.name}{argStr ? ' ' + argStr : ''}
          </Text>
        </Text>,
      );
    } else if (event.type === 'tool_result') {
      const ms = Date.now() - (toolStart.get(event.callId) ?? Date.now());
      lines.push(
        <Text key={`res-${event.callId}`}>
          <Text color="green">✓</Text>
          <Text dimColor>
            {' '}{event.name} ({(ms / 1000).toFixed(1)}s)
          </Text>
        </Text>,
      );
    }
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines}
    </Box>
  );
}

function MinimalDisplay({ events }: { events: ToolEvent[] }) {
  const batch = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'tool_call') {
      batch.set(event.name, (batch.get(event.name) ?? 0) + 1);
    }
  }

  if (batch.size === 0) return null;

  const parts: string[] = [];
  for (const [name, count] of batch) {
    const label = TOOL_LABELS[name];
    if (label) {
      parts.push(`${label.past.toLowerCase()} ${plural(count, label.noun)}`);
    } else {
      parts.push(`${plural(count, name)}`);
    }
  }

  return (
    <Box marginLeft={2}>
      <Text color="gray">{parts.join(', ')}</Text>
    </Box>
  );
}

function GroupedDisplay({ events, isActive }: { events: ToolEvent[]; isActive: boolean }) {
  const [pulseFrame, setPulseFrame] = React.useState(0);

  React.useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setPulseFrame(f => f + 1), 600);
    return () => clearInterval(timer);
  }, [isActive]);

  type Pending = {
    name: string;
    callId: string;
    args: Record<string, unknown>;
    output?: string;
    diffData?: { success?: boolean; path?: string; replacements?: number; isNew?: boolean; diff?: string; error?: string };
  };

  const groups: Pending[][] = [];
  const pendingByCallId = new Map<string, Pending>();
  let currentGroup: Pending[] = [];
  let currentCategory = '';

  for (const event of events) {
    if (event.type === 'tool_call') {
      const category = TOOL_LABELS[event.name]?.past ?? event.name;
      if (category !== currentCategory) {
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [];
        currentCategory = category;
      }
      const p: Pending = { name: event.name, callId: event.callId, args: event.args };
      currentGroup.push(p);
      pendingByCallId.set(event.callId, p);
    } else if (event.type === 'tool_result') {
      const p = pendingByCallId.get(event.callId);
      if (p) {
        p.output = event.output;
        if (event.diffData) p.diffData = event.diffData;
      }
    }
  }

  if (currentGroup.length > 0) groups.push(currentGroup);

  // Build set of callIds that have results
  const completedCallIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool_result') {
      completedCallIds.add(event.callId);
    }
  }

  function Dot({ callId }: { callId: string }) {
    const done = completedCallIds.has(callId);
    if (done || !isActive) {
      return <Text color="green">● </Text>;
    }
    // Pulse: alternate between green and dim gray
    const color = pulseFrame % 2 === 0 ? 'green' : 'gray';
    return <Text color={color}>● </Text>;
  }

  return (
    <Box flexDirection="column" marginLeft={0}>
      {groups.map((group, gi) => {
        const first = group[0];
        const label = TOOL_LABELS[first.name]?.past ?? first.name;
        const formatter = DEFAULT_FORMATTERS[first.name] ?? defaultFormatter;

        if (group.length === 1) {
          const argStr = formatter(first.name, first.args);
          const result = first.output ? parseToolResult(first.output, first.diffData) : null;
          const hasDiff = result?.diff && (first.name === 'file_edit' || first.name === 'file_write');

          return (
            <Box key={gi} flexDirection="column">
              <Box>
                <Dot callId={first.callId} />
                <Text bold>{label}</Text>
                <Text>{' '}{argStr}</Text>
              </Box>
              {first.output && !hasDiff && (
                <Box marginLeft={2}>
                  <Text dimColor>└ </Text>
                  <Text color="gray">{trunc(first.output.split('\n')[0], 70)}</Text>
                </Box>
              )}
              {first.output && hasDiff && renderDiffOutput(result!)}
            </Box>
          );
        }

        return (
          <Box key={gi} flexDirection="column">
            <Box>
              <Dot callId={first.callId} />
              <Text bold>{label}</Text>
            </Box>
            {group.map((item, i) => {
              const argStr = formatter(item.name, item.args);
              const isLast = i === group.length - 1;
              const branch = isLast ? '└' : '├';
              const result = item.output ? parseToolResult(item.output, item.diffData) : null;
              const hasDiff = result?.diff && (item.name === 'file_edit' || item.name === 'file_write');

              return (
                <Box key={i} flexDirection="column" marginLeft={2}>
                  <Box>
                    <Text dimColor>{branch} {argStr}</Text>
                    {item.output && !hasDiff && (
                      <Text color="gray">{' '}{trunc(item.output.split('\n')[0], 50)}</Text>
                    )}
                  </Box>
                  {hasDiff && renderDiffOutput(result!)}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
