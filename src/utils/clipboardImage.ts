import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

const TMP_DIR = process.env.GEMMACLI_TMPDIR || tmpdir();

function getTempPath(ext = 'png'): string {
  return join(TMP_DIR, `gemmacli-paste-${Date.now()}.${ext}`);
}

async function runCommand(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 5000 });
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    return { stdout: '', stderr: err?.stderr || '', code: err?.code ?? 1 };
  }
}

type Platform = 'darwin' | 'linux' | 'win32';

function getPlatform(): Platform {
  return process.platform as Platform;
}

function isWayland(): boolean {
  return !!process.env.WAYLAND_DISPLAY;
}

export type ClipboardImage = {
  path: string;
  base64: string;
  mediaType: string;
};

/**
 * Check if the clipboard currently contains an image.
 */
export async function hasImageInClipboard(): Promise<boolean> {
  const platform = getPlatform();

  if (platform === 'linux') {
    if (isWayland()) {
      const result = await runCommand('wl-paste -l 2>/dev/null | grep -qE "image/(png|jpeg|jpg|gif|webp|bmp)"');
      return result.code === 0;
    }
    const result = await runCommand('xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -qE "image/(png|jpeg|jpg|gif|webp|bmp)"');
    return result.code === 0;
  }

  if (platform === 'darwin') {
    const result = await runCommand(`osascript -e 'the clipboard as «class PNGf»'`);
    return result.code === 0;
  }

  if (platform === 'win32') {
    const result = await runCommand('powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"');
    return result.stdout.trim().toLowerCase() === 'true';
  }

  return false;
}

/**
 * Read image data from the system clipboard and save to a temporary file.
 * Returns the temp file path, base64 string, and detected media type.
 */
export async function getImageFromClipboard(): Promise<ClipboardImage | null> {
  const platform = getPlatform();
  const tmpPath = getTempPath('png');

  try {
    if (platform === 'linux') {
      let saved = false;

      if (isWayland()) {
        // Try PNG first, then BMP
        const pngResult = await runCommand(`wl-paste --type image/png > "${tmpPath}" 2>/dev/null`);
        if (pngResult.code === 0 && existsSync(tmpPath)) {
          saved = true;
        } else {
          const bmpResult = await runCommand(`wl-paste --type image/bmp > "${tmpPath}" 2>/dev/null`);
          if (bmpResult.code === 0 && existsSync(tmpPath)) {
            saved = true;
          }
        }
      }

      if (!saved) {
        // Fallback to xclip
        const pngResult = await runCommand(`xclip -selection clipboard -t image/png -o > "${tmpPath}" 2>/dev/null`);
        if (pngResult.code === 0 && existsSync(tmpPath)) {
          saved = true;
        } else {
          const bmpResult = await runCommand(`xclip -selection clipboard -t image/bmp -o > "${tmpPath}" 2>/dev/null`);
          if (bmpResult.code === 0 && existsSync(tmpPath)) {
            saved = true;
          }
        }
      }

      if (!saved) return null;
    } else if (platform === 'darwin') {
      const result = await runCommand(
        `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${tmpPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`
      );
      if (result.code !== 0 || !existsSync(tmpPath)) return null;
    } else if (platform === 'win32') {
      const result = await runCommand(
        `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${tmpPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`
      );
      if (result.code !== 0 || !existsSync(tmpPath)) return null;
    } else {
      return null;
    }

    // Read the saved image
    const buffer = readFileSync(tmpPath);
    if (buffer.length === 0) {
      unlinkSync(tmpPath);
      return null;
    }

    // Detect format from magic bytes
    const mediaType = detectImageFormat(buffer);

    // BMP is not supported by most APIs — we should convert, but for now just warn
    // (We already try PNG first above, so this is unlikely)

    const base64 = buffer.toString('base64');

    return { path: tmpPath, base64, mediaType };
  } catch {
    // Cleanup on error
    try { unlinkSync(tmpPath); } catch {}
    return null;
  }
}

/**
 * Detect image format from magic bytes and return the MIME type.
 */
function detectImageFormat(buffer: Buffer): string {
  if (buffer.length < 4) return 'image/png';

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'image/webp';
    }
  }

  // BMP: BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  return 'image/png';
}

/**
 * Check if pasted text is a file path to an image.
 */
export function isImageFilePath(text: string): boolean {
  const trimmed = text.trim();
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(unquoted);
}

/**
 * Try to read an image file from a path.
 */
export async function readImageFile(filePath: string): Promise<ClipboardImage | null> {
  try {
    const cleanPath = filePath.trim().replace(/^["']|["']$/g, '');
    const buffer = readFileSync(cleanPath);
    if (buffer.length === 0) return null;

    const mediaType = detectImageFormat(buffer);
    const base64 = buffer.toString('base64');

    return { path: cleanPath, base64, mediaType };
  } catch {
    return null;
  }
}
