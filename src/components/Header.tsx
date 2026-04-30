import React from 'react';
import { Box, Text } from 'ink';

export interface HeaderProps {
  model: string;
  slashCommands: boolean;
  activeSkill?: string | null;
}

export function Header({ model, slashCommands, activeSkill }: HeaderProps) {
  const width = Math.min(process.stdout.columns || 60, 60);
  const line = '─'.repeat(width);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="gray">{line}</Text>
      <Box>
        <Text bold> GEMMACLI</Text>
        <Text dimColor> v0.0.1</Text>
        {activeSkill && (
          <Text color="orange">  [skill active]</Text>
        )}
      </Box>
      <Box>
        <Text dimColor> model </Text>
        <Text color="cyan">{model}</Text>
      </Box>
      {slashCommands && (
        <Box>
          <Text dimColor> /help for commands</Text>
        </Box>
      )}
      <Text color="gray">{line}</Text>
    </Box>
  );
}
