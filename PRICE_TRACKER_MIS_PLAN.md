# Material Master + Price Tracker MIS — Plan

> **Read this first.** This is a plan, not code. Nothing is changed in the
> database or the app yet. Read it, then tell me **"approved"** or tell me what
> to change. After your approval I build it phase by phase, and you can review
> at each gate.

---

## 0. What you asked for — in plain words

You gave me the **Master Sheet** with 5 kinds of items:

| Kind | Meaning | Status |
|---|---|---|
| **Finished Goods** | What your client **sells / dispatches** to *their* customers (jars, bowls). | ✅ Already in DB |
| **Packing** | Boxes, partitions, stickers, tape — your client **buys** these. | ✅ Already in DB |
| **Raw Material** | DD steel sheets, Copper sheets — your client **buys** these. | ⛔ Not yet — **push now** |
| **Consumables** | Buffs, brushes, bearings, belts, oils, chemicals — your client **buys** these. | ⛔ Not yet — **push now** |
| **Circles** | Cut metal circles. | 🚫 **Do NOT push** (your instruction) |

And you want a **Price Tracker MIS** where the client can:

1. **Easily pick** an item (by kind → by sub-group → by search).
2. See its **Current price, Previous price, and full History** (audit: who / when / why).
3. Use a **Calculator** for that item.
4. See **Analytics** for that item / group.

The key business idea you explained:

> Finished Goods = the **selling** side (orders the client *receives* and dispatches).
> Raw Material + Consumables + Packing = the **buying** side (purchase orders the
> client *sends to vendors*).

So the tracker must cleanly separate **"price we sell at"** from **"price we buy at"**.

---

## 1. Good news — most of this engine already exists

Your system is **not** starting from zero. It already has a real, well-built
pricing engine. Here is what is **already working** today:

| Feature you asked for | Already built? | Where |
|---|---|---|
| Append-only price history (audit trail) | ✅ Yes | `PriceRevision` model |
| Current price + Previous price | ✅ Yes | `getPriceMaster()` service |
| Full history per SKU (who/when/why) | ✅ Yes | `getSkuHistory()` + History Drawer |
| Approval workflow for big price changes | ✅ Yes | `decideApproval()` engine |
| Calculator (server-computed totals + GST) | ✅ Yes | `calculator.service.js` |
| Analytics (trends, top movers, heatmap) | ✅ Yes | `getPricingAnalytics()` |
| Document tracker (proof attachments) | ✅ Yes | `listPricingDocuments()` |
| Excel export (3 sheets) | ✅ Yes | `getExportData()` |
| Pricing Hub UI (search, filters, KPIs) | ✅ Yes | `PricingHub.jsx` |

**So we are NOT rebuilding.** We are doing two focused things:

1. **Load the missing data** (Raw Material + Consumables) — safely.
2. **Add ONE missing concept** so the tracker can separate buy-items from
   sell-items, and so the UI lets the client pick items the easy way.

That "one missing concept" is explained next. It is the heart of this plan.

---

## 2. The one big idea — `itemType`

### The problem today

Right now every item — a finished jar, a cardboard box, a steel sheet, a
buffing wheel — sits in **one single `SKU` table**. The only thing telling them
apart is a **free-text `category`** field (values like `"PP Jar"`, `"Mixer Jar"`).

If we just dump 7 raw materials + ~130 consumables into that same table, the
Pricing Hub becomes a **soup of ~180 mixed rows**. The client cannot tell what
they sell from what they buy. That breaks your requirement *"easy to pick what
SKU they want to see."*

### The fix — add a top-level `itemType`

We add **one new field** to the SKU record: `itemType`. It is a fixed list
(an enum — only these values allowed, no typos possible):

```
itemType ∈  FINISHED_GOOD | RAW_MATERIAL | CONSUMABLE | PACKING | CIRCLE
```

Think of it as the **top shelf**. The existing `category` becomes the
**sub-shelf** inside it:

