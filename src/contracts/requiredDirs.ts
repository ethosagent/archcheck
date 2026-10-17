import { unitOf } from './siblings.js';

const DIR_SELECTOR = /^dir\[(.+)\]$/;

// Returns true if forEach is a dir selector
export function isDirSelector(forEach: string): boolean {
  return DIR_SELECTOR.test(forEach);
}

// Extracts the glob pattern from a dir selector
export function dirGlobOf(forEach: string): string | undefined {
  return DIR_SELECTOR.exec(forEach)?.[1];
}

// Finds unique sorted directories matching dirGlob that contain files
export function dirsOf(dirGlob: string, files: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = unitOf(dirGlob, file);
    if (dir !== undefined) {
      dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

// Expands template placeholders with directory path components
export function expandForDir(template: string, dir: string): string {
  const lastSlash = dir.lastIndexOf('/');
  const dirname = lastSlash === -1 ? dir : dir.slice(lastSlash + 1);
  const parent = lastSlash === -1 ? '' : dir.slice(0, lastSlash);

  return template
    .replaceAll('{dirname}', dirname)
    .replaceAll('{parent}', parent)
    .replaceAll('{dir}', dir);
}
