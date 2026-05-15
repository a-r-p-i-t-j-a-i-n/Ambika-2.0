# Order → Dispatch Plan → Actual Dispatch
## Modern System Design (React + Node/Express + MongoDB)

> **Mindset:** We are **not** rebuilding Excel in a browser. We are building a modern, opinionated SaaS that happens to ingest the same data the Excel did. The UI, the data shape, and the workflows are designed for speed, accuracy, and clarity — not nostalgia.

---

## 1. The flow in one picture

```
┌──────────────────┐   ┌────────────────────┐   ┌────────────────────────────┐   ┌────────────────────┐
│ 1. ORDER ENTRY   │ → │ 2. DISPATCH PLAN   │ → │ 3. ACTUAL DISPATCH (DC)    │ → │ 4. PLAN vs ACTUAL  │
│ (party + SKUs +  │   │ (1..N phases per   │   │ pick Party → SO → Phase    │   │ live comparison &  │
│  PO doc)         │   │  order, P1..Pn)    │   │ (dropdown) → actual qty    │   │  achievement, risk │
└──────────────────┘   └────────────────────┘   └────────────────────────────┘   └────────────────────┘

  SalesOrder              DispatchSchedule              DeliveryChallan +              buildComparison()
  + items[]               .items[].phases[]             actuals attached to a          (already implemented,
                          (phaseNo, date, qty)          specific phaseNo               surfaced as panels)
```

**Single most important design choice:**
👉 **Every actual dispatch is recorded *against a specific plan phase*.** The user picks `P1`, `P2`, etc. from a dropdown when entering a DC. That's what makes plan-vs-actual unambiguous, without us having to "match" by date or quantity heuristics later.

---

## 2. What the client gains by leaving Excel

| Excel today | What we replace it with |
|---|---|
| One row per phase per SKU, repeated for every order. | Normalized: `SalesOrder.items[].skuId/qty` + `DispatchSchedule.items[].phases[]`. No duplication. |
| "Match by date and SKU name" guesswork between plan and actual. | **Direct foreign-key link** — every actual references a `phaseNo` on the schedule. |
| Plan changes overwrite each other (no history). | **Versioned schedule** + per-edit audit log (who changed what, when, before/after). |
| Operators see only one sheet at a time. | **Role-based dashboards:** sales sees the order pipeline, planner sees phases & risks, dispatch sees today's loadouts. |
| "Carry-forward" calculated manually. | Server computes `carryForwardSuggestionQty` per SKU; UI offers a one-click "add to next phase". |
| Excel is single-user. | Multi-user with optimistic concurrency — two planners can't silently overwrite each other. |
| No real validation. | Schema validation at the API boundary, inline cell errors, business rules (over-plan, over-dispatch) enforced server-side. |

---

## 3. The three core screens — designed properly

### 3.1 Order Entry

