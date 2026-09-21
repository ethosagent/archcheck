/**
 * The filesystem, behind one interface.
 *
 * What rule this enforces: the same twin discipline archcheck asks of its consumers. The memory
 * implementation is what lets the structure tests run without touching disk, and the conformance
 * test runs BOTH implementations against one fixture and asserts identical findings — which is
 * the only thing that proves the twin is a twin rather than a second, subtly different tool.
 *
 * What a caller must know: every path is repo-relative POSIX, in and out. The Node implementation
 * holds the one absolute root; nothing above this layer ever sees one.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from '../util/glob.js';
import { toPosix } from '../util/paths.js';

export type FileSystem = {
  /** Repo-relative POSIX path. */
  exists(path: string): boolean;
  /** Returns undefined rather than throwing — a missing file is an answer, not a failure. */
  read(path: string): string | undefined;
  /** Repo-relative POSIX paths matching the globs, sorted. */
  glob(patterns: string | string[]): string[];
};

const IGNORED = new Set(['node_modules', '.git', 'dist', '.archcheck']);

export function createNodeFileSystem(root: string): FileSystem {
  let listing: string[] | undefined;

  const walk = (): string[] => {
    if (listing) return listing;
    const out: string[] = [];
    const visit = (relative: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(join(root, relative));
      } catch {
        return; // an unreadable directory is empty as far as a rule is concerned
      }
      for (const entry of entries) {
        if (IGNORED.has(entry)) continue;
        const next = relative === '' ? entry : `${relative}/${entry}`;
        try {
          if (statSync(join(root, next)).isDirectory()) visit(next);
          else out.push(next);
        } catch {
          // a vanished entry between readdir and stat is simply not there
        }
      }
    };
    visit('');
    listing = out.sort();
    return listing;
  };

  return {
    exists: (path) => existsSync(join(root, toPosix(path))),
    read: (path) => {
      try {
        return readFileSync(join(root, toPosix(path)), 'utf8');
      } catch {
        return undefined;
      }
    },
    glob: (patterns) => {
      const globs = typeof patterns === 'string' ? [patterns] : patterns;
      return walk().filter((path) => matchesAny(globs, path));
    },
  };
}

/** The twin. Same contract, no disk. */
export function createMemoryFileSystem(files: Record<string, string>): FileSystem {
  const paths = Object.keys(files).sort();
  return {
    exists: (path) => Object.hasOwn(files, toPosix(path)),
    read: (path) => files[toPosix(path)],
    glob: (patterns) => {
      const globs = typeof patterns === 'string' ? [patterns] : patterns;
      return paths.filter((path) => matchesAny(globs, path));
    },
  };
}
