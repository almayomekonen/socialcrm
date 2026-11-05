# Gotenberg renderer (fallback)

Used only when `PDF_RENDERER=gotenberg`. A Cloudflare Worker cannot run this container, so it
needs a container host outside AWS. The image is stateless and needs no storage credentials: the
app receives the PDF bytes and uploads them itself.

**Host requirements:** Docker image deploys, HTTPS, secrets, port 3000, and at least 1 instance
always on, with enough memory for Chromium (the retired AWS task had 2 vCPU and 4 GB).

**Host secrets:** `GOTENBERG_API_BASIC_AUTH_USERNAME`, `GOTENBERG_API_BASIC_AUTH_PASSWORD`.
**Vercel:** the same two, plus `PDF_RENDER_URL` and `PDF_RENDERER=gotenberg`.

**Check before use, with no customer data:**
1. `GET /health` answers 200.
2. An unauthenticated conversion answers 401. Do not route traffic to it otherwise.
3. Render a synthetic Hebrew invoice and check it per `docs/cloudflare-r2-migration.md`, step 6.
