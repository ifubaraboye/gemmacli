import type { AgentEvent } from './agent.js';
import type { DisplayConfig } from './config.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const MAGENTA = '\x1b[35m';

// Lightweight streaming Markdown parser
class MarkdownStream {
  private buffer = '';
  private inCodeBlock = false;
  private inInlineCode = false;
  private inBold = false;

  private CODE_COLOR = '\x1b[36m';   // Cyan for blocks
  private INLINE_COLOR = '\x1b[33m'; // Yellow for inline
  private BOLD_COLOR = '\x1b[1m';
  private RESET_CODE = '\x1b[0m';

  push(chunk: string): string {
    let out = '';
    this.buffer += chunk;

    while (this.buffer.length > 0) {
      // Toggle Code Blocks
      if (this.buffer.startsWith('```')) {
        this.inCodeBlock = !this.inCodeBlock;
        out += this.inCodeBlock ? this.CODE_COLOR : this.RESET_CODE;
        this.buffer = this.buffer.slice(3);
        continue;
      }

      // Buffer lookahead check to prevent premature processing
      if (!this.inCodeBlock && (this.buffer === '`' || this.buffer === '``')) {
        break; 
      }

      // Toggle Inline Code
      if (this.buffer.startsWith('`') && !this.inCodeBlock) {
        this.inInlineCode = !this.inInlineCode;
        out += this.inInlineCode ? this.INLINE_COLOR : this.RESET_CODE;
        this.buffer = this.buffer.slice(1);
        continue;
      }

      // Toggle Bold
      if (this.buffer.startsWith('**') && !this.inCodeBlock && !this.inInlineCode) {
        this.inBold = !this.inBold;
        out += this.inBold ? this.BOLD_COLOR : this.RESET_CODE;
        this.buffer = this.buffer.slice(2);
        continue;
      }

      // Buffer lookahead check for bold
      if (!this.inCodeBlock && !this.inInlineCode && this.buffer === '*') {
        break;
      }

      out += this.buffer[0];
      this.buffer = this.buffer.slice(1);
    }

    return out;
  }

  end(): string {
    let out = this.buffer;
    this.buffer = '';
    // Safely close dangling styles
    if (this.inCodeBlock || this.inInlineCode || this.inBold) {
      out += this.RESET_CODE;
    }
    return out;
  }
}

type ToolFormatter = (name: string, args: Record<string, unknown>) => string;

const DEFAULT_FORMATTERS: Record<string, ToolFormatter> = {
  run_command: (_n, a) => `command=${trunc(String(a.command ?? ''))}`,
  read_file: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  write_file: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  edit_file: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
  search_files: (_n, a) => `pattern=${trunc(String(a.pattern ?? ''))}`,
  grep_files: (_n, a) => `pattern=${trunc(String(a.pattern ?? ''))}`,
  list_directory: (_n, a) => `path=${trunc(String(a.path ?? ''))}`,
};

const TOOL_LABELS: Record<string, { past: string; noun: string }> = {
  run_command: { past: 'Ran', noun: 'shell command' },
  read_file: { past: 'Read', noun: 'file' },
  write_file: { past: 'Wrote', noun: 'file' },
  edit_file: { past: 'Edited', noun: 'file' },
  search_files: { past: 'Searched', noun: 'pattern' },
  grep_files: { past: 'Searched', noun: 'pattern' },
  list_directory: { past: 'Listed', noun: 'directory' },
};

function trunc(s: string, max = 50): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function plural(n: number, noun: string): string {
  if (n === 1) return `1 ${noun}`;
  if (noun.endsWith('y')) return `${n} ${noun.slice(0, -1)}ies`;
  return `${n} ${noun}s`;
}

export interface RendererOptions {
  display: DisplayConfig;
  toolFormatters?: Record<string, ToolFormatter>;
  toolColors?: Record<string, string>;
  beforeWrite?: () => void;
  afterWrite?: () => void;
}

export class TuiRenderer {
  private display: DisplayConfig;
  private formatters: Record<string, ToolFormatter>;
  private toolColors: Record<string, string>;
  private toolStart = new Map<string, number>();
  private streaming = false;
  private mdStream = new MarkdownStream();
  private beforeWrite?: () => void;
  private afterWrite?: () => void;

  private groupedPending: { name: string; callId: string; args: Record<string, unknown>; output?: string }[] =[];
  private groupedCategory = '';

  private minimalBatch = new Map<string, number>();

  constructor(opts: RendererOptions) {
    this.display = opts.display;
    this.formatters = { ...DEFAULT_FORMATTERS, ...opts.toolFormatters };
    this.toolColors = { run_command: RED, ...opts.toolColors };
    this.beforeWrite = opts.beforeWrite;
    this.afterWrite = opts.afterWrite;
  }

  handle(event: AgentEvent): void {
    switch (event.type) {
      case 'text':
        return this.renderText(event.delta);
      case 'tool_call':
        return this.renderToolCall(event.name, event.callId, event.args);
      case 'tool_result':
        return this.renderToolResult(event.name, event.callId, event.output);
      case 'reasoning':
        return this.renderReasoning(event.delta);
    }
  }

  private renderText(delta: string): void {
    this.flushMinimal();
    this.streaming = true;
    this.beforeWrite?.();
    process.stdout.write(this.mdStream.push(delta));
    this.afterWrite?.();
  }

  private renderToolCall(name: string, callId: string, args: Record<string, unknown>): void {
    if (this.display.toolDisplay === 'hidden') return;
    this.endStreaming();
    this.toolStart.set(callId, Date.now());

    if (this.display.toolDisplay === 'emoji') {
      const color = this.toolColors[name] ?? YELLOW;
      const formatter = this.formatters[name] ?? this.defaultFormatter;
      const argStr = formatter(name, args);
      this.beforeWrite?.();
      console.log(`  ${color}⚡${RESET} ${DIM}${name}${argStr ? ' ' + argStr : ''}${RESET}`);
      this.afterWrite?.();
    } else if (this.display.toolDisplay === 'grouped') {
      const category = TOOL_LABELS[name]?.past ?? name;
      if (category !== this.groupedCategory) {
        this.flushGrouped();
        this.groupedCategory = category;
      }
      this.groupedPending.push({ name, callId, args });
    } else if (this.display.toolDisplay === 'minimal') {
      this.minimalBatch.set(name, (this.minimalBatch.get(name) ?? 0) + 1);
    }
  }

  private renderToolResult(name: string, callId: string, output: string): void {
    if (this.display.toolDisplay === 'hidden') return;
    const ms = Date.now() - (this.toolStart.get(callId) ?? Date.now());
    const dur = `(${(ms / 1000).toFixed(1)}s)`;

    if (this.display.toolDisplay === 'emoji') {
      this.beforeWrite?.();
      console.log(`  ${GREEN}✓${RESET} ${DIM}${name} ${dur}${RESET}`);
      this.afterWrite?.();
    } else if (this.display.toolDisplay === 'grouped') {
      const pending = this.groupedPending.find((p) => p.callId === callId);
      if (pending) {
        pending.output = output;
      }
    }
  }

  private renderReasoning(delta: string): void {
    if (!this.display.reasoning) return;
    this.flushMinimal();
    this.endStreaming();
    this.beforeWrite?.();
    process.stdout.write(`${DIM}${delta}${RESET}`);
    this.afterWrite?.();
  }

  endStreaming(): void {
    if (this.streaming) {
      process.stdout.write(this.mdStream.end() + RESET + '\n');
      this.streaming = false;
    }
  }

  endTurn(): void {
    this.flushGrouped();
    this.flushMinimal();
    this.endStreaming();
  }

  private flushGrouped(): void {
    if (this.groupedPending.length === 0) return;

    this.beforeWrite?.();
    const first = this.groupedPending[0];
    const label = TOOL_LABELS[first.name]?.past ?? first.name;
    const formatter = this.formatters[first.name] ?? this.defaultFormatter;

    if (this.groupedPending.length === 1) {
      const argStr = formatter(first.name, first.args);
      console.log(`${GREEN}●${RESET} ${BOLD}${label}${RESET} ${argStr}`);
      if (first.output) {
        const line = first.output.split('\n').find(l => l.trim().length > 0) || '';
        console.log(`  └ ${GRAY}${trunc(line, 70)}${RESET}`);
      }
    } else {
      console.log(`${GREEN}●${RESET} ${BOLD}${label}${RESET}`);
      for (const pending of this.groupedPending) {
        const argStr = formatter(pending.name, pending.args);
        const isLast = pending === this.groupedPending[this.groupedPending.length - 1];
        const branch = isLast ? '└' : '├';
        if (pending.output) {
          const line = pending.output.split('\n').find(l => l.trim().length > 0) || '';
          console.log(`  ${branch} ${DIM}${argStr}${RESET} ${GRAY}${trunc(line, 50)}${RESET}`);
        } else {
          console.log(`  ${branch} ${DIM}${argStr}${RESET}`);
        }
      }
    }
    console.log();
    this.afterWrite?.();

    this.groupedPending =[];
    this.groupedCategory = '';
  }

  private flushMinimal(): void {
    if (this.minimalBatch.size === 0) return;

    this.beforeWrite?.();
    const parts: string[] =[];
    for (const [name, count] of this.minimalBatch) {
      const label = TOOL_LABELS[name];
      if (label) {
        parts.push(`${label.past.toLowerCase()} ${plural(count, label.noun)}`);
      } else {
        parts.push(`${plural(count, name)}`);
      }
    }
    console.log(`  ${GRAY}${parts.join(', ')}${RESET}`);
    this.afterWrite?.();

    this.minimalBatch.clear();
  }

  private defaultFormatter: ToolFormatter = (_name, args) => {
    const key = Object.keys(args)[0];
    if (!key) return '';
    return `${key}=${trunc(String(args[key]))}`;
  };
}