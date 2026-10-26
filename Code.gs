/**
 * Pigeon post
 *
 * A private Telegram bot for two people. Each of you sends it small letters (a poem,
 * a little thing that happened, a photo, a voice note, a song link), picks how fast
 * each one travels, and it delivers them to the other person at a random time
 * between 7am and midnight, never more than 14 days later. The receiver gets no
 * warning. They can ❤️ a letter, and the sender is told. Once a week you both get
 * the same question, and your answers are swapped once you've both replied.
 *
 * Lives inside a Google Sheet (Extensions → Apps Script). Setup is in README.md.
 * It checks Telegram for new messages once a minute, and every 10 minutes it
 * delivers letters that are due, sends prompts and brings pigeons home.
 */

const TZ = 'Asia/Singapore';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_START_HOUR = 7; // letters, prompts and pings only arrive from 7am…
const WINDOW_END_HOUR = 24; // …until midnight
const MAX_DAYS = 14; // no letter ever takes longer than this
const PIGEONS = 3; // each of you has a loft of 3
const PIGEON_AWAY_DAYS = 2; // a pigeon comes home this long after it flies
const CHANGE_WINDOW_MS = 60 * 60 * 1000; // you can change a letter's speed, or unsend it, for an hour
const PROMPT_GAP_DAYS = [5, 9]; // a new shared prompt this many days after the last one: about once a week
const NUDGE_AFTER_DAYS = [7, 8]; // a nudge once nobody has posted a letter for 7 days
const REMIND_AFTER_DAYS = 7; // a reminder to answer a prompt, repeated every 7 days
const TICK_EVERY_MS = 10 * 60 * 1000;
const STAY_AWAKE_MS = 3 * 60 * 1000; // after a message, keep listening this long for the next one (carries over between runs)
const MAX_RUN_MS = 4.5 * 60 * 1000; // Apps Script stops any run at 6 minutes, so finish well before
const SHOEBOX_RECENT = 10;

const SPEEDS = {
  // reaction: the emoji the bot puts on your message (Telegram only allows some emoji as reactions)
  post: { icon: '✉️', name: 'post', reaction: '✍', min: 1, max: 14 }, // the default
  pigeon: { icon: '🕊️', name: 'pigeon', reaction: '🕊', min: 1, max: 3 },
  sea: { icon: '🐳', name: 'sea mail', reaction: '🐳', min: 7, max: 14 },
};

// How each kind of attachment is sent back out. Albums can only hold the "groupable" ones.
const MEDIA = {
  photo: { method: 'sendPhoto', icon: '📷', name: 'photo', caption: true, groupable: true },
  video: { method: 'sendVideo', icon: '🎬', name: 'video', caption: true, groupable: true },
  animation: { method: 'sendAnimation', icon: '🎞', name: 'GIF', caption: true },
  document: { method: 'sendDocument', icon: '📎', name: 'file', caption: true, groupable: true },
  audio: { method: 'sendAudio', icon: '🎵', name: 'song', caption: true, groupable: true },
  voice: { method: 'sendVoice', icon: '🎙', name: 'voice note', caption: true },
  video_note: { method: 'sendVideoNote', icon: '📹', name: 'video message' },
  sticker: { method: 'sendSticker', icon: '🏷', name: 'sticker' },
};

// The two people. "one" set the bot up; "two" joined with /invite.
const PEOPLE = ['one', 'two'];
const NUM = { one: 1, two: 2 }; // their column numbers on the Rounds tab

const LETTER_HEADERS = ['ID', 'Written', 'From', 'To', 'Kind', 'Text', 'Files', 'Speed', 'Status', 'Due', 'Delivered', 'Hearted', 'Album', 'Message ID'];
const L = { id: 1, written: 2, from: 3, to: 4, kind: 5, text: 6, files: 7, speed: 8, status: 9, due: 10, delivered: 11, hearted: 12, album: 13, messageId: 14 };
const PROMPT_HEADERS = ['Prompt', 'Level', 'Added by', 'Last asked'];
const P = { prompt: 1, level: 2, addedBy: 3, lastAsked: 4 };
const ROUND_HEADERS = ['Round', 'Prompt', 'Sent', 'Answer 1', 'Answered 1', 'Answer 2', 'Answered 2', 'Delivered', 'Reminded 1', 'Reminded 2', 'Msg 1', 'Msg 2'];
const R = { round: 1, prompt: 2, sent: 3, answer1: 4, answered1: 5, answer2: 6, answered2: 7, delivered: 8, reminded1: 9, reminded2: 10, msg1: 11, msg2: 12 };

const props = PropertiesService.getScriptProperties();

const other = user => (user === 'one' ? 'two' : 'one');
const chatOf = user => props.getProperty('CHAT_' + user);
const nameOf = user => props.getProperty('NAME_' + user) || 'your partner';
const bothConnected = () => Boolean(chatOf('one') && chatOf('two'));

// Test mode (/testmode on): every "day" is a minute and the 7am–midnight window is ignored,
// so you can watch letters, pigeons and prompts work without waiting.
const testMode = () => props.getProperty('TEST_MODE') === 'on';
const dayMs = () => (testMode() ? 60 * 1000 : DAY_MS);

function help(user) {
  const o = nameOf(other(user));
  return [
    '💌 <b>How this works</b>',
    '',
    'Send me anything small, as often as you like: a poem, a little thing that happened, a photo, a voice note, a song link. Each message is posted straight away.',
    '',
    `✍ <b>Post</b> (the default): arrives sometime in the next 1–14 days, spread out so ${o} gets about one a day at most.`,
    `🕊 <b>Pigeon</b>: 1–3 days. You have ${PIGEONS}, and each comes home ${PIGEON_AWAY_DAYS} days after it flies.`,
    `🐳 <b>Sea mail</b>: 7–14 days.`,
    '',
    'For pigeon or sea mail, start the message with <b>pigeon:</b> or <b>sea:</b>. Or, within an hour, reply to your message with <b>pigeon</b>, <b>sea</b>, <b>post</b> or <b>unsend</b>. My reaction on your message shows how it’s travelling.',
    '',
    `Letters land between 7am and midnight, and ${o} won’t know they’re coming. I’ll tell you when each one arrives, and when ${o} ❤️s it.`,
    '',
    `💭 Once a week you both get the same question. Your answers stay sealed until you’ve both replied. Answering brings a pigeon home early.`,
    '',
    '/shoebox: letters you’ve received',
    '/pigeon: how many pigeons are home',
    '/prompt: this week’s question',
    '/addprompt: add a question to the pile',
    user === 'one' ? '/invite: a link to connect your partner' : null,
  ].filter(l => l !== null).join('\n');
}

