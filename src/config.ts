import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export interface DisplayConfig {
  toolDisplay: 'emoji' | 'grouped' | 'minimal' | 'hidden';
  reasoning: boolean;
  inputStyle: 'block' | 'bordered' | 'plain';
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxSteps: number;
  maxCost: number;
  sessionDir: string;
  showBanner: boolean;
  display: DisplayConfig;
  slashCommands: boolean;
}

const DEFAULTS: AgentConfig = {
  apiKey: '',
  model: 'google/gemma-4-31b-it:free',
  systemPrompt: [
    'You are Gemma, a coding assistant with access to tools for reading, writing, editing, and searching files, and running shell commands.',
    '',
    'Current working directory: {cwd}',
    '',
    '## Core Guidelines',
    '',
    '- Use your tools proactively. Explore the codebase to find answers instead of asking the user.',
    '- Keep working until the task is fully resolved before responding.',
    '- Do not guess or make up information — use your tools to verify.',
    '- Be concise and direct.',
    '- Show file paths clearly when working with files.',
    '- Prefer grep and glob tools over shell commands for file search.',
    '- When editing code, make minimal targeted changes consistent with the existing style.',
    '',
    '## Think Before Coding',
    '',
    '- State your assumptions explicitly. If uncertain, ask.',
    '- If multiple interpretations exist, present them — do not pick silently.',
    '- If a simpler approach exists, say so. Push back when warranted.',
    '- If something is unclear, stop. Name what is confusing. Ask.',
    '',
    '## Simplicity First',
    '',
    '- Write the minimum code that solves the problem. Nothing speculative.',
    '- No features beyond what was asked.',
    '- No abstractions for single-use code.',
    '- No "flexibility" or "configurability" that was not requested.',
    '- If you write 200 lines and it could be 50, rewrite it.',
    '',
    '## Surgical Changes',
    '',
    '- Touch only what you must. Do not "improve" adjacent code, comments, or formatting.',
    '- Do not refactor things that are not broken.',
    '- Match existing style, even if you would do it differently.',
    '- If your changes create unused imports/variables/functions, remove them.',
    '- Do not remove pre-existing dead code unless asked.',
    '- Every changed line should trace directly to the user\'s request.',
    '',
    '## Goal-Driven Execution',
    '',
    '- Transform vague tasks into verifiable goals before starting.',
    '- For multi-step tasks, state a brief plan with success criteria for each step.',
    '- Strong success criteria let you loop independently without constant clarification.',
  ].join('\n'),
  maxSteps: 20,
  maxCost: 1.0,
  sessionDir: join(homedir(), '.gemmacli', 'sessions'),
  showBanner: false,
  display: { toolDisplay: 'grouped', reasoning: false, inputStyle: 'bordered' },
  slashCommands: true,
};

export function loadConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  let config = { ...DEFAULTS };

  const configPath = resolve('agent.config.json');
  if (existsSync(configPath)) {
    const file = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (file.display) {
      config.display = { ...config.display, ...file.display };
    }
    config = { ...config, ...file, display: config.display };
  }

  if (process.env.OPENROUTER_API_KEY) config.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MAX_STEPS) config.maxSteps = Number(process.env.AGENT_MAX_STEPS);
  if (process.env.AGENT_MAX_COST) config.maxCost = Number(process.env.AGENT_MAX_COST);

  if (overrides.display) {
    config.display = { ...config.display, ...overrides.display };
  }
  config = { ...config, ...overrides, display: config.display };

  if (!config.apiKey) throw new Error('OPENROUTER_API_KEY is required.');
  return config;
}