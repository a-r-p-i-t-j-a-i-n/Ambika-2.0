/**
 * Action-link registry — connects an FMS step to the REAL screen where the
 * work happens. The template designer picks one by key; at runtime the route
 * placeholders are filled from the live process ({soNumber}, {orderId},
 * {processId}, {intakeId}) so the doer lands on the exact page for THAT order.
 *
 * Keep keys stable — they are stored on templates and step instances.
 */
export const ACTION_LINKS = [
  { key: 'ORDER_INTAKE',    label: 'Order Intake (log a client order)', route: '/order-intake' },
  { key: 'ORDER_ENTRY',     label: 'Sales Order Entry (punch-in)',      route: '/orders?so={soNumber}' },
  { key: 'ORDER_DETAILS',   label: 'Order Details page',                route: '/orders/{orderId}' },
  { key: 'DISPATCH_PLAN',   label: 'Dispatch Planning',                 route: '/dispatch-planning?so={soNumber}' },
  { key: 'PPC',             label: 'PPC Planning',                      route: '/ppc-planning' },
  { key: 'ACTUAL_DISPATCH', label: 'Actual Dispatch (challan)',         route: '/challans?so={soNumber}' },
  { key: 'INVOICE',         label: 'Invoicing',                         route: '/invoices?so={soNumber}' },
  { key: 'CONTROL_TOWER',   label: 'Dispatch Control Tower',            route: '/dispatch-control-tower' },
  { key: 'FMS_PROCESS',     label: "This order's FMS flow",             route: '/o2d-fms/process/{processId}' },

  // ── Current-Sheet FMS step forms (do-the-entry → return to task) ──
  { key: 'DISPATCH_PLAN_PDF', label: 'Generate Dispatch Plan PDF',      route: '/dispatch-planning/generate-pdf?so={soNumber}' },
  { key: 'CHALLAN_PDF',       label: 'Generate Challan PDF',            route: '/challans/generate-pdf?so={soNumber}' },
  { key: 'INVOICE_ENTRY',     label: 'Create Invoice & Eway Bill (2.7)', route: '/o2d/invoice-entry' },
  { key: 'INVOICE_EMAIL',     label: 'Email Invoice & Eway (2.8)',      route: '/o2d/invoice-email' },
  { key: 'TRACK_DELIVERY',    label: 'Track Delivery (2.9)',            route: '/o2d/track-delivery' },
  // Payment is two distinct steps — each opens its own focused screen.
  { key: 'PAYMENT_FOLLOWUP',  label: 'Payment Follow-up (2.10)',        route: '/o2d/payments?part=followup' },
  { key: 'PAYMENT_RECEIPT',   label: 'Receive Payment & Tally Entry (2.11)', route: '/o2d/payments?part=receipt' },
  // Transport bill is two distinct steps too.
  { key: 'TRANSPORT_BILL_RECEIVE', label: 'Receive Transport Bill (2.12)', route: '/o2d/transport-bill?part=receive' },
  { key: 'TRANSPORT_BILL_STATUS',  label: 'Transport Bill Payment Status (2.13)', route: '/o2d/transport-bill?part=status' },
  // Legacy combined links — kept so older in-flight orders still resolve their "Do it now".
  { key: 'PAYMENTS',          label: 'Payment Follow-up & Receipt (2.10–2.11)', route: '/o2d/payments' },
  { key: 'TRANSPORT_BILL',    label: 'Transport Bill (2.12–2.13)',      route: '/o2d/transport-bill' },
];

export const actionLinkMeta = (key) => ACTION_LINKS.find((a) => a.key === key) || null;

// Steps already wired to an auto-advance trigger get the matching action
// link suggested automatically in the template builder.
export const TRIGGER_TO_ACTION = {
  ORDER_INTAKE: 'ORDER_INTAKE',
  ORDER_ENTRY: 'ORDER_ENTRY',
  DISPATCH_PLAN: 'DISPATCH_PLAN',
  ACTUAL_DISPATCH: 'ACTUAL_DISPATCH',
  INVOICE: 'INVOICE',
};

/**
 * Resolve a registry key + process context to a concrete path.
 * Missing placeholder values: a missing query-param value drops that param;
 * a missing path segment ({orderId}/{processId}) makes the link unresolvable → null.
 */
export const resolveActionLink = (key, ctx = {}) => {
  const meta = actionLinkMeta(key);
  if (!meta) return null;

  // Sales Order Entry on an intake-based, not-yet-converted process → open the
  // intake's conversion form directly (it links to the SAME FMS process), rather
  // than dumping the doer on the orders list to hunt for a "New Order" button.
  if (key === 'ORDER_ENTRY' && ctx.intakeId && !ctx.orderId) {
    return `/order-intake?convert=${encodeURIComponent(String(ctx.intakeId))}`;
  }
  // SO already exists → open its detail page (not the bare list).
  if (key === 'ORDER_ENTRY' && ctx.orderId) {
    return `/orders/${encodeURIComponent(String(ctx.orderId))}`;
  }
  const values = {
    soNumber: ctx.soNumber || '',
    orderId: ctx.orderId ? String(ctx.orderId) : '',
    processId: ctx.processId ? String(ctx.processId) : '',
    intakeId: ctx.intakeId ? String(ctx.intakeId) : '',
  };

  const [pathPart, queryPart] = meta.route.split('?');
  // Path placeholders are mandatory.
  let path = pathPart;
  for (const [k, v] of Object.entries(values)) {
    if (path.includes(`{${k}}`)) {
      if (!v) return null;
      path = path.replaceAll(`{${k}}`, encodeURIComponent(v));
    }
  }
  // Query placeholders are best-effort.
  const params = new URLSearchParams();
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, raw] = pair.split('=');
      const m = raw?.match(/^\{(\w+)\}$/);
      const v = m ? values[m[1]] : raw;
      if (v) params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

export default ACTION_LINKS;