// ---------- Setup ----------

/** Run once from the editor, after adding BOT_TOKEN to Script Properties. Safe to rerun. */
function setup() {
  if (!props.getProperty('BOT_TOKEN')) {
    throw new Error('Add BOT_TOKEN in Project Settings → Script Properties first.');
  }
  if (Session.getScriptTimeZone() !== TZ) {
    throw new Error('Set the time zone to Singapore in Project Settings first, so letters arrive at the right time.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('SHEET_ID', ss.getId());
  let letters = ss.getSheetByName('Letters');
  if (!letters) {
    letters = ss.insertSheet('Letters');
    letters.appendRow(LETTER_HEADERS);
    letters.setFrozenRows(1);
    letters.setColumnWidth(L.text, 400);
  }
  if (!ss.getSheetByName('Rounds')) {
    const rounds = ss.insertSheet('Rounds');
    rounds.appendRow(ROUND_HEADERS);
    rounds.setFrozenRows(1);
  }
  if (!ss.getSheetByName('Prompts')) {
    const prompts = ss.insertSheet('Prompts');
    prompts.appendRow(PROMPT_HEADERS);
    prompts.setFrozenRows(1);
    prompts.setColumnWidth(P.prompt, 500);
    const seed = [];
    Object.keys(STARTER_PROMPTS).forEach(level =>
      STARTER_PROMPTS[level].forEach(p => seed.push([p, level, 'starter', ''])));
    prompts.getRange(2, 1, seed.length, PROMPT_HEADERS.length).setValues(seed);
  }
  // Hide the letters, so nobody spoils a surprise by opening the Sheet
  letters.hideSheet();
  if (!props.getProperty('NEXT_ID')) props.setProperty('NEXT_ID', '1');

  tg('deleteWebhook', {}); // getUpdates only works without a webhook
  tg('setMyCommands', {
    commands: [
      { command: 'shoebox', description: 'Letters you’ve received' },
      { command: 'pigeon', description: 'How many pigeons are home' },
      { command: 'prompt', description: 'This week’s question' },
      { command: 'addprompt', description: 'Add a question to the pile' },
      { command: 'help', description: 'How this works' },
    ],
  });

  // This script only has this one trigger, so it's safe to start fresh
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkMessages').timeBased().everyMinutes(1).create();

  console.log('Done. If you haven’t yet, open your bot in Telegram and send it /start.');
}

/**
 * One-off (21 Oct 2026): the Sheet was on US Pacific time until 21 Oct, so times saved before
 * then are 15 hours early. This moves them forward. A time is only moved if the result isn't in
 * the future, which skips anything saved after the switch; a due date moves with its letter.
 */
function fixTimes() {
  if (props.getProperty('TIMES_FIXED')) throw new Error('Already done. Running it again would move the times twice.');
  const lock = LockService.getScriptLock();
  lock.waitLock(5 * 60 * 1000); // so the bot isn't saving anything halfway through
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TZ);
  const SHIFT = 15 * 60 * 60 * 1000;
  const now = Date.now();
  let moved = 0;
  const fixColumn = (sheet, col, shouldMove) => {
    if (sheet.getLastRow() < 2) return [];
    const range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    const rows = range.getValues();
    const did = rows.map((r, i) => {
      if (!(r[0] instanceof Date) || !shouldMove(r[0], i)) return false;
      r[0] = new Date(r[0].getTime() + SHIFT);
      moved++;
      return true;
    });
    range.setValues(rows);
    return did;
  };
  const past = v => v.getTime() + SHIFT <= now;

  const letters = lettersSheet();
  const writtenMoved = fixColumn(letters, L.written, past);
  fixColumn(letters, L.due, (v, i) => writtenMoved[i]);
  [L.delivered, L.hearted].forEach(col => fixColumn(letters, col, past));
  [R.sent, R.answered1, R.answered2, R.delivered, R.reminded1, R.reminded2].forEach(col => fixColumn(roundsSheet(), col, past));
  fixColumn(promptsSheet(), P.lastAsked, past);

  props.setProperty('TIMES_FIXED', new Date().toISOString());
  lock.releaseLock();
  console.log(`Moved ${moved} times forward by 15 hours. Sheet time zone is now ${TZ}.`);
}

/** Run from the editor to check time zones. Logs times only, never letter text. */
function checkTimeZone() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log(`Sheet time zone: ${ss.getSpreadsheetTimeZone()} · script time zone: ${Session.getScriptTimeZone()}`);
  const when = v => v instanceof Date ? Utilities.formatDate(v, TZ, 'EEE d MMM, HH:mm') : '—';
  letters().forEach(l => console.log(`Letter ${l.id} from ${l.from}: written ${when(l.written)} · ` +
    (l.status === 'in transit' ? 'still on its way' : `${l.status} ${when(l.delivered)}`)));
}

// ---------- Trigger ----------

/**
 * Runs every minute. It fetches new Telegram messages and button taps, then (every
 * 10 minutes) does the timed jobs. After any activity it stays awake for 3 minutes
 * (across runs, since each run stops at 4.5), so follow-ups are answered within seconds.
 */