```
itemType: CONSUMABLE
   └─ category: "Buffing"      → Side Buff, Buff 3", Khila Buff 4" ...
   └─ category: "Brush"        → Brush 7", Lokhand Brush, Tar Brush ...
   └─ category: "Bearing"      → Bearing 30204, 32212 ...
   └─ category: "Belt"         → Belt B-70, B-71 ...
   └─ category: "Chemical/Oil" → Press Oil, DD White Chemical ...
   └─ category: "Abrasive"     → FW flap wheels, Polish Paper ...
   └─ category: "General"      → Soap, Gloves, Duster ...
```

**Why this is the right design (not over-engineering):**

- **It is additive.** Nothing existing breaks. Old screens that don't know
  about `itemType` keep working exactly as before.
- **It is cheap.** One indexed field. No new tables, no data duplication.
- **It is the natural filter axis.** The UI top tab becomes
  `Finished Goods | Raw Material | Consumables | Packing` — one click to narrow
  ~180 rows down to the ~40 the client cares about right now.
- **It is honest.** It encodes the real business fact you told me:
  FG = sell side, the rest = buy side.
- **It scales.** Tomorrow if they add "Spare Parts" or "Tools", it's one new
  enum value — not a redesign.

This is the **only structural change**. Everything else is wiring.

---

## 3. Data audit — problems I found in your sheet (please read)

I checked every row of the Master Sheet **before** writing any import code,
because a bad import is very hard to undo. Here is what I found. **The import
script will handle each of these the way described — you can override any of it.**

### 3.1 ⚠ Duplicate SKU codes inside Consumables

The `code` field must be **unique** (it has a unique database index). These rows
clash or repeat:

| Issue | Rows | How I will handle it |
|---|---|---|
| **"Green Pad - Fiber" listed twice** with *two different codes* | `CO-GF-00-00` **and** `CO-GP-FB-00` | Same physical item. I will keep **one** record (`CO-GF-00-00`) and add `CO-GP-FB-00` as an **alias** so old references still resolve. *(Your call — see Decision 3.)* |

### 3.2 ⚠ Blank SKU codes — the 5 "WPS Pomex Material" rows

These 5 Consumable rows have an **empty code column**:

```
WPS Pomex Material -  OD 190mm X Length - 2½"     (no code)
WPS Pomex Material -  OD 155mm X Length - 2"      (no code)
WPS Pomex Material -  OD 160mm X Length - 2 ½"    (no code)
WPS Pomex Material -  OD 140mm X Length - 2 ½"    (no code)
WPS Pomex Material -  OD 6" X Length - 3"         (no code)
```

A SKU **cannot exist without a code.** I will **auto-generate stable codes** from
their size (same style your other codes use), so nothing is lost:

```
CO-WPS-190-25   ·   CO-WPS-155-20   ·   CO-WPS-160-25
CO-WPS-140-25   ·   CO-WPS-006-30
```

If you have the **real codes** for these, give them to me and I'll use those
instead. *(Decision 4.)*

### 3.3 ℹ Category-vs-prefix mismatches (cosmetic — I will NOT silently "fix")

A few rows have a category that disagrees with their code prefix:

- `CO-FW-00-00` **"FlyWheel"** is tagged **Packing**, but `CO-` = Consumable.
  *(This is in the Packing data you already pushed — I will leave it alone and
  just flag it.)*
- `BB-BT-00-00` **"Bal Black Tapper"** is tagged Consumable but uses a `BB-`
  prefix. Code is still unique → it imports fine, no problem.

### 3.4 ℹ Duplicates in the *Packing* section (already pushed — for your awareness)

The Packing rows you already loaded **also** have duplicates — for example
`PK-PP10-BX` is used for **both** *"1.0Ltr SG Box"* **and** *"PP Dry Box"*; and
the MG box/partition rows appear a second time with **blank codes**. I will
**not** touch already-pushed Packing data in this task, but I recommend a
**separate clean-up pass** later. Say the word and I'll include it.

### 3.5 ✅ Raw Material — clean

