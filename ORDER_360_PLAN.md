# Order 360° — the full story of every order, on one URL

> Read this, then reply **"go"** or your changes. Nothing built yet.

---

## 1. What you asked for

1. **Control Tower** — click an order → open a proper **URL** to a rich page that
   tells the *whole story*: when received, what was planned, what actually
   happened, what is delayed, what is left.
2. **Dispatch Planning** — click a phase (P1, P2…) → clearly see *what is planned
   inside it*: SKU-1 → 200, SKU-2 → 340, SKU-3 → 450.
3. **Actual Dispatch** — click a challan row → a full detail page (when, how,
   who, what) on its own **URL**.

---

## 2. What already exists (so we extend, not rebuild)

- `/orders/:id` is **already a routed page** (`OrderDetails`).
- The backend already computes the hard part — **plan vs actual with per-phase
  carry-forward and risks** (`/comparison`), the **schedule** with phases &
  actual dispatches, and a **summary**.
- Phase cards in Planning **already** hold the per-SKU plan numbers.

So the work is: **present this richly, tell it as a story, and wire clean URLs.**
Only one small backend addition is needed (a single-challan endpoint).

---

## 3. The three deliverables

### 3.1 ORDER 360° — `/orders/:id` (rebuilt rich page)

The centrepiece. One scrollable page, deep-linkable by section.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◀ Orders   AGL/SO-002/25-26 · Versuni India          [Plan] [Record Dispatch] │
│ ▓ KPIs: Ordered 7,504 · Planned 7,096 · Dispatched 4,700 · Balance 2,804      │
│        Fulfilment 62.6%  ·  Plan Adherence 66%  ·  ⚠ 2 risks                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◇ ORDER JOURNEY  (the story — a horizontal timeline)                          │
│                                                                                │
│   ●─────────────●──────────────●───────────────○───────────────○              │
│   Received      Planned        Dispatch P1     Dispatch P2     Completed       │
│   17 Dec 10:24  20 Dec         30 Dec ✓        05 Jan (due)    —               │
│                 2 phases       4,700 pcs ✓     2,396 pending   2,804 left      │
│                                                ⚠ 3 days away, 0 done           │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ WHAT'S LACKING                                                              │
│   • 2,804 pcs not yet dispatched   • P2 due 05 Jan, 0% done                   │
│   • Galaxy 1.0 L — 608 pcs unplanned (no phase)                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Plan vs Actual ] [ Phases ] [ Dispatch History ] [ Workflow ] [ Documents ] │
│  ── tab content ──                                                             │
│  Plan vs Actual : per-SKU matrix — ordered / planned / actual / balance        │
│  Phases         : each phase, expandable → per-SKU planned vs actual           │
│  Dispatch Hist. : every challan (clickable → DC 360°)                          │
│  Workflow       : the 13-step O2D tracker — planned date vs actual + delay     │
│  Documents      : PO doc, invoices, challans PDFs                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why this is good:**
- **Order Journey** = the story you asked for — *received → planned → dispatched
  → completed* with **real timestamps** and **delay flags**, in one glance.
- **What's Lacking** panel surfaces every gap (unplanned balance, overdue phases,
  short dispatches) in plain words — no hunting.
- **Tabbed body** keeps it rich but not overwhelming; each tab is **deep-linkable**
  (`/orders/:id?tab=phases`).
- Reuses the data the backend already gives — fast to build, accurate.

**Wiring:** in the **Control Tower**, clicking an order row now **navigates here**
(not just the small "Manage Order" button). The row stays expandable for a quick
peek; the row's title/click opens the full 360° page.

---

### 3.2 PHASE DETAIL — inside Dispatch Planning

Clicking a phase (the card header **or** its chip on the timeline) cleanly opens
that phase showing **exactly what is planned inside it**:

