# Connect Matrix

Dex on any Matrix homeserver (matrix.org or self-hosted) — open, federated chat.

## Link it (about 5 minutes)

1. Create a Matrix account for Dex on your homeserver (or reuse one).
2. Get an **access token** (Element → Settings → Help & About → Advanced → Access Token, or via the login API).
3. In Dex, open this app and paste the **homeserver URL** + **access token**, then tap **Connect**.
4. Invite the Dex user to a room (or DM it) and send a message — Dex replies.

## Use cases

- **Self-hosted privacy:** keep the whole chat on infrastructure you control.
- **Bridged hubs:** reach Dex from any client bridged into Matrix.
- **Room automation:** "Post the deploy status in #ops."

## Notes

- Use a dedicated account for Dex so its messages are clearly attributable.
- Encrypted rooms need the device verified; follow your client's verification flow.
