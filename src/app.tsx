import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
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
};

type QueuedMessage = {
  input: string;
  images: PastedImage[];
};

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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

  const sessionPathRef = useRef('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const assistantTextRef = useRef('');
  const toolsRef = useRef<ToolEvent[]>([]);
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

    // Slash commands — handled locally, not sent to model
    if (config.slashCommands && input.startsWith('/')) {
      const ctx: CommandContext = {
        model: config.model,
        setModel: (m) => { config.model = m; },
        messages: messagesRef.current,
        clearMessages: () => { messagesRef.current = []; },
        sessionPath: sessionPathRef.current,
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

    try {
      const result = await runAgentWithRetry(config, messagesRef.current, { onEvent: handleEvent });

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

      // Move to history
      setHistory((h) => [...h, { role: 'assistant', content: assistantContent, tokens: tokenLine }]);

      // Reset current turn
      setStatus('idle');
      assistantTextRef.current = '';
      toolsRef.current = [];
      setCurrentText('');
      setCurrentTools([]);
      setCurrentReasoning('');

      // Process next queued message if any
      if (queuedRef.current.length > 0) {
        setTimeout(() => { void processNextQueued(); }, 0);
      }
    } catch (err: any) {
      setHistory((h) => [...h, { role: 'assistant', content: `Error: ${err.message}` }]);
      setStatus('idle');
      assistantTextRef.current = '';
      toolsRef.current = [];
      setCurrentText('');
      setCurrentTools([]);
      setCurrentReasoning('');

      if (queuedRef.current.length > 0) {
        setTimeout(() => { void processNextQueued(); }, 0);
      }
    }
  }, [exit, processNextQueued]);

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
      <Header model={configRef.current.model} slashCommands={configRef.current.slashCommands} />

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
          <ToolDisplay events={currentTools} display={configRef.current.display} />
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
