---
name: connectors-marketplace
description: How DEX's Marketplace connectors work — hosted MCP servers via OAuth DCR, the stdio proxy, which services were verified/excluded
metadata:
  type: project
---

Settings › Connectors is just the card that opens the **Marketplace** (`renderer/hub/connectors/Marketplace.tsx`); since v3.3.0 the old Accounts grid is gone (owner: "delete the old accounts section"). It lists the built-in accounts (Google, Microsoft 365, GitHub, Slack, Reddit, Hugging Face) plus 50 hosted MCP servers from `src/shared/connectorCatalog.ts`.

**Logos:** the owner wants each service's *real* logo, never letter tiles. They live in `renderer/assets/brand-logos/<id>.svg|png`, mapped by `connectors/brandLogos.ts`, on a white tile. Vectors come from Simple Icons (CC0, npm `simple-icons`, in the brand colour). Brands it lacks use the service's own icon (apple-touch-icon, or the GitHub org avatar `github.com/<org>.png?size=256`), resized to 128 px. A new connector needs a logo file; the Marketplace spec fails without one. Credit new ones in LICENSES.md › Logos and trademarks.

**How the hosted ones work:**
- Sign-in uses the MCP OAuth spec, in `main/connectors/remoteAuth.ts`:
  - discovery (RFC 9728, then RFC 8414);
  - dynamic client registration with a `http://127.0.0.1:<port>/callback` redirect;
  - PKCE;
  - the server as the token's `resource` (audience).
- Tokens go to the keytar MCP store as connection `remote_<id>`.
- `mcp-servers/remote/server.mjs` bridges an engine's stdio to Streamable HTTP, or to the old SSE transport for `/sse` URLs.
- Tokens are refreshed before each run. Mid-run, the proxy POSTs `/dex/connector-token`.

**Verified on 2026-10-07:** all 50 accept DCR with a loopback redirect.
- **Excluded:** Figma and QuickBooks (DCR closed), Calendly (https only), Gamma and PitchBook (loopback refused).
- **No sign-in:** Kiwi.com flights, PubMed, Context7, DeepWiki, Exa, Hugging Face Hub, Excalidraw, Cloudflare Docs.
- **Not yet tried:** a full end-to-end sign-in with a real account.

**Travel is MCP first (owner, 2026-10-07):** `connectionsForPrompt` (mcp/catalog.ts) attaches the keyless Kiwi.com (flights) and trivago (hotels, `https://mcp.trivago.com/mcp`) servers to any task whose words are about flights/hotels/trips, with a hint to answer as dex-ui cards. Restaurants still go through Google Maps in the browser (Google's Maps Grounding Lite MCP needs a Cloud project with billing). Playbooks: `domain-skills/google-travel/`.

**Release builds hide sign-ins they can't do** (no OAuth app): Microsoft needs DEX's Entra app (redirect `http://localhost/microsoft/callback`, public client, no secret), Reddit an approved app.

**Why:** the owner wants "all integrations via OAuth" for students, employees, doctors and engineers, without registering an app with each service.

**How to apply:**
- Add a connector only after probing its DCR with a loopback redirect, using the probe-script pattern in the session scratchpad.
- Never list one that can't sign in.
