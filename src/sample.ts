import type { FileMap } from './types';

// Stub files live as real files under `stubs/` (mirroring the project layout) and are
// pulled in as raw strings — easier to read/edit than inline escaped literals.
import indexHtml from '../stubs/index.html?raw';
import demoCss from '../stubs/demo.css?raw';
import packageJson from '../stubs/package.json?raw';
import appTsx from '../stubs/src/App.tsx?raw';
import indexTsx from '../stubs/src/index.tsx?raw';
import indexModuleCss from '../stubs/src/index.module.css?raw';

import vueIndexHtml from '../stubs-vue/index.html?raw';
import vueMainJs from '../stubs-vue/src/main.js?raw';
import vueApp from '../stubs-vue/src/App.vue?raw';
import vuePackageJson from '../stubs-vue/package.json?raw';

/** Default project shown when no `?files=` param is present: a Base UI Combobox demo. */
export const SAMPLE: FileMap = {
  'index.html': indexHtml,
  'src/App.tsx': appTsx,
  'src/index.tsx': indexTsx,
  'src/index.module.css': indexModuleCss,
  'package.json': packageJson,
  'demo.css': demoCss,
};

/** A minimal Vue 3 SFC starter (script-setup + scoped styles). */
export const VUE_SAMPLE: FileMap = {
  'index.html': vueIndexHtml,
  'src/main.js': vueMainJs,
  'src/App.vue': vueApp,
  'package.json': vuePackageJson,
};
