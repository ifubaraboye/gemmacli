import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import { writeFileSync } from 'fs';
import { SlashMenu } from './SlashMenu.js';
import { getCommandList } from '../commands.js';
import { getImageFromClipboard, readImageFile, isImageFilePath } from '../utils/clipboardImage.js';

export interface PastedImage {
  path: string;
  base64: string;
  mediaType: string;
}

export interface InputPromptProps {
  onSubmit: (input: string) => void;
  onImagePaste?: (image: PastedImage) => void;
  history?: string[];
}

export function InputPrompt({ onSubmit, onImagePaste, history = [] }: InputPromptProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [maxWidth, setMaxWidth] = useState(process.stdout.columns || 80);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const lastImageHash = useRef('');
  const lastPasteTime = useRef(0);
  const ignoreNextPaste = useRef(false);
  const nextImageId = useRef(1);

  const allCommands = useMemo(() => getCommandList(), []);

  const insertImagePlaceholder = useCallback(() => {
    const id = nextImageId.current++;
    const placeholder = `[Image #${id}]`;
    setValue((v) => {
      const next = v.slice(0, cursor) + placeholder + v.slice(cursor);
      return next;
    });
    setCursor((c) => c + placeholder.length);
  }, [cursor]);

  const handleClipboardImage = useCallback(async (): Promise<boolean> => {
    if (!onImagePaste) return false;

    try {
      const image = await getImageFromClipboard();
      if (!image) return false;

      const now = Date.now();
      const hash = image.base64.slice(0, 64);
      if (hash === lastImageHash.current && now - lastPasteTime.current < 500) {
        return true;
      }
      lastImageHash.current = hash;
      lastPasteTime.current = now;

      onImagePaste(image);
      insertImagePlaceholder();
      return true;
    } catch {
      return false;
    }
  }, [onImagePaste, insertImagePlaceholder]);

  const filteredCommands = useMemo(() => {
    if (!menuOpen || !value.startsWith('/')) return [];
    const query = value.slice(1).toLowerCase();
    return allCommands.filter((c) => c.name.toLowerCase().startsWith(query));
  }, [menuOpen, value, allCommands]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  useEffect(() => {
    const handler = () => setMaxWidth(process.stdout.columns || 80);
    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
  }, []);

  usePaste((pasted: string) => {
    if (ignoreNextPaste.current) {
      ignoreNextPaste.current = false;
      return;
    }

    const trimmed = pasted.trim();

    if (onImagePaste && trimmed.startsWith('data:image/')) {
      const match = trimmed.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (match) {
        const now = Date.now();
        const base64Data = match[2];
        const hash = base64Data.slice(0, 64);
        if (hash === lastImageHash.current && now - lastPasteTime.current < 500) {
          return;
        }
        lastImageHash.current = hash;
        lastPasteTime.current = now;

        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const data = Buffer.from(base64Data, 'base64');
        const tmpFile = `/tmp/gemmacli-paste-${Date.now()}.${ext}`;
        writeFileSync(tmpFile, data);
        onImagePaste({ path: tmpFile, base64: base64Data, mediaType: `image/${match[1]}` });
        insertImagePlaceholder();
        return;
      }
    }

    if (onImagePaste && isImageFilePath(trimmed)) {
      void readImageFile(trimmed).then((image) => {
        if (image) {
          const now = Date.now();
          const hash = image.base64.slice(0, 64);
          if (hash === lastImageHash.current && now - lastPasteTime.current < 500) {
            return;
          }
          lastImageHash.current = hash;
          lastPasteTime.current = now;
          onImagePaste(image);
          insertImagePlaceholder();
        }
      });
      return;
    }

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
    // Ctrl+V (or Cmd+V on macOS): try to paste image from clipboard
    if ((key.ctrl || key.meta) && input.toLowerCase() === 'v') {
      void handleClipboardImage().then((handled) => {
        if (handled) {
          ignoreNextPaste.current = true;
          setTimeout(() => { ignoreNextPaste.current = false; }, 100);
        }
      });
      return;
    }

    if (key.escape) {
      if (menuOpen) {
        setMenuOpen(false);
      }
      return;
    }

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
        nextImageId.current = 1;
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

  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const charAtCursor = after[0] || ' ';

  return (
    <Box flexDirection="column">
      <Text color="gray">{border}</Text>
      <Box>
        <Text>
          {'› '}{before}
          <Text inverse color="white">{charAtCursor}</Text>
          {after.slice(1)}
        </Text>
      </Box>
      <Text color="gray">{border}</Text>
      {menuOpen && (
        <SlashMenu
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          maxWidth={maxWidth}
        />
      )}
    </Box>
  );
}
