/**
 * IMS field help — the single source of truth for every hover explanation in
 * the four IMS modules (Consumables & Packing, Raw Material, Finished Goods,
 * Scrap).
 *
 * WHY THIS FILE EXISTS
 * Each screen used to carry its own one-line hint, so the same field was
 * explained three different ways — or, worse, explained with a textbook
 * inventory formula that is not the one this application actually runs. Every
 * entry below was written after tracing the real calculation in
 * backend/src/modules/inventory (ims.service.js, rmIms.service.js,
 * fgIms.service.js, scrapIms.service.js).
 *
 * THE ONE RULE
 * Where a field genuinely behaves differently between modules, it gets a
 * SEPARATE entry. Average Daily Consumption, In Transit, Projected Available,
 * Available % and Suggested Qty all mean different things in different modules,
 * and a shared tooltip for them would be wrong on at least two screens. The
 * per-module sections below exist for exactly that reason.
 *
 * SHAPE
 *   means    what the field is, in one plain sentence
 *   source   where the number comes from (measured, typed, master data, PO…)
 *   formula  the real calculation, when there is one
 *   matters  what the number goes on to drive
 *   example  only where a number makes it click
 *
 * Plain strings are still accepted anywhere a structured entry is, so an
 * explanation that needs no breakdown can stay a sentence.
 *
 * LANGUAGE: business English. No field names from the code, no table names, no
 * transaction codes. "Issued to production", not "CONSUME_OUT".
 */

// ── Wording used in more than one place, kept identical on purpose ───────────
const ISSUE_RULE =
  'Only stock issued to production counts. Transfers, returns, corrections, '
  + 'coil-to-circle conversions, dispatches and anything coming IN are not counted.';

const RP_NO_SF =
  'Note: the Safety Factor is deliberately NOT part of this. Changing the '
  + 'Safety Factor moves the Max Level, but never moves the Reorder At figure.';

// Checked in this order, first match wins. Written against Projected Available
// rather than "stock plus what is coming", because each module works that
// figure out differently — see the Projected Available entry for this module.
const STATUS_LADDER =
  'Out of stock — nothing physically left in the store.\n'
  + 'Reorder — Projected Available has fallen to the Reorder At level.\n'
  + 'Overstock — stock in hand is more than 1.25 times the Max Level.\n'
  + 'Low — above Reorder At, but still inside the safety cushion.\n'
  + 'OK — none of the above.';

