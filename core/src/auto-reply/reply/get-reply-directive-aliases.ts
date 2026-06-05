import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@dexagent/normalization-core/string-coerce";
import type { DexConfig } from "../../config/types.openclaw.js";
import type { SkillCommandSpec } from "../../skills/types.js";

export function reserveSkillCommandNames(params: {
  reservedCommands: Set<string>;
  skillCommands: SkillCommandSpec[];
}) {
  for (const command of params.skillCommands) {
    params.reservedCommands.add(normalizeLowercaseStringOrEmpty(command.name));
  }
}

export function resolveConfiguredDirectiveAliases(params: {
  cfg: DexConfig;
  commandTextHasSlash: boolean;
  reservedCommands: Set<string>;
}) {
  if (!params.commandTextHasSlash) {
    return [];
  }
  return Object.values(params.cfg.agents?.defaults?.models ?? {})
    .map((entry) => normalizeOptionalString(entry.alias))
    .filter((alias): alias is string => Boolean(alias))
    .filter((alias) => !params.reservedCommands.has(normalizeLowercaseStringOrEmpty(alias)));
}
