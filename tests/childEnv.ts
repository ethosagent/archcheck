// Strip git's variables so a spawned CLI discovers git the way a user's shell would.
export function childEnv(): NodeJS.ProcessEnv {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...rest } = process.env;
  return { ...rest, NO_COLOR: '1' };
}
