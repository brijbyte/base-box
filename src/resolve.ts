import type { MemFS } from './fs';
import { normalizePath } from './fs';

const EXTS = [
  '',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.vue',
];
const INDEX = ['index.js', 'index.ts', 'index.tsx', 'index.jsx', 'index.mjs'];

/** A bare specifier points at an npm package (not "./", "../", "/", or a URL). */
export function isBare(spec: string): boolean {
  return !/^(\.{0,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(spec);
}

/**
 * Resolve a relative/absolute specifier against the FS using Node-style
 * extension and directory (index) resolution. Returns a slash-free FS path.
 */
export function resolveRelative(
  fromPath: string,
  spec: string,
  fs: MemFS
): string | null {
  const dir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  const base = spec.startsWith('/') ? spec : `${dir}/${spec}`;
  const target = normalizePath(base);

  // 1. exact / with extension
  for (const ext of EXTS) {
    const candidate = normalizePath(target + ext);
    if (fs.has(candidate)) return candidate;
  }
  // 2. directory index
  for (const idx of INDEX) {
    const candidate = normalizePath(`${target}/${idx}`);
    if (fs.has(candidate)) return candidate;
  }
  return null;
}
