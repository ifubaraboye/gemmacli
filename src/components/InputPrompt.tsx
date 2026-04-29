import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import { SlashMenu } from './SlashMenu.js';
import { getCommandList, type CommandMeta } from '../commands.js';

export interface InputPromptProps {
  onSubmit: (input: string) => void;
  disabled?: boolean;
  lastValue?: string;
  history?: string[];
}

export function InputPrompt({ onSubmit, disabled, lastValue = '', history = [] }: InputPromptProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [maxWidth, setMaxWidth] = useState(process.stdout.columns || 80);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');

  const allCommands = useMemo(() => getCommandList(), []);

  const filteredCommands = useMemo(() => {
    if (!menuOpen || !value.startsWith('/')) return [];
    const query = value.slice(1).toLowerCase();
    return allCommands.filter((c) => c.name.toLowerCase().startsWith(query));
  }, [menuOpen, value, allCommands]);

  // Update selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Update max width on resize
  useEffect(() => {
    const handler = () => setMaxWidth(process.stdout.columns || 80);
    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
  }, []);

  usePaste((pasted: string) => {
    if (disabled) return;
    setValue((v) => {
      const next = v.slice(0, cursor) + pasted + v.slice(cursor);
      if (next === '/') {
        setMenuOpen(true);
      } else if (!next.startsWith('/')) {
        setMenuOpen(false);
      }
      return next;
    });
    setCursor((c) => c + pasted.length);
  });

  useInput((input, key) => {
    if (disabled) return;

    if (key.escape) {
      if (menuOpen) {
        setMenuOpen(false);
      }
      return;
    }

    // History cycling with up/down when menu is closed
    if (!menuOpen && history.length > 0) {
      if (key.upArrow) {
        const nextIndex = historyIndex + 1;
        if (nextIndex <= history.length - 1) {
          if (historyIndex === -1) setDraft(value);
          const prev = history[history.length - 1 - nextIndex];
          setValue(prev);
          setCursor(prev.length);
          setHistoryIndex(nextIndex);
        }
        return;
      }
      if (key.downArrow) {
        const nextIndex = historyIndex - 1;
        if (nextIndex >= -1) {
          if (nextIndex === -1) {
            setValue(draft);
            setCursor(draft.length);
          } else {
            const prev = history[history.length - 1 - nextIndex];
            setValue(prev);
            setCursor(prev.length);
          }
          setHistoryIndex(nextIndex);
        }
        return;
      }
    }

    if (menuOpen && filteredCommands.length > 0) {
      if (key.upArrow) {
        setSelectedIndex((i) => (i <= 0 ? filteredCommands.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => (i >= filteredCommands.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.return || key.tab) {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          const newValue = `/${cmd.name} `;
          setValue(newValue);
          setCursor(newValue.length);
          setMenuOpen(false);
        }
        return;
      }
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue('');
        setCursor(0);
        setMenuOpen(false);
        setHistoryIndex(-1);
        setDraft('');
      }
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }

    if (key.backspace) {
      if (cursor === 0) return;
      setValue((v) => {
        const next = v.slice(0, cursor - 1) + v.slice(cursor);
        if (!next.startsWith('/')) setMenuOpen(false);
        else if (next === '/') setMenuOpen(true);
        return next;
      });
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.delete) {
      if (cursor >= value.length) return;
      setValue((v) => {
        const next = v.slice(0, cursor) + v.slice(cursor + 1);
        if (!next.startsWith('/')) setMenuOpen(false);
        else if (next === '/') setMenuOpen(true);
        return next;
      });
      return;
    }

    if (key.ctrl && input === 'c') {
      // let Ink handle exit
      return;
    }

    if (!key.ctrl && !key.meta && input.length === 1) {
      setValue((v) => {
        const next = v.slice(0, cursor) + input + v.slice(cursor);
        if (next === '/') {
          setMenuOpen(true);
        } else if (!next.startsWith('/')) {
          setMenuOpen(false);
        }
        return next;
      });
      setCursor((c) => c + 1);
    }
  });

  const width = maxWidth;
  const border = '─'.repeat(width);

  // Split value at cursor for rendering
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const charAtCursor = after[0] || ' ';

  return (
    <Box flexDirection="column">
      <Text color="gray">{border}</Text>
      <Box>
        {disabled ? (
          <Text dimColor>{'› '}{lastValue}</Text>
        ) : (
          <Text>
            {'› '}{before}
            <Text inverse color="white">{charAtCursor}</Text>
            {after.slice(1)}
          </Text>
        )}
      </Box>
      <Text color="gray">{border}</Text>
      {!disabled && menuOpen && (
        <SlashMenu
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          maxWidth={maxWidth}
        />
      )}
    </Box>
  );
}