**Goal:** Sales staff books a customer order in under a minute, with full validation, no copy-paste from PDFs.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◀ New Sales Order                                          [Save Draft] [Submit] │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Step 1 · Customer ────────────────────────────────────────────────────────┐   │
│ │ Party    [▼ search 'versuni' ⟶ Versuni India Home Solutions Ltd]          │   │
│ │          ├ Mumbai, MH · GST 27AAAA…  · Credit 30d · Lead 7d               │   │
│ │          └ Last order: AGL/SO-002/25-26 · 1,608 pcs · 17 Dec 2025         │   │
│ │                                                                             │   │
│ │ PO #     [PODM02537/25-26]      PO Date [17/12/2025]                       │   │
│ │ Transport[▼ Road]   Place[▼ from party]   Party Group[…]                   │   │
│ │ PO Doc   [📎 drop file or click — PDF/PNG/XLSX ≤ 10 MB]                    │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Step 2 · Line items ──────────────────────────────────────────────────────┐   │
│ │ # │ SKU (search) ▼     │ Code     │  Order Qty │ ASN/FCI │ Remark   │ ×   │   │
│ │ 1 │ Steele 1.5 L       │ ST1500…  │     3,484  │         │          │ 🗑  │   │
│ │ 2 │ Steele 1.0 L       │ ST1000…  │     2,412  │         │          │ 🗑  │   │
│ │ 3 │ Galaxy 1.5 L       │ GX1500…  │     1,608  │         │          │ 🗑  │   │
│ │ + Add row     ⌘V Paste from Excel                          Total: 7,504  │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ Summary: 3 SKUs · 7,504 pcs · Auto SO# will be AGL/SO-003/25-26                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Why this is good:**
- **Two clear steps, one screen** — no wizard pagination, no modal-in-modal.
- **Party autocomplete** previews credit, location, last order (server returns `recentOrders` summary on the lookup).
- **SO# is shown as a preview before submit** so sales knows what they'll quote.
- **Drag-drop file upload**, not a URL paste.
- **Paste-from-Excel** on the line-items table — split by `\n`/`\t`, auto-match SKU by name/code.
- **Save Draft** persists to `localStorage` (anonymous) or to server as `status:'DRAFT'` (signed-in).
- **Submit** is disabled until validation passes; errors surface inline next to each field.

---

### 3.2 Dispatch Planning (per Sales Order)

**Goal:** Planner converts an open SO into N dispatch phases (P1..Pn), each with a date and per-SKU qty, before production schedules anything.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◀ AGL/SO-002/25-26 · Versuni India   Status: PLANNING        [+ Add Phase]      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Order Snapshot ───────────────────────────────────────────────────────────┐   │
│ │ Order Qty 7,504   Planned 4,700   Dispatched 0   Balance 7,504             │   │
│ │ Plan coverage ▓▓▓▓▓▓▓░░░ 62%      Risks: 1 unplanned balance               │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Phases (timeline) ────────────────────────────────────────────────────────┐   │
│ │   Nov ──── Dec ──────────────────────── Jan ─────────────────── Feb ────▶  │   │
│ │            ●P1 30/12        ●P2 05/01                                       │   │
│ │            4,700           2,396                                            │   │
│ │   [drag a chip to reschedule]                       [click + Add Phase]    │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ P1 · Planned 30 Dec 2025 ─── 4,700 pcs ─── PLANNED ──── [edit] [delete]──┐   │
│ │ SKU            │ Order │ Planned │ Actual │ Bal │ Auto-fill from balance  │   │
│ │ Steele 1.5 L   │ 3,484 │  2,000  │   0    │1,484│ ◀ this phase →          │   │
│ │ Steele 1.0 L   │ 2,412 │  1,500  │   0    │  912│                          │   │
│ │ Galaxy 1.5 L   │ 1,608 │    200  │   0    │1,408│                          │   │
│ │ Galaxy 1.0 L   │ 1,608 │  1,000  │   0    │  608│                          │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ P2 · Planned 05 Jan 2026 ─── 2,396 pcs ─── PLANNED ──── [edit] [delete]──┐   │
│ │ … (collapsed by default, click to expand) …                                 │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Why this is good:**
- **Phases are first-class blocks**, not cells in a wide grid. Each phase has its own date, status, and per-SKU breakdown — clean to read, clean to edit.
- **Timeline strip** at the top gives instant visual sense of the plan over months. Drag a chip to reschedule (issues a PATCH; server validates).
- **One-click auto-fill from balance** per SKU in a phase — fills `plannedQty := balanceQty` so planners don't do mental math.
- **Phase status badges**: `PLANNED` → `IN_PROGRESS` (when first DC hits it) → `DISPATCHED` (when planned qty fully met) → `DELAYED` (date passed, qty short).
- **Add Phase** prompts a date + optional template ("split balance equally across remaining phases").
- **Risk panel inline** at the top (overdue, unplanned, over-plan, carry-forward).

---

### 3.3 Actual Dispatch (Delivery Challan)

