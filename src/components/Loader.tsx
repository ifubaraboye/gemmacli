import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

const frames = ['■', '□', '▪', '▫'];
const interval = 120;

export interface LoaderProps {
  text?: string;
}

export function Loader({ text = 'RUMINATING' }: LoaderProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box marginLeft={2}>
      <Text color="cyan">{frames[frame]}</Text>
      <Text color="gray"> {text}</Text>
    </Box>
  );
}
