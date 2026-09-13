# Dex use cases — daily, personal, study, work

Dex is a chat-first personal assistant that runs on your machine and has *hands* — it can drive your Windows apps, your browser, and your messaging channels with your approval. Below are ~35 concrete things you can ask it to do, written for **non-developers**: students, doctors, office workers, and anyone who just wants a calmer day. Each use case has a short trigger, the literal command or chat message you give Dex, and what Dex does next.

Every action Dex takes is previewed first. Nothing happens until you press **Approve**.

---

## Part 1 — Students (12 use cases)

Studying, homework, research, scheduling, communication with peers + professors.

### 1. "Summarize this PDF lecture into bullet notes"

**You say**: `summarize the lecture pdf on my desktop into 15 bullet points I can use as revision notes, and save them next to the original`

**Dex does**:
1. Opens the PDF via the file driver, extracts text.
2. Anthropic Claude shapes a 15-bullet summary.
3. Previews the bullet points + the save path (`Desktop\lecture-notes.md`).
4. On approve, writes the file.

**Pairs with**: the `document-extract` extension.

### 2. "Pull the key formulas from chapter 7 into a flashcard deck"

**You say**: `from the calculus textbook in C:\Study\Calculus.pdf, extract the formulas in chapter 7 and write them as Anki-style flashcards`

**Dex** generates a `flashcards.md` file with `Q: ... A: ...` lines you can import into Anki / Quizlet.

### 3. "Plan my study schedule around my Friday exam"

**You say**: `I have an Organic Chemistry final on Friday. Plan a 4-day study schedule starting today, 3 hours per day, focusing on reactions and mechanisms`

**Dex** drafts the schedule as a markdown table, asks you which time blocks work, then optionally adds reminders to your calendar.

### 4. "Compare the wording across these three lecture handouts"

**You say**: `read these three handouts and tell me which definitions of 'entropy' differ between them`

**Dex** reads all three, diffs the relevant passages, and presents a side-by-side table.

### 5. "Find scholarly papers on X — give me 5 with abstracts"

**You say**: `find me 5 recent scholarly papers on CRISPR off-target effects, with abstracts and a link to each`

**Dex** uses the browser driver (or the `exa` / `tavily` search extensions) to query Google Scholar / arXiv, returns links + abstracts.

### 6. "Email my professor about an extension"

**You say**: `draft a polite email to Dr. Martin asking for a 2-day extension on the chem lab report. Cite that I had a flu test on Monday. Send via Gmail`

**Dex** drafts the email, previews subject + body + recipient, and on approve sends through the `gmail`-style channel (or pastes into Outlook/Gmail tab via browser driver).

### 7. "Help me cite this article"

**You say**: `here's a URL: <paste>. Give me APA, MLA, and Chicago citations`

**Dex** fetches the page metadata, formats three citations.

### 8. "Make me a quiz from chapter 4"

**You say**: `read chapter 4 from D:\Study\Biology.pdf and quiz me with 10 multiple-choice questions, one at a time`

**Dex** asks each question in turn, tracks your answers, explains the right answer when you're wrong.

### 9. "Organize my Downloads folder by subject"

**You say**: `look at the files I've downloaded this week and sort them into subject folders under Documents\School\<Subject>`

**Dex** previews the file moves (which file → which folder), waits for approve, then executes.

### 10. "Watch my email and ping me when Dr. Lin replies"

**You say**: `let me know when an email from drlin@university.edu arrives`

