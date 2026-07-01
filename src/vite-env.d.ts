/// <reference types="vite/client" />

// agentic-ui exposes CSS bundles at extensionless subpaths (e.g. `/tokens`,
// `/reset`) that resolve to .css files; declare them as side-effect modules.
declare module '@brijbyte/agentic-ui/tokens';
declare module '@brijbyte/agentic-ui/reset';
declare module '@brijbyte/agentic-ui/styles';
declare module '@brijbyte/agentic-ui/layer-order';
