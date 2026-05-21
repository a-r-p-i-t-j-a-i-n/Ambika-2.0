# PPC Planning — Make it a Real Production Module

> Read this, then tell me **"go"** or your changes. Nothing is built yet.

---

## 1. Why you (and the client) are confused — you are right

Today's **PPC Planning** page shows a month grid where each day cell has a
**planned dispatch** and **actual dispatch** number.

That is **dispatch tracking** — and the **Control Tower already does dispatch
plan-vs-actual**. So the current PPC page is a **duplicate**. It has no real
production job. That is exactly why it feels pointless.

**The fix:** PPC must stop being about dispatch and become about the **factory**.

---

## 2. The one idea that fixes it — two different worlds

| | 🚚 Control Tower | 🏭 PPC Planning |
|---|---|---|
| The question it answers | "Did we **ship** what we promised the customer?" | "Is the **factory making** enough, fast enough?" |
| Plan | Dispatch phases (P1, P2…) | Daily **production target** per jar type |
| Actual | Delivery Challans (goods that **left** the gate) | Daily **production output** (jars **made** on the floor) |
| Who uses it | Sales & Dispatch desk | **Production manager & shop floor** |
| "Plan vs Actual" means | promised-vs-shipped | **target-vs-produced** |

They **both** have a plan-vs-actual — but on **two different things**.
You cannot ship 5,000 jars if the factory only **made** 3,000. PPC is the
half that makes sure the goods **exist** before dispatch can happen.

```
   Customer Order ──▶ Dispatch Plan ──▶ [ PPC: the factory makes the jars ] ──▶ Actual Dispatch
                          │                          │                              │
                    Control Tower            PPC PLANNING (new)                 Control Tower
                    plans the promise        runs the production               checks the promise
```

---

## 3. The jar's journey — what PPC actually tracks

A mixer/grinder jar is **not made in one step**. It travels through stages:

```
 Raw Sheet ─▶ ① CUTTING ─▶ ② DRAWING ─▶ ③ BUFFING ─▶ ④ FINISHING ─▶ ⑤ PACKING ─▶ ✅ FG READY
   (steel/cu)   circles      press/draw   polish        trim+QC        box it       ready to dispatch
```

> These 5 stage names are my proposal — **tell me your real stage names** and I
> will use those. PPC's job is to know **how many jars sit at each stage** and
> **how many finish (reach FG Ready) each day**.

---

## 4. What the new PPC Planning will do

1. **Production Demand (auto)** — for every jar SKU, PPC computes how many the
   factory must make:
   ```
   Need to produce = open order qty  −  FG ready stock  −  jars already in WIP  +  safety buffer
   ```
   This is pulled **automatically from the live sales orders** — the floor never
   re-types order numbers. No double entry.

2. **Production Plan** — spread that quantity across the working days of the
   month → a clear **daily target per SKU**. PPC suggests an even split; the
   planner can adjust any day.

3. **Daily Production Entry** — a fast, tablet-friendly screen where the floor
   punches in *"today we finished 420 of Steele 1.5L"*. One tap per SKU.

4. **WIP Shop-Floor Board** — a board with a column per stage
   (Cutting → Drawing → Buffing → Finishing → Packing). Each card = a jar type
   with the quantity sitting at that stage. **"Where are my goods right now."**

5. **Production Achievement** — cumulative **produced vs target**: which SKUs are
   **on track**, which are **behind**, and by how much. Plus a "today" pulse:
   target today vs done today.

*(Later, optional)* **Material readiness** — "to hit this plan you need X kg of
sheet, Y circles, Z buffs — here's what's short." A light check, Phase 5.

---

## 5. The screens — clean & simple