All 7 raw-material rows have unique, well-formed codes. No problems:

```
JSL202-08  DD 0.80 mm      JSL204-08  Cu 0.80 mm
JSL202-07  DD 0.70 mm      JSL204-07  Cu 0.70 mm
JSL202-06  DD 0.60 mm      JSL204-06  Cu 0.60 mm
                           JSL204-10  Cu 1.00 mm
```

### 3.6 Circles — excluded

All `Circles` rows (e.g. `JSL204-08-850`) are **skipped entirely**, per your
instruction. The `CIRCLE` itemType value exists in the enum as a placeholder
only — nothing is imported into it.

---

## 4. Database design — exactly what changes

### 4.1 The `SKU` model — one new field + one index

```js
// backend/src/modules/skus/sku.model.js   — ADD this block
itemType: {
  type: String,
  enum: ['FINISHED_GOOD', 'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE'],
  default: 'FINISHED_GOOD',
  index: true,
},
// (category stays — it now means "sub-group within the itemType")
```

```js
SkuSchema.index({ itemType: 1, category: 1 });   // fast tab + sub-group filter
```

That's it for the schema. **No other model changes.** `PriceRevision`,
`CompanySettings`, the calculator — all stay as they are.

### 4.2 Backfill the items already in the DB (safe migration)

The 41 Finished Goods and the Packing items already in the DB have **no
`itemType` yet**. A one-time migration sets it:

| Existing item | Detection rule | Gets `itemType` |
|---|---|---|
| 41 FG SKUs (`PP1500-202`, `ST1000-202`, …) | known FG code list | `FINISHED_GOOD` |
| Packing SKUs (`PK-…`, `ML-…`) | code prefix `PK`/`ML` or category = Packing | `PACKING` |
| Anything else unmatched | — | left as default, **reported** for you to check |

The migration runs in **dry-run mode first** — it prints what it *would* do and
changes nothing. You read the report, approve, then I run it for real.

### 4.3 The price stream — how "buy price" is stored

`PriceRevision` already supports **two price streams** per item:

- `SELLING`  — the price you sell at.
- `RM_COST`  — a cost price.

**My recommendation (Decision 1):** for buy-items (RM / Consumables / Packing)
we use the existing **`RM_COST`** stream as their **purchase price** — and in the
UI we **rename the label** depending on what you're looking at:

```
Looking at Finished Goods   →  stream toggle shows:  "Selling Price"
Looking at RM/Consum/Packing →  stream is:           "Purchase Price"
```

**Why reuse `RM_COST` instead of inventing a new `PURCHASE` type:**

- Zero data-model churn — analytics, calculator, document tracker, and export
  **already** understand `RM_COST`. A brand-new type means touching all of them.
- It is functionally identical — the approval engine only does margin checks on
  `SELLING`; a cost stream behaves the same whether we call it `RM_COST` or
  `PURCHASE`.
- The only downside is the *word* "RM Cost" on a cardboard box — and a **dynamic
  label** fixes that completely.

Lower risk, faster, same result. If you'd still prefer a separate `PURCHASE`
type for perfectly clean wording, I can do it — it's just more surface area.
Tell me in Decision 1.

### 4.4 Where the data lives (version-controlled, reviewable)

I will **not** hard-code 137 rows inside a script. Instead:

```
backend/src/data/material-master.js     ← the cleaned RM + Consumables data
                                            (deduped, codes filled, sub-grouped)
backend/src/scripts/importMaterialMaster.js  ← reads that file, upserts to DB
```

This way the data is in git, you can see every row, and the import is just a
dumb, safe, re-runnable loader.

---

## 5. The import — how the data gets in (safely)

The import script (`importMaterialMaster.js`) follows production-grade rules:

1. **Scope lock** — imports **only** `RAW_MATERIAL` and `CONSUMABLE`.
   Finished Goods, Packing, and Circles are *never* written by this script.
2. **Dry-run by default** — running it plain prints a full report and writes
   **nothing**:
   ```
   node src/scripts/importMaterialMaster.js          ← preview only
   node src/scripts/importMaterialMaster.js --commit ← actually writes
   ```
