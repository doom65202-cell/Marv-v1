## Deploying on Render (free)

Render's Free instance type only exists for **Web Services** (not Background
Workers), and a free web service spins down after 15 minutes of no inbound
traffic — which also wipes the session on next restart. `index.js` runs a
tiny built-in HTTP server on `$PORT` for exactly this reason: it gives
Render something to route to, and gives you something to ping so the
service — and the WhatsApp connection — never goes idle long enough to sleep.

### Pairing-code method (recommended)

Because Render's **Start Command** is non-interactive, the bot cannot ask
you to type a number at runtime. Instead you provide it ahead of time.

1. Push this project to a GitHub repo.
2. On [dashboard.render.com](https://dashboard.render.com), click **New →
   Web Service** and connect that repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Before deploying, open the **Environment** tab and add:
