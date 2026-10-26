# Pigeon Mail

A little private Telegram bot for you and your partner. Send it small letters and it delivers them to the other person at a random time though never more than 14 days later. What it does and why is in `SPEC.md`. The starter questions are in `prompts.md`.

It runs free on Google Apps Script and a Google Sheet, with no server.

## Setup

1. **Make the bot.** In Telegram, message **@BotFather** and send `/newbot`. Pick a name and a username ending in `bot`. BotFather replies with a **token** (looks like `123456:ABC-xyz…`). Keep it private, because anyone with it can control the bot.
2. **Create the Sheet.** Make a new Google Sheet, open **Extensions → Apps Script**, and paste in `Code.gs`. Or, with [clasp](https://github.com/google/clasp), run `clasp create --type sheets --title "Pigeon post"` then `clasp push` from this folder.
3. **Settings.** Open the script (Sheet → Extensions → Apps Script), click ⚙️ **Project Settings**:
   - Set **Time zone** to yours. It's built for Singapore: if you're elsewhere, also change `TZ` at the top of `Code.gs`.
   - Under **Script Properties**, add `BOT_TOKEN` = the token from step 1.
4. **Run setup.** In the **Editor**, choose `setup` from the function dropdown and click **Run**. Allow the permissions (if it says “Google hasn’t verified this app”, click Advanced → Go to project).
5. **Claim the bot.** Straight away, open the bot in Telegram and send `/start`. The first person to message it becomes its owner.
6. **Invite your partner.** Send `/invite` and forward the link. The bot tells you who connected, so you can check.

## Updating the code

Paste the new `Code.gs` into the Apps Script editor (or run `clasp push`). Rerun `setup` only if a change says so.

## How it works

- **Letters:** anything you send (text, photo, album, voice note, video, song, file, sticker) is posted straight away by ✍ Post (1–14 days). The bot reacts to your message with the speed. Start with `pigeon:` (1–3 days) or `sea:` (7–14 days) for those instead, or within an hour reply to your letter with `pigeon`, `sea`, `post` or `unsend`. To fix a typo, edit the message in Telegram as usual: the bot picks up the new text, as long as the letter hasn’t arrived yet.
- **Delivery:** a random time between 7am and midnight on a random day in that range, preferring days when nothing else is due to the same person. It arrives with a postmark and a ❤️ button. The sender is told when it lands and when it’s ❤️’d.
- **Pigeon loft:** 3 each. A pigeon comes home 2 days after it flies. Answering a shared prompt brings one home early. If all 3 are out, `pigeon:` letters go by post instead, and the bot says so.
- **Shared prompt:** about once a week (5–9 days apart), at a random time in the window. Tap ✍️ Answer, or reply to the question. Answers are swapped once you’ve both answered. Only one question is open at a time. After a week, whoever hasn’t answered gets a weekly reminder. If the next question is overdue by the time you’ve both answered, it comes straight away.
- **Nudge:** if nobody has posted a letter for 7 days, you both get a light writing prompt.
- **Commands:** `/shoebox`, `/pigeon`, `/prompt`, `/addprompt <question>`, `/cancel`, `/invite` (owner only), `/help`.

## The Sheet

- **Letters** (hidden, so nobody spoils a surprise): every letter, its speed, when it’s due and when it arrived. `From`/`To` are `one` (whoever set it up) and `two` (whoever joined by invite). Attachments are stored as Telegram file IDs, not copies.
- **Prompts:** the question pile. Edit or add rows here. `Level` is `1`, `2`, `3`, `yours` (asked first) or `nudge`. `Last asked` is filled in by the bot.
- **Rounds:** each weekly question and both answers. Answers sit here before they’re swapped, so don’t peek.

## Good to know

- **Quota:** personal Google accounts get 90 minutes of trigger time a day. Checking Telegram every minute uses about 30 minutes, and each time the bot stays awake (3 minutes after any message) uses up to 3 more. To use less, lower `STAY_AWAKE_MS` at the top of `Code.gs`. If Apps Script ever emails about quota, change `everyMinutes(1)` in `setup` to `everyMinutes(5)` and rerun `setup` (buttons will then take up to 5 minutes to respond after a quiet spell).
- **Timed jobs run every 10 minutes,** so a letter can arrive up to 10 minutes after its due time.
- **Test mode:** the owner can send `/testmode on` to turn every “day” into a minute (and ignore the 7am–midnight window), then `/testmode off`. The bot’s messages still say “days”.
- **If it stops responding,** open Apps Script → **Executions** to see errors.
- **To disconnect your partner,** delete `CHAT_two` in Script Properties.