// ── Identity and master data (same everywhere) ───────────────────────────────
export const COMMON = {
  skuCode: {
    means: 'The unique code for this item.',
    source: 'SKU Master. IMS uses it to tie stock, purchases, consumption and reorder figures to the right item.',
  },
  skuName: {
    means: 'The item name as it appears in the SKU Master.',
    source: 'SKU Master.',
  },
  category: {
    means: 'The group this item is filed under, used for filtering and for the category breakdown on the dashboard.',
    source: 'SKU Master. Blank when the item has not been grouped.',
  },
  unit: {
    means: 'The unit every quantity in this row is counted in.',
    source: 'SKU Master.',
  },
  convertedItemName: {
    means: 'The name this item is sold on as, when that differs from the item name.',
    source: 'SKU Master. An older copy kept inside IMS is still read for items seeded before the master carried it.',
  },
  warehouse: {
    means: 'The store the stock sits in.',
    source: 'Recorded on each stock movement. Everything defaults to the MAIN store unless another one was chosen.',
  },

  // ── Stock ──────────────────────────────────────────────────────
  onHand: {
    means: 'How much is physically in the store right now.',
    source: 'The running total of every stock movement recorded for this item — receipts, issues, corrections and transfers.',
    matters: 'Drives Days Cover, the stock status, and the value of the stock held.',
  },
  openingStock: {
    means: 'The balance this item started with when it was first loaded into IMS.',
    source: 'Entered when the item was set up, usually from the client stock sheet. It is a starting point only — it does not change as stock moves.',
  },
  avgCost: {
    means: 'The average cost of one unit of the stock currently held.',
    source: 'Recalculated each time stock is received, as a weighted average of what has been paid.',
  },
  stockValue: {
    means: 'What the stock on hand is worth.',
    formula: 'On Hand × rate per unit.',
    source: 'Calculated at display time.',
  },

  // ── Planning inputs (typed by the planner) ─────────────────────
  leadDays: {
    means: 'How many days pass between raising the indent and actually receiving the material.',
    source: 'Typed into the item’s Inventory Policy. Defaults to 16 days when nobody has set one.',
    matters: 'Used in both Reorder At and Max Level, so it moves almost every planning figure on this screen.',
  },
  safetyFactor: {
    means: 'The cushion kept on top of normal demand, to cover usage running high or delivery running late.',
    source: 'Typed into the item’s Inventory Policy. Defaults to 1.5 when nobody has set one.',
    formula: 'Max Level = Average Daily Consumption × Lead Time × Safety Factor.',
    matters: 'Raises or lowers the Max Level, the Safety Stock and the suggested quantity. It does NOT affect Reorder At.',
    example: 'A Safety Factor of 1.5 keeps half again as much as one lead time’s worth of demand.',
  },
  moq: {
    means: 'The smallest quantity that can sensibly be ordered or made in one go.',
    source: 'Typed into the item’s Inventory Policy.',
    matters: 'If the suggested quantity comes out below this number, it is raised to it. A suggestion of zero stays zero.',
    example: 'Suggested 40 with a minimum of 100 is shown as 100.',
  },
  rate: {
    means: 'The price of one unit, used to value stock and to cost a suggested order.',
    source: 'Typed into the Inventory Policy. Falls back to the average cost of the stock held when no rate has been set.',
  },
  vendorName: {
    means: 'The supplier this item is normally bought from.',
    source: 'Typed into the Inventory Policy.',
  },

  // ── Calculated planning levels ─────────────────────────────────
  leadTimeDemand: {
    means: 'How much of this item gets used during one full lead time.',
    formula: 'Average Daily Consumption × Lead Time.',
    matters: 'This is the same number as Reorder At, and it is the base the Safety Stock is measured above.',
  },
  reorderPoint: {
    means: 'When stock falls to this number, it is time to place the order.',
    formula: 'Average Daily Consumption × Lead Time.',
    source: 'Calculated. It is exactly the amount used up while waiting for delivery.',
    matters: RP_NO_SF,
    example: 'Using 10 a day with a 16-day lead time gives a Reorder At of 160.',
  },
  maxLevel: {
    means: 'The level stock is topped back up to — the most that should be held.',
    formula: 'Average Daily Consumption × Lead Time × Safety Factor.',
    source: 'Normally calculated (AUTO). A number typed in deliberately (MANUAL) overrides the calculation.',
    matters: 'Sets the suggested order quantity and the Overstock warning.',
  },
  maxLevelMode: {
    means: 'Whether the Max Level is being calculated or has been overridden by hand.',
    source: 'Chosen in the Policy drawer.',
    formula: 'AUTO recalculates Average Daily Consumption × Lead Time × Safety Factor every time. MANUAL keeps the number that was typed in.',
    matters: 'On MANUAL, editing the Safety Factor will not move the Max Level — the typed number wins.',
  },
  safetyStock: {
    means: 'The buffer held above what is needed just to cover the wait for delivery.',
    formula: 'Max Level − Reorder At (never below zero).',
    matters: 'Falling into this cushion is what puts an item into the Low status.',
  },
  daysCover: {
    means: 'How many days the stock in hand will last at the current daily rate.',
    formula: 'On Hand ÷ Average Daily Consumption.',
    source: 'Calculated. Blank when there is no daily rate yet, because it cannot be worked out.',
    matters: 'The reorder list is sorted by this — the item closest to running out comes first.',
  },
  status: {
    means: 'How healthy this item’s stock is right now.',
    source: 'Worked out each time the screen loads, by comparing stock against the levels below.',
    formula: STATUS_LADDER,
  },
  booked: {
    means: 'Quantity already promised to confirmed orders, so it is not free to use.',
    source: 'Typed into the item’s Inventory Policy.',
    matters: 'Subtracted when working out what is genuinely available to plan with.',
  },

  // ── Movements ──────────────────────────────────────────────────
  movementDate: {
    means: 'The date this stock movement was recorded against.',
    source: 'Entered when the movement was saved; defaults to the day it was entered.',
  },
  movementType: {
    means: 'What kind of stock movement this was — for example goods received, issued to production, a correction, a transfer, a coil cut or a dispatch.',
    source: 'Set automatically by the screen the entry was made from, so it cannot be mistyped.',
    matters: 'Only issues to production count towards the daily consumption average. Corrections, transfers, conversions and dispatches do not.',
  },
  movementQty: {
    means: 'How much stock this one movement added or removed.',
    source: 'Entered by whoever recorded the movement.',
  },
  balanceAfter: {
    means: 'What the stock balance stood at immediately after this movement.',
    source: 'Recorded on the movement itself, so the history always adds up.',
  },
  recordedBy: {
    means: 'Who recorded this movement.',
    source: 'The signed-in user at the time.',
  },
  movementRef: {
    means: 'The document this movement came from, such as a goods receipt or a conversion.',
    source: 'Stored with the movement so any quantity can be traced back to its paperwork.',
  },
  movementNotes: {
    means: 'Free-text notes typed when the movement was recorded.',
    source: 'Entered by the user. Often blank.',
  },
  batchNo: {
    means: 'The batch this movement belongs to.',
    source: 'Entered by the user. Used to tie a coil, its cut and its scrap together.',
  },
  movementNumber: {
    means: 'The reference number given to this stock movement.',
    source: 'Generated automatically when the movement is saved, so every entry can be found again.',
  },
  costPerUnit: {
    means: 'What one unit cost on this particular movement.',
    source: 'Entered when stock was received. Feeds the running average cost of the stock held.',
  },
  quantity: {
    means: 'The quantity being recorded on this line.',
    source: 'Entered by the user.',
  },
  reference: {
    means: 'The document or reason behind this entry.',
    source: 'Entered, or carried over automatically from the document that created the movement.',
  },

  // ── Running balances on a stock card ───────────────────────────
  openingBalance: {
    means: 'What the balance stood at at the start of the day.',
    source: 'Carried forward from the previous day’s closing balance.',
  },
  closingBalance: {
    means: 'What the balance stood at at the end of the day.',
    formula: 'Opening + everything in − everything out.',
  },
  newBalance: {
    means: 'What the balance will be once this entry is saved.',
    formula: 'Current balance ± the quantity on this line.',
    matters: 'Shown before saving so a mistake is caught before it reaches the ledger.',
  },
  recordedAt: {
    means: 'When this entry was saved.',
    source: 'Stamped automatically.',
  },
  dayIn: {
    means: 'Everything that came into stock on this day.',
    source: 'Added up from that day’s incoming movements.',
  },
  dayOut: {
    means: 'Everything that left stock on this day.',
    source: 'Added up from that day’s outgoing movements.',
  },
  dayNet: {
    means: 'The net change in stock across the day.',
    formula: 'Total in − total out.',
  },
};

