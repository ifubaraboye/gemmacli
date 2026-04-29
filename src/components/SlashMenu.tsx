import React from 'react';
import { Box, Text } from 'ink';

export interface CommandMeta {
  name: string;
  description: string;
}

export interface SlashMenuProps {
  commands: CommandMeta[];
  selectedIndex: number;
  maxWidth?: number;
}

export function SlashMenu({ commands, selectedIndex, maxWidth = 80 }: SlashMenuProps) {
  if (commands.length === 0) return null;

  const nameWidth = Math.max(...commands.map((c) => c.name.length)) + 1; // +1 for leading /
  const descMaxWidth = Math.max(20, maxWidth - nameWidth - 4);

  return (
    <Box flexDirection="column" marginTop={0} marginLeft={2}>
      {commands.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const desc = cmd.description.length > descMaxWidth
          ? cmd.description.slice(0, descMaxWidth - 1) + '…'
          : cmd.description;

        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
              {isSelected ? '› ' : '  '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
              {`/${cmd.name}`}
            </Text>
            <Box marginLeft={2}>
              <Text color={isSelected ? 'cyan' : 'gray'} dimColor={!isSelected}>
                {desc}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
