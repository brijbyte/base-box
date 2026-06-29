import type { FileMap } from "./types";

// Unicode-safe base64url <-> bytes helpers.
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a FileMap into a URL-safe base64 string for `?files=`. */
export function encodeFiles(files: FileMap): string {
  const json = JSON.stringify(files);
  return bytesToBase64Url(new TextEncoder().encode(json));
}

/** Decode `?files=` back into a FileMap. Returns null on failure. */
export function decodeFiles(param: string): FileMap | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(param));
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object") return obj as FileMap;
    return null;
  } catch {
    return null;
  }
}

/** Read `?files=` from a URL's search string. */
export function filesFromUrl(search: string = location.search): FileMap | null {
  const param = new URLSearchParams(search).get("files");
  return param ? decodeFiles(param) : null;
}
