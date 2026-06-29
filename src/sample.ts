import type { FileMap } from './types';

/** Default project shown when no `?files=` param is present: a React + TS app. */
export const SAMPLE: FileMap = {
  'index.html': `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>base-box preview</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
  'src/main.tsx': `import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
`,
  'src/App.tsx': `import { useState } from "react";

type Props = { start?: number };

export function App({ start = 0 }: Props) {
  const [count, setCount] = useState<number>(start);
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>base-box ⚡️</h1>
      <p>React + TypeScript, no backend, no bundler.</p>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
    </main>
  );
}
`,
};