// ── Consumables & Packing ────────────────────────────────────────────────────
// ADC here is MEASURED ONLY. There is no typed fallback at all.
export const IMS = {
  adc: {
    means: 'The average amount of this item used per day.',
    source: 'Measured from the last 90 days of actual issues. ' + ISSUE_RULE,
    formula: 'Total issued over the last 90 days ÷ 90.',
    matters: 'Drives Reorder At, Max Level, Safety Stock and Days Cover. An item with nothing issued in the last 90 days shows 0 — this module never falls back to a typed figure.',
    example: '900 units issued over the last 90 days works out at 10 a day.',
  },
  dailyConsumption: {
    means: 'How much was actually issued TODAY. This is not the average — it is just today.',
    source: 'Today’s issue transactions only.',
    matters: 'Shown beside the average so you can see whether today is normal. Blank means nothing has gone out today; yesterday’s figure is never carried forward.',
  },
  inTransit: {
    means: 'Quantity ordered from the supplier but not yet received.',
    source: 'Typed into the item’s Inventory Policy. In this module it is a manually maintained figure, not read from purchase orders.',
    matters: 'Added to stock in hand when deciding whether the item needs reordering.',
  },
  projectedAvailable: {
    means: 'What you can count on having — what is in the store plus what is on its way.',
    formula: 'On Hand + In Transit.',
    matters: 'This is the figure compared against Reorder At to decide whether to order.',
  },
  suggestedOrderQty: {
    means: 'How much to buy now to bring stock back up to the Max Level.',
    formula: 'Max Level − Projected Available (never below zero). If the result is below the minimum order quantity, it is raised to it.',
    matters: 'This is the quantity to put on the purchase indent.',
  },
};