function checkMessages() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // previous run still going
  try {
    const start = Date.now();
    // Pick up where the last run left off, if someone messaged in the last few minutes
    const previous = Number(props.getProperty('LAST_ACTIVITY') || 0);
    let lastActivity = start - previous < STAY_AWAKE_MS ? previous : 0;
    let ticked = false;
    do {
      const timeout = lastActivity ? 10 : 0; // once awake, wait up to 10s for the next message
      const offset = Number(props.getProperty('UPDATE_OFFSET') || 0);
      const updates = tg('getUpdates', { offset, timeout, allowed_updates: ['message', 'edited_message', 'callback_query'] }) || [];
      updates.forEach(u => {
        // Move the offset first so one bad message can't jam the queue
        props.setProperty('UPDATE_OFFSET', String(u.update_id + 1));
        try { handleUpdate(u); } catch (err) { console.error(err); }
      });
      if (updates.length) {
        lastActivity = Date.now();
        props.setProperty('LAST_ACTIVITY', String(lastActivity));
      }
      // Timed jobs after answering messages, so replies aren't held up
      if (!ticked && Date.now() - Number(props.getProperty('LAST_TICK') || 0) >= (testMode() ? 0 : TICK_EVERY_MS)) {
        ticked = true;
        props.setProperty('LAST_TICK', String(Date.now()));
        try { tick(); } catch (err) { console.error(err); }
      }
    } while (lastActivity && Date.now() - lastActivity < STAY_AWAKE_MS && Date.now() - start < MAX_RUN_MS);
  } finally {
    lock.releaseLock();
  }
}

/** The timed jobs: deliver due letters, bring pigeons home, prompts, nudges. */
function tick() {
  const now = new Date();
  deliverDueLetters(now); // due times are always in the window, so this only runs late by a few minutes
  if (!inWindow(now)) return;
  PEOPLE.forEach(user => tellIfPigeonHome(user));
  if (!bothConnected()) return;
  remindUnanswered(now);
  maybeSendPrompt(now);
  maybeNudge(now);
}

// ---------- Handling messages ----------

function handleUpdate(u) {
  const msg = u.message || u.edited_message;
  const chat = msg ? msg.chat : u.callback_query ? u.callback_query.message.chat : null;
  if (!chat || chat.type !== 'private') return;

  // The first person to message the bot becomes "one". "two" joins with an invite
  // link from /invite. Everyone else is ignored.
  if (!chatOf('one')) {
    if (!u.message) return;
    props.setProperty('CHAT_one', String(chat.id));
    props.setProperty('NAME_one', u.message.from.first_name || 'You');
    send('one', `Hello ${escapeHtml(nameOf('one'))}! This bot is yours now.\n\n` + help('one') +
      '\n\nNext, send /invite and forward the link to your partner.');
    return;
  }
  const user = PEOPLE.find(p => chatOf(p) === String(chat.id));
  if (!user) {
    if (u.message) acceptInvite(u.message);
    return;
  }
  if (u.callback_query) handleTap(u.callback_query, user);
  else if (u.edited_message) handleEdit(u.edited_message, user);
  else handleMessage(u.message, user);
}

function handleMessage(msg, user) {
  const text = (msg.text || msg.caption || '').trim();
  if (msg.text && text.startsWith('/')) return handleCommand(text, user);

  // An answer to the shared prompt: after tapping ✍️ Answer, or as a reply to the prompt
  const awaiting = props.getProperty('AWAITING_' + user);
  const repliedRound = msg.reply_to_message ? roundForMessage(user, msg.reply_to_message.message_id) : null;
  if (awaiting || repliedRound) {
    if (!text) return send(user, 'Answers can only be text. Try typing it out?');
    props.deleteProperty('AWAITING_' + user);
    return recordAnswer(user, repliedRound || Number(awaiting), text);
  }

  // A reply to one of your own letters with just "pigeon", "sea", "post" or "unsend" changes it
  const change = text.toLowerCase().replace(/[.!]+$/, '').trim();
  if (msg.reply_to_message && CHANGE_WORDS[change]) {
    const letter = letters().find(l => l.from === user && l.messageId === msg.reply_to_message.message_id);
    if (letter) return changeLetter(letter, CHANGE_WORDS[change], user);
  }

  writeLetter(msg, user, text);
}

/** You edited a message in Telegram: if it's a letter that hasn't arrived yet, update its text. */
function handleEdit(msg, user) {
  const letter = letters().find(l => l.from === user && l.messageId === msg.message_id);
  if (!letter || letter.status === 'cancelled') return;
  if (letter.status === 'delivered') {
    return send(user, `That letter arrived on ${day(letter.delivered)}, so your edit won’t reach ${escapeHtml(nameOf(letter.to))}.`);
  }
  // The speed stays as it is: a "pigeon:" added in an edit is just tidied away
  const text = (msg.text || msg.caption || '').trim().replace(SPEED_PREFIX, '');
  lettersSheet().getRange(letter.row, L.text).setValue(safe(text));
  tg('sendMessage', { chat_id: chatOf(user), text: '✏️ Got your edit. That’s the version they’ll get.', reply_parameters: { message_id: msg.message_id } });
}

const CHANGE_WORDS = { pigeon: 'pigeon', post: 'post', sea: 'sea', 'sea mail': 'sea', unsend: 'unsend', cancel: 'unsend', 'don’t send': 'unsend', "don't send": 'unsend' };

function handleCommand(text, user) {
  const command = text.split(/[\s@]/)[0].toLowerCase();
  const args = text.slice(text.split(/\s/)[0].length).trim();

  if (command === '/shoebox') {
    sendShoebox(user);
  } else if (command === '/pigeon') {
    send(user, pigeonStatus(user));
  } else if (command === '/prompt') {
    sendPromptStatus(user);
  } else if (command === '/addprompt') {
    addPrompt(args, user);
  } else if (command === '/cancel') {
    props.deleteProperty('AWAITING_' + user);
    send(user, 'Okay. Your next message will be a letter again.');
  } else if (command === '/invite' && user === 'one') {
    sendInvite();
  } else if (command === '/testmode' && user === 'one') {
    setTestMode(args.toLowerCase() === 'off' ? 'off' : 'on');
  } else {
    send(user, help(user));
  }
}

// ---------- Writing letters ----------

// "pigeon: …" or "sea: …" at the start of a message picks its speed
const SPEED_PREFIX = /^\s*(pigeon|sea(?:\s*mail)?|post)\s*:\s*/i;

