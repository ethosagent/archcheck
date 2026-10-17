/**
 * Maps archcheck sink entries to Biome linter overrides.
 * Callers must surface `unexpressed` rule ids; Biome cannot cover every archcheck rule.
 */

export type SinkEntry = {
  ruleId: string;
  files: string[];
  forbid: string;
  message: string;
  patterns?: string[];
  target?: string;
};

export type BiomeOverride = {
  includes: string[];
  linter: { rules: { style: Record<string, unknown> } };
};

export type BiomeAdapted = { overrides: BiomeOverride[]; unexpressed: string[] };

function rulesFor(entry: SinkEntry): BiomeOverride['linter'] | undefined {
  if (entry.forbid === 'import-path-matching') {
    const group = entry.patterns ?? [];
    if (group.length === 0) return undefined;
    const message = entry.message;
    return {
      rules: {
        style: {
          noRestrictedImports: { level: 'error', options: { patterns: [{ group, message }] } },
        },
      },
    };
  }

  // Dotted targets require nursery rules, which are unstable and unsuitable for committed config.
  if (entry.forbid === 'member-access') {
    const target = entry.target ?? '';
    if (target === '' || target.includes('.')) return undefined;
    return {
      rules: {
        style: {
          noRestrictedGlobals: {
            level: 'error',
            options: { deniedGlobals: { [target]: entry.message } },
          },
        },
      },
    };
  }

  return undefined;
}

export function toBiomeConfig(entries: readonly SinkEntry[]): BiomeAdapted {
  const overrides: BiomeOverride[] = [];
  const unexpressedSet = new Set<string>();

  for (const entry of entries) {
    const linter = rulesFor(entry);
    if (linter) {
      overrides.push({ includes: entry.files, linter });
    } else {
      unexpressedSet.add(entry.ruleId);
    }
  }

  return { overrides, unexpressed: [...unexpressedSet].sort() };
}