**Dex** polls (or hooks via Gmail's IMAP webhook), pings you in the chat surface when it sees the message, and shows the body.

### 11. "Convert my handwritten notes to typed text"

**You say**: `I scanned my handwritten chemistry notes to C:\Scans. OCR them and save the text as <date>-chem-notes.md`

**Dex** runs OCR (via the `document-extract` extension), saves the text.

### 12. "Help me with a stuck math problem"

**You say**: `here's a screenshot of problem 14. Walk me through solving it step by step`

**Dex** uses Claude vision (or Gemini Flash-Lite, see Phase C) to read the screenshot, then explains the solution in human-friendly steps. Best for when you want to learn, not just get the answer.

---

## Part 2 — Doctors / healthcare workers (7 use cases)

Patient documentation, scheduling, evidence look-ups, referrals. **All patient data stays on your machine** unless you explicitly tell Dex to send it somewhere; nothing in Dex auto-uploads.

### 13. "Draft a referral letter to Dr. Patel for the patient we just saw"

**You say**: `draft a cardiology referral to Dr. Patel for a 58-year-old with intermittent chest pain on exertion, normal ECG, BP 142/91. Mention I'd like an exercise stress test`

**Dex** drafts the letter in your clinic's letterhead format, lets you fill in patient name + DOB, previews, and saves to your referrals folder. You sign and send by your usual channel.

### 14. "Pull the latest UK/US guidelines on managing X"

**You say**: `find me NICE and UpToDate's latest recommendations on first-line treatment for adult ADHD`

**Dex** uses the browser driver to navigate NICE/UpToDate (you log in with your credentials, Dex doesn't store them), pulls the relevant section, and summarizes.

### 15. "Schedule a follow-up call with the patient in 6 weeks"

**You say**: `book a 15-minute phone follow-up with patient ID 4422 for the second week of June. Add a reminder to my work calendar`

**Dex** opens your scheduling app (via the browser driver), drafts the entry, you approve, it commits the booking.

### 16. "Summarize this patient's last 6 months of notes"

**You say**: `read the notes for patient 4422 in our EHR and give me a 1-paragraph summary of the last 6 months, focused on medication changes and lab trends`

**Dex** drives the EHR via the browser driver (with your existing session), extracts the data, summarizes. The summary stays local unless you copy it elsewhere.

### 17. "Write up today's home visit"

**You say**: `I just visited Mrs. Brown for her diabetes follow-up. HbA1c 7.2 down from 8.1, taking metformin 1g BD, swollen ankles improved since stopping amlodipine. Format this as a SOAP note`

**Dex** structures the dictation into Subjective / Objective / Assessment / Plan and saves to your home-visit log.

### 18. "Look up drug interactions for these three medications"

**You say**: `Check interactions between amitriptyline, tramadol, and sertraline`

**Dex** queries an interaction database (BNF, drugs.com, or a configured plugin), returns clinically relevant interactions with severity flags.

### 19. "Voice-dictate today's last consultation note"

**You say**: (press a hotkey, then speak) `male 47, presented with...`

**Dex** transcribes via the `deepgram` / `azure-speech` extension, formats as a clinical note, saves to today's log. You proofread + sign.

---

## Part 3 — Office workers (8 use cases)

Email triage, meetings, documents, status updates, expense reports.

### 20. "Triage my inbox: tell me what needs a reply today"

**You say**: `look at my unread emails. Tag each one: reply-needed, FYI, ignore. Give me a list, sorted by urgency`

**Dex** drives your Outlook / Gmail tab, classifies each message, returns a ranked list with one-sentence reasons.

### 21. "Reply to all the easy ones with a polite acknowledgement"

**You say**: `for every "FYI" email, send a one-line "thanks, noted" reply`

**Dex** previews each draft. You approve in bulk or one-by-one.

### 22. "Get me ready for the 2pm meeting"

**You say**: `I have a meeting with the Acme account at 2. Pull the last 3 emails from them, summarize what we owe them, and draft a 5-bullet talking-points list`

**Dex** assembles everything in one Markdown brief you can read in 60 seconds.

### 23. "Take notes during the call (transcribe + summarize)"

**You say**: (start the meeting) `start transcribing this call and summarize action items at the end`

**Dex** captures audio (via Talk-voice / Deepgram), at the end shows a structured summary: decisions, action items, owners.

### 24. "Fill in this expense report from the receipts in my Downloads"

**You say**: `Look at the receipts I downloaded this week. Fill in this month's expense report — vendor, date, amount, category, approved-by left blank`

**Dex** OCRs each receipt, populates the spreadsheet template, shows you the proposed rows.

### 25. "Update the project tracker with the latest status"

**You say**: `look at the Slack channel #atlas-launch from the last 24 hours and update the project tracker tab on our Notion page with any status changes`

**Dex** uses the Slack channel extension + browser driver (Notion). Previews changes before writing.

### 26. "Help me write a status update to my boss"

**You say**: `summarize what I worked on this week — pull commits from my git activity, calendar meetings, and the Slack channels I'm in — and draft a Friday status email`

**Dex** assembles the draft, previews, sends only on approve.

### 27. "Find that one email about the venue change"

**You say**: `there was an email a few weeks ago about a venue change for the Q3 offsite — find it and pull up the new address`

**Dex** searches your mail, returns the matching thread + the address.

---

## Part 4 — Personal life (8 use cases)

Family logistics, travel, health, hobbies, household.

### 28. "Plan a weekend trip to <city> for under <budget>"

**You say**: `plan a 2-night Friday-Sunday trip from Bangalore to Pondicherry for two people, total budget 15,000 rupees. Include train booking links and 2 hotel options`

**Dex** uses the browser driver, returns an itinerary + booking-ready links. You approve each booking before it happens.

### 29. "Remind me to take medication twice a day"

**You say**: `remind me at 8am and 8pm every day to take my vitamin D`

**Dex** sets a cron entry. Optionally pings via Telegram / WhatsApp / Signal.

### 30. "Track my reading list"

**You say**: `I just finished 'Project Hail Mary'. Add it to my reading log with the date, rating 5/5, and recommend three similar books`

**Dex** appends to your reading log file, then queries the LLM for recommendations.

### 31. "Order the usual groceries"

**You say**: `look at my last grocery order on BigBasket / Instacart and reorder the same items minus the bread`

**Dex** uses the browser driver, walks through the basket, previews + asks before submitting.

### 32. "Find me a recipe using what's in my fridge"

**You say**: `I have eggs, tomatoes, onions, paneer, and ginger. Suggest 3 quick dinners under 30 minutes`

**Dex** chats the suggestions; you pick one and Dex pulls the full recipe.

### 33. "Help me draft a wedding RSVP"

**You say**: `decline the Patel wedding for Aug 12 politely, mention I have a family commitment that weekend`

**Dex** drafts the message, lets you pick the channel (WhatsApp, email).

### 34. "Track my sleep streak (manual)"

**You say**: `log that I slept 7.5 hours last night, woke up at 6:30, felt energetic`

**Dex** appends to your sleep log file. Over time it can summarize weekly trends.

### 35. "Pay my electricity bill"

**You say**: `open the electricity provider website, log in with my saved credentials, pay this month's bill by UPI, send me a screenshot of the receipt`

**Dex** uses the browser driver, asks you to confirm the UPI step in your authenticator app, captures the receipt.

---

## How to actually run any of the above

1. **Install Dex** (one-time):
   ```cmd
   npm install -g dexagent
   dex onboard
   ```
   The onboarding wizard asks for an Anthropic API key (free tier works for most of the above), then drops you into a configured `~/.dex/` directory.

2. **Start the gateway**:
   ```cmd
   dex gateway --port 18789
   ```

3. **Open the Flutter UI** (or talk to Dex from any paired channel — Telegram, Slack, WhatsApp):
   ```cmd
   D:\project1\app\build\windows\x64\runner\Debug\dex.exe
   ```

4. **Type your goal in natural language.** Dex will preview every action before it runs. Click **Approve** to let it proceed, or **Deny** to cancel.

5. **For voice**: tap the mic button. Dex transcribes via Deepgram / Azure / on-device MLX (configurable in `dex configure`).

## What each use case roughly costs

| Tier | Models | Cost guidance |
|---|---|---|
| Free | Groq Qwen 3 (UI driving), Gemini Flash-Lite (when added in Phase C), free Anthropic web | Most usage; great for #1-#12 and #28-#35 |
| Light paid | Anthropic Claude API key | Better reasoning for medical use cases #13-#19 and complex office work #20-#27 |
| Pro | Claude Sonnet 4.6 + GPT-5 fallback + OpenRouter | Heavy daily use with lowest latency; large doc summarization |

You set this in `dex configure → Brain → Provider catalog`.

## Privacy + safety

- **Nothing leaves your machine without your approval.** Dex previews every web post, every file write, every channel message.
- **Refusal list**: Dex blocks destructive operations by default (formatting drives, sending money without confirmation in the goal, modifying system services). See `dex/core/HERITAGE.md` and the `SECURITY.md` at the repo root.
- **Credentials**: All API keys and channel logins live in `~/.dex/credentials/`. They never get uploaded.
- **Healthcare data**: Dex does NOT auto-sync to any external service. Patient identifiers stay in your EHR; Dex only sees what you paste into chat or what's in files you explicitly point it at.

## Adding your own use case

If you have a recurring task not on this list, just describe it in plain English. Dex will pick the right combination of:

- Shell commands (file ops, git, system calls)
- Windows UI automation (UFO² — anything with a window)
- Browser automation (browser-use — anything in a webpage)
- Channels (Telegram / WhatsApp / Slack / etc.)
- LLM reasoning (whichever brain you configured)

The first time you do something, Dex will be slow because it's figuring out the right tools. After a few runs the same task is faster and quieter — the orchestrator's [Beta-prior learner](architecture/apps-and-extensions.md) remembers which engine worked.

---

*Inspired by [awesome-openclaw-usecases](https://github.com/hesamsheikh/awesome-openclaw-usecases) and adapted for daily, non-developer Dex workflows.*