### 5.1 Production Board (the home screen)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🏭 PPC — Production Control            May 2026 ▾        [+ Daily Entry]      │
├─────────────────────────────────────────────────────────────────────────────┤
│  To Produce 48,200 │ Produced 31,400 │ Behind 3 SKUs │ Today ▸ 1,600/1,250  │
├─────────────────────────────────────────────────────────────────────────────┤
│ JAR (SKU)        │ Need  │ Produced │ Balance │ Today tgt │ Done │ Status    │
│ Steele 1.5 L     │ 12,000│  9,400   │  2,600  │   420     │ 420  │ ✅ On track│
│ Steele 1.0 L     │  8,400│  4,100   │  4,300  │   500     │ 180  │ ⚠ Behind  │
│ Galaxy 1.5 L     │  6,000│  6,000   │     0   │    —      │  —   │ ✔ Done    │
│ MG 1.1 Wet Jar   │  9,800│  5,900   │  3,900  │   600     │ 600  │ ✅ On track│
│   click a row → day-by-day plan vs produced + the SKU's stage breakdown      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 WIP Shop-Floor Board (where the goods are)

```
┌──────────┬──────────┬──────────┬───────────┬──────────┬─────────────┐
│ CUTTING  │ DRAWING  │ BUFFING  │ FINISHING │ PACKING  │ ✅ FG READY │
├──────────┼──────────┼──────────┼───────────┼──────────┼─────────────┤
│ Steele1.5│ Steele1.5│ Galaxy1.5│ MG 1.1 Wet│ Steele1.0│ Galaxy 1.5  │
│   1,200  │   800    │   2,100  │    640    │   1,500  │   6,000     │
│ MG 1.1   │ Galaxy1.0│ Steele1.0│           │          │ Steele 1.5  │
│   900    │   1,100  │   1,800  │           │          │   9,400     │
└──────────┴──────────┴──────────┴───────────┴──────────┴─────────────┘
   move a card right as the batch advances a stage → totals update live
```

### 5.3 Daily Production Entry (for the floor, fast)

```
┌──────────────────────────────────────────────────────────┐
│ Daily Production · 20 May 2026                   [Save]   │
│ SKU                 Target today   Produced today         │
│ Steele 1.5 L            420        [   420   ]            │
│ Steele 1.0 L            500        [   180   ]  ⚠ short   │
│ MG 1.1 Wet Jar          600        [   600   ]            │
│ + add an unplanned SKU                                    │
└──────────────────────────────────────────────────────────┘
```

A **month calendar grid** (day-by-day plan vs produced) stays available as a
secondary view for the planner — but now it shows **production**, not dispatch.

---

## 6. Data model — clean, no overlap with dispatch

- **New `ProductionPlan`** — one per **SKU per month**: the net qty to produce,
  `days[]` of `{ date, targetQty, producedQty }`, opening FG stock & WIP, and a
  `wipByStage` snapshot. This is PPC's own data — the factory's truth.
- **Demand is read live** from sales orders / dispatch schedule — never copied,
  so it can't go stale.
- The **old `PPCEntry`** (the dispatch-matrix model) is **retired**; the dispatch
  data it held is already fully owned by the Control Tower.

---

## 7. Build order (each phase is shippable & reviewable)

| Phase | What | Outcome |
|---|---|---|
| 1 | Backend: `ProductionPlan` model + auto demand calc + daily-production API. Retire the dispatch-matrix PPC. | PPC has real data. |
| 2 | Frontend: **Production Board** + **Daily Production Entry**. | Floor can plan & log output. |
| 3 | Frontend: **WIP Shop-Floor Board** (stage columns). | "Where are my goods" answered. |
| 4 | **Month calendar** (production plan vs produced) + Export. | Planner's detail view. |
| 5 *(optional)* | **Material readiness** — sheet/circle/consumable check vs plan. | Mini-MRP. |

---

## 8. Decisions for you

| # | Decision | My recommendation |
|---|---|---|
| 1 | **Stage names** — are `Cutting → Drawing → Buffing → Finishing → Packing` right, or give me your real ones. | Use these unless you correct them. |
| 2 | **WIP board** — full stage-by-stage board, or keep it simple (just produced vs balance, no stage columns)? | **Full stage board** — it's the heart of real PPC and what impresses a client. |
| 3 | **Demand** — auto-pull from sales orders (recommended), or let the planner type production targets manually? | **Auto-pull** — no double entry, always accurate. |
| 4 | **Buffer** — keep a safety buffer % on top of demand? | Yes — a small configurable buffer (e.g. 3%). |

---

### 👉 Next step

Reply **"go"** to build Phase 1 — or tell me your stage names / changes first.
After each phase I'll stop so you can review.
