/**
 * Writing the sinks, and the staleness check.
 *
 * What rule this enforces: `emit --check` exits 3 — a code of its own, distinct from 1 (the code is
 * wrong) and 2 (the config is wrong). An agent reading exit 3 knows the fix is `archcheck emit`,
 * not an edit to any source file (LLD §6).
 *
 * What a caller must know: `check` re-emits into MEMORY and compares. It never writes, so running
 * it in CI cannot mask the drift it is meant to detect.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toPosix } from '../util/paths.js';
import type { SinkFile } from './merge.js';

export type EmitTarget = {
  /** Absolute path of the repository root. */
  root: string;
  /** Relative to root, e.g. `generated`. */
  generatedDir: string;
};

export type WrittenFile = { path: string; changed: boolean };

function absolutePathOf(target: EmitTarget, file: SinkFile): string {
  return join(target.root, target.generatedDir, file.path);
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function writeSinks(target: EmitTarget, files: readonly SinkFile[]): WrittenFile[] {
  const written: WrittenFile[] = [];
  for (const file of files) {
    const path = absolutePathOf(target, file);
    const existing = readOrNull(path);
    const changed = existing !== file.content;
    if (changed) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
    }
    written.push({ path: toPosix(join(target.generatedDir, file.path)), changed });
  }
  return written;
}

export type StaleFile = {
  path: string;
  /** `unreadable` is a document `manifest.docs` names that is not there — see `planEmit`. */
  reason: 'missing' | 'hand-edited' | 'unreadable';
};

export function checkSinks(target: EmitTarget, files: readonly SinkFile[]): StaleFile[] {
  const stale: StaleFile[] = [];
  for (const file of files) {
    const existing = readOrNull(absolutePathOf(target, file));
    const path = toPosix(join(target.generatedDir, file.path));
    if (existing === null) stale.push({ path, reason: 'missing' });
    else if (existing !== file.content) stale.push({ path, reason: 'hand-edited' });
  }
  return stale;
}

/** A Record over the reasons, so a new reason cannot be added without a sentence for it. */
const STALE_REASON: Record<StaleFile['reason'], string> = {
  missing: 'has never been generated',
  unreadable:
    'is named in docs but could not be read — create it with an archcheck fence, or drop it ' +
    'from the manifest',
  'hand-edited': 'does not match the manifest — it was hand-edited, or the manifest changed',
};

export function describeStale(stale: readonly StaleFile[]): string[] {
  return stale.map(({ path, reason }) => `${path} ${STALE_REASON[reason]}`);
}
