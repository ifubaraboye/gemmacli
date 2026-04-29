import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const GRAY_SCALE = [240, 245, 250, 255, 250, 245];

function gradientLine(text: string, frame: number): string {
  return text
    .split('')
    .map((char, i) => {
      const colorIndex = (i + frame) % GRAY_SCALE.length;
      const color = GRAY_SCALE[colorIndex];
      return `\x1b[38;5;${color}m${char}`;
    })
    .join('');
}

export interface LoaderProps {
  text?: string;
}

export function Loader({ text = 'RUMINATING' }: LoaderProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 150);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box marginLeft={2}>
      <Text>{gradientLine(text, frame) + '\x1b[0m'}</Text>
    </Box>
  );
}
