import type { FileMap } from './types';

// Unicode-safe base64url <-> bytes helpers.
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Raw-deflate through the native (de)compression streams (Safari 16.4+).
async function pipe(
  bytes: Uint8Array,
  stream: GenericTransformStream
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const deflate = (bytes: Uint8Array) =>
  pipe(bytes, new CompressionStream('deflate-raw'));
const inflate = (bytes: Uint8Array) =>
  pipe(bytes, new DecompressionStream('deflate-raw'));

/** Encode a FileMap into a deflate-compressed URL-safe base64 string for `?files=`. */
export async function encodeFiles(files: FileMap): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(files));
  return bytesToBase64Url(await deflate(json));
}

/** Decode a deflate-compressed `?files=` back into a FileMap. Returns null on failure. */
export async function decodeFiles(param: string): Promise<FileMap | null> {
  try {
    const json = new TextDecoder().decode(
      await inflate(base64UrlToBytes(param))
    );
    const obj = JSON.parse(json);
    if (obj && typeof obj === 'object') return obj as FileMap;
    return null;
  } catch {
    return null;
  }
}

/** Read `?files=` from a URL's search string. */
export function filesFromUrl(
  search: string = location.search
): Promise<FileMap | null> {
  const param = new URLSearchParams(search).get('files');
  return param ? decodeFiles(param) : Promise.resolve(null);
}