**Goal:** Dispatch desk records a real loadout. The dropdown that picks **which plan phase** this DC is fulfilling is the heart of plan-vs-actual.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◀ New Actual Dispatch                                                  [Submit]  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Step 1 · Order ───────────────────────────────────────────────────────────┐   │
│ │ Party    [▼ search 'versuni' ⟶ Versuni India]                              │   │
│ │ Sales Order [▼ AGL/SO-002/25-26 · PO PODM02537 · Bal 7,504]                │   │
│ │              ↑ only shows orders with status IN_PROGRESS or PLANNING        │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Step 2 · Which Plan Phase ────────────────────────────────────────────────┐   │
│ │ Phase  [▼  P1 · 30 Dec · planned 4,700 · pending 4,700                     │   │
│ │           P2 · 05 Jan · planned 2,396 · pending 2,396                      │   │
│ │           — or — Unplanned (out-of-plan dispatch, flagged as risk)         │   │
│ │        ]                                                                    │   │
│ │  ↳ Selecting a phase auto-fills the SKU list and suggested qtys below.      │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Step 3 · Loadout ─────────────────────────────────────────────────────────┐   │
│ │ DC Date  [14/05/2026]   Transporter [▼ ABC Logistics]                      │   │
│ │ Vehicle  [MH-12-AB-1234] LR #  [LR-991]   Invoice # [auto]                 │   │
│ │ Mode     [▼ Road]                                                           │   │
│ │                                                                             │   │
│ │ SKU            │ Plan (P1) │ Already dispatched │ Now dispatching │ Boxes  │ │
│ │ Steele 1.5 L   │   2,000   │        0           │     [ 2,000  ]  │   20   │ │
│ │ Steele 1.0 L   │   1,500   │        0           │     [ 1,500  ]  │   15   │ │
│ │ Galaxy 1.5 L   │     200   │        0           │     [   200  ]  │    2   │ │
│ │ Galaxy 1.0 L   │   1,000   │        0           │     [ 1,000  ]  │   10   │ │
│ │                                                          Total: 4,700      │ │
│ │                                                                             │ │
│ │  ⚠ "Now dispatching" can be ≤ pending. Type a higher number to flag         │ │
│ │     OVER_PLAN — a confirmation prompt explains the risk.                    │ │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Step 4 · Documents (optional) ────────────────────────────────────────────┐   │
│ │ Invoice PDF [📎]   E-way Bill [📎]   POD on delivery [📎 later]            │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Why this is good:**
- **The "Which Plan Phase" dropdown is mandatory** (or operator explicitly chooses `Unplanned`, which raises a risk flag). This guarantees clean plan-vs-actual linkage.
- **Suggested quantities** auto-fill from the phase's `plannedQty - alreadyDispatchedQty`.
- **Live variance** — if operator types a different number, we show a colored chip ("20 short", "30 extra").
- **Single submit** creates the `DeliveryChallan`, attaches it to the chosen `phaseNo`, recomputes balances, fires PPC daily-plan upsert, all in one transaction.

---

### 3.4 Plan vs Actual (per order)

