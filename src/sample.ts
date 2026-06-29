import type { FileMap } from './types';

// Stub files live as real files under `stubs/` (mirroring the project layout) and are
// pulled in as raw strings — easier to read/edit than inline escaped literals.
import indexHtml from '../stubs/index.html?raw';
import demoCss from '../stubs/demo.css?raw';
import packageJson from '../stubs/package.json?raw';
import mainTsx from '../stubs/src/main.tsx?raw';
import appTsx from '../stubs/src/App.tsx?raw';
import indexTsx from '../stubs/src/index.tsx?raw';
import indexModuleCss from '../stubs/src/index.module.css?raw';

/** Default project shown when no `?files=` param is present: a Base UI Combobox demo. */
export const SAMPLE: FileMap = {
  'index.html': indexHtml,
  'src/main.tsx': mainTsx,
  'src/App.tsx': appTsx,
  'src/index.tsx': indexTsx,
  'src/index.module.css': indexModuleCss,
  'package.json': packageJson,
  'demo.css': demoCss,
};
