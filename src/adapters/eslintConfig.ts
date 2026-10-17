// One entry of the lint sink.
export type SinkEntry = {
  ruleId: string;
  files: string[];
  forbid: string;
  message: string;
  patterns?: string[];
  target?: string;
};

// An ESLint flat-config block.
export type EslintBlock = { files: string[]; rules: Record<string, unknown> };

// The adapted config and rule ids that could not be expressed.
export type AdaptedConfig = { blocks: EslintBlock[]; unexpressed: string[] };

// Returns undefined if the entry cannot be expressed, so the caller can name the rule.
function rulesFor(entry: SinkEntry): Record<string, unknown> | undefined {
  if (entry.forbid === 'import-path-matching') {
    const group = entry.patterns ?? [];
    if (group.length === 0) return undefined;
    return {
      'no-restricted-imports': ['error', { patterns: [{ group, message: entry.message }] }],
    };
  }

  if (entry.forbid === 'empty-catch') {
    return { 'no-empty': ['error', { allowEmptyCatch: false }] };
  }

  if (entry.forbid === 'computed-dynamic-import') {
    const selector = 'ImportExpression:not([source.type="Literal"])';
    return { 'no-restricted-syntax': ['error', { selector, message: entry.message }] };
  }

  if (entry.forbid === 'member-access') {
    const target = entry.target ?? '';
    if (target.length === 0) return undefined;
    const dot = target.indexOf('.');
    if (dot === -1) {
      const bare = `Identifier[name="${target}"]`;
      return { 'no-restricted-syntax': ['error', { selector: bare, message: entry.message }] };
    }
    const object = target.slice(0, dot);
    const property = target.slice(dot + 1);
    const selector = `MemberExpression[object.name="${object}"][property.name="${property}"]`;
    return { 'no-restricted-syntax': ['error', { selector, message: entry.message }] };
  }

  return undefined;
}

// Converts lint sink entries into ESLint flat-config blocks.
export function toEslintConfig(entries: readonly SinkEntry[]): AdaptedConfig {
  const blocks: EslintBlock[] = [];
  const unexpressed = new Set<string>();

  for (const entry of entries) {
    const rules = rulesFor(entry);
    if (rules === undefined) {
      unexpressed.add(entry.ruleId);
      continue;
    }
    blocks.push({ files: entry.files, rules });
  }

  return { blocks, unexpressed: [...unexpressed].sort() };
}