// ── Raw Material ─────────────────────────────────────────────────────────────
// Measured rate wins when there is one; otherwise the planned Low/Normal/Peak
// column. In Transit comes from open purchase orders.
export const RM = {
  adc: {
    means: 'The daily rate this item is planned with.',
    source: 'Measured from the last 90 days of actual issues whenever there have been any. '
      + 'If nothing has been issued yet, the planned Low / Normal / Peak rate is used instead. ' + ISSUE_RULE,
    formula: 'Measured rate = total issued over the last 90 days ÷ 90.',
    matters: 'Drives Reorder At, Max Level, Safety Stock and Days Cover. The screen shows whether the figure being used is measured or planned.',
    example: '900 kg issued over the last 90 days works out at 10 kg a day. An item with no issues yet falls back to its typed rate instead.',
  },
  plannedAdc: {
    means: 'The forecast daily rate typed by the planner — the Low, Normal or Peak column, whichever mode is selected.',
    source: 'Typed into the Inventory Policy. Defaults to the Low column.',
    matters: 'Used only when there is no measured usage yet.',
  },
  measuredAdc: {
    means: 'The daily rate actually measured from issues over the last 90 days.',
    source: 'Calculated from issue transactions. ' + ISSUE_RULE,
    matters: 'As soon as this is above zero it takes over from the planned rate.',
  },
  consumptionMode: {
    means: 'Which forecast column the planner wants to use — Low, Normal or Peak.',
    source: 'Chosen in the Policy drawer. Defaults to Low.',
    matters: 'Only has an effect while the item has no measured usage.',
  },
  dailyConsumption: {
    means: 'How much was actually issued TODAY. Not the average.',
    source: 'Today’s issue transactions only.',
    matters: 'Blank means nothing went out today. An older day’s figure is never shown in its place.',
  },
  inTransit: {
    means: 'Quantity ordered from the supplier but not yet received.',
    source: 'Taken from the open purchase orders in Purchase FMS — what was ordered, less what has already been received. '
      + 'The typed policy figure is used only for an item with no open purchase order, and the two are never added together.',
    matters: 'Counts towards what is available to plan with, so it holds back a reorder that is already on its way.',
  },
  projectedAvailable: {
    means: 'What is genuinely free to plan with.',
    formula: 'On Hand + In Transit − Booked.',
    matters: 'This is the figure compared against Reorder At to decide whether to order.',
  },
  availablePct: {
    means: 'How full the bin is — stock in hand as a share of the Max Level.',
    formula: 'On Hand ÷ Max Level × 100.',
    source: 'Calculated. It deliberately uses only what is physically in the store — material on its way and material already booked are left out, because this column answers "how much is actually here", not "should I order".',
    matters: 'Under 33% is critical, 33–66% is thin, 66–100% is comfortable, and above 100% means more is held than the Max Level allows for.',
  },
  suggestedOrderQty: {
    means: 'How much to buy now to bring stock back up to the Max Level.',
    formula: 'Max Level − Projected Available (never below zero). Raised to the minimum order quantity if it falls below it.',
    matters: 'This is the quantity to put on the purchase indent.',
  },
  buyCost: {
    means: 'What the suggested order would cost.',
    source: 'Calculated at display time.',
    formula: 'Suggested Order Qty × rate per unit.',
  },
  onHandKg: {
    means: 'The weight of the circles held, recorded alongside the piece count.',
    source: 'Captured when circles are produced or received.',
    matters: 'This is a record only. Circles are stocked, issued and planned in PIECES — the weight never feeds Max Level, Available % or Days Cover. It also drifts low as pieces go out, so it should not be read as a live weight balance.',
  },
  openPo: {
    means: 'The purchase orders that are still open for this item.',
    source: 'Purchase FMS. Quantities already received are not counted again.',
  },
  poOrdered: {
    means: 'The total quantity ordered across all open purchase orders for this item.',
    source: 'Purchase FMS.',
  },
  poReceived: {
    means: 'How much of those open orders has already arrived.',
    source: 'Purchase FMS goods receipts.',
  },
  poPending: {
    means: 'How much is still to come from the supplier.',
    formula: 'Ordered − Received.',
    matters: 'This is the figure shown as Material In Transit for this item.',
  },

  // ── Raw-material stock card columns ────────────────────────────
  inward: {
    means: 'Material received into the store on this day.',
    source: 'Added up from the day’s goods receipts and manual stock-in entries.',
  },
  consumption: {
    means: 'Material issued to production on this day.',
    source: 'Added up from the day’s issue entries. This is the same kind of movement the 90-day average is measured from.',
  },
  conversionIn: {
    means: 'Circles that came into stock from a coil being cut on this day.',
    source: 'Recorded automatically by the conversion screen.',
  },
  conversionOut: {
    means: 'Coil that was consumed by a cut on this day.',
    source: 'Recorded automatically by the conversion screen. This is not counted as production consumption, so it never affects the daily average.',
  },
  adjustment: {
    means: 'A manual correction to the balance on this day, up or down.',
    source: 'Entered by a user to fix a counting error. Corrections are never counted in the daily average.',
  },
};