/** Posts a new letter straight away (or adds to one, for a photo album) and reacts to show its speed. */
function writeLetter(msg, user, text) {
  if (!chatOf(other(user))) {
    return send(user, 'Your partner isn’t connected yet, so there’s nowhere to post this.' +
      (user === 'one' ? ' Send /invite to get a link for them.' : ''));
  }
  const file = fileOf(msg);
  if (!file && !msg.text) {
    return send(user, 'I can post text, photos, videos, voice notes, songs, files and stickers, but not that one, sorry.');
  }

  let speedKey = 'post';
  const m = text.match(SPEED_PREFIX);
  if (m) {
    speedKey = m[1].toLowerCase().startsWith('sea') ? 'sea' : m[1].toLowerCase();
    text = text.slice(m[0].length).trim();
  }

  // Photos sent together arrive as separate messages with the same album ID: keep them as one letter
  const cache = CacheService.getScriptCache();
  if (msg.media_group_id) {
    const existing = cache.get('album:' + msg.media_group_id);
    if (existing) {
      const letter = letters().find(l => l.id === Number(existing));
      if (letter && letter.status === 'in transit') {
        letter.files.push(file);
        const sheet = lettersSheet();
        sheet.getRange(letter.row, L.files).setValue(JSON.stringify(letter.files));
        sheet.getRange(letter.row, L.kind).setValue(kindOf(letter.files));
        if (text && !letter.text) sheet.getRange(letter.row, L.text).setValue(safe(text));
        return;
      }
    }
  }

  let note = '';
  if (speedKey === 'pigeon' && !sendPigeon(user)) {
    speedKey = 'post';
    note = `🕊 No pigeons home right now (the next one’s back ${day(nextPigeonBack(user))}), so this one’s gone by post.`;
  }

  const files = file ? [file] : [];
  const id = Number(props.getProperty('NEXT_ID') || 1);
  props.setProperty('NEXT_ID', String(id + 1));
  const now = new Date();
  const sheet = lettersSheet();
  sheet.appendRow([id, now, user, other(user), kindOf(files), safe(text), JSON.stringify(files),
    '', '', '', '', '', msg.media_group_id || '', msg.message_id]);
  if (sheet.getRange(1, L.messageId).getValue() !== 'Message ID') sheet.getRange(1, L.messageId).setValue('Message ID'); // older Sheets
  if (msg.media_group_id) cache.put('album:' + msg.media_group_id, String(id), 3600);

  postLetter({ row: sheet.getLastRow(), to: other(user) }, speedKey, now);
  react(user, msg.message_id, SPEEDS[speedKey].reaction);
  if (note) send(user, note);
}

/** Puts a letter in transit with a random delivery time. */
function postLetter(letter, speedKey, now) {
  const due = pickDeliveryTime(letter.to, SPEEDS[speedKey], now);
  lettersSheet().getRange(letter.row, L.speed, 1, 3).setValues([[speedKey, 'in transit', due]]);
  scheduleNudge(now);
}

/** A reply of "pigeon", "sea", "post" or "unsend" to one of your letters, within an hour of writing it. */
function changeLetter(letter, change, user) {
  const now = new Date();
  if (letter.status !== 'in transit' || now - letter.written > (testMode() ? 2 * 60 * 1000 : CHANGE_WINDOW_MS)) {
    return send(user, 'That one’s already on its way, so it’s too late to change it.');
  }
  if (change === 'unsend') {
    lettersSheet().getRange(letter.row, L.status).setValue('cancelled');
    if (letter.speed === 'pigeon') returnPigeon(user);
    react(user, letter.messageId, null);
    return send(user, '✖ Unsent. That one won’t be delivered.');
  }
  if (change === letter.speed) return send(user, `It’s already going by ${SPEEDS[change].name}.`);
  if (change === 'pigeon' && !sendPigeon(user)) {
    return send(user, `🕊 No pigeons home right now. The next one’s back ${day(nextPigeonBack(user))}.`);
  }
  if (letter.speed === 'pigeon') returnPigeon(user);
  postLetter(letter, change, letter.written); // counted from when it was written, so the 14-day cap holds
  react(user, letter.messageId, SPEEDS[change].reaction);
  const speed = SPEEDS[change];
  send(user, `${speed.reaction} Now going by ${speed.name}: ${speed.min}–${speed.max} days.` +
    (change === 'pigeon' ? ` ${pigeonsHome(user)} of ${PIGEONS} pigeons left at home.` : ''));
}

/** Puts an emoji reaction on one of your messages (or clears it, with null). */
function react(user, messageId, emoji) {
  tg('setMessageReaction', { chat_id: chatOf(user), message_id: messageId, reaction: emoji ? [{ type: 'emoji', emoji }] : [] });
}

/**
 * Picks a random day within the speed's range, preferring days when nothing else is
 * due to the same person (so letters don't pile up), then a random time between
 * 7am and midnight. Never later than MAX_DAYS after now.
 */
function pickDeliveryTime(to, speed, now) {
  if (testMode()) return new Date(now.getTime() + (speed.min + Math.random() * (speed.max - speed.min)) * dayMs());
  const perDay = {};
  letters().filter(l => l.to === to && l.status === 'in transit')
    .forEach(l => { perDay[dayKey(l.due)] = (perDay[dayKey(l.due)] || 0) + 1; });

  const cap = now.getTime() + MAX_DAYS * DAY_MS;
  const days = [];
  for (let d = speed.min; d <= speed.max; d++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, WINDOW_START_HOUR).getTime();
    const end = Math.min(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, WINDOW_END_HOUR).getTime(), cap);
    if (end > start) days.push({ start, end, load: perDay[dayKey(new Date(start))] || 0 });
  }
  const lightest = Math.min(...days.map(d => d.load));
  const choices = days.filter(d => d.load === lightest);
  const pick = choices[Math.floor(Math.random() * choices.length)];
  return new Date(pick.start + Math.random() * (pick.end - pick.start));
}

