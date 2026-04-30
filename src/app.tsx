import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from './config.js';
import { runAgentWithRetry, type AgentEvent, type ChatMessage } from './agent.js';
import { initSessionDir, newSessionPath, saveMessage, loadSession } from './session.js';
import { dispatch, type CommandContext } from './commands.js';
import { Header } from './components/Header.js';
import { InputPrompt, type PastedImage } from './components/InputPrompt.js';
import { ToolDisplay, type ToolEvent } from './components/ToolDisplay.js';
import { StreamingText } from './components/StreamingText.js';
import { Loader } from './components/Loader.js';

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  tokens?: string;
  tools?: ToolEvent[];
};

type QueuedMessage = {
  input: string;
  images: PastedImage[];
};

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const SKILL_PATTERNS = [
  /(?:use|with|using|via)\s+(?:my|your|the)?\s*(\w+[-\s]?\w*)\s+(?:skill|expertise)/i,
  /(?:my|your|the)\s+(\w+[-\s]?\w*)\s+(?:skill|expertise)/i,
  /(?:apply|follow)\s+(?:the)?\s*(\w+[-\s]?\w*)\s+(?:skill|guidelines)/i,
  /(\w+[-\s]?\w*)\s+(?:skill|guidelines)/i,
];

function fuzzyMatch(candidate: string, skills: string[]): string | null {
  const lower = candidate.toLowerCase();

  for (const skill of skills) {
    if (skill.toLowerCase() === lower) return skill;
  }

  for (const skill of skills) {
    if (skill.toLowerCase().includes(lower)) return skill;
    if (lower.includes(skill.toLowerCase())) return skill;
  }

  let best: string | null = null;
  let bestScore = Infinity;
  for (const skill of skills) {
    const dist = levenshtein(lower, skill.toLowerCase());
    if (dist <= 3 && dist < bestScore) {
      bestScore = dist;
      best = skill;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function detectSkillMention(input: string): string | null {
  const skillsDir = join(homedir(), '.agents', 'skills');
  if (!existsSync(skillsDir)) return null;

  let dirs: string[];
  try {
    dirs = readdirSync(skillsDir);
  } catch {
    return null;
  }

  for (const pattern of SKILL_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      const matched = fuzzyMatch(candidate, dirs);
      if (matched) {
        const skillPath = join(skillsDir, matched, 'SKILL.md');
        if (existsSync(skillPath)) {
          return matched;
        }
      }
    }
  }

  return null;
}

export default function App() {
  const configRef = useRef(loadConfig());
  const { exit } = useApp();

  const [history, setHistory] = useState<Turn[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming'>('idle');
  const [currentTools, setCurrentTools] = useState<ToolEvent[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [currentReasoning, setCurrentReasoning] = useState('');
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  const sessionPathRef = useRef('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const assistantTextRef = useRef('');
  const toolsRef = useRef<ToolEvent[]>([]);
  const structuredDiffRef = useRef<Map<string, { success?: boolean; path?: string; replacements?: number; isNew?: boolean; diff?: string }>>(new Map());
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queuedRef = useRef<QueuedMessage[]>([]);
  const processSubmitRef = useRef<(input: string, images: PastedImage[]) => Promise<void>>(async () => {});

  const isActive = status !== 'idle';

  // Sync queuedRef with state
  useEffect(() => {
    queuedRef.current = queuedMessages;
  }, [queuedMessages]);

  // Init session on mount
  useEffect(() => {
    async function init() {
      const config = configRef.current;
      await initSessionDir(config.sessionDir);
      const sp = newSessionPath(config.sessionDir);
      sessionPathRef.current = sp;
      messagesRef.current = await loadSession(sp);
    }
    init();
  }, []);

  // Sync refs to React state every 50ms during active turn
  useEffect(() => {
    if (status === 'idle') {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      return;
    }
    syncIntervalRef.current = setInterval(() => {
      setCurrentText(assistantTextRef.current);
      setCurrentTools([...toolsRef.current]);
    }, 50);
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [status]);

  const processNextQueued = useCallback(async () => {
    if (queuedRef.current.length === 0) return;

    const next = queuedRef.current[0];
    setQueuedMessages((q) => q.slice(1));

    await processSubmitRef.current!(next.input, next.images);
  }, []);

  const processSubmit = useCallback(async (input: string, images: PastedImage[]) => {
    const config = configRef.current;

    if (input.toLowerCase() === 'exit') {
      exit();
      return;
    }

    // Auto-detect skill mentions in user messages
    let skillContent: string | null = null;
    const detectedSkill = detectSkillMention(input);
    if (detectedSkill && detectedSkill !== activeSkill) {
      const skillPath = join(homedir(), '.agents', 'skills', detectedSkill, 'SKILL.md');
      try {
        skillContent = readFileSync(skillPath, 'utf-8');
        setActiveSkill(skillContent);
      } catch {
        // ignore load failures
      }
    }

    // Slash commands — handled locally, not sent to model
    if (config.slashCommands && input.startsWith('/')) {
      const ctx: CommandContext = {
        model: config.model,
        setModel: (m) => { config.model = m; },
        messages: messagesRef.current,
        clearMessages: () => { messagesRef.current = []; },
        sessionPath: sessionPathRef.current,
        activeSkill,
        setActiveSkill: (skill: string | null) => { setActiveSkill(skill); },
      };
      const result = await dispatch(input, ctx);
      if (result.handled) {
        if (result.clear) {
          setHistory([]);
          messagesRef.current = [];
        } else if (result.output) {
          setHistory((h) => [
            ...h,
            { role: 'user', content: input },
            { role: 'assistant', content: result.output! },
          ]);
        }
      }
      if (queuedRef.current.length > 0) {
        setTimeout(() => { void processNextQueued(); }, 0);
      }
      return;
    }

    // Build user message — with images as content array if any were pasted
    const hasImages = images.length > 0;
    let userMessage: ChatMessage;

    if (hasImages) {
      const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; imageUrl: string; detail: 'auto' }> = [];
      if (input.trim()) {
        content.push({ type: 'input_text', text: input.trim() });
      }
      for (const img of images) {
        content.push({
          type: 'input_image',
          imageUrl: `data:${img.mediaType};base64,${img.base64}`,
          detail: 'auto',
        });
      }
      userMessage = { role: 'user', content };
    } else {
      userMessage = { role: 'user', content: input };
    }

    messagesRef.current = [...messagesRef.current, userMessage];
    if (sessionPathRef.current) {
      await saveMessage(sessionPathRef.current, userMessage);
    }
    setHistory((h) => [...h, { role: 'user', content: input }]);
    setPendingImages([]);

    // Reset current turn state
    assistantTextRef.current = '';
    toolsRef.current = [];
    setCurrentText('');
    setCurrentTools([]);
    setCurrentReasoning('');
    setStatus('loading');

    const handleEvent = (event: AgentEvent) => {
      if (event.type === 'text') {
        setStatus('streaming');
        assistantTextRef.current += event.delta;
      } else if (event.type === 'tool_call') {
        setStatus('streaming');
        toolsRef.current = [...toolsRef.current, {
          type: 'tool_call',
          name: event.name,
          callId: event.callId,
          args: event.args,
        }];
      } else if (event.type === 'tool_result') {
        toolsRef.current = [...toolsRef.current, {
          type: 'tool_result',
          name: event.name,
          callId: event.callId,
          output: event.output,
        }];
      } else if (event.type === 'reasoning') {
        if (config.display.reasoning) {
          setStatus('streaming');
          setCurrentReasoning((r) => r + event.delta);
        }
      }
    };

    const handleToolResult = (data: { name: string; callId: string; output: unknown }) => {
      if (data.name === 'file_edit' || data.name === 'file_write') {
        const parsed = data.output as { success?: boolean; path?: string; replacements?: number; isNew?: boolean; diff?: string; error?: string };
        structuredDiffRef.current.set(data.callId, parsed);
      }
    };

    try {
      const result = await runAgentWithRetry(config, messagesRef.current, {
        onEvent: handleEvent,
        onToolResult: handleToolResult,
        skillInstructions: skillContent ?? activeSkill ?? undefined,
      });

      // Flush final state from refs
      setCurrentText(assistantTextRef.current);
      setCurrentTools([...toolsRef.current]);

      const assistantContent = assistantTextRef.current;
      const inT = result.usage?.inputTokens ?? 0;
      const outT = result.usage?.outputTokens ?? 0;
      const tokenLine = `${formatTokens(inT)} in · ${formatTokens(outT)} out`;

      // Save assistant message
      messagesRef.current = [...messagesRef.current, { role: 'assistant', content: assistantContent }];
      if (sessionPathRef.current) {
        await saveMessage(sessionPathRef.current, { role: 'assistant', content: assistantContent });
      }

      // Move to history — include tool snapshot so diffs persist
      // Merge structured diffs from structuredDiffRef into the tool events
      const toolsWithDiffs = toolsRef.current.map(tool => {
        if (tool.type === 'tool_result' && (tool.name === 'file_edit' || tool.name === 'file_write')) {
          const diffData = structuredDiffRef.current.get(tool.callId);
          return { ...tool, diffData };
        }
        return tool;
      });
      setHistory((h) => [...h, { role: 'assistant', content: assistantContent, tokens: tokenLine, tools: toolsWithDiffs }]);

      // Reset current turn
      setStatus('idle');
      assistantTextRef.current = '';
      toolsRef.current = [];
      structuredDiffRef.current = new Map();
      setCurrentText('');
      setCurrentTools([]);
      setCurrentReasoning('');

      // Process next queued message if any
      if (queuedRef.current.length > 0) {
        setTimeout(() => { void processNextQueued(); }, 0);
      }
    } catch (err: any) {
      setHistory((h) => [...h, { role: 'assistant', content: `Error: ${err.message}`, tools: [...toolsRef.current] }]);
      setStatus('idle');
      assistantTextRef.current = '';
      toolsRef.current = [];
      structuredDiffRef.current = new Map();
      setCurrentText('');
      setCurrentTools([]);
      setCurrentReasoning('');

      if (queuedRef.current.length > 0) {
        setTimeout(() => { void processNextQueued(); }, 0);
      }
    }
  }, [exit, processNextQueued, activeSkill]);

  // Make processSubmit available to processNextQueued via ref
  processSubmitRef.current = processSubmit;

  const handleSubmit = useCallback(async (input: string) => {
    if (isActive) {
      setQueuedMessages((q) => [...q, { input, images: pendingImages }]);
      setPendingImages([]);
      return;
    }

    await processSubmit(input, pendingImages);
  }, [isActive, pendingImages, processSubmit]);

  const handleImagePaste = useCallback((image: PastedImage) => {
    setPendingImages((prev) => [...prev, image]);
  }, []);

  return (
    <Box flexDirection="column">
      <Header model={configRef.current.model} slashCommands={configRef.current.slashCommands} activeSkill={activeSkill} />

      {/* History */}
      {history.map((turn, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          {turn.role === 'user' ? (
            <Box>
              <Text bold color="green">{'› '}</Text>
              <Text>{turn.content}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {turn.tools && turn.tools.length > 0 && (
                <ToolDisplay events={turn.tools} display={configRef.current.display} isActive={false} />
              )}
              <StreamingText text={turn.content} streaming={false} />
              {turn.tokens && (
                <Box marginTop={1}>
                  <Text dimColor>{`  ${turn.tokens}`}</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      ))}

      {/* Current turn */}
      {isActive && (currentText || currentTools.length > 0 || currentReasoning) && (
        <Box flexDirection="column">
          <ToolDisplay events={currentTools} display={configRef.current.display} isActive={true} />
          <StreamingText
            text={currentText}
            streaming={true}
            reasoning={currentReasoning}
            showReasoning={configRef.current.display.reasoning}
          />
        </Box>
      )}

      {/* Queued messages indicator */}
      {queuedMessages.length > 0 && (
        <Box marginBottom={1}>
          <Text dimColor>
            [{queuedMessages.length} queued message{queuedMessages.length > 1 ? 's' : ''}]
          </Text>
        </Box>
      )}

      {/* Loader above input */}
      {status === 'loading' && (
        <Box marginBottom={1}>
          <Loader text="RUMINATING" />
        </Box>
      )}

      <Box>
        <InputPrompt
          onSubmit={handleSubmit}
          onImagePaste={handleImagePaste}
          history={history.filter((t) => t.role === 'user').map((t) => t.content)}
        />
      </Box>
    </Box>
  );
}
