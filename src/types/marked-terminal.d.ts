declare module 'marked-terminal' {
  import { TerminalRenderer as BaseTerminalRenderer } from 'marked';
  class TerminalRenderer extends BaseTerminalRenderer {}
  export default TerminalRenderer;
}

declare module 'clipboardy' {
  interface ClipboardImage {
    data: Buffer;
    format: string;
  }

  function read(): Promise<string>;
  function write(text: string): Promise<void>;
  function readSync(): string;
  function writeSync(text: string): void;
  function readImages(): Promise<ClipboardImage[]>;
  function writeImages(images: ClipboardImage[]): Promise<void>;
  function hasImages(): Promise<boolean>;

  export default {
    read,
    write,
    readSync,
    writeSync,
    readImages,
    writeImages,
    hasImages,
  };
}
