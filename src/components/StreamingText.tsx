import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

marked.setOptions({
  renderer: new TerminalRenderer() as any,
});

export interface StreamingTextProps {
  text: string;
  streaming?: boolean;
  reasoning?: string;
  showReasoning?: boolean;
}

export function StreamingText({ text, streaming = false, reasoning, showReasoning }: StreamingTextProps) {
  const raw = streaming ? text : (marked(text) as string);
  const rendered = raw.replace(/\n+$/g, '');

  return (
    <Box flexDirection="column">
      {showReasoning && reasoning && (
        <Box>
          <Text dimColor>{reasoning}</Text>
        </Box>
      )}
      <Box>
        <Text>{rendered}</Text>
      </Box>
    </Box>
  );
}