// ---------- Delivering letters ----------

function deliverDueLetters(now) {
  letters().filter(l => l.status === 'in transit' && l.due <= now).forEach(letter => {
    showLetter(letter.to, letter, true);
    lettersSheet().getRange(letter.row, L.status, 1, 3).setValues([['delivered', letter.due, now]]);
    send(letter.from, `📬 Your ${SPEEDS[letter.speed].icon} letter from ${day(letter.written)} has reached ${escapeHtml(nameOf(letter.to))}: ${escapeHtml(snippet(letter, 60))}`);
  });
}

/** Sends a letter with its postmark and ❤️ button: as a new delivery, or reopened from the shoebox. */
function showLetter(user, letter, isNew) {
  const speed = SPEEDS[letter.speed];
  const written = Utilities.formatDate(letter.written, TZ, 'EEE d MMM, h:mma').replace('AM', 'am').replace('PM', 'pm');
  const postmark = isNew
    ? `Posted ${daysAgo(letter.written)}, ${written} · ${speed.icon} ${speed.name}`
    : `Posted ${written} · arrived ${day(letter.delivered)} · ${speed.icon} ${speed.name}`;
  const body = `📮 <b>A letter from ${escapeHtml(nameOf(letter.from))}</b>\n<i>${postmark}</i>` +
    (letter.text ? '\n\n' + escapeHtml(letter.text) : '');
  const markup = { inline_keyboard: [[heartButton(letter, Boolean(letter.hearted))]] };

  const files = letter.files;
  if (files.length === 1 && MEDIA[files[0].type].caption && body.length <= 1000) {
    return sendFile(user, files[0], body, markup);
  }
  send(user, body, markup, true);
  if (files.length > 1 && files.every(f => MEDIA[f.type].groupable)) {
    for (let i = 0; i < files.length; i += 10) { // albums hold up to 10
      tg('sendMediaGroup', { chat_id: chatOf(user), media: files.slice(i, i + 10).map(f => ({ type: f.type, media: f.id })) });
    }
  } else {
    files.forEach(f => sendFile(user, f));
  }
}

function heartButton(letter, hearted) {
  return { text: hearted ? '❤️ Sent' : '❤️', callback_data: 'heart:' + letter.id };
}

// ---------- Buttons ----------

