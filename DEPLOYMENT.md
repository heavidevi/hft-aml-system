# Deploying the dashboard on Vercel

Only the **frontend** (`frontend/`) goes on Vercel. The backend is a long-running Node process that spawns the C++
engine and holds WebSocket connections, so Vercel serverless functions cannot host it. For the demo, run the backend on
your own laptop.

## 1. Push to GitHub
```bash
git init && git add . && git commit -m "hft-aml-system" && git branch -M main
git remote add origin <your repo> && git push -u origin main
```

## 2. Import into Vercel
1. Vercel → **Add New Project** → import the repo.
2. **Root Directory: `frontend`** (leave "Include source files outside of the Root Directory" on).
3. Framework preset: Next.js (auto-detected). No build command changes needed.
4. Environment variable `NEXT_PUBLIC_API_URL` = the backend address (see step 3). Redeploy after changing it, because
   `NEXT_PUBLIC_*` values are baked in at build time.

## 3. Point the dashboard at a running backend
The page shows "offline" until it can reach a backend. Start it locally:
```bash
npm install
make -C engine
npm run dev:backend        # http://localhost:4000
```
Then pick one:

| Option | `NEXT_PUBLIC_API_URL` | Notes |
|---|---|---|
| Browser on the same laptop as the backend | `http://localhost:4000` | Works in Chrome/Edge/Firefox. Safari may block http/ws from an https page. |
| Others should see it too (e.g. presenting) | a public https tunnel URL | Run `npx cloudflared tunnel --url http://localhost:4000` (or ngrok) and use the `https://…` address it prints. The WebSocket becomes `wss://…/ws` automatically. |

The backend allows any origin by default; to restrict it, start it with `CORS_ORIGIN=https://your-app.vercel.app`.

## Troubleshooting
- **"offline – start the backend":** backend not running, wrong `NEXT_PUBLIC_API_URL`, or you changed it without redeploying.
- **Mixed content error:** the Vercel site is https, so a non-localhost backend must be https/wss (use a tunnel).
- **Tunnel URL changed:** free tunnels get a new address on each start; update the variable and redeploy.

## Note
The backend starts the live market automatically and pauses it while no browser is connected. Keep the backend terminal open during your demo.
