declare module 'marked-terminal' {
  import { TerminalRenderer as BaseTerminalRenderer } from 'marked';
  class TerminalRenderer extends BaseTerminalRenderer {}
  export default TerminalRenderer;
}