function handleTap(cb, user) {
  const [action, id] = cb.data.split(':');
  const answer = text => tg('answerCallbackQuery', { callback_query_id: cb.id, text });

  if (action === 'answer') {
    props.setProperty('AWAITING_' + user, id);
    answer('');
    return send(user, '✍️ Go ahead: your next message is your answer. (Send /cancel to write a letter instead.)');
  }
  if (action === 'month') {
    answer('');
    return sendShoeboxMonth(user, id);
  }

  const letter = letters().find(l => l.id === Number(id));
  if (!letter) return answer('Couldn’t find that letter');

  if (action === 'open') {
    if (letter.to !== user || letter.status !== 'delivered') return answer('');
    answer('');
    return showLetter(user, letter, false);
  }

  if (action === 'heart') {
    if (letter.to !== user) return answer('');
    if (letter.hearted) return answer('Already sent ❤️');
    lettersSheet().getRange(letter.row, L.hearted).setValue(new Date());
    tg('editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[heartButton(letter, true)]] } });
    answer('❤️');
    return send(letter.from, `❤️ ${escapeHtml(nameOf(user))} loved your letter from ${day(letter.written)}: ${escapeHtml(snippet(letter, 60))}`);
  }
  answer('');
}

// ---------- Pigeons ----------
// Each person's loft is stored as a list of times their pigeons that are out will come home.

function pigeonsOut(user) {
  return JSON.parse(props.getProperty('PIGEONS_' + user) || '[]').filter(t => t > Date.now()).sort((a, b) => a - b);
}

function pigeonsHome(user) {
  return PIGEONS - pigeonsOut(user).length;
}

function nextPigeonBack(user) {
  const out = pigeonsOut(user);
  return out.length ? new Date(out[0]) : null;
}

/** Sends a pigeon off, if one's home. Returns false if they're all out. */
function sendPigeon(user) {
  const out = pigeonsOut(user);
  if (out.length >= PIGEONS) return false;
  out.push(Date.now() + PIGEON_AWAY_DAYS * dayMs());
  props.setProperty('PIGEONS_' + user, JSON.stringify(out));
  if (out.length >= PIGEONS) props.setProperty('LOFT_EMPTY_' + user, '1'); // so we can say when one's back
  return true;
}

/** Brings one pigeon home early (the one that would've been out longest). Returns false if none were out. */
function returnPigeon(user) {
  const out = pigeonsOut(user);
  if (!out.length) return false;
  out.pop();
  props.setProperty('PIGEONS_' + user, JSON.stringify(out));
  props.deleteProperty('LOFT_EMPTY_' + user);
  return true;
}

function pigeonStatus(user) {
  const home = pigeonsHome(user);
  const next = nextPigeonBack(user);
  return `🕊 ${home} of ${PIGEONS} pigeons home.` +
    (next ? ` The next one’s back ${day(next)}.` : '') +
    (home === 0 ? ' Answering this week’s question (/prompt) brings one home early.' : '');
}

/** If someone had run out of pigeons, tell them once one's home. */
function tellIfPigeonHome(user) {
  if (!props.getProperty('LOFT_EMPTY_' + user) || !pigeonsHome(user) || !chatOf(user)) return;
  props.deleteProperty('LOFT_EMPTY_' + user);
  send(user, '🕊 A pigeon’s home and ready to fly.');
}

// ---------- Shoebox ----------

function received(user) {
  return letters().filter(l => l.to === user && l.status === 'delivered').sort((a, b) => b.delivered - a.delivered);
}

/** /shoebox: the most recent letters, then a button for each month. */
function sendShoebox(user) {
  const all = received(user);
  if (!all.length) return send(user, '🗃 Your shoebox is empty for now. Letters land here once they arrive.');
  const months = [];
  all.forEach(l => {
    const key = Utilities.formatDate(l.delivered, TZ, 'yyyy-MM');
    const m = months.find(x => x.key === key);
    if (m) m.count++;
    else months.push({ key, label: Utilities.formatDate(l.delivered, TZ, 'MMM yyyy'), count: 1 });
  });
  const buttons = all.slice(0, SHOEBOX_RECENT).map(l => [shoeboxButton(l)]);
  if (months.length > 1 || all.length > SHOEBOX_RECENT) {
    months.forEach(m => buttons.push([{ text: `📁 ${m.label} (${m.count})`, callback_data: 'month:' + m.key }]));
  }
  send(user, `🗃 <b>Your shoebox</b> · ${all.length} ${all.length === 1 ? 'letter' : 'letters'}\nTap one to open it.`, { inline_keyboard: buttons });
}

function sendShoeboxMonth(user, key) {
  const inMonth = received(user).filter(l => Utilities.formatDate(l.delivered, TZ, 'yyyy-MM') === key);
  if (!inMonth.length) return send(user, 'Nothing from that month.');
  const label = Utilities.formatDate(inMonth[0].delivered, TZ, 'MMMM yyyy');
  send(user, `📁 <b>${label}</b>`, { inline_keyboard: inMonth.slice(0, 90).map(l => [shoeboxButton(l)]) });
}

function shoeboxButton(l) {
  const label = `${day(l.written)} · ${l.hearted ? '❤️ ' : ''}${snippet(l, 40)}`;
  return { text: label, callback_data: 'open:' + l.id };
}

// ---------- Shared prompts ----------

/** Sends a new shared prompt if one's due and none is waiting on answers. */
function maybeSendPrompt(now) {
  if (openRound()) return;
  const nextAt = Number(props.getProperty('NEXT_PROMPT_AT') || 0);
  if (!nextAt || nextAt > now.getTime() || !inWindow(now)) return;

  const prompt = pickPrompt(false);
  if (!prompt) return;
  const sheet = roundsSheet();
  const round = sheet.getLastRow(); // rounds are numbered 1, 2, 3…
  sheet.appendRow([round, prompt, now, '', '', '', '', '', '', '', '', '']);
  const row = sheet.getLastRow();
  PEOPLE.forEach(user => {
    const sent = tg('sendMessage', {
      chat_id: chatOf(user),
      text: `💭 <b>This week’s question</b>\n\n${escapeHtml(prompt)}\n\n<i>Your answer stays sealed until ${escapeHtml(nameOf(other(user)))} answers too.</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '✍️ Answer', callback_data: 'answer:' + round }]] },
    });
    if (sent) sheet.getRange(row, R['msg' + NUM[user]]).setValue(sent.message_id);
  });
  props.setProperty('NEXT_PROMPT_AT', String(randomMomentInDays(now, PROMPT_GAP_DAYS).getTime()));
}

function recordAnswer(user, round, text) {
  const r = rounds().find(x => x.round === round);
  if (!r) return send(user, 'I couldn’t find that question.');
  if (r.delivered) return send(user, 'You’ve both already answered that one. /prompt shows the current question.');
  const sheet = roundsSheet();
  const n = NUM[user];
  const replacing = Boolean(r['answer' + n]);
  sheet.getRange(r.row, R['answer' + n], 1, 2).setValues([[safe(text), new Date()]]);
  r['answer' + n] = text;

  // Answering brings a pigeon home early
  const woke = !replacing && returnPigeon(user);

  const o = other(user);
  if (r['answer' + NUM[o]]) return deliverRound(r);
  send(user, `💭 ${replacing ? 'Updated' : 'Sealed'}. I’ll swap answers once ${escapeHtml(nameOf(o))} has answered too.` +
    (woke ? `\n\n🕊 One of your pigeons flew home early. ${pigeonsHome(user)} of ${PIGEONS} home now.` : ''));
}

/** Both have answered: each gets the other's answer. If the next prompt is overdue, it goes out now. */
function deliverRound(r) {
  roundsSheet().getRange(r.row, R.delivered).setValue(new Date());
  PEOPLE.forEach(user => {
    const o = other(user);
    send(user, [
      `💭 <b>${escapeHtml(r.prompt)}</b>`,
      '',
      `<b>${escapeHtml(nameOf(o))}:</b> ${escapeHtml(r['answer' + NUM[o]])}`,
      '',
      `<b>You:</b> ${escapeHtml(r['answer' + NUM[user]])}`,
    ].join('\n'));
  });
  maybeSendPrompt(new Date());
}

/** A week after a prompt (and every week after that), ping whoever hasn't answered. */
function remindUnanswered(now) {
  const r = openRound();
  if (!r) return;
  PEOPLE.forEach(user => {
    const n = NUM[user];
    if (r['answer' + n]) return;
    const since = r['reminded' + n] || r.sent;
    if (now - since < REMIND_AFTER_DAYS * dayMs()) return;
    const o = other(user);
    const waiting = r['answer' + NUM[o]] ? ` ${escapeHtml(nameOf(o))} has answered, and their answer is waiting for yours.` : '';
    tg('sendMessage', {
      chat_id: chatOf(user),
      text: `💭 A gentle nudge: this week’s question is still open.${waiting}\n\n<i>${escapeHtml(r.prompt)}</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '✍️ Answer', callback_data: 'answer:' + r.round }]] },
    });
    roundsSheet().getRange(r.row, R['reminded' + n]).setValue(now);
  });
}

function sendPromptStatus(user) {
  const r = openRound();
  if (!r) return send(user, '💭 No question open right now. The next one arrives sometime this week.');
  const o = other(user);
  const mine = r['answer' + NUM[user]];
  const theirs = r['answer' + NUM[o]];
  const status = mine
    ? `You’ve answered. Waiting on ${escapeHtml(nameOf(o))}. (Tap below to change your answer.)`
    : theirs ? `${escapeHtml(nameOf(o))} has answered and is waiting on you.` : 'Neither of you has answered yet.';
  tg('sendMessage', {
    chat_id: chatOf(user),
    text: `💭 <b>This week’s question</b>\n\n${escapeHtml(r.prompt)}\n\n<i>${status}</i>`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: mine ? '✍️ Change my answer' : '✍️ Answer', callback_data: 'answer:' + r.round }]] },
  });
}

