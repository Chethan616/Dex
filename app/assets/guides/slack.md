# Connect Slack

Bring Dex into your Slack workspace — DMs or channels.

## Link it (about 5 minutes)

1. Go to **api.slack.com/apps → Create New App → From scratch**, pick your workspace.
2. Under **OAuth & Permissions**, add bot scopes: `chat:write`, `app_mentions:read`, `im:history`, `files:write`.
3. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`).
4. Enable **Socket Mode** (or Event Subscriptions) and copy the **App-Level Token** (`xapp-...`) if prompted.
5. In Dex, open this app, paste the token(s), and tap **Connect**.
6. In Slack, `/invite` the bot to a channel or DM it — Dex replies.

## Use cases

- **Standup helper:** "Summarize yesterday's commits and post to #standup."
- **On-call command line:** DM Dex to run a check on your PC and report back.
- **File exports:** "Send the report CSV to #finance."

## Notes

- Scopes matter: without `chat:write` the bot can read but not reply.
- Reinstall the app after changing scopes so Slack issues an updated token.
