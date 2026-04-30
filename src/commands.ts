import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import type { ChatMessage } from './agent.js';
import { colorizeDiff } from './utils/diff.js';

const execAsync = promisify(exec);

export interface CommandContext {
  model: string;
  setModel: (model: string) => void;
  messages: ChatMessage[];
  clearMessages: () => void;
  sessionPath: string;
  activeSkill: string | null;
  setActiveSkill: (skill: string | null) => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, ctx: CommandContext) => string | void | Promise<string | void>;
}

const commands: SlashCommand[] = [];

export function registerCommand(cmd: SlashCommand): void {
  commands.push(cmd);
}

export function getCommands(): SlashCommand[] {
  return commands;
}

export interface CommandMeta {
  name: string;
  description: string;
}

export function getCommandList(): CommandMeta[] {
  return commands.map((c) => ({ name: c.name, description: c.description }));
}

export interface DispatchResult {
  handled: boolean;
  output?: string;
  clear?: boolean;
}

export async function dispatch(input: string, ctx: CommandContext): Promise<DispatchResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const [name, ...rest] = trimmed.slice(1).split(' ');
  const args = rest.join(' ');

  const cmd = commands.find((c) => c.name === name);
  if (!cmd) {
    return { handled: true, output: `Unknown command: /${name}. Type /help for available commands.` };
  }

  const output = await cmd.execute(args, ctx);
  return { handled: true, output: output ?? undefined, clear: name === 'new' };
}

// Register default commands
registerCommand({
  name: 'model',
  description: 'Switch the active model (e.g., /model anthropic/claude-opus-4.7)',
  execute: (args, ctx) => {
    if (!args.trim()) {
      return `Current model: ${ctx.model}`;
    }
    ctx.setModel(args.trim());
    return `Model switched to: ${args.trim()}`;
  },
});

registerCommand({
  name: 'new',
  description: 'Start a fresh conversation',
  execute: (_args, ctx) => {
    ctx.clearMessages();
    return '';
  },
});

registerCommand({
  name: 'help',
  description: 'List available commands',
  execute: () => {
    const lines = ['Commands:'];
    for (const cmd of getCommands()) {
      lines.push(`  /${cmd.name} — ${cmd.description}`);
    }
    return lines.join('\n');
  },
});

registerCommand({
  name: 'find-skills',
  description: 'Search for agent skills (e.g., /find-skills react performance)',
  execute: async (args) => {
    if (!args.trim()) {
      return 'Usage: /find-skills <query>\nExample: /find-skills react performance\n\nBrowse all skills at: https://skills.sh/';
    }
    try {
      const { stdout, stderr } = await execAsync(`npx skills find ${args}`, {
        timeout: 30000,
      });
      const out = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      return out || 'No results found.';
    } catch (err: any) {
      const out = err.stdout ?? '';
      const errOut = err.stderr ?? '';
      const combined = out + (errOut ? `\n[stderr]\n${errOut}` : '');
      return combined || err.message;
    }
  },
});

registerCommand({
  name: 'skill',
  description: 'Load or list installed skills (e.g., /skill frontend-design)',
  execute: (args, ctx) => {
    const skillName = args.trim();

    if (!skillName) {
      const skillsDir = join(homedir(), '.agents', 'skills');
      if (!existsSync(skillsDir)) {
        return 'No skills installed.\n\nSearch for skills: /find-skills <query>\nInstall: npx skills add <owner/repo@skill>';
      }

      let dirs: string[];
      try {
        dirs = readdirSync(skillsDir);
      } catch {
        return 'No skills installed.\n\nSearch for skills: /find-skills <query>\nInstall: npx skills add <owner/repo@skill>';
      }

      if (dirs.length === 0) {
        return 'No skills installed.\n\nSearch for skills: /find-skills <query>\nInstall: npx skills add <owner/repo@skill>';
      }

      const lines = ['Installed skills:'];
      for (const dir of dirs.sort()) {
        lines.push(`  ${dir}`);
      }
      lines.push('\nLoad a skill: /skill <name>\nSearch for skills: /find-skills <query>');
      return lines.join('\n');
    }

    const skillPath = join(homedir(), '.agents', 'skills', skillName, 'SKILL.md');
    if (!existsSync(skillPath)) {
      return `Skill "${skillName}" not found at ~/.agents/skills/${skillName}/SKILL.md\n\nInstalled skills: /skill\nSearch for skills: /find-skills <query>`;
    }

    try {
      const content = readFileSync(skillPath, 'utf-8');
      ctx.setActiveSkill(content);
      return `Loaded skill: ${skillName}\n\nThe skill's guidelines are now active for this session.`;
    } catch (err: any) {
      return `Failed to load skill: ${err.message}`;
    }
  },
});

registerCommand({
  name: 'diff',
  description: 'Show git diff for a file (e.g., /diff src/app.tsx --git HEAD~1)',
  execute: async (args) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return 'Usage: /diff <file> [--git <ref>]\nExample: /diff src/app.tsx --git HEAD~1\nDefaults to HEAD (uncommitted changes).';
    }

    let ref = 'HEAD';
    let filePath = parts[0];

    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === '--git' && i + 1 < parts.length) {
        ref = parts[i + 1];
        filePath = parts.slice(0, i).join(' ').trim();
        break;
      }
    }

    const resolvedPath = resolve(process.cwd(), filePath);

    if (!existsSync(resolvedPath)) {
      return `File not found: ${resolvedPath}`;
    }

    try {
      const { stdout, stderr } = await execAsync(
        `git diff --no-color ${ref} -- "${resolvedPath}"`,
        { timeout: 10000 }
      );

      if (!stdout.trim()) {
        return `No changes in ${filePath} (ref: ${ref})`;
      }

      const colored = colorizeDiff(stdout);
      return colored;
    } catch (err: any) {
      if (err.code === 128) {
        return `Git error: ${err.stderr || 'Unknown git error'}`;
      }
      if (err.code === 1 && err.stdout) {
        const colored = colorizeDiff(err.stdout as string);
        return colored;
      }
      return `Failed to run git diff: ${err.message}`;
    }
  },
});