function addPrompt(text, user) {
  if (!text) return send(user, 'Write the question after the command, e.g. <b>/addprompt What’s a smell that takes you back?</b>');
  promptsSheet().appendRow([safe(text), 'yours', user, '']);
  send(user, '💭 Added to the pile. Questions you add get asked before the starter ones.');
}

/**
 * Picks the next question. Shared: ones you've added first, then the starter levels
 * in order (1, 2, 3). Nudges: any nudge. Once they've all been asked, the
 * longest-unasked one comes round again.
 */
function pickPrompt(isNudge) {
  const sheet = promptsSheet();
  if (sheet.getLastRow() < 2) return null;
  const all = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROMPT_HEADERS.length).getValues()
    .map((r, i) => ({ row: i + 2, prompt: String(r[0]).trim(), level: String(r[1]).trim(), lastAsked: r[3] }))
    .filter(p => p.prompt && (p.level === 'nudge') === isNudge);
  if (!all.length) return null;

  const rank = p => (p.level === 'yours' ? 0 : Number(p.level) || 9);
  let pool = all.filter(p => !p.lastAsked);
  if (pool.length) {
    const best = Math.min(...pool.map(rank));
    pool = isNudge ? pool : pool.filter(p => rank(p) === best);
  } else {
    const oldest = Math.min(...all.map(p => p.lastAsked.getTime()));
    pool = all.filter(p => p.lastAsked.getTime() === oldest);
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  sheet.getRange(pick.row, P.lastAsked).setValue(new Date());
  return pick.prompt;
}

// ---------- Nudges ----------

/** Sets the next nudge for 7–8 days from now. Called whenever a letter is posted. */
function scheduleNudge(from) {
  props.setProperty('NUDGE_AT', String(randomMomentInDays(from, NUDGE_AFTER_DAYS).getTime()));
}

function maybeNudge(now) {
  const at = Number(props.getProperty('NUDGE_AT') || 0);
  if (!at || at > now.getTime()) return;
  const nudge = pickPrompt(true);
  if (nudge) PEOPLE.forEach(user => send(user, `✏️ It’s been a quiet week in the post. Something to write about, if you like:\n\n<i>${escapeHtml(nudge)}</i>`));
  scheduleNudge(now);
}

// ---------- Test mode ----------

function setTestMode(state) {
  if (state === 'on') {
    props.setProperty('TEST_MODE', 'on');
    if (bothConnected()) {
      const now = new Date();
      props.setProperty('NEXT_PROMPT_AT', String(randomMomentInDays(now, [1, 2]).getTime()));
      scheduleNudge(now);
    }
    return send('one', '🧪 <b>Test mode on.</b> Days are now minutes: post 1–14, pigeon 1–3, sea mail 7–14. Pigeons come home 2 minutes after flying, you can change or unsend a letter for 2 minutes, a question comes every 5–9 minutes, and a nudge after 7 quiet minutes. Any time of day counts as the delivery window.\n\nSend <b>/testmode off</b> when you’re done.');
  }
  props.deleteProperty('TEST_MODE');
  const now = new Date();
  PEOPLE.forEach(user => { props.deleteProperty('PIGEONS_' + user); props.deleteProperty('LOFT_EMPTY_' + user); }); // all pigeons home
  if (bothConnected()) {
    props.setProperty('NEXT_PROMPT_AT', String(randomMomentInDays(now, [2, 5]).getTime()));
    scheduleNudge(now);
  }
  send('one', '🧪 Test mode off. Back to real days. Letters already in transit keep their test times, so they’ll still arrive soon. To clear out test letters, rows can be deleted from the hidden Letters tab.');
}

// ---------- Connecting your partner ----------

/** /invite: a one-time link for your partner to connect. */
function sendInvite() {
  const code = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  props.setProperty('INVITE_CODE', code);
  const username = tg('getMe', {}).username;
  send('one', [
    'Forward this link to your partner. It works once, and only for the next person who taps it:',
    `https://t.me/${username}?start=${code}`,
    '',
    'I’ll tell you who connected, so you can check it’s really them.',
  ].join('\n'));
}

/** Someone new messaged the bot: connect them if they used the invite link. */
function acceptInvite(msg) {
  const code = props.getProperty('INVITE_CODE');
  if (!code || (msg.text || '').trim() !== '/start ' + code) return;
  props.setProperty('CHAT_two', String(msg.chat.id));
  props.setProperty('NAME_two', msg.from.first_name || 'Your partner');
  props.deleteProperty('INVITE_CODE');
  const now = new Date();
  props.setProperty('NEXT_PROMPT_AT', String(randomMomentInDays(now, [2, 5]).getTime()));
  scheduleNudge(now);
  send('two', `Hi ${escapeHtml(nameOf('two'))}! ${escapeHtml(nameOf('one'))} set this up for the two of you.\n\n` + help('two'));
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const handle = msg.from.username ? ` (@${msg.from.username})` : '';
  send('one', `🔗 ${escapeHtml(name + handle)} is now connected. If that’s not who you meant, send /invite again and the new link will replace them.`);
}

// ---------- Sheet ----------

function sheetNamed(name) {
  return SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getSheetByName(name);
}
const lettersSheet = () => sheetNamed('Letters');
const roundsSheet = () => sheetNamed('Rounds');
const promptsSheet = () => sheetNamed('Prompts');

function letters() {
  const sheet = lettersSheet();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, LETTER_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      id: r[L.id - 1],
      written: r[L.written - 1],
      from: r[L.from - 1],
      to: r[L.to - 1],
      text: String(r[L.text - 1]),
      files: JSON.parse(r[L.files - 1] || '[]'),
      speed: r[L.speed - 1],
      status: r[L.status - 1],
      due: r[L.due - 1],
      delivered: r[L.delivered - 1],
      hearted: r[L.hearted - 1],
      messageId: r[L.messageId - 1],
    }))
    .filter(l => l.id !== '');
}

