// The public surface. Explicit named exports only — never `export *`, so a dead-code pass can
// find a symbol nobody consumes.
export { writeEntry } from './services/write.js';