// ── Finished Goods ───────────────────────────────────────────────────────────
// Demand here is PLANNED ONLY — dispatches are recorded but are not measured
// back into the daily rate.
export const FG = {
  add: {
    means: 'The average number of units expected to be sold or dispatched per day.',
    source: 'Typed by the planner as the Low, Normal or Peak column, whichever mode is selected. Defaults to the Normal column.',
    matters: 'Drives Reorder At, Max Level, Safety Stock and Days Cover. Unlike Raw Material and Consumables, it is NOT measured from actual dispatches — finished goods always plan on the typed forecast.',
    example: 'A Normal rate of 40 with a 10-day lead time gives a Reorder At of 400.',
  },
  consumptionMode: {
    means: 'Which forecast column to plan with — Low, Normal or Peak.',
    source: 'Chosen in the Policy drawer. Defaults to Normal.',
  },
  inProduction: {
    means: 'Units currently being made that are expected to be finished and added to stock.',
    source: 'Typed into the item’s policy as work in progress.',
    matters: 'Counted as available when deciding whether more needs to be produced.',
  },
  projectedAvailable: {
    means: 'What can actually be promised to a customer.',
    formula: 'On Hand + In Production − Booked.',
    matters: 'This is the figure compared against Reorder At to decide whether to schedule production.',
  },
  availablePct: {
    means: 'How well covered this finished good is, against its target level.',
    formula: 'Projected Available ÷ Max Level × 100.',
    source: 'Calculated. Note this includes what is in production and excludes what is already booked — it is a forward-looking figure, unlike the Raw Material version of this column.',
  },
  suggestedProduceQty: {
    means: 'How many units to PRODUCE now to bring stock back to the target level. This is a production quantity, not a purchase quantity.',
    formula: 'Max Level − Projected Available (never below zero). Raised to the minimum batch size if it falls below it.',
    matters: 'This is what goes onto the production plan.',
  },
  sellingPrice: {
    means: 'The price this finished good is sold at.',
    source: 'SKU Master.',
  },
  committedValue: {
    means: 'The value of the stock already promised to customers.',
    formula: 'Booked × selling price.',
  },
  maxLevel: {
    means: 'The target stock level for this finished good.',
    formula: 'Average Daily Demand × Lead Time × Safety Factor.',
    source: 'Calculated when the Max Level is left blank. A number typed in deliberately overrides it.',
    matters: 'Sets the suggested production quantity and the Overstock warning.',
  },
  leadDays: {
    means: 'How many days it takes to produce this item once production starts.',
    source: 'Typed into the item’s policy. Defaults to 16 days.',
  },

  // Finished goods plan against DEMAND, not consumption. Same arithmetic as the
  // other modules, but the shared wording would name the wrong column here.
  reorderPoint: {
    means: 'When Projected Available falls to this number, it is time to schedule production.',
    formula: 'Average Daily Demand × Lead Time.',
    source: 'Calculated. It is the quantity sold during the time it takes to make more.',
    matters: RP_NO_SF,
  },
  safetyFactor: {
    means: 'The cushion kept on top of normal demand, to cover selling faster than expected or production running late.',
    source: 'Typed into the item’s policy. Defaults to 1.5 when nobody has set one.',
    formula: 'Max Level = Average Daily Demand × Lead Time × Safety Factor.',
    matters: 'Raises or lowers the Max Level, the Safety Stock and the suggested production quantity. It does NOT affect Reorder At.',
  },
  daysCover: {
    means: 'How many days the finished stock will last at the planned daily demand.',
    formula: 'On Hand ÷ Average Daily Demand.',
    source: 'Calculated. Blank when no daily demand has been set, because it cannot be worked out.',
    matters: 'The planning list is sorted by this — the item closest to running out comes first.',
  },
  safetyStock: {
    means: 'The buffer held above what is needed just to cover the production lead time.',
    formula: 'Max Level − Reorder At (never below zero).',
    matters: 'Falling into this cushion is what puts a finished good into the Low status.',
  },
  leadTimeDemand: {
    means: 'How many units are sold during one full production lead time.',
    formula: 'Average Daily Demand × Lead Time.',
    matters: 'This is the same number as Reorder At.',
  },
};

