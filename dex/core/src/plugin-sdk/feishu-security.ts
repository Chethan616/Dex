// Manual facade. Keep loader boundary explicit.
import type { DexConfig } from "../config/types.js";
import type { SecurityAuditFinding } from "../security/audit.types.js";
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

type SecuritySurface = {
  collectFeishuSecurityAuditFindings: (params: { cfg: DexConfig }) => SecurityAuditFinding[];
};

function loadSecuritySurface(): SecuritySurface {
  return loadBundledPluginPublicSurfaceModuleSync<SecuritySurface>({
    dirName: "feishu",
    artifactBasename: "security-contract-api.js",
  });
}

export const collectFeishuSecurityAuditFindings: SecuritySurface["collectFeishuSecurityAuditFindings"] =
  ((...args) =>
    loadSecuritySurface().collectFeishuSecurityAuditFindings(
      ...args,
    )) as SecuritySurface["collectFeishuSecurityAuditFindings"];
