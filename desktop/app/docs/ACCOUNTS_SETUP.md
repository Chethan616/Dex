# One-click accounts: registering DEX's sign-in apps

Users only ever click **Connect** and approve DEX on Google's, Slack's,
GitHub's or Reddit's own OAuth page — like Claude's connectors. That works because the
product registers one app per service. Do it once, as DEX's developer:

```
cd desktop/app
yarn oauth:setup
```

The script opens each registration page (Slack is pre-filled from a
manifest), tells you what to click, and writes the gitignored
`config/oauth-clients.json` that builds carry. GitHub is optional: without
an app, DEX connects through your GitHub CLI login. Details per service:

## Google (Gmail, Calendar, Meet, Drive, Docs, Sheets, Contacts, Tasks)

1. <https://console.cloud.google.com> → create a project (the same project can
   be your Firebase project — see `firebase/README.md`).
2. **APIs & Services → Library** — enable: Gmail API, Google Calendar API,
   Google Drive API, Google Docs API, Google Sheets API, People API,
   Google Tasks API.
3. **OAuth consent screen** — External, app name "DEX", your email. Add the
   scopes DEX asks for (`src/main/accounts/google.ts` → `GOOGLE_SCOPES`).
   While the app is in *Testing*, add your Google account(s) under **Test
   users**; Gmail/Drive scopes are "restricted", so publishing to everyone
   needs Google's verification — personal use doesn't.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.**
   Copy the client ID and secret. (A Desktop client's secret isn't
   confidential by Google's design; DEX also uses PKCE.)

No redirect URL to register: Desktop clients accept any `http://127.0.0.1:<port>`.

## GitHub

1. <https://github.com/settings/developers> → **New OAuth App**.
   Homepage `https://github.com/Chethan616/Dex`, callback
   `http://127.0.0.1` (unused by the device flow).
2. Tick **Enable Device Flow**. Copy the **Client ID** — no secret is needed.

## Slack

1. <https://api.slack.com/apps> → **Create New App** → From scratch.
2. **OAuth & Permissions** → Redirect URLs → add
   `http://127.0.0.1:53682/slack/callback`. If Slack refuses a non-HTTPS URL,
   deploy the relay page in `firebase/hosting/oauth/slack.html` and register
   `https://<project>.web.app/oauth/slack.html` instead (set it as
   `DEX_SLACK_REDIRECT_URI`); it forwards the code to the same loopback.
3. **Bot Token Scopes**: `channels:history channels:read chat:write
   reactions:write users:read users.profile:read groups:read im:history`.
4. **Basic Information** → copy Client ID and Client Secret. The secret is
   confidential: only ship it in builds you control.

## Reddit

Reddit's MCP connection uses Reddit's installed-app OAuth flow, so DEX never
asks for your Reddit password. Reddit currently requires approved API access
before an app can use the API; app creation or API use may be blocked until
Reddit approves the request. See Reddit's
[Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).

After Reddit approves the app and provides a client ID:

1. Register an **installed app** with this exact redirect URI:
   `http://127.0.0.1:53683/reddit/callback`.
2. Set `DEX_REDDIT_CLIENT_ID` in the desktop app's environment, or add this
   entry to the gitignored `config/oauth-clients.json`:

   ```json
   {
     "reddit": {
       "clientId": "your-approved-client-id",
       "redirectUri": "http://127.0.0.1:53683/reddit/callback"
     }
   }
   ```

3. Restart DEX, open **Settings → Accounts**, and choose **Connect Reddit**.
   DEX stores Reddit's refresh token in the OS credential store. The token is
   used by the upstream Reddit MCP server to make authorized API requests.

## What happens on connect

- The browser signs in; DEX receives the grant on a one-shot local server.
- The token goes to Windows Credential Manager (keytar), never to a file.
- The matching MCP server is switched on and verified, so the next task can
  use its tools. Google uses DEX's own server (`mcp-servers/google/server.mjs`),
  run by Electron's bundled Node — nothing to install.
- **Disconnect** revokes the grant with Google, Slack or Reddit and deletes
  the token.
