/**
 * The registry — the only thing that knows a rule exists.
 *
 * What rule this enforces: coverage is computed, never stored (plan 03). The three counts come
 * from counting the manifest at load time, so nobody can claim a number the manifest does not
 * support. If someone adds a rule with no real check, the model count goes up and the percentage
 * drops, in the same commit.
 *
 * What a caller must know: `open()` is the only way in, and it returns a Result. Everything past
 * it can assume every rule is well-formed, which is why no downstream module re-validates.
 */
import { join } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { ContractKind, Coverage, Rule } from '../types.js';
import type { ArchitectureManifest } from './define.js';
import { checkIdImmutability, ID_LEDGER_PATH, type IdLedger, readIdLedger } from './ids.js';
import { type LoadedManifest, loadManifest, loadManifestFrom } from './load.js';
import { type ParamsValidator, validateManifest } from './validate.js';

export type Registry = {
  readonly root: string;
  readonly configPath: string;
  readonly manifest: ArchitectureManifest;
  all(): readonly Rule[];
  /** Rules that can actually fire — everything except `severity: 'off'`. */
  active(): readonly Rule[];
  byId(id: string): Rule | undefined;
  byKind(kind: ContractKind): readonly Rule[];
  coverage(): Coverage;
  /** The id ledger `emit` should write next. */
  ledger(): IdLedger;
};

function createRegistry(loaded: LoadedManifest, ledger: IdLedger): Registry {
  const rules = loaded.manifest.rules;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));

  return {
    root: loaded.root,
    configPath: loaded.configPath,
    manifest: loaded.manifest,
    all: () => rules,
    active: () => rules.filter((rule) => rule.severity !== 'off'),
    byId: (id) => byId.get(id),
    byKind: (kind) => rules.filter((rule) => rule.kind === kind),
    coverage: () => {
      const active = rules.filter((rule) => rule.severity !== 'off');
      const count = (confidence: Rule['confidence']) =>
        active.filter((rule) => rule.confidence === confidence).length;
      return {
        total: active.length,
        deterministic: count('deterministic'),
        proxy: count('proxy'),
        model: count('model'),
      };
    },
    ledger: () => ledger,
  };
}

export type OpenOptions = {
  /** Where to start looking for the manifest. Ignored when `configPath` is given. */
  cwd?: string;
  configPath?: string;
  /** Kind-specific params validation, injected by the composition root. */
  validateParams: ParamsValidator;
  /** Skip the id-immutability ledger. Only `emit` and tests have a reason to. */
  skipIdCheck?: boolean;
};

export function open(options: OpenOptions): Result<Registry> {
  const loadedResult = options.configPath
    ? loadManifestFrom(options.configPath)
    : loadManifest(options.cwd ?? process.cwd());
  if (!loadedResult.ok) return loadedResult;
  const loaded = loadedResult.value;

  const validated = validateManifest(loaded.manifest, options.validateParams);
  if (!validated.ok) return err(validated.error);

  const ledger = readIdLedger(join(loaded.root, ID_LEDGER_PATH));
  if (options.skipIdCheck !== true) {
    const immutable = checkIdImmutability(loaded.manifest.rules, ledger);
    if (!immutable.ok) return err(immutable.error);
  }

  return ok(createRegistry(loaded, ledger));
}

export { type ArchitectureManifest, defineArchitecture } from './define.js';
export {
  checkIdImmutability,
  ID_LEDGER_PATH,
  type IdLedger,
  nextIdLedger,
  readIdLedger,
} from './ids.js';
export { CONFIG_FILENAME, findConfig, type LoadedManifest } from './load.js';
export { type ParamsValidator, validateManifest } from './validate.js';
