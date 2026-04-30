import { createTwoFilesPatch } from 'diff';

export function colorizeDiff(patch: string): string {
  return patch.split('\n').map(line => {
    if (line.startsWith('index') || line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++')) {
      return `\x1b[90m${line}\x1b[0m`;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `\x1b[32m${line}\x1b[0m`;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return `\x1b[31m${line}\x1b[0m`;
    }
    if (line.startsWith('@@')) {
      return `\x1b[36m${line}\x1b[0m`;
    }
    return line;
  }).join('\n');
}

export function buildFileDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  options?: { context?: number }
): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent, '', '', {
    context: options?.context ?? 3,
  });
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNum?: number;
  newLineNum?: number;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  path: string;
  additions: number;
  removals: number;
  hunks: DiffHunk[];
}

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let path = '';
  let additions = 0;
  let removals = 0;

  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      path = line.slice(4).replace(/^b\//, '');
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldCount: match[2] ? parseInt(match[2]) : 1,
          newStart: parseInt(match[3]),
          newCount: match[4] ? parseInt(match[4]) : 1,
          lines: [],
        };
        hunks.push(currentHunk);
      }
      continue;
    }

    if (line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }

    if (currentHunk) {
      const type: DiffLine['type'] = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context';
      const content = type === 'context' ? line : line.slice(1);
      currentHunk.lines.push({ type, content });
      if (type === 'add') additions++;
      if (type === 'remove') removals++;
    }
  }

  // Assign line numbers
  for (const hunk of hunks) {
    let oldNum = hunk.oldStart;
    let newNum = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        line.oldLineNum = oldNum++;
        line.newLineNum = newNum++;
      } else if (line.type === 'remove') {
        line.oldLineNum = oldNum++;
      } else if (line.type === 'add') {
        line.newLineNum = newNum++;
      }
    }
  }

  return { path, additions, removals, hunks };
}

export function renderDiffForTerminal(parsed: ParsedDiff, maxLines = 50): string[] {
  const width = process.stdout.columns || 80;
  const BG_GREEN = '\x1b[48;5;22m';
  const BG_RED = '\x1b[48;5;52m';
  const FG_GREEN = '\x1b[38;5;82m';
  const FG_RED = '\x1b[38;5;196m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';
  const CLEAR_EOL = '\x1b[K';

  const out: string[] = [];
  let totalRendered = 0;

  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (totalRendered >= maxLines) {
        out.push(`${DIM}… (${parsed.additions + parsed.removals - totalRendered} more lines)${RESET}`);
        return out;
      }

      const num = line.newLineNum ?? line.oldLineNum ?? '';
      const numStr = String(num).padStart(4, ' ');

      if (line.type === 'add') {
        const text = `${numStr} + ${line.content}`;
        out.push(`${BG_GREEN}${FG_GREEN}${text.padEnd(width - 1, ' ')}${CLEAR_EOL}${RESET}`);
      } else if (line.type === 'remove') {
        const text = `${numStr} - ${line.content}`;
        out.push(`${BG_RED}${FG_RED}${text.padEnd(width - 1, ' ')}${CLEAR_EOL}${RESET}`);
      } else {
        out.push(`${DIM}${numStr}   ${line.content}${RESET}`);
      }
      totalRendered++;
    }
  }

  return out;
}
