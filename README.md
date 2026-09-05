# Apply Assist — Frontend

A Vite + React project wrapping the Apply Assist dashboard, ready to deploy
to Vercel/Netlify. Talks to the FastAPI backend (see the `apply-assist-backend`
folder) — no direct calls to Anthropic or Adzuna from the browser.

## 1. Local setup

```bash
cd apply-assist-frontend
npm install
cp .env.example .env
# edit .env: VITE_API_BASE=http://localhost:8000 (or your deployed backend URL)
npm run dev
```

Opens at `http://localhost:5173`. Make sure the backend is running first
(`uvicorn app.main:app --reload --port 8000` from the backend folder), and
that the backend's `.env` has `FRONTEND_ORIGIN=http://localhost:5173` for
CORS to allow it.

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo (or the same repo as the backend, in a
   `frontend/` subfolder — Vercel lets you set a root directory).
2. On vercel.com → New Project → import the repo.
3. Framework preset: Vite (auto-detected).
4. Add environment variable: `VITE_API_BASE` = your deployed backend URL
   (e.g. `https://apply-assist-api.onrender.com`).
5. Deploy. Vercel gives you a URL like `https://apply-assist.vercel.app`.
6. Go back to your **backend's** `.env` (or Render/Railway environment
   variables) and set `FRONTEND_ORIGIN` to that Vercel URL, then redeploy
   the backend so CORS allows requests from it.

## 3. Deploy to Netlify (alternative)

1. New site from Git → pick the repo.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Site settings → Environment variables → add `VITE_API_BASE`.
5. Same CORS step as above: update the backend's `FRONTEND_ORIGIN`.

## Notes

- This project has no backend of its own — it's a pure static build after
  `npm run build` (outputs to `dist/`). All data (resume, jobs, tracker)
  lives in the FastAPI backend's database.
- If you rename or move `App.jsx`, keep `main.jsx`'s import in sync.
