# Dealer Portal

An invite-only dealer portal for **Unknown Suppressors, Unknown Munitions, Salmon River Solutions and Shoot2Hunt**.
Dealers see live inventory from all four WooCommerce stores, check out once, and pay in a single payment or split across
card, ACH and check. Each brand receives its own WooCommerce order to fulfill.

**Stack:** Next.js 16 (App Router) · React 19 · Sanity Studio (embedded at `/studio`) · Postgres (Neon) with Drizzle · Authorize.net · WooCommerce REST API · Vercel.

## Where things live

| What | Where | Edited by |
| --- | --- | --- |
| Portal name, logo, sign-in text, support contact | Sanity → Portal settings | Admins in `/studio` |
| Payment methods on/off, split payments, check instructions | Sanity → Payment settings | Admins |
| Brands: dealer discount %, notification emails, SOT-required categories, shipping restrictions by state | Sanity → Brands | Admins |
| Per-product dealer price, minimum qty, hide, featured, dealer note (matched by SKU) | Sanity → Product settings | Admins |
| Announcements and pages (terms, FAQ…) | Sanity | Admins |
| Access requests, dealers, FFL/SOT verification, orders, check payments, sync health | Postgres, managed at `/admin` | Admins |
| Products, stock, retail price | WooCommerce (mirrored into Postgres) | Each store |

Studio edits show in the portal within 30 seconds (instantly if you add the optional Sanity webhook).

## How it works

- **Access:** every page requires sign-in (`src/proxy.ts`). Dealers request access at `/request-access` and pick a brand. That brand's admins are emailed, verify the FFL/SOT at `/admin`, and approve. The dealer gets a one-time link to set their password.
- **Inventory:** WooCommerce webhooks plus a tiny WordPress plugin (`wordpress/dealer-portal-stock-ping.php`) push stock changes to `/api/webhooks/woo/<store>`. The portal re-reads the product from the store and updates Postgres. A cron re-syncs changed products every 15 minutes and does a full sync nightly. The inventory page polls every 10 seconds.
- **Checkout:** stock is re-checked live against each store, prices come from Sanity (dealer price or brand discount), and SOT and state shipping rules are enforced. Payments run in a safe order: cards are **authorized**, eChecks debited, then cards **captured**. Any decline voids everything already done, so the dealer is never charged for a failed order.
- **Orders:** one WooCommerce order per brand, with dealer prices as explicit line totals. Paid in full by card → **Processing**. Waiting on a check or ACH → **On hold**, released automatically when the eCheck settles (hourly cron) or when an admin marks the check received. Returned eChecks put the order back on hold and email the admin. WooCommerce status and tracking numbers flow back to the dealer's order page.
- **Card and bank details** are tokenized in the browser by Authorize.net Accept.js and never touch the portal's server.

## Setup

### 1. Install and configure

```bash
npm install
cp .env.example .env.local   # fill it in as you go
```

### 2. Database (Neon Postgres)

Create a Neon project (or add Neon from the Vercel Marketplace), put the connection string in `DATABASE_URL`, then:

```bash
npm run db:push                                   # create the tables
npm run create-admin -- you@example.com "Your Name"   # prints a set-password link
```

### 3. Sanity

1. Create a project at sanity.io/manage and put its ID in `NEXT_PUBLIC_SANITY_PROJECT_ID`.
2. Under **API → CORS origins**, add `http://localhost:3000` and your production URL, with credentials allowed.
3. Invite each admin as a member of the Sanity project so they can sign in to `/studio`.
4. In `/studio`, create the four **Brands**, choosing the matching **Store key** for each, then fill in **Portal settings** and **Payment settings**.
5. Optional: under **API → Webhooks**, add a webhook to `https://<your-domain>/api/revalidate` with a secret, and set `SANITY_REVALIDATE_SECRET` to the same value.

### 4. WooCommerce (on each of the four stores)

1. **WooCommerce → Settings → Advanced → REST API:** create a **Read/Write** key for a dedicated user (for example `portal-bot`, Shop Manager role). Put it in `WOO_<STORE>_KEY` / `_SECRET` along with the store's `_URL`.
2. **WooCommerce → Settings → Advanced → Webhooks:** add webhooks for `Product created`, `Product updated`, `Product deleted`, `Order created` and `Order updated`. Point each at `https://<your-domain>/api/webhooks/woo/<store-key>` and use the same secret for all of them; put that secret in `WOO_<STORE>_WEBHOOK_SECRET`.
   Store keys: `unknown-suppressors`, `unknown-munitions`, `salmon-river-solutions`, `shoot2hunt`.
3. Copy `wordpress/dealer-portal-stock-ping.php` into `wp-content/mu-plugins/` and add `DEALER_PORTAL_URL` and `DEALER_PORTAL_SECRET` to `wp-config.php` (see the top of the file).
4. Run the first full import from **/admin → Store sync → Run full sync now**.

### 5. Authorize.net

1. Create a free sandbox account at developer.authorize.net for development.
2. **Account → Settings → API Credentials & Keys:** copy the API Login ID and a Transaction Key.
3. **Account → Settings → Security Settings → Manage Public Client Key:** create the client key Accept.js uses.
4. Make sure **eCheck.Net** is enabled on the production account, and check its transaction limits.
5. Set `AUTHNET_ENV=production` only when you go live.

### 6. Run and deploy

```bash
npm run dev     # http://localhost:3000
```

Deploy to Vercel and add the same environment variables. `vercel.json` schedules three crons: sync every 15 minutes, a full sync nightly, and ACH settlement checks hourly. Vercel's Hobby plan only runs crons once a day, so use Pro. Set `CRON_SECRET` so only Vercel can call them.

## Project map

```
src/proxy.ts                         sign-in gate for every route
src/app/(site)/(auth)/               login, request access, set password
src/app/(site)/(portal)/inventory    live inventory (polls /api/inventory)
src/app/(site)/(portal)/checkout     single or split payment, Accept.js
src/app/(site)/(portal)/orders       dealer order history and status
src/app/(site)/(portal)/admin        access requests, dealers, orders, sync health
src/app/studio/                      embedded Sanity Studio
src/app/api/webhooks/woo/[store]     WooCommerce + mu-plugin webhooks
src/app/api/cron/*                   sync, full sync, ACH settlement
src/lib/orders.ts                    checkout: pricing, rules, payments, Woo orders
src/lib/authnet.ts                   Authorize.net API client
src/lib/woo/*                        WooCommerce client, sync, orders
src/lib/catalog.ts                   dealer pricing, visibility and restrictions
src/sanity/                          schemas and content queries
wordpress/                           mu-plugin for each store
```

## Still to decide

- **Shipping and tax:** orders are created without shipping charges, and dealers are assumed to be tax-exempt resellers. Decide whether shipping is a flat dealer rate, free over a threshold, or added by each brand. It can be made an admin setting in Sanity.
- **Settlement between brands:** all payments land in one Authorize.net account. Decide with your accountant which company is the merchant of record and how each brand is paid its share. The `store_orders.subtotal` column gives each brand's amount per order.
- **Compliance:** have your compliance lead confirm the SOT and state shipping rules you enter in Sanity.
- **Truly instant updates:** polling every 10 seconds is usually enough. If you need instant push, add Pusher or Supabase Realtime and publish from `refreshProduct` in `src/lib/woo/sync.ts`.
