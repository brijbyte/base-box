import { Volume } from "memfs";
import type { FileMap } from "./types";

/** Strip leading "./" and "/", collapse, resolve "." / ".." — returns slash-free path. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

const abs = (p: string) => "/" + normalizePath(p);

/**
 * In-memory file system backed by `memfs` (a real Node-`fs` implementation).
 * Public paths are slash-free ("src/App.tsx"); memfs stores them absolute.
 */
export class MemFS {
  /** The underlying memfs Volume — exposes the full Node `fs` API when needed. */
  readonly vol: InstanceType<typeof Volume>;

  constructor(initial?: FileMap) {
    this.vol = new Volume();
    if (initial) this.load(initial);
  }

  load(map: FileMap): void {
    for (const [path, content] of Object.entries(map)) {
      this.write(path, content);
    }
  }

  read(path: string): string | undefined {
    try {
      return this.vol.readFileSync(abs(path), "utf8") as string;
    } catch {
      return undefined;
    }
  }

  write(path: string, content: string): void {
    const full = abs(path);
    const dir = full.slice(0, full.lastIndexOf("/")) || "/";
    this.vol.mkdirSync(dir, { recursive: true });
    this.vol.writeFileSync(full, content);
  }

  delete(path: string): boolean {
    try {
      this.vol.unlinkSync(abs(path));
      return true;
    } catch {
      return false;
    }
  }

  has(path: string): boolean {
    return this.vol.existsSync(abs(path));
  }

  list(): string[] {
    return Object.keys(this.vol.toJSON())
      .map((p) => normalizePath(p))
      .sort();
  }

  toJSON(): FileMap {
    const out: FileMap = {};
    for (const [p, content] of Object.entries(this.vol.toJSON())) {
      if (typeof content === "string") out[normalizePath(p)] = content;
    }
    return out;
  }
}
