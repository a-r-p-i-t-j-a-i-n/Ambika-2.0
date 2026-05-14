import EventEmitter from 'events';

class AppEmitter extends EventEmitter {}

export const appEvents = new AppEmitter();

// Centralized Event Names to prevent typos and ensure consistency across modules
export const EVENTS = {
  ORDER_CREATED: 'ORDER_CREATED',
  DISPATCH_PLANNED: 'DISPATCH_PLANNED',
  DISPATCH_ACTUAL_LOGGED: 'DISPATCH_ACTUAL_LOGGED',
  DELIVERY_CHALLAN_GENERATED: 'DELIVERY_CHALLAN_GENERATED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  WORKFLOW_STEP_UPDATED: 'WORKFLOW_STEP_UPDATED'
};

// Example Global Listener setup (These would ideally be broken down into specific event handler files)
appEvents.on(EVENTS.DISPATCH_ACTUAL_LOGGED, (payload) => {
  console.log(`[EVENT HANDLER] DISPATCH_ACTUAL_LOGGED | Triggering async side-effects for Phase: ${payload.phaseId}`);
  // Here we would typically:
  // 1. Queue PDF Generation for Delivery Challan via PdfQueue
  // 2. Queue Email/WhatsApp notification via NotificationQueue
  // 3. Update Workflow Engine Step to 'DISPATCHED'
});
