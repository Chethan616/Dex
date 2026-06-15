# Connect Microsoft Teams

Dex in Teams chats and channels for work setups.

## Link it (about 10 minutes — needs an Azure app)

1. In the **Azure Portal → App registrations**, create an app and note the **App ID** and a **client secret**.
2. Register a **Bot** (Azure Bot resource) and set its messaging endpoint to the webhook Dex provides.
3. Add the **Teams** channel to the bot.
4. In Dex, open this app and paste the App ID + secret, then tap **Connect**.
5. Sideload the bot into Teams (or publish to your org) and message it.

## Use cases

- **Work cockpit:** run desktop tasks from a Teams chat and share results with colleagues.
- **Channel notifications:** "Post the report link in the Project channel."

## Notes

- Teams setup is the heaviest of the channels because it goes through Azure; budget extra time.
- Your org admin may need to approve sideloading or publishing the bot.