```
┌─ P1 · Planned 30 Dec 2025 · DISPATCHED ──────────────────────────┐
│  SKU              Order   Carry-in   Planned   Actual   Balance   │
│  Steele 1.5 L     3,484      0        2,000    2,000 ✓     0       │
│  Steele 1.0 L     2,412      0        1,500    1,500 ✓     0       │
│  Galaxy 1.5 L     1,608      0          200      200 ✓     0       │
│  Galaxy 1.0 L     1,608      0        1,000    1,000 ✓     0       │
│                                Phase total: 4,700 planned         │
└────────────────────────────────────────────────────────────────────┘
```

The per-SKU table already exists in the phase card — we make the **click
obvious**, auto-expand the chosen phase, and put it in the **URL**
(`/dispatch-planning?so=AGL/SO-002/25-26&phase=P1`) so a phase view is shareable.

---

### 3.3 DELIVERY CHALLAN 360° — `/challans/:id` (new page)

Challan rows become **clickable** → a new routed detail page:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◀ Challans   DC/AGL/0042   ·   DISPATCHED            [Download PDF] [Invoice] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Order   AGL/SO-002/25-26 (→ open Order 360°)   Party  Versuni India           │
│ Fulfils Plan Phase  P1 · 30 Dec   ✓ planned     (or  ⚠ Unplanned dispatch)     │
├──────────────────────────────────────────────────────────────────────────────┤
│ WHEN & HOW                                                                     │
│   DC Date 30 Dec 2025   ·  Created 30 Dec 14:08 by <user>                      │
│   Vehicle MH-12-AB-1234 · Transporter ABC Logistics · Mode Road                │
│   Invoice INV-0091  ·  Delivery: Versuni, Mumbai                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ ITEMS DISPATCHED                                                               │
│   SKU            Qty (pcs)   Boxes   Weight                                    │
│   Steele 1.5 L     2,000       20     540 kg                                   │
│   Steele 1.0 L     1,500       15     280 kg                                   │
│                    Total 4,700 pcs · 35 boxes · 820 kg                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Shows **when, how, who, what** — exactly as you asked. Linked both ways: from the
Order 360° "Dispatch History" tab, and back to the order.

> *Note on "who":* orders/challans don't currently store a `createdBy` user.
> I'll show the creation **timestamp** now, and (Decision 2) can add `createdBy`
> capture so the actual person's name shows going forward.

---

## 4. URLs everywhere (shareable, like the Price Tracker)

| Page | URL |
|---|---|
| Order 360° | `/orders/:id` · `?tab=phases` |
| Phase view | `/dispatch-planning?so=<SO>&phase=P1` |
| Challan 360° | `/challans/:id` |

Every drill-down is a real address you can copy, bookmark and share.

---

## 5. Build order

| # | Layer | Step |
|---|---|---|
| 1 | Backend | Add `GET /challans/:id` (single challan with order + phase context). |
| 2 | Frontend | **Order 360°** — rebuild `/orders/:id`: KPI hero + **Order Journey** + **What's Lacking** + tabbed body. Deep-link tabs. |
| 3 | Frontend | **Control Tower** — clicking an order row navigates to Order 360°. |
| 4 | Frontend | **Phase detail** — phase click (card + timeline) auto-opens per-SKU breakdown; reflected in URL. |
| 5 | Frontend | **Challan 360°** — new `/challans/:id` page; make Challan-list rows clickable. |

Each step is shippable on its own; I'll stop after each for your review.

---

## 6. Decisions for you

| # | Decision | Recommendation |
|---|---|---|
| 1 | Order 360° body — **tabs** (one section at a time, cleaner) or **all sections stacked** (one long scroll)? | **Tabs** — cleaner, still deep-linkable. |
| 2 | Capture **who created** each order / challan, so the name shows on the 360° pages? | **Yes** — record `createdBy`; richer audit. |
| 3 | "Order Journey" timeline — show **time of day** (17 Dec 10:24) or **date only**? | **Date + time** — you asked for "what time". |

---

### 👉 Reply **"go"** to start at step 1, or tell me your changes.