3. **Idempotent** — keyed on `code` with upsert. Run it 10 times → same result,
   no duplicates. Safe to re-run after a fix.
4. **De-dupe pass** — collapses repeats and the `Green Pad` clash *before*
   touching the DB.
5. **Validation** — every row must have a non-empty code and name, or it is
   rejected and listed (not silently dropped).
6. **Report** — at the end you get: `created`, `updated`, `skipped`, and a list
   of every code that was auto-generated or merged.

Expected outcome on commit:

```
RAW_MATERIAL ......  7 items
CONSUMABLE ....... ~130 items   (exact count printed by the dry-run)
Auto-generated codes:  5  (WPS Pomex)
Merged duplicates:     1  (Green Pad - Fiber)
Circles skipped:       all
Packing / FG:          untouched
```

**Note:** these new buy-items will start as **"Unpriced"** — that is correct.
A SKU and its *price* are two different things. The price is added afterwards
(see Decision 2 — optional opening-price import if you give me a rate list).

---

## 6. The Price Tracker MIS — UI design

Today's `Pricing Hub` has a 2-way toggle (`Selling Prices | RM Costs`). With
~180 mixed items that is not enough. Here is the upgraded layout — **same Hub,
one new navigation row on top**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  💰  PRICE TRACKER                                      [Export ▾] [Revise] │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─ STEP 1 · Pick the kind ──────────────────────────────────────────────┐ │
│  │ [ Finished Goods ] [ Raw Material ] [ Consumables ] [ Packing ]        │ │
│  │       (sell side)      ◀────────  buy side  ────────▶                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─ STEP 2 · Narrow it down ─────────────────────────────────────────────┐ │
│  │ Sub-group:  [All] [Buffing] [Brush] [Bearing] [Belt] [Chemical] …      │ │
│  │ 🔎 Search code or name…                          Stream: Purchase ▼   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  KPIs:  Total 130 │ Changed 4 │ Stable 110 │ Stale 12 │ Unpriced 4 │ …     │
│                                                                            │
│  ┌─ The list ────────────────────────────────────────────────────────────┐ │
│  │ Code         Name              Current   Previous   Δ%    Updated     │ │
│  │ CO-BF-30-00  Buff - 3"          ₹42.00    ₹40.00    +5%   12 May  →   │ │
│  │ CO-BR-32-212 Bearing - 32212   ₹310.00   ₹295.00   +5%   02 May  →   │ │
│  │ CO-WPS-190-25 WPS Pomex OD190…  —  (unpriced)              [Set price] │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│       click a row  → History Drawer (every change: who · when · why · proof)│
└────────────────────────────────────────────────────────────────────────────┘
```

**Why this works for the client:**

- **Step 1 → Step 2 is how people think.** "I want a *consumable* → a *bearing*
  → *32212*." Three clicks, no scrolling through 180 rows.
- The **stream label changes itself** — "Selling Price" on Finished Goods,
  "Purchase Price" on the buy kinds. The client never sees a confusing word.
- **Everything else stays** — the History Drawer, KPIs, status chips
  (Changed / Stale / Unpriced), Excel export — all already built, now just
  scoped to the chosen kind.
- **Unpriced rows get a clear "Set price" button** instead of looking broken.

### Calculator

The existing Calculator stays. One change: it inherits the chosen **kind** so:

- On **Finished Goods** → it's a **sales quote** calculator (selling price + GST).
- On **Consumables / RM / Packing** → it's a **purchase-cost estimator** (what a
  vendor order will cost). Same screen, right prices, right label.

### Analytics

The existing Analytics dashboard stays. One change: it accepts the **kind**
filter, so the client can ask *"show me Consumables price inflation over the
last 12 months"* or *"top 5 raw materials that got costlier"* in one click.

---

## 7. Build order — phase by phase (each phase is safe & reviewable)

| Phase | What I do | You can check |
|---|---|---|
| **1. Schema** | Add `itemType` + index to SKU model. | App still runs; nothing visible yet. |
| **2. Backfill** | Migration sets `itemType` on existing FG + Packing. **Dry-run → you approve → commit.** | Read the dry-run report. |
| **3. Data file** | Create `material-master.js` — cleaned RM + Consumables, deduped, codes filled. | Open the file, eyeball every row. |
| **4. Import** | `importMaterialMaster.js`. **Dry-run → you approve → commit.** | Read the dry-run report; check counts. |
| **5. Backend API** | Add `itemType` filter to master / analytics / calculator / export endpoints. | API returns filtered data. |
| **6. Frontend** | Add Step-1 kind tabs + dynamic stream label to Pricing Hub; wire Calculator & Analytics to the kind. | Click through the new UI. |
| **7. Polish** | "Set price" button on unpriced rows, empty states, sub-group chips per kind. | Final walkthrough. |
| **8. (Optional)** | Bulk opening-price import — *only if* you give me a rate list (Decision 2). | Prices show as Current. |

Each phase is committed separately so you review and steer at every gate.
After phase 4 the data is fully in. After phase 6 the client has the new UI.

---

## 8. Production-quality rules I will follow (every phase)

- **Dry-run before every destructive step** — migration and import both preview
  first, write only on `--commit`.
- **Idempotent** — re-running any script is safe; no duplicates ever.
- **Additive & backwards-compatible** — no existing screen breaks; `itemType`
  has a safe default.
- **Data in git** — the material list is a reviewable file, not buried in code.
- **Validation at the boundary** — bad rows are rejected and reported, never
  silently swallowed.
- **Indexed for speed** — `{ itemType, category }` index keeps the filtered Hub
  instant even at thousands of SKUs.
- **Audit preserved** — every price uses the existing `PriceRevision` journal,
  so who/when/why/proof is always recorded.
- **No silent guesses** — every auto-generated code and every merge is printed
  in the report for you to confirm.

---

## 9. Decisions I need from you (quick — pick or say "you decide")

| # | Decision | My recommendation |
|---|---|---|
| **1** | Buy-price stream: reuse `RM_COST` (relabel UI) **or** add new `PURCHASE` type? | **Reuse `RM_COST`** — lower risk, faster, identical result. |
| **2** | Do you have a **current rate list** for the RM/Consumables? If yes I'll bulk-load opening prices; if no, they start "Unpriced" and prices are entered in-app. | Send the rate list if you have it — otherwise fine to start unpriced. |
| **3** | "Green Pad - Fiber" appears twice (`CO-GF-00-00`, `CO-GP-FB-00`). Merge into one (alias the other)? | **Yes, merge** — it's one physical item. |
| **4** | The 5 "WPS Pomex" rows have no code. Use my auto-generated codes (`CO-WPS-190-25`…) or do you have the real ones? | Use auto-generated unless you have the real codes. |
| **5** | Should I also include a **clean-up pass** for the duplicate Packing rows already in the DB? | Optional — recommend doing it as a small separate task later. |

---

## 10. What "done" looks like

1. The client opens **Price Tracker**, clicks **Consumables** → **Bearing** →
   types "32212" → sees **Bearing 32212**, its current price, previous price,
   and a History Drawer with every change (who, when, why, proof file).
2. They switch to **Finished Goods** → the label flips to "Selling Price"
   automatically → they see the jars they dispatch.
3. They open the **Calculator** under Consumables, pick 5 items, get a
   purchase-cost estimate with GST.
4. They open **Analytics**, filtered to Consumables → see a 12-month price-trend
   chart and the top items that got costlier.
5. All 7 Raw Materials + ~130 Consumables are in the DB, cleanly typed and
   sub-grouped. Circles were never touched. Finished Goods & Packing untouched.

---

### 👉 Next step

Read this. Then reply **"approved"** to start at Phase 1 — or tell me your
answers to Section 9 / any changes you want. I will not touch the database
until you approve.
