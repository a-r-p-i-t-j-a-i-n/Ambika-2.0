// Shared merge logic for the Dispatch Calendar (screen + PDF), so both read the
// SAME way. The client's rule: on any given day, a PARTY is ONE entry — it does
// not matter that the quantities came from different sales orders or POs. And
// within that entry, the SAME item is merged into one line with the combined
// quantity (so "PP Chutney" from two orders shows once, summed).

// Worst-status wins when several orders/SKUs collapse into one party entry.
export const PRIORITY = { DELAYED: 5, IN_PROGRESS: 4, PLANNED: 3, DISPATCHED: 2, CANCELLED: 1 };

/**
 * Merge a single day's events by PARTY, and merge identical SKUs inside each party.
 * @param {Array} list  the day's already-filtered events (uniform eventType per the
 *                       active view — scheduled OR actual).
 * @returns party groups, sorted worst-status / biggest-qty first.
 */
export const groupDayByParty = (list = []) => {
  const groups = new Map();
  list.forEach((e) => {
    const g = groups.get(e.partyName) || {
      id: `${e.dateKey}__${e.partyName}`,
      dateKey: e.dateKey,
      date: e.date,
      partyName: e.partyName,
      eventType: e.eventType || 'scheduled',
      status: 'CANCELLED',
      isDelayed: false,
      delayDays: 0,
      soSet: new Set(),
      events: [],
      skuMap: new Map(),
      plannedQty: 0,
      actualQty: 0,
      pendingQty: 0,
      // Production Plan only: how much of the plan an order has already taken.
      // Summed here so the PDF can colour a card the same way the screen does.
      usedQty: 0,
    };
    g.events.push(e);
    if (e.eventType === 'actual') g.eventType = 'actual';
    if (e.soNumber) g.soSet.add(e.soNumber);
    g.isDelayed = g.isDelayed || Boolean(e.isDelayed);
    g.delayDays = Math.max(g.delayDays, Number(e.delayDays || 0));
    if ((PRIORITY[e.status] || 0) > (PRIORITY[g.status] || 0)) g.status = e.status;
    g.plannedQty += Number(e.plannedQty || 0);
    g.actualQty += Number(e.actualQty || 0);
    g.pendingQty += Number(e.pendingQty || 0);
    g.usedQty += Number(e.usedQty || 0);
    (e.skus || []).forEach((sk) => {
      // Merge by SKU identity (code when present, else name) so the same item on
      // two different orders becomes ONE line with the combined quantity.
      const k = String(sk.skuCode || sk.skuName || '').toUpperCase();
      const cur = g.skuMap.get(k) || {
        skuName: sk.skuName, skuCode: sk.skuCode,
        plannedQty: 0, actualQty: 0, pendingQty: 0, usedQty: 0,
      };
      cur.plannedQty += Number(sk.plannedQty || 0);
      cur.actualQty += Number(sk.actualQty || 0);
      cur.pendingQty += Number(sk.pendingQty || 0);
      cur.usedQty += Number(sk.usedQty || 0);
      g.skuMap.set(k, cur);
    });
    groups.set(e.partyName, g);
  });

  return [...groups.values()].map((g) => {
    const isActual = g.eventType === 'actual';
    const skus = [...g.skuMap.values()]
      .sort((a, b) => (isActual ? b.actualQty - a.actualQty : b.plannedQty - a.plannedQty));
    return {
      ...g,
      soNumbers: [...g.soSet],
      orderCount: g.soSet.size,
      skus,
      totalQty: isActual ? g.actualQty : g.plannedQty,
    };
  }).sort((a, b) => (
    Number(b.isDelayed) - Number(a.isDelayed)
    || (PRIORITY[b.status] - PRIORITY[a.status])
    || (b.totalQty - a.totalQty)
  ));
};
