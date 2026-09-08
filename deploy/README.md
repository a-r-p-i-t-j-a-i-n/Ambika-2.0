# Deploying Ambika 2.0

Target: **3.105.199.228** (`ubuntu`), reached with `ERP-Projects-New.pem`.

> **This box is shared.** It runs 8 other tenants under pm2 — jjerp, ld-erp,
> nasher-erp, nia, rajputana, surgenesis, sparsh/theknowcart — behind one nginx.
> Anything you do here that isn't scoped to `/home/ubuntu/ambika_2.0`, the
> `ambika-backend` pm2 process, or the `ambika` nginx site can take someone
> else's production down.

## Layout

| Thing | Value |
|---|---|
| App root | `/home/ubuntu/ambika_2.0` |
| Backend | pm2 `ambika-backend` on `:3006` |
| Frontend | static `frontend/dist`, served by nginx on `:3005` |
| Public URL | `http://3.105.199.228:3005` |
| nginx site | `/etc/nginx/sites-available/ambika` |

Port 3006 was chosen because **5001 from the local `.env` is already taken by
`ld-erp-api`** on this box. Port 3005 was free too; 3000/4000/4001/5000/5001/5003/8000/8005/8081/8082/8084/8086 all belong to other tenants.

## Two things must happen once, by hand

Neither can be done from CI.

**1. Open ports 3005 and 3006 in the EC2 security group.** Both are closed
today, so the site would only be reachable from inside the box. The SG
currently allows 22, 80, 443, 8005, 8081, 8082, 8084, 8086.

**2. Place the backend `.env`.** `deploy.yml` excludes `.env` from rsync so
deploys never clobber it, which means the first one has to find it already
there. Copy [`server.env.template`](server.env.template) up:

```bash
scp -i ERP-Projects-New.pem deploy/server.env.template \
  ubuntu@3.105.199.228:/home/ubuntu/ambika_2.0/backend/.env
```

(`mkdir -p /home/ubuntu/ambika_2.0/backend` first, or let one deploy run and
fail at the guard — it creates the directories before it checks.)

The workflow refuses to start the backend if that file is missing, rather than
booting a server with `JWT_SECRET='fallback-secret'` and no database.

## Then

Push to `main`, or run the workflow manually:

```bash
gh workflow run "Deploy to EC2" --repo d-tableanalytics/Ambika_2.0 --ref main
```

## What the workflow does

1. Builds the frontend **on the runner** — the box has ~1.6 GB RAM free across
   9 apps and a vite build there could OOM a neighbour.
2. `rsync --delete` into `/home/ubuntu/ambika_2.0`, excluding `.env`,
   `node_modules`, `uploads`.
3. `pm2 startOrReload` (not `reload` — the first deploy has no process yet).
4. Copies the nginx site, runs `nginx -t`, and **only reloads if it passes**;
   on failure it unlinks the site and leaves nginx alone. This is the one step
   that touches shared state.
5. Health-checks `127.0.0.1:3006/api/health` from inside the box, then confirms
   nginx is serving the SPA and proxying the API. Dumps pm2 logs on failure.

## Rollback

```bash
ssh -i ERP-Projects-New.pem ubuntu@3.105.199.228
pm2 stop ambika-backend && pm2 delete ambika-backend && pm2 save
sudo rm -f /etc/nginx/sites-enabled/ambika
sudo nginx -t && sudo systemctl reload nginx
```

That returns the box to exactly its pre-Ambika state; no other tenant is touched.