**Goal:** Anyone (sales, planner, ops) can open an SO and see, at a glance, what was promised vs what shipped — and what to do next.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ AGL/SO-002/25-26 · Versuni India                                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Top KPIs ─────────────────────────────────────────────────────────────────┐   │
│ │ Order 7,504  Planned 7,096  Actual 4,700  Balance 2,804  Fulfilment 62.6%  │   │
│ │ Plan Achievement 66.2%  Risks: 2  Next dispatch: P2 · 05 Jan               │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Per-SKU matrix ───────────────────────────────────────────────────────────┐   │
│ │ SKU            │ Ordered │ P1 plan/act │ P2 plan/act │ Total act │ Bal │   │   │
│ │ Steele 1.5 L   │  3,484  │  2,000/2,000✔│ 1,484/  0  │   2,000   │1,484│   │   │
│ │ Steele 1.0 L   │  2,412  │  1,500/1,500✔│   912/  0  │   1,500   │  912│   │   │
│ │ Galaxy 1.5 L   │  1,608  │    200/  200✔│ 1,408/  0  │     200   │1,408│   │   │
│ │ Galaxy 1.0 L   │  1,608  │  1,000/1,000✔│      —     │   1,000   │  608│ ⚠  │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ ┌─ Next Actions ─────────────────────────────────────────────────────────────┐   │
│ │ • Galaxy 1.0 L has 608 pcs unplanned. [Add to next phase →]               │   │
│ │ • P2 (05 Jan) is 3 days away with 0 actual. [Open Dispatch →]             │   │
│ └─────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The "Next Actions" panel is **server-driven** — `getOrderControlTower` already returns these. We just render them as clickable cards.

---

## 4. Data model — what we keep, what we tighten

The existing models are mostly right. Targeted changes:

### `SalesOrder` ([backend/src/modules/order/order.model.js](backend/src/modules/order/order.model.js))
Add:
- `place: String` (explicit "ship-to" place, distinct from party HQ).
- `draft: Boolean` — true while a sales user is still editing.
- `recentOrdersCount`/`recentOrdersTotal` are *not* stored — computed via aggregate when the party is looked up.

### `DispatchSchedule` ([backend/src/modules/schedule/schedule.model.js](backend/src/modules/schedule/schedule.model.js))
The `phaseSchema` already has `phaseNo`, `plannedDate`, `plannedQty`, `actualDispatches[]`. Tighten:
- Add `phaseId: ObjectId` (Mongo auto-id) so the actual-dispatch form can reference a phase reliably even if `phaseNo` changes (today phaseNo is a string like `P1`).
- Add `status` enum on phase: `PLANNED | IN_PROGRESS | DISPATCHED | DELAYED | CANCELLED`.
- Add `notes` on phase (planner can leave a note like "MD approval pending").
- Index `items.phases.plannedDate` for dashboard date-range queries.

### `DeliveryChallan` ([backend/src/modules/challan/](backend/src/modules/challan/))
- Add `phaseRef: { scheduleId, itemId, phaseId, phaseNo }` — the explicit pointer from this DC back to a plan phase. **This is the new contract.** Today the system tries to find a phase by date; we replace heuristic with reference.
- Add `isUnplanned: Boolean` — true if operator chose "Unplanned" in the phase dropdown.

### New collection: `AuditLog` (extend existing `audit-logs` module)
- `{ actor, resourceType, resourceId, action, before, after, ts }` — used by plan edits, schedule reschedules, DC submissions.

---

## 5. API surface — REST, module-based

We extend the existing `dispatch-control` module's controller; no parallel APIs.

### Orders
- `GET    /api/orders` (paginated, filterable) — already exists.
- `POST   /api/dispatch-control/order-entry` — already exists, accepts new `place` + `orderDocument` (URL from upload).
- `GET    /api/orders/:soNumber` — single order detail with embedded schedule snapshot.
- `POST   /api/uploads/order-document` — multer, returns `{ url }`.

### Planning
- `GET    /api/dispatch-control/schedules/:soNumber` — full schedule with all phases.
- `POST   /api/dispatch-control/schedules/:soNumber/phases` — create a new phase (date, optional SKU breakdown).
- `PATCH  /api/dispatch-control/schedules/:soNumber/phases/:phaseId` — update qty/date/notes; emits audit log.
- `DELETE /api/dispatch-control/schedules/:soNumber/phases/:phaseId` — only if no actuals attached.

### Actual dispatch
- `POST   /api/dispatch-control/actual-dispatches` — already exists, **extended** to require `phaseRef` (or explicit `isUnplanned:true`). Server validates: chosen phase exists, has remaining capacity, qtys sum to the input.
- `GET    /api/dispatch-control/orders/:soNumber/dispatchable-phases` — feeds the "Which Plan Phase" dropdown. Returns each phase with `plannedQty, dispatchedQty, pendingQty, plannedDate, status`.

