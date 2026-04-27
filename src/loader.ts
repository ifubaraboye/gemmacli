const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// Grayscale shimmer from dim to bright white and back
const SHIMMER_COLORS =[
  238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 
  248, 249, 250, 251, 252, 253, 254, 255, 255, 254, 
  253, 252, 251, 250, 249, 248, 247, 246, 245, 244, 
  243, 242, 241, 240, 239
];

export class Loader {
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private text: string;
  private onFrame: (text: string) => void;

  constructor(text: string, onFrame: (text: string) => void) {
    this.text = text;
    this.onFrame = onFrame;
  }

  start(): void {
    this.stop();
    this.frame = 0;
    process.stdout.write(HIDE_CURSOR);
    this.draw();
    // Faster interval for smooth gradient scrolling
    this.interval = setInterval(() => this.draw(), 40);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    process.stdout.write(SHOW_CURSOR);
    this.onFrame('\r\x1b[K'); // clear the line
  }

  private draw(): void {
    let out = '\r\x1b[K  ';
    
    // Apply scrolling shimmer color to each character
    for (let i = 0; i < this.text.length; i++) {
      // Offset controls the shimmer movement, spreading the gradient across the text
      const colorIdx = (this.frame + i * 2) % SHIMMER_COLORS.length;
      const colorCode = SHIMMER_COLORS[colorIdx];
      out += `\x1b[38;5;${colorCode}m${this.text[i]}`;
    }
    
    out += RESET;
    this.onFrame(out);
    this.frame++;
  }
}