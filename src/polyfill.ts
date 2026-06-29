// memfs (and other node libs) expect a global Buffer in the browser/worker.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