### Plan vs Actual / Tower
- `GET    /api/dispatch-control/orders/:soNumber/comparison` — already exists.
- `GET    /api/dispatch-control/orders/:soNumber/summary` — already exists (next actions).
- `GET    /api/dispatch-control/dashboard` — already exists.

All write endpoints use Mongo **transactions**; all reads use `.lean()` for speed.

---

## 6. Frontend architecture — module-based, opinionated

Stays inside the existing `frontend/src/features/*` structure. We don't add a parallel folder.

```
frontend/src/
├── features/
│   ├── orders/                        ← Order Entry rebuilt
│   │   ├── OrderEntryDrawer.jsx       (was OrderCreateModal; redesigned 2-step)
│   │   ├── PartyAutocomplete.jsx      (with rich preview + recent orders)
│   │   ├── SkuLineTable.jsx           (paste-from-Excel handler)
│   │   └── OrdersList.jsx             (existing, minor polish)
│   ├── planning/                      ← Dispatch Planning rebuilt
│   │   ├── PlanWorkspace.jsx          (replaces PlanCreation.jsx)
│   │   ├── components/
│   │   │   ├── OrderSnapshot.jsx      (top KPI + plan-coverage bar)
│   │   │   ├── PhaseTimeline.jsx      (horizontal Gantt-strip)
│   │   │   ├── PhaseCard.jsx          (one block per phase, expandable)
│   │   │   ├── PhaseSkuRow.jsx        (inline qty edit w/ auto-fill)
│   │   │   └── RiskRail.jsx           (overdue / unplanned / carry-fwd)
│   │   └── hooks/
│   │       └── usePhaseDraft.js       (localStorage draft + concurrency check)
│   ├── execution/                     ← Actual Dispatch rebuilt
│   │   ├── DispatchEntry.jsx          (new: 4-step DC form)
│   │   ├── components/
│   │   │   ├── PhasePicker.jsx        (the KEY dropdown — plan phase chooser)
│   │   │   ├── DispatchLoadoutTable.jsx
│   │   │   └── VarianceBadge.jsx
│   │   └── ChallansList.jsx           (existing)
│   └── dashboard/
│       └── DispatchControlTower.jsx   (existing, polished)
└── store/api/
    ├── dispatchControlApi.js          (extend: usePhasesQuery, usePatchPhaseMutation, useDispatchablePhasesQuery)
    └── uploadsApi.js                  (new: useUploadOrderDocMutation)
```

**UX conventions across all three screens:**
- Drawer-based forms (right-side slide-in) — never a centered modal that hides context.
- All numerics use `Intl.NumberFormat('en-IN')`.
- All dates use `dayjs` with locale `en-IN`, format `DD MMM YYYY`.
- Color tokens come from `theme.js`. No hard-coded hex outside theme.
- Loading: skeleton cards, never spinners on full screens.
- Errors: inline beneath the offending field; toast only for top-level save failure.
- Empty states have a clear call-to-action button (no "no data" dead-ends).
- Mobile / tablet: drawer becomes full-screen sheet; tables scroll-x with sticky first column.

---

## 7. Step-by-step build order

Each step is independently shippable. After each, the app stays green.

