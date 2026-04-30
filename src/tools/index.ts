import { serverTool } from '@openrouter/agent';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listDirTool } from './list-dir.js';
import { shellTool } from './shell.js';
import { jsReplTool } from './js-repl.js';
import { subAgentTool } from './sub-agent.js';
import { planTool } from './plan.js';
import { requestInputTool } from './request-input.js';
import { webFetchTool } from './web-fetch.js';
import { viewImageTool } from './view-image.js';
import { customTool } from './custom.js';
import { findSkillsTool } from './find-skills.js';

export const tools = [
  // User-defined tools — executed client-side
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  grepTool,
  listDirTool,
  shellTool,
  jsReplTool,
  subAgentTool,
  planTool,
  requestInputTool,
  webFetchTool,
  viewImageTool,
  customTool,
  findSkillsTool,

  // Server tools — executed by OpenRouter, no client implementation needed
  serverTool({ type: 'openrouter:web_search' }),
  serverTool({ type: 'openrouter:datetime', parameters: { timezone: 'UTC' } }),
];
