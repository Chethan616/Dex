# Connect iMessage

Talk to Dex over iMessage. This requires a Mac that stays signed into Messages — iMessage has no Windows API, so the Mac acts as the bridge.

## Link it

1. On a Mac signed into your Apple ID, install the Dex bridge helper (see `dex channels add --channel imessage` for the current steps).
2. Grant Messages + Full Disk Access to the helper in **System Settings → Privacy & Security**.
3. In Dex, open this app and follow the pairing prompt to connect to that Mac.
4. Send yourself an iMessage and Dex replies.

## Use cases

- **Blue-bubble assistant:** command Dex from your iPhone via iMessage.
- **Family-safe:** message a shared number to trigger PC tasks.

## Notes

- A always-on Mac is required; without it, prefer WhatsApp, Telegram, or Signal on Windows.
- Apple may rate-limit automated sending — keep volume reasonable.