// ── Conversion (coil → circles) ──────────────────────────────────────────────
export const CONVERSION = {
  pieces: {
    means: 'The number of circles.',
    source: 'Entered when the circles were produced or received.',
    matters: 'Pieces are the stock balance for circles — this is the figure everything is planned on.',
  },
  weightKg: {
    means: 'The weight in kg — recorded alongside the piece count for circles. For an item counted in kg (a coil) it is the quantity itself.',
    source: 'Entered when the circles were produced, received or taken out — optional.',
    matters: 'A record only. It is never used for Max Level, Available % or Days Cover.',
  },
  sizeLabel: {
    means: 'The circle size this line refers to.',
    source: 'Entered on the conversion.',
  },
  circleProduced: {
    means: 'The circle size that came out of this coil.',
    source: 'Limited to the sizes the client has approved for the coil being cut. Identify the coil — usually by its batch number — and the list follows from it.',
    matters: 'A coil can only be cut into the sizes it was bought for. Offering every size is how a Cu coil ends up recorded as having produced DD circles, which puts the wrong item into stock and makes the yield meaningless.',
    example: 'Batch resolves to coil JSL204-07, so only JSL204-07-700, JSL204-07-750 and JSL204-07-840 can be chosen.',
  },

  // ── The weight columns on a circle stock card ──────────────────
  // Three different figures. They shared one explanation at first, which was
  // wrong for the closing balance in particular.
  inKg: {
    means: 'The total weight that came into stock on this day.',
    source: 'Added up from the day’s incoming entries. Shown only for items that are weighed as well as counted.',
  },
  outKg: {
    means: 'The total weight that left stock on this day.',
    source: 'Added up from the day’s outgoing entries.',
  },
  closingKg: {
    means: 'The recorded weight balance at the end of the day.',
    source: 'Carried alongside the piece balance for items that are weighed as well as counted.',
    matters: 'A record only — the piece count is the real balance. This weight drifts low as pieces go out, because pieces are issued without always recording a weight, so it should not be read as a true weight on hand.',
  },
  coilWeight: {
    means: 'The weight of the coil that was put into the cut.',
    source: 'Entered when the conversion is recorded. The coil is removed from stock by this weight.',
  },
  circlesWeight: {
    means: 'The total weight of all the circles that came out of the coil.',
    source: 'Added up from the weight entered against each circle size produced.',
  },
  circlesPcs: {
    means: 'How many circles were produced.',
    source: 'Entered per size when the conversion is recorded.',
    matters: 'Circles are stocked in PIECES, so this is the number that becomes stock. The weight is recorded separately and does not become the stock balance.',
  },
  scrapKg: {
    means: 'The material left over after cutting — what went in, minus what came out as circles.',
    formula: 'Coil Weight − Total Circle Weight.',
    source: 'Calculated from the two weights on the conversion.',
  },
  yieldPct: {
    means: 'How much of the coil was turned into usable circles.',
    formula: 'Circle Weight ÷ Coil Weight × 100.',
    matters: 'Not simply higher-is-better. Circles cannot pack tighter than about 86% of a coil, so a yield above that normally means the scrap was under-weighed, not that the cut went well. 75–86% is the working band; under 74% is a real loss on the floor.',
    example: '1,000 kg of coil producing 810 kg of circles is an 81% yield with 190 kg scrap — squarely normal. The same coil reporting 950 kg of circles is flagged for checking, not praised.',
  },
  scrapVerified: {
    means: 'Whether the leftover scrap from this cut has been physically checked.',
    source: 'Set on the conversion. Starts as not-yet-checked.',
  },
};

