# Pigeon post: spec

## Original brief

A private Telegram bot between two partners. It should feel like snail/pigeon mail: you send in a small poem or a small happenstance, things too benign to bring up right away because that would feel like spam. The time between sending a message and the other person receiving it is random, but never more than 2 weeks.

Both partners have the same features and functions.

## Principles

- **Every letter is a surprise.** The receiver gets no hint that something is on its way, and can't see how many letters are in transit.
- **Letters are slow; reactions are fast.** Letters take the random delay. The only instant reply is a one-tap emoji reaction.
- **Both people are equal.** Every feature works the same in both directions.

## Features

### Letters

- **Writing a letter:** send the bot text, a photo, a voice note or a link (e.g. a song), as many as you like. Each one is posted straight away with nothing to tap, and the bot reacts to show its speed (✍ post, 🕊 pigeon, 🐳 sea mail).
- **Postmark:** when a letter arrives, it shows when it was written, e.g. *"Posted 9 days ago, Tuesday 14 Oct, 11:42pm."*
- **Delivery at a nice moment:** letters only land between 7am and midnight SGT, never in the small hours.

### Timing

- **Delivery speed per letter:** the exact day is random within the range:
  - ✍ Post (the default): 1–14 days
  - 🕊 Pigeon: 1–3 days
  - 🐳 Sea mail: 7–14 days
- **Picking a speed:** start the message with `pigeon:` or `sea:`. Or, within an hour, reply to your own letter with `pigeon`, `sea`, `post` or `unsend`.
- **Hard cap:** no letter ever takes more than 14 days.
- **Speed limits and rewards:**
  - 🕊 **Pigeon loft:** each of you has 3 pigeons. Each carries one letter and comes home 2 days after it flies. Answering the weekly shared prompt brings one home early. If you've run out, the bot tells you when one's back.
  - ✍ **Post** and 🐳 **Sea mail:** unlimited.
- **No pile-ups:** letters are spread out so no more than one lands per day where possible. Ten letters sent at once arrive over about ten different days. This must never push a letter past its 14-day cap.

### Replies and keepsakes

- **Quick reaction:** each delivered letter has a single ❤️ button. Tapping it tells the sender instantly. No text replies.
- **Delivery receipt:** the sender is told when their letter has been delivered, e.g. *"Your letter from 14 Oct has arrived."*
- **The shoebox:** `/shoebox` lets you browse every letter you've received (not ones you've sent), most recent first, with the option to filter by month.

### Prompts

- **Gentle nudge:** if neither of you has sent a letter in 7 days, you both get a small prompt, e.g. *"What did you notice on your commute today?"*
- **Shared prompt:** once a week, at a random time in the delivery window, you both get the same question. Your answers are held until both are in, however long that takes, then delivered to each other together. Prompts live in the Sheet's Prompts tab (seeded from `prompts.md`), and you can both add your own with `/addprompt`.
  - **One prompt at a time:** no new prompt goes out until you've both answered the current one.
  - **Reminder:** if a prompt is still unanswered after a week, whoever hasn't answered gets a gentle ping. It repeats weekly until they answer.
  - **Catching up:** if a prompt ran overdue, the next one goes out as soon as both answers have been delivered. After that, prompts go back to a random time once a week.

### Practical

- **Locked to you two:** the bot only responds to your two Telegram accounts and ignores everyone else.

## Build

A Telegram bot, a Google Apps Script web app and a Google Sheet as the database (letters, delivery times, reactions). A trigger checks Telegram every minute and delivers due letters every 10 minutes. Details in `README.md`. It's free and runs without a server.
