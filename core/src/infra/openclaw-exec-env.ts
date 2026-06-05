export const DEX_CLI_ENV_VAR = "DEX_CLI";
export const DEX_CLI_ENV_VALUE = "1";

export function markOpenClawExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [DEX_CLI_ENV_VAR]: DEX_CLI_ENV_VALUE,
  };
}

export function ensureOpenClawExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[DEX_CLI_ENV_VAR] = DEX_CLI_ENV_VALUE;
  return env;
}
