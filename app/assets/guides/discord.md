# Connect Discord

Run Dex as a Discord bot — in your own server or in DMs.

## Link it (about 5 minutes)

1. Go to the **Discord Developer Portal** (discord.com/developers/applications) → **New Application**.
2. Open **Bot** → **Add Bot**, then **Reset Token** and copy the token.
3. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**.
4. In **OAuth2 → URL Generator**, tick **bot**, give it **Send Messages** + **Read Message History**, copy the URL, open it, and invite the bot to your server.
5. In Dex, open this app, paste the bot token, and tap **Connect**.
6. Mention the bot or DM it in Discord — Dex replies.

## Use cases

- **Team cockpit:** ask Dex to run a task in a shared channel so your group sees the result.
- **DM assistant:** keep a private DM with the bot as your personal command line.
- **Notifications:** "Post 'build finished' in #dev when the deploy completes."
- **File drops:** Dex can attach screenshots, logs, or exports straight into a channel.

## Notes

- Message Content Intent is required or the bot can't read your messages.
- Keep the token secret; reset it in the Developer Portal if it leaks.
