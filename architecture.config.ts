/**
 * archcheck's own architecture. If it cannot hold its own dependency law it has no business
 * holding anyone else's (LLD §9.1).
 *
 * The layer order, one way, no arrow back:
 *
 *   kernel ← util ← registry · graph · contract · normalize · report · emit · probe ← facade ← cli
 *
 * Every layer below is declared here, and anything undeclared is denied. A new folder in src/
 * fails on its first commit rather than being silently legal — that is the property
 * `catchesUnlayered` exists for, and it is the whole reason default-deny is worth having.
 */
import { defineArchitecture } from './src/index.js';

const law = {
  kind: 'layers' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    // ── the dependency law ────────────────────────────────────────────────────────────────────
    {
      ...law,
      id: 'tests-reach-anything',
      statement: 'a test may reach any layer, because its job is to look at one',
      params: {
        name: 'test',
        // Declared FIRST: first match wins, so a co-located test is a test before it is
        // anything else. Without this, every test that imports two layers is a violation.
        match: ['src/**/*.test.ts', 'tests/**'],
        mayImport: '*',
      },
      remedy: { summary: 'nothing to do — tests are exempt from the layer law by design' },
    },
    {
      ...law,
      id: 'kernel-imports-nothing',
      statement: 'the kernel imports nothing internal — not a layer, and not the TypeScript SDK',
      params: {
        name: 'kernel',
        match: ['src/types.ts', 'src/result.ts', 'src/version.ts'],
        mayImport: [],
      },
      remedy: {
        summary: 'if the kernel needs it, it is not the kernel: move the type down or the code up',
      },
    },
    {
      ...law,
      id: 'util-is-a-leaf',
      statement: 'a utility reaches the kernel and nothing else',
      params: { name: 'util', match: 'src/util/**', mayImport: ['kernel'] },
      remedy: { summary: 'take what you need as an argument instead of importing it' },
    },
    {
      ...law,
      id: 'the-filesystem-is-a-leaf',
      statement: 'the filesystem seam reads and writes and decides nothing',
      params: { name: 'fs', match: 'src/fs/**', mayImport: ['kernel', 'util'] },
      remedy: { summary: 'return the paths and let a probe judge them' },
    },
    {
      ...law,
      id: 'the-baseline-is-a-leaf',
      statement: 'the baseline reads and writes one file and knows nothing about rules',
      params: { name: 'baseline', match: 'src/baseline/**', mayImport: ['kernel'] },
      remedy: {
        summary: 'take the diagnostics as an argument; the baseline only keys off identity',
      },
    },
    {
      ...law,
      id: 'exceptions-are-a-leaf',
      statement: 'exceptions decide suppression from paths and dates, and run no check',
      params: { name: 'exception', match: 'src/exceptions/**', mayImport: ['kernel', 'util'] },
      remedy: { summary: 'take the diagnostics as an argument rather than producing them' },
    },
    {
      ...law,
      id: 'contracts-know-no-probe',
      statement: 'a contract kind decides, emits and explains — it never runs anything',
      params: {
        name: 'contract',
        match: 'src/contracts/**',
        mayImport: ['kernel', 'util', 'graph'],
      },
      remedy: { summary: 'return the decision as data and let a probe do the walking' },
    },
    {
      ...law,
      id: 'graph-reports-facts-only',
      statement: 'the graph reader reports facts and evaluates no rule',
      params: { name: 'graph', match: 'src/graph/**', mayImport: ['kernel', 'util'] },
      remedy: { summary: 'move the judgement into a contract kind; the graph only observes' },
    },
    {
      ...law,
      id: 'registry-knows-only-rules',
      statement: 'the registry knows that a rule has a kind, never what a kind means',
      params: {
        name: 'registry',
        match: 'src/registry/**',
        // `exception` is here because the exceptions block is part of the manifest SHAPE, which
        // the registry owns. It reaches the validator, never a probe.
        mayImport: ['kernel', 'util', 'exception'],
      },
      remedy: {
        summary: 'inject the kind-specific behaviour as a parameter, the way validateParams is',
        allowed: ['kernel', 'util'],
      },
    },
    {
      ...law,
      id: 'normalize-adds-only',
      statement: 'the normaliser enriches a finding and runs no check of its own',
      params: { name: 'normalize', match: 'src/normalize/**', mayImport: ['kernel', 'util'] },
      remedy: { summary: 'inject it, the way refine is injected, rather than importing a kind' },
    },
    {
      ...law,
      id: 'reporters-read-a-runresult',
      statement: 'a reporter reads a RunResult and reaches for nothing else',
      params: { name: 'report', match: 'src/report/**', mayImport: ['kernel', 'util'] },
      remedy: {
        summary: 'put what the reporter needs into the Diagnostic, so every audience gets it',
      },
    },
    {
      ...law,
      id: 'emit-reads-contracts-not-probes',
      statement: 'the emitter asks a contract kind for fragments and never runs a probe',
      params: {
        name: 'emit',
        match: 'src/emit/**',
        mayImport: ['kernel', 'util', 'contract', 'registry'],
      },
      remedy: {
        summary: 'emit is a pure function of the manifest; move the runtime part to a probe',
      },
    },
    {
      ...law,
      id: 'probes-never-report',
      statement: 'a probe returns evidence, never prose and never a verdict',
      params: {
        name: 'probe',
        match: 'src/probes/**',
        mayImport: ['kernel', 'util', 'contract', 'graph', 'fs'],
      },
      remedy: { summary: "return a RawFinding and let the kind's explain() write the sentence" },
    },
    {
      ...law,
      id: 'only-the-facade-wires-layers',
      statement: 'the facade is the one place the layers are wired together',
      params: {
        name: 'facade',
        match: ['src/archcheck.ts', 'src/index.ts'],
        mayImport: [
          'kernel',
          'util',
          'registry',
          'graph',
          'contract',
          'probe',
          'normalize',
          'report',
          'emit',
          'baseline',
          'exception',
          'fs',
        ],
        catchesUnlayered: true,
      },
      remedy: {
        summary: 'wire it in src/archcheck.ts — that is the composition root, and the only one',
      },
    },
    {
      ...law,
      id: 'the-manifest-reaches-the-barrel-only',
      statement: 'the manifest imports archcheck through its public surface, like any consumer',
      params: { name: 'manifest', match: 'architecture.config.ts', mayImport: ['facade'] },
      remedy: {
        summary:
          "import from './src/index.js' — reaching inside would make the manifest a consumer no other repo could be",
      },
    },
    {
      ...law,
      id: 'cli-owns-no-behaviour',
      statement: 'the CLI parses arguments, calls the facade and picks a reporter — nothing else',
      params: {
        name: 'cli',
        match: 'src/cli/**',
        mayImport: ['kernel', 'util', 'facade', 'report', 'emit'],
      },
      remedy: {
        summary: 'add the capability to ArchCheck instead: the agent hook does not shell out',
      },
    },

    // ── banned syntax ────────────────────────────────────────────────────────────────────────
    {
      id: 'no-console-outside-an-entry-point',
      kind: 'banned-syntax',
      statement: 'logging goes through one seam, so the server stays embeddable',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        appliesTo: ['src/**', '!src/cli/**', '!src/report/**', '!src/**/*.test.ts'],
        selector: 'member-access',
        target: 'console',
      },
      remedy: { summary: 'return the text and let the CLI print it' },
    },
    {
      id: 'no-computed-dynamic-import',
      kind: 'banned-syntax',
      statement: 'a dynamic import names its module literally, so the graph stays complete',
      severity: 'error',
      confidence: 'deterministic',
      params: { appliesTo: 'src/**', selector: 'computed-dynamic-import' },
      remedy: { summary: 'import the candidates statically and pick between them' },
    },
    {
      id: 'no-empty-catch',
      kind: 'banned-syntax',
      statement: 'a caught error is handled, rethrown, or its silence is explained',
      severity: 'error',
      confidence: 'deterministic',
      params: { appliesTo: ['src/**', '!src/**/*.test.ts'], selector: 'empty-catch' },
      remedy: { summary: 'handle it, rethrow it, or leave a comment saying why ignoring is safe' },
    },
    {
      id: 'no-inline-suppression',
      kind: 'banned-syntax',
      statement: 'an exception lives in the manifest with an owner and an expiry, never inline',
      // A proxy, and marked as one: the scanner reads comment text, so a suppression spelled a way
      // it does not know still gets through. It catches every form anyone here actually types.
      severity: 'error',
      confidence: 'proxy',
      params: { appliesTo: ['src/**', '!src/**/*.test.ts'], selector: 'suppression-comment' },
      remedy: {
        summary: 'declare an exception in architecture.config.ts, with an owner and an expiry',
      },
    },

    // ── naming ───────────────────────────────────────────────────────────────────────────────
    {
      id: 'filenames-are-camel-case-or-kebab',
      kind: 'naming',
      statement: 'a filename is camelCase, or kebab-case when it names a contract kind',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        appliesTo: 'src/**',
        target: 'files',
        pattern: '^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*(\\.test)?\\.ts$',
      },
      remedy: { summary: 'rename the file' },
    },
  ],
});