function rounds() {
  const sheet = roundsSheet();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, ROUND_HEADERS.length).getValues()
    .map((r, i) => {
      const round = { row: i + 2 };
      Object.keys(R).forEach(k => { round[k] = r[R[k] - 1]; });
      round.answer1 = String(round.answer1);
      round.answer2 = String(round.answer2);
      return round;
    })
    .filter(r => r.round !== '');
}

/** The current question, if it's still waiting on an answer. */
function openRound() {
  return rounds().filter(r => !r.delivered).pop() || null;
}

function roundForMessage(user, messageId) {
  const r = rounds().find(x => x['msg' + NUM[user]] === messageId);
  return r ? r.round : null;
}

/** A leading apostrophe stops text like "=..." or "-..." being read as a formula. */
function safe(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// ---------- Attachments ----------

function fileOf(msg) {
  if (msg.photo) return { type: 'photo', id: msg.photo[msg.photo.length - 1].file_id }; // the largest size
  const type = Object.keys(MEDIA).find(t => t !== 'photo' && msg[t]);
  return type ? { type, id: msg[type].file_id } : null;
}

function kindOf(files) {
  return files.length ? [...new Set(files.map(f => f.type))].join(', ') : 'text';
}

function sendFile(user, file, caption, markup) {
  const media = MEDIA[file.type];
  const payload = { chat_id: chatOf(user) };
  payload[file.type] = file.id;
  if (caption && media.caption) { payload.caption = caption; payload.parse_mode = 'HTML'; }
  if (markup) payload.reply_markup = markup;
  tg(media.method, payload);
}

/** A short description of a letter, e.g. “the rain smelled like…” or “📷 photo”. */
function snippet(letter, length) {
  if (letter.text) {
    const flat = letter.text.replace(/\s+/g, ' ').trim();
    return '“' + (flat.length > length ? flat.slice(0, length - 1) + '…' : flat) + '”';
  }
  const f = letter.files[0];
  return f ? `${MEDIA[f.type].icon} ${MEDIA[f.type].name}` + (letter.files.length > 1 ? ` (+${letter.files.length - 1})` : '') : 'a letter';
}

// ---------- Time ----------

function inWindow(date) {
  if (testMode()) return true;
  const hour = date.getHours();
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** A random time between 7am and midnight, on a random day [min, max] days after `from`. */
function randomMomentInDays(from, [min, max]) {
  if (testMode()) return new Date(from.getTime() + (min + Math.random() * (max - min)) * dayMs());
  const d = min + Math.floor(Math.random() * (max - min + 1));
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, WINDOW_START_HOUR).getTime();
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d, WINDOW_END_HOUR).getTime();
  return new Date(start + Math.random() * (end - start));
}

function dayKey(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

function day(date) {
  return Utilities.formatDate(date, TZ, 'd MMM');
}

/** "earlier today", "yesterday", "9 days ago" */
function daysAgo(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const n = Math.round((today - then) / DAY_MS);
  return n === 0 ? 'earlier today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

// ---------- Telegram ----------

/** Sends a message, splitting it if it's over Telegram's length limit. Buttons go on the last part. */
function send(user, text, markup, showPreviews) {
  const chunks = [];
  let current = '';
  text.split('\n').forEach(line => {
    if (current && (current + '\n' + line).length > 4000) { chunks.push(current); current = line; }
    else current = current ? current + '\n' + line : line;
  });
  chunks.push(current);

  chunks.forEach((chunk, i) => {
    const payload = { chat_id: chatOf(user), text: chunk, parse_mode: 'HTML', link_preview_options: { is_disabled: !showPreviews } };
    if (i === chunks.length - 1 && markup) payload.reply_markup = markup;
    tg('sendMessage', payload);
  });
}

function tg(method, payload) {
  const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${props.getProperty('BOT_TOKEN')}/${method}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (!body.ok) console.error(method, body.description);
  return body.result;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Starter prompts ----------
// Copied into the Prompts tab the first time setup runs. After that, the Sheet is the
// list: edit it there, or add questions with /addprompt. (Same list as prompts.md.)

const STARTER_PROMPTS = {
  1: [
    'What did you assume about me before we really knew each other?',
    'What do you think I was like as a ten-year-old?',
    'What do you think I’m secretly proud of?',
    'Which small habit of mine do you notice that I probably don’t?',
    'What do you think I’d be doing if I’d chosen a completely different path?',
    'What song do you think I’d pick to describe this month?',
    'What do you think I worry about that I don’t say out loud?',
    'What’s something you think I’d be surprisingly good at?',
  ],
  2: [
    'When did you last feel really looked after by me?',
    'What’s a moment with me you keep replaying?',
    'What’s something I do that makes an ordinary day feel better?',
    'When do you feel closest to me: talking, doing things side by side, or in silence?',
    'What’s something you’ve wanted to tell me but never found the right moment for?',
    'What’s a version of us you’d like to see in five years?',
    'What’s one thing you’d like us to do more of?',
    'Which of our inside jokes is your favourite, and why?',
    'What’s a small thing I did that meant more to you than I realised?',
    'What’s something you’re still learning about how to love me?',
  ],
  3: [
    'How have I changed you, for better or worse?',
    'What’s something about us you’d never want to lose?',
    'What did this past week teach you about yourself?',
    'What’s a fear about us you’d feel better saying out loud?',
    'What do you hope I remember about this season of our lives?',
    'What’s something you forgive me for that I might not know about?',
    'If you could write me one sentence to read in ten years, what would it be?',
  ],
  nudge: [
    'What did you notice on your commute today?',
    'What’s the best thing you ate this week?',
    'Did anything make you laugh out loud lately?',
    'What’s a stranger you saw this week and the story you made up about them?',
    'What’s a smell or sound that reminded you of something today?',
    'Write a four-line poem about the weather right now.',
    'What’s one thing on your desk, and why is it there?',
    'What did you overhear today?',
    'What’s something small you’re looking forward to?',
    'Describe the sky the last time you looked up.',
  ],
};