| # | Layer | Step | Outcome |
|---|---|---|---|
| 1 | Backend | Add `place` to SalesOrder + validation. Migration backfills from `location`. | Order entry can capture ship-to place explicitly. |
| 2 | Backend | Add `phaseId` (auto-id) + `status` + `notes` to phase sub-schema. Migration assigns `phaseId` on existing docs. | Phases are referencable by stable id. |
| 3 | Backend | `POST /api/uploads/order-document` (multer, 10 MB, mimetype whitelist). | UI can upload a PO doc and get back a URL. |
| 4 | Backend | Wrap `planDispatch` and `createActualDispatch` in Mongo transactions. | All-or-nothing saves. |
| 5 | Backend | New endpoints: `POST/PATCH/DELETE schedules/:soNumber/phases[/:phaseId]`, `GET dispatchable-phases`. | UI can manage phases as resources. |
| 6 | Backend | Extend `createActualDispatch` to require `phaseRef` (or `isUnplanned:true`). Persist on Challan. | Plan-vs-actual is linked by reference, not heuristic. |
| 7 | Backend | Audit log on every plan edit + DC submit. | Full history for the client. |
| 8 | Frontend | Rebuild `OrderEntryDrawer` (2-step layout, party preview, file drop, paste-from-Excel). | Order entry feels modern. |
| 9 | Frontend | Build `PlanWorkspace` (snapshot + timeline + expandable phase cards + risk rail). | Planning replaces the old line-form. |
| 10 | Frontend | Build `DispatchEntry` with `PhasePicker` dropdown (the centerpiece). | Actuals are entered against a phase. |
| 11 | Frontend | Polish `Plan vs Actual` panel on the SO detail page using existing `getComparison`. | One-glance fulfilment view. |
| 12 | Both | End-to-end smoke + 3 e2e Playwright tests: create order → plan 2 phases → dispatch P1 fully → P2 partial → see comparison. | Confidence to demo to client. |

---

## 8. Production-quality non-negotiables (apply to every step)

- **Validation** lives in the API layer (joi/zod). UI mirrors for UX only.
- **Transactions** on every multi-document write.
- **Optimistic concurrency** via `updatedAt` (or a `version` field on schedule). UI sends the read-time value; server returns 409 on conflict and UI shows a "reload" prompt with diff.
- **Idempotency** on phase upserts and DC submits (same `phaseRef` + same `dcNumber` does nothing).
- **Audit log** on plan and DC writes.
- **Indexes**: `salesorders.soNumber/poNumber/partyId+status/orderDate`, `dispatchschedules.soNumber/items.phases.plannedDate`, `deliverychallans.soNumber/dcDate/phaseRef.phaseId`.
- **Error UX:** server returns `{ ok:false, message, fieldErrors: {...} }`. UI maps `fieldErrors` to inputs; `message` goes to toast.
- **Auth & roles** (existing `auth` module): Sales can create orders, Planner can edit phases, Dispatch can record DCs, MD can do all + delete. Enforced server-side, mirrored in UI by hiding actions.
- **Loading and empty states** designed for every screen.
- **Mobile/tablet** responsive — operators on the shop floor use tablets.
- **No silent defaults** for business-critical numbers (qty, date). If missing, explicit error.

---

## 9. What "done" looks like for this iteration

A client demo where we:

1. **Create a new order** for Versuni, upload the PO PDF, add 4 SKU lines, submit. SO# auto-generated, party recent-orders shown in the picker.
2. **Open Dispatch Planning** for the new SO. Add **P1 (30 Dec, 4,700 pcs)** and **P2 (05 Jan, 2,396 pcs)**. Auto-fill from balance per SKU. Save — instantly the timeline shows two chips.
3. **Record an actual dispatch.** Pick Versuni → the SO → choose **Phase P1** from the dropdown — the SKU table pre-fills with planned qtys. Submit. A `DeliveryChallan` is created, linked to P1 by `phaseRef`.
4. **Open Plan vs Actual** on the same SO. P1 row shows 4,700/4,700 ✔. P2 shows pending. Achievement and risks update live. The "Next actions" card invites the user to dispatch P2.
5. **Edit P2** to move from 05 Jan to 08 Jan — audit log captures the change with old/new values.
6. **Try to over-plan** in P3 — server rejects with a clear message; UI highlights the offending row.
7. **Two users** open the same plan; the second to save hits a 409 and is offered to merge or overwrite.

Once you confirm this direction, I start at step 1 and commit step-by-step so you can review and steer at each gate.
