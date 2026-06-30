import { zipSync, strToU8 } from 'fflate';
import type { FileMap } from './types';

/** Zip the (all-text) project files and trigger a browser download of `<name>.zip`. */
export function downloadZip(name: string, files: FileMap): void {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);

  const blob = new Blob([zipSync(entries)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
