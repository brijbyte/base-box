import { isBare } from './resolve';

/** Map of package name -> version range, merged from a package.json. */
export type Deps = Record<string, string>;

/** Parse `dependencies` + `devDependencies` from a package.json source. */
export function parseDeps(json: string | undefined): Deps {
  if (json === undefined) return {};
  try {
    const pkg = JSON.parse(json);
    return { ...pkg?.devDependencies, ...pkg?.dependencies };
  } catch {
    return {};
  }
}

/** Split a bare specifier into its package name and subpath ("" or "/sub"). */
export function splitSpecifier(spec: string): {
  name: string;
  subpath: string;
} {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return { name, subpath: spec.slice(name.length) };
}

/**
 * Map a bare specifier to its esm.sh URL, pinning the version from package.json **in the
 * path** (`react` -> `esm.sh/react@18.3.1`). That alone dedupes: esm.sh routes every
 * pinned `react@18.3.1` — ours and the one react-dom imports internally — to the same
 * canonical `/react@18.3.1/es2022/react.mjs`, so there's one React instance across the
 * graph. We deliberately add NO query:
 *  - `?external=` makes esm.sh emit *bare* deep imports of a package's own internals
 *    (e.g. `@base-ui/react/combobox/root/AriaCombobox`) that our map can't resolve;
 *  - `?deps=` builds a divergent `X-…` variant whose `react.mjs` differs from the plain
 *    one react-dom imports — two React copies, broken hooks.
 * Deps absent from package.json stay unversioned, so a project without a package.json is
 * unaffected.
 */
export function esmUrl(spec: string, deps: Deps, cdn: string): string {
  const { name, subpath } = splitSpecifier(spec);
  const version = deps[name];
  const pkg = version ? `${name}@${version}` : name;
  return `${cdn}${pkg}${subpath}`;
}

/**
 * Build the import map for a set of files. Every bare specifier found in the
 * (transformed) sources maps to its esm.sh URL; additionally every declared dep gets a
 * bare entry (importable by name even if only used via a subpath) plus a trailing-slash
 * prefix entry so *any* deep subpath of it resolves — including ones we never lexed
 * (e.g. dynamic imports).
 */
export function buildImports(
  bareSpecifiers: Iterable<string>,
  deps: Deps,
  cdn: string
): Record<string, string> {
  const imports: Record<string, string> = {};
  for (const name of Object.keys(deps)) {
    const version = deps[name];
    const pkg = version ? `${name}@${version}` : name;
    imports[name] = esmUrl(name, deps, cdn);
    // Prefix mapping: `@base-ui/react/x/y` -> `<cdn>@base-ui/react@<ver>/x/y`.
    // The target must end in `/` with no query (the subpath is appended raw).
    imports[`${name}/`] = `${cdn}${pkg}/`;
  }
  for (const spec of bareSpecifiers) {
    if (isBare(spec)) imports[spec] = esmUrl(spec, deps, cdn);
  }
  return imports;
}