// ── Scrap ────────────────────────────────────────────────────────────────────
export const SCRAP = {
  scrapKg: {
    means: 'The weight of material left over from a cut.',
    formula: 'Coil Weight − Circle Weight.',
    source: 'Calculated on each cut.',
    matters: 'Coils that were received but never cut are left out of every scrap total. Their circle weight is blank, so counting them would report the whole coil as scrap and badly overstate the figure. They are counted separately as uncut batches instead.',
  },
  location: {
    means: 'Where the cutting happened — in-house or at a job worker.',
    source: 'Recorded on each cut.',
    matters: 'Only in-house cutting adds scrap to stock. Offcuts from job-work cutting stay with the job worker, so they are measured for yield but never become stock the company holds.',
  },
  disposition: {
    means: 'What has been decided about this scrap — checked and done, sent for job work, rejected, or still pending.',
    source: 'Set by the user on the scrap record.',
  },
  batchStatus: {
    means: 'Whether this coil was actually cut.',
    source: 'Set when the record is created.',
    matters: 'Uncut coils are kept on record but excluded from all scrap quantities, so the scrap totals stay honest.',
  },
  uncutBatches: {
    means: 'Coils that were received but have not been cut yet.',
    source: 'Counted separately from the scrap figures, never mixed into them.',
    matters: 'Shown so that the excluded rows are visible rather than silently dropped.',
  },
  avgYield: {
    means: 'The typical yield across the cuts being shown.',
    formula: 'Each cut’s own yield percentage, averaged. Note this is an average of the individual cuts, not total circles ÷ total coil — a small cut counts as much as a large one.',
    source: 'Calculated over cut batches only — uncut coils are left out.',
  },
  scrapStock: {
    means: 'The scrap balance currently held.',
    source: 'Moves like any other item: added by in-house cuts and manual scrap-in entries, reduced by scrap-out entries such as a sale or disposal.',
    matters: 'Scrap carries no rate anywhere in the source data, so scrap stock is tracked by quantity only and values at nil.',
  },
  scrapPct: {
    means: 'How much of this coil’s weight ended up as scrap.',
    formula: 'Total Scrap Weight ÷ Total Coil Weight × 100, across all the cuts shown.',
    matters: 'This is a total for the whole group, while the Average Yield beside it is the average of each individual cut. For that reason the two will usually not add up to exactly 100%.',
  },
  coilCut: {
    means: 'The coil this cut was made from.',
    source: 'Chosen when the conversion was recorded.',
  },
  party: {
    means: 'Who the scrap went to, or came from.',
    source: 'Entered on the scrap movement.',
  },
  inOut: {
    means: 'Whether this entry added scrap to stock or took it out.',
    source: 'Set by the screen the entry was made from. In-house cuts and manual scrap-in add; sales and disposals take out.',
  },
};

/**
 * Everything in one object, so a screen can pull just its own module:
 *   import FIELD from './imsFieldHelp';  →  FIELD.rm.adc
 * Module entries override the common ones of the same name.
 */
/**
 * Order matters: the module's OWN section is spread last, so it always wins.
 *
 * `scrapKg` is defined in both CONVERSION (the leftover from one cut) and
 * SCRAP (the register figure, which excludes uncut coils). With CONVERSION
 * last, the Scrap module's own column silently picked up the conversion
 * wording and lost the uncut-exclusion note that keeps the totals honest.
 */
export const FIELD = {
  common: COMMON,
  ims: { ...COMMON, ...IMS },
  rm: { ...COMMON, ...CONVERSION, ...RM },
  fg: { ...COMMON, ...FG },
  scrap: { ...COMMON, ...CONVERSION, ...SCRAP },
};

export default FIELD;
