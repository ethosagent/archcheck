const BRACE = /^\{([A-Za-z][A-Za-z0-9]*)\}$/;

// Extracts brace names from pattern segments in order of appearance.
export function captureNames(pattern: string): string[] {
  const names: string[] = [];
  for (const segment of pattern.split('/')) {
    const name = BRACE.exec(segment)?.[1];
    if (name === undefined) continue;
    names.push(name);
  }
  return names;
}

// Membership stays with the existing matcher so there is no second glob parser.
export function toGlob(pattern: string): string {
  return pattern
    .split('/')
    .map((segment) => (BRACE.test(segment) ? '*' : segment))
    .join('/');
}

// Captures values positionally, returning undefined if path is too short.
export function capturesOf(pattern: string, path: string): Record<string, string> | undefined {
  const patternSegments = pattern.split('/');
  const pathSegments = path.split('/');
  const captures: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const segment = patternSegments[i];
    if (segment === undefined) continue;

    const name = BRACE.exec(segment)?.[1];
    if (name === undefined) continue;

    const value = pathSegments[i];
    if (value === undefined) return undefined;

    captures[name] = value;
  }

  return captures;
}

// Reports structural issues like globstar instability or duplicate names.
export function captureProblems(pattern: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let afterGlobstar = false;

  for (const segment of pattern.split('/')) {
    if (segment === '**') {
      afterGlobstar = true;
      continue;
    }
    const name = BRACE.exec(segment)?.[1];
    if (name === undefined) continue;
    if (afterGlobstar) {
      problems.push(`capture {${name}} follows a ** and its segment index is not stable`);
    }
    if (seen.has(name)) {
      problems.push(`capture {${name}} appears more than once`);
    }
    seen.add(name);
  }

  return problems;
}
