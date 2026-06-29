/// <reference lib="webworker" />
// A TypeScript language server running in a web worker, built on Volar's browser
// language server. The TS engine + lib.d.ts + npm package types are all fetched from
// jsdelivr on demand (@volar/jsdelivr); the project's own files are served from an
// in-memory map synced from the main thread.
//
// Two channels share this worker:
//   - LSP JSON-RPC runs over a dedicated MessagePort (so `self` stays free).
//   - File sync ("init"/"sync") arrives on `self.onmessage`.
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser';
import {
  createServer,
  createTypeScriptProject,
  loadTsdkByUrl,
} from '@volar/language-server/browser';
import { create as createTsServices } from 'volar-service-typescript';
import { createNpmFileSystem } from '@volar/jsdelivr';
import type { FileSystem, FileType } from '@volar/language-service';
import { URI } from 'vscode-uri';

// Pin a Volar-2.4-compatible TS; lib.d.ts is read from this same package on jsdelivr.
const TS_VERSION = '5.6.3';
const TSDK_URL = `https://cdn.jsdelivr.net/npm/typescript@${TS_VERSION}/lib`;

// Default compiler options when the project has no tsconfig.json.
const DEFAULT_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    allowJs: true,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
  },
});

const F_FILE = 1 satisfies FileType;
const F_DIR = 2 satisfies FileType;

let files: Record<string, string> = {};
let deps: Record<string, string> = {};

/** Merge dependencies + devDependencies from a package.json string (versions only). */
function parseDeps(pkgJson?: string): Record<string, string> {
  try {
    const p = JSON.parse(pkgJson ?? '{}');
    return { ...p.devDependencies, ...p.dependencies };
  } catch {
    return {};
  }
}

/**
 * Pin a dep to an EXACT version for jsdelivr, else undefined → it resolves `latest`.
 * The jsdelivr FS only resolves the tag `latest`; a range like `^18` is sent verbatim
 * to `/flat` and 404s (and TS then can't find e.g. `react/jsx-runtime`).
 */
function exactVersion(range?: string): string | undefined {
  const v = range?.replace(/^[\^~]/, '');
  return v && /^\d+\.\d+\.\d+/.test(v) ? v : undefined;
}

/** Strip a leading slash so `/src/App.tsx` matches the `src/App.tsx` map keys. */
const relOf = (uri: URI) => uri.path.replace(/^\/+/, '');

/** Read project files from the synced map; `tsconfig.json` falls back to a default. */
const projectFs: FileSystem = {
  stat(uri) {
    const rel = relOf(uri);
    if (
      rel in files ||
      (rel === 'tsconfig.json' && !('tsconfig.json' in files))
    )
      return {
        type: F_FILE,
        ctime: 0,
        mtime: 0,
        size: files[rel]?.length ?? 0,
      };
    const prefix = rel === '' ? '' : rel + '/';
    if (Object.keys(files).some((f) => f.startsWith(prefix)))
      return { type: F_DIR, ctime: 0, mtime: 0, size: 0 };
    return undefined;
  },
  readFile(uri) {
    const rel = relOf(uri);
    if (rel === 'tsconfig.json' && !('tsconfig.json' in files))
      return DEFAULT_TSCONFIG;
    return files[rel];
  },
  readDirectory(uri) {
    const prefix = relOf(uri) === '' ? '' : relOf(uri) + '/';
    const seen = new Map<string, FileType>();
    for (const f of Object.keys(files)) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) seen.set(rest, F_FILE);
      else seen.set(rest.slice(0, slash), F_DIR);
    }
    return [...seen.entries()];
  },
};

const isNodeModules = (uri: URI) =>
  uri.path === '/node_modules' || uri.path.startsWith('/node_modules/');

/** node_modules (lib.d.ts + npm types) → jsdelivr; everything else → the project map. */
function compositeFs(npmFs: FileSystem): FileSystem {
  return {
    stat: (uri) => (isNodeModules(uri) ? npmFs.stat(uri) : projectFs.stat(uri)),
    readFile: (uri) =>
      isNodeModules(uri) ? npmFs.readFile(uri) : projectFs.readFile(uri),
    readDirectory: (uri) =>
      isNodeModules(uri)
        ? npmFs.readDirectory(uri)
        : projectFs.readDirectory(uri),
  };
}

let serverRef: ReturnType<typeof createServer> | null = null;

function startLsp(port: MessagePort) {
  const connection = createConnection(
    new BrowserMessageReader(port),
    new BrowserMessageWriter(port)
  );
  const server = createServer(connection);
  serverRef = server;

  connection.onInitialize(async (params) => {
    // CM's lsp-client advertises pull-diagnostics but never pulls — it only renders
    // pushed `publishDiagnostics`. Drop the capability so Volar pushes instead.
    delete params.capabilities.textDocument?.diagnostic;
    // params.locale is undefined here; 'en' avoids a 404 for localized messages.
    const tsdk = await loadTsdkByUrl(TSDK_URL, params.locale || 'en');
    // Pin `typescript` (lib.d.ts) to our engine; other pkgs follow package.json (else latest).
    const npmFs = createNpmFileSystem(
      undefined,
      (pkg) => (pkg === 'typescript' ? TS_VERSION : exactVersion(deps[pkg])),
      undefined
    );
    server.fileSystem.install('file', compositeFs(npmFs));
    return server.initialize(
      params,
      createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
        languagePlugins: [],
      })),
      createTsServices(tsdk.typescript)
    );
  });
  connection.onInitialized(() => server.initialized());
  connection.onShutdown(() => server.shutdown());
  connection.listen();
}

self.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d?.type === 'init') {
    files = d.files ?? {};
    deps = parseDeps(files['package.json']);
    startLsp(d.port as MessagePort);
  } else if (d?.type === 'sync') {
    files = d.files ?? {};
    deps = parseDeps(files['package.json']);
    // Non-open files changed (add/rename/delete) → re-validate open docs.
    serverRef?.languageFeatures.requestRefresh(false).catch(() => {});
  }
};
