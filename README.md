# MARV-C V1

A personal WhatsApp assistant bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) (multi-device, no official Meta API needed).

## ⚠️ Before you deploy
Baileys connects through WhatsApp's unofficial web-multi-device protocol.
This is against WhatsApp's Terms of Service. It's widely used for personal
bots like this one, but there's a real chance the linked number gets rate
limited or banned — especially if you use `kick`/`add` a lot in groups.
Use a secondary number if you can, not your primary one.

## What it does
- Keeps the linked account showing "online" continuously.
- Shows "typing…" for ~15 seconds whenever a message comes in.
- Commands start with `.` (e.g. `.menu`).
- **Main menu** (`.menu` / `.help`): uptime, owner info, bot info, repo link,
  `.sc` (repo + owner + "Enjoy"), anti-delete toggle.
- **Group menu** (`.groupmenu`): group info, member list, tag/tag-all,
  leave group, and admin-only add/kick.
- **Anti-delete**: when turned on, if anyone deletes a message in a chat
  the bot has seen, it forwards the original content to the owner's DM.

## Setup

1. Install [Node.js](https://nodejs.org) 18+.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Edit `config.js`:
   - `REPO_URL` → point it at your own GitHub repo once you push this code.
   - `OWNER_NUMBER` / `OWNER_NAME` are just starting defaults — see step 8,
     `OWNER_NUMBER` gets overwritten automatically once you link.
4. Start the bot:
   ```bash
   npm start
   ```
5. The terminal prompts: `Enter the WhatsApp number to link (with country
   code, no '+'):`. Type in the number you want to link (e.g.
   `254712345678`) and press enter. The bot asks for this every time it
   needs to generate a code — it's never read from a config file or env
   var, so a code is only ever generated for a number you hand over in
   that moment.
6. A pairing code then prints, e.g. `Pairing code: ABCD-1234`. On the phone
   number you just typed in: open WhatsApp → **Settings → Linked Devices →
   Link a Device → Link with phone number instead** → enter that code. No
   QR scanning needed.
7. **If you don't link within 1 minute**, that code expires and a fresh one
   is generated and printed automatically — just watch the console/logs
   and use whichever code is newest. This repeats every 60 seconds until
   you successfully connect, then stops on its own.
8. Once connected, that number becomes the bot's operating identity for
   the session — commands, group actions, admin checks (`add`/`kick`), and
   anti-delete DMs all run through it, overriding whatever `OWNER_NUMBER`
   was set to in `config.js`.
9. Session credentials are saved under `data/session/` so you don't have
   to re-link (or re-enter the number) on every restart — only if that
   folder gets deleted or WhatsApp unlinks the device. **Never commit this
   folder or share it — it's equivalent to your WhatsApp login.**

   If you'd rather use the old QR-code flow, set `LOGIN_METHOD=qr` (env var)
   or change `LOGIN_METHOD` in `config.js`, then scan the QR code that
   prints in the terminal instead.

## Deploying for free (24/7)
Same free-tier options the project you referenced uses:
- **Render** – background worker (not a web service, since this isn't an HTTP server), free tier sleeps after inactivity unless you're on a paid plan or add a keep-alive ping.
- **Railway / Fly.io** – small free allowances, similar caveats.
- **Termux on an old Android phone** – run `npm start` inside `pm2` so it survives being backgrounded:
  ```bash
  npm install -g pm2
  pm2 start index.js --name marv-c
  ```
- **A cheap VPS** – most reliable, run the same `pm2` setup.

Whichever host you pick, `data/session/` must persist between restarts or
you'll have to re-scan the QR code every time.

## Deploying on Render (free)

Render's Free instance type only exists for **Web Services** (not Background
Workers), and a free web service spins down after 15 minutes of no inbound
traffic — which also wipes the session on next restart. `index.js` runs a
tiny built-in HTTP server on `$PORT` for exactly this reason: it gives
Render something to route to, and gives you something to ping so the
service (and the WhatsApp connection) never goes idle long enough to sleep.

1. Push this project to a GitHub repo.
2. On [dashboard.render.com](https://dashboard.render.com), click **New →
   Web Service** and connect that repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Deploy. Render assigns a public URL like `https://marv-c-v1.onrender.com`.
5. Open the **Shell** tab (not just Logs — the bot needs to read your typed
   input) and run `npm start` there, or watch the Logs tab for the prompt
   and use Render's console to type the number when asked. Enter the
   pairing code that comes back on the phone within a couple of minutes,
   via WhatsApp → Linked Devices → Link with phone number instead. Some
   free-tier hosts don't expose an interactive shell — if yours doesn't,
   you'll need a host that does (or switch back to `LOGIN_METHOD=qr`,
   which only needs the Logs tab to be visible, not interactive).
6. **Set up a keep-alive ping** so it doesn't spin down: sign up free at
   [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org)
   and add an HTTP monitor hitting your Render URL every 10 minutes (must be
   under the 15-minute spin-down window).

**Trade-off to know going in:** even with pinging, Render can still restart
a free instance at any time, and every restart wipes the local
`data/session/` folder — so you may occasionally need to re-link (grab a
fresh pairing code) from the Logs tab. If that's too disruptive, Oracle
Cloud's free VPS (see below) doesn't have this problem, since it's a real
persistent disk.

## Notes on the menu "buttons"
WhatsApp's multi-device clients frequently drop native interactive button
messages, so the menus here are plain numbered text — tapping isn't
required, you just send the listed `.command`. This is more reliable across
phones/WhatsApp versions than native buttons currently are.

## File structure
```
marv-c-v1/
├── index.js              # connection, presence, command router
├── config.js              # bot name, owner info, repo link, prefix
├── commands/
│   ├── mainMenu.js         # menu 1 text + handlers
│   └── groupMenu.js        # menu 2 text + group admin actions
├── lib/
│   ├── messageStore.js      # message cache + anti-delete toggle/state
│   └── uptime.js            # uptime formatter
└── data/                   # session + anti-delete state (git-ignored)
```
