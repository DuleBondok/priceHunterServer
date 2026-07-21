# Deploy to Render (ops API + scrapers)

Repo: https://github.com/DuleBondok/priceHunterServer  
Root directory on GitHub = this `backend/` folder (Dockerfile, render.yaml, app.ts).

## 1. Push this repo (after commit)

```bash
cd backend
git add -A
git status   # confirm .env is NOT listed
git commit -m "Add Render Docker deploy for ops API and scrapers"
git push origin master
```

## 2. New Web Service on Render

1. Render Dashboard → **New** → **Web Service**
2. Connect **DuleBondok/priceHunterServer**
3. Runtime: **Docker** (uses `./Dockerfile`)
4. Name: `pricely-ops` (or similar)
5. Instance: **Starter** or higher (**not Free** — scrapers need always-on + RAM; prefer **2 GB** if available)
6. Health check path: `/`

## 3. Environment variables (Dashboard → Environment)

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `ADMIN_API_TOKEN` | same token you use for local login |
| `DATABASE_URL` | Neon URL (same DB as Pricely) |
| `DIRECT_DATABASE_URL` | optional direct (non-pooler) Neon URL |
| `CORS_ORIGINS` | `https://admin.pricely.rs,http://localhost:3000` |
| Cloudflare image keys | same as local if you use Image Manager |

Do **not** set `ALLOW_CLEAR_DB=true` unless you intentionally need wipe.

## 4. After deploy

- Open `https://pricely-ops.onrender.com/` → should say backend is running
- Local frontend: set `REACT_APP_API_BASE_URL=https://pricely-ops.onrender.com` and login with token
- Later: custom domain `ops.pricely.rs` → CNAME to the Render host; admin UI on `admin.pricely.rs`

## 5. Cron

`node-cron` runs complete scrapers daily at **05:00 Europe/Belgrade** while this service is up. Manual: Admin → Complete scrapers → Run now.
