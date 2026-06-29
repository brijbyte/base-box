/// <reference lib="webworker" />
// A CSS/SCSS/LESS language server in a web worker, built on `vscode-css-languageservice`
// (the same engine VS Code uses) wrapped in a tiny LSP server. Unlike the TS worker (§21)
// it's fully self-contained — no CDN/wasm — so it's small and boots instantly. Comlink owns
// `self` for control (`init`); LSP JSON-RPC runs over the transferred MessagePort.
import * as Comlink from 'comlink';
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
} from 'vscode-languageserver/browser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  getCSSLanguageService,
  getSCSSLanguageService,
  getLESSLanguageService,
  type LanguageService,
} from 'vscode-css-languageservice';

// One service per dialect; the LSP `languageId` (set on didOpen) picks the parser/grammar.
const services: Record<string, LanguageService> = {
  css: getCSSLanguageService(),
  scss: getSCSSLanguageService(),
  less: getLESSLanguageService(),
};
const serviceFor = (languageId: string) => services[languageId] ?? services.css;

function startLsp(port: MessagePort) {
  const connection = createConnection(
    new BrowserMessageReader(port),
    new BrowserMessageWriter(port)
  );
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['.', '#', ':', '-', '(', '/', '@', '!'],
      },
      hoverProvider: true,
    },
  }));

  // Validation is per-document — push diagnostics on every change (CM only renders pushed).
  const validate = (doc: TextDocument) => {
    const ls = serviceFor(doc.languageId);
    const diagnostics = ls.doValidation(doc, ls.parseStylesheet(doc));
    void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  };
  documents.onDidChangeContent((e) => validate(e.document));

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const ls = serviceFor(doc.languageId);
    return ls.doComplete(doc, params.position, ls.parseStylesheet(doc));
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const ls = serviceFor(doc.languageId);
    return ls.doHover(doc, params.position, ls.parseStylesheet(doc));
  });

  documents.listen(connection);
  connection.listen();
}

const workerApi = {
  /** Boot the LSP over the transferred MessagePort. CSS needs no file-map sync. */
  init(port: MessagePort) {
    startLsp(port);
  },
};

export type CssWorkerApi = typeof workerApi;

Comlink.expose(workerApi);
