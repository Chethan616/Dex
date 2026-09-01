# Connect Google Chat

Dex in Google Chat spaces and DMs (Google Workspace).

## Link it (about 10 minutes — needs a Google Cloud project)

1. In the **Google Cloud Console**, create/select a project and enable the **Google Chat API**.
2. Configure the Chat app (App name, avatar) and set its endpoint to the webhook Dex provides (or use Pub/Sub).
3. Create a **service account** and download its JSON key.
4. In Dex, open this app and paste the service-account key, then tap **Connect**.
5. Add the Dex app to a space or DM it.

## Use cases

- **Workspace assistant:** trigger PC tasks from a Chat space your team shares.
- **Status posts:** "Drop the weekly summary in the Team space."

## Notes

- Requires Google Workspace; consumer Gmail accounts can't add Chat apps.
- A Workspace admin may need to allow the app for your domain.
