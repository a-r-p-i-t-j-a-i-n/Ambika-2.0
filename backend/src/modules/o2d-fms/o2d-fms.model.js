/**
 * O2D FMS (Flow Management System) models.
 *
 * Two collections power the module:
 *
 *   StepDefinition — the CONFIG / SOP layer. One doc per step in the O2D flow.
 *                    Holds the "Who / What / How / When" the client tracks in
 *                    their Google Sheet header. Admin-editable, so steps and
 *                    SLAs can change without code.
 *
 *   O2DProcess     — the RUNTIME layer. Exactly one doc per Sales Order. Its
 *                    `steps[]` are seeded from the active StepDefinitions when
 *                    the order is booked, then each step records
 *                    planned / actual / delay / owner as work happens.
 *
 * This replaces the dead `modules/workflow/workflow.model.js`.
 */

import mongoose from 'mongoose';
import { AttachmentSchema, baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// Step lifecycle. "Overdue" is NOT stored — it is derived (PENDING && planned < now).
export const O2D_STEP_STATUS = Object.freeze({
  PENDING: 'PENDING',  // not done yet
  DONE:    'DONE',     // completed on/before planned
  DELAYED: 'DELAYED',  // completed AFTER planned (late)
  SKIPPED: 'SKIPPED',  // intentionally skipped
});

export const O2D_PHASE = Object.freeze({
  PRE_PRODUCTION: 'PRE_PRODUCTION',
  PLANNING:       'PLANNING',
  EXECUTION:      'EXECUTION',
  POST_DISPATCH:  'POST_DISPATCH',
});

// Where a step's SLA clock starts ticking from.
export const SLA_FROM = Object.freeze({
  PREV_ACTUAL:     'PREV_ACTUAL',     // previous step's completion time (default)
  ORDER_RECEIVED:  'ORDER_RECEIVED',  // the order's receivedAt
});

// Links a step to a real business action elsewhere in the app. When that action
// happens, the FMS bridge auto-completes the matching step. MANUAL = only a
// person ticking it done from the FMS advances it.
export const TRIGGER_KEY = Object.freeze({
  MANUAL:          'MANUAL',
  ORDER_INTAKE:    'ORDER_INTAKE',   // client order logged via call/email/WhatsApp/meeting
  ORDER_ENTRY:     'ORDER_ENTRY',    // formal Sales Order punched into the system
  DISPATCH_PLAN:   'DISPATCH_PLAN',
  ACTUAL_DISPATCH: 'ACTUAL_DISPATCH',
  INVOICE:         'INVOICE',
  POD:             'POD',
  PAYMENT:         'PAYMENT',
});

// ── StepDefinition (config / SOP) ───────────────────────────────────────────
const StepDefinitionSchema = new Schema({
  ...baseSchemaFields,

  // Which FMS catalog this step belongs to. 'V1' = the original O2D flow (FMS 1.0);
  // 'CURRENT_SHEET' = the live Google-sheet flow. Steps are grouped per-fms, so the
  // same stepCode (e.g. '2.02') can exist independently in each FMS.
  fmsKey: { type: String, default: 'V1', trim: true, index: true },

  stepCode: { type: String, required: true, trim: true }, // e.g. '2.02'
  name:     { type: String, required: true, trim: true }, // What — short task name
  description: { type: String, default: '' },             // What — fuller instruction

  // Who — default owner. Either a specific user, or a role key (UPPER_SNAKE_CASE,
  // matches Role.key / legacy User.role). User wins when both are set.
  defaultOwnerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  defaultOwnerRole:   { type: String, default: null, trim: true },
  // Free-text owner from the client sheet (the "Who" column), when the person
  // isn't a system user yet — e.g. "Upasana" / "pc@msambikaglobal.in".
  ownerName:  { type: String, default: null, trim: true },
  ownerEmail: { type: String, default: null, trim: true },

  // The sheet's "When" column as free text (e.g. "Whenever Received", "10 days",
  // "After 1 day of delivery"). The numeric SLA below drives the actual schedule.
  whenText: { type: String, default: null, trim: true },

  tool: { type: String, default: null, trim: true },      // How — e.g. 'Excel & Tally', 'Order Form'

  // When — SLA. slaMinutes is the allowed duration; slaFrom is the clock start.
  slaMinutes: { type: Number, default: 60, min: 0 },
  slaFrom:    { type: String, enum: Object.values(SLA_FROM), default: SLA_FROM.PREV_ACTUAL },

  sequence: { type: Number, required: true },             // order in the flow (1,2,3…)
  phase:    { type: String, enum: Object.values(O2D_PHASE), default: O2D_PHASE.PRE_PRODUCTION },

  // Auto-advance link: when this real action fires elsewhere, the step completes itself.
  triggerKey: { type: String, enum: Object.values(TRIGGER_KEY), default: TRIGGER_KEY.MANUAL },

  requiresLink:       { type: Boolean, default: false },  // must paste a link to complete
  requiresAttachment: { type: Boolean, default: false },  // must attach a file to complete
  allowIncompleteChecklist: { type: Boolean, default: false }, // allow Mark Done with unticked items

  isActive: { type: Boolean, default: true },
}, baseSchemaOptions);

// stepCode is unique PER FMS (not globally) so each catalog can reuse codes.
StepDefinitionSchema.index({ fmsKey: 1, stepCode: 1 }, { unique: true });
StepDefinitionSchema.index({ fmsKey: 1, isActive: 1, sequence: 1 });

// Checklist item on a live step (the doer ticks these off).
const ChecklistItemSchema = new Schema({
  text:   { type: String, required: true },
  done:   { type: Boolean, default: false },
  doneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  doneByName: { type: String, default: null }, // denormalised for activity history
  doneAt: { type: Date, default: null },
}, { _id: true });

// ── Requirement types (beyond checklist) ────────────────────────────────────
// Each step can demand several KINDS of verification before it counts as done:
// yes/no questions, data fields to capture, minimum proof attachments, and an
// approval by a named person. All optional and template-driven.

export const FORM_FIELD_TYPE = Object.freeze({ TEXT: 'TEXT', NUMBER: 'NUMBER', DATE: 'DATE' });

// Yes/No verification question. "NO" requires a remark explaining why.
const VerificationItemSchema = new Schema({
  question: { type: String, required: true },
  answer:   { type: String, enum: ['YES', 'NO', null], default: null },
  remark:   { type: String, default: null },
  answeredBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  answeredByName: { type: String, default: null },
  answeredAt:     { type: Date, default: null },
}, { _id: true });

// Data-capture field (e.g. "Vehicle No.", "Qty loaded").
const FormFieldItemSchema = new Schema({
  label:     { type: String, required: true },
  fieldType: { type: String, enum: Object.values(FORM_FIELD_TYPE), default: FORM_FIELD_TYPE.TEXT },
  required:  { type: Boolean, default: true },
  value:     { type: Schema.Types.Mixed, default: null },
  filledBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  filledByName: { type: String, default: null },
  filledAt:     { type: Date, default: null },
}, { _id: true });

// Proof gate config — step needs ≥ minCount attachments before completion.
const ProofConfigSchema = new Schema({
  required: { type: Boolean, default: false },
  minCount: { type: Number, default: 1, min: 1 },
}, { _id: false });

// Approval gate — one of approverIds must approve before completion.
const ApprovalSchema = new Schema({
  required:    { type: Boolean, default: false },
  approverIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  approvedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedByName: { type: String, default: null },
  approvedAt:     { type: Date, default: null },
}, { _id: false });

// A proof attachment on a step — any file or a voice note. uploadedByName is
// denormalised so "who attached this, when" always renders without a populate.
const StepAttachmentSchema = new Schema({
  fileName: { type: String, required: true },
  fileUrl:  { type: String, required: true }, // stable, signed-on-demand URL
  fileKey:  { type: String, default: null },  // S3 key (for deletion)
  fileType: { type: String, default: null },  // MIME
  sizeBytes:{ type: Number, default: 0 },
  kind:     { type: String, enum: ['file', 'audio', 'video', 'image'], default: 'file' },
  uploadedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedByName: { type: String, default: null },
  uploadedAt:     { type: Date, default: Date.now },
}, { _id: true });

// A comment / collaboration note on a step. userName is denormalised at write
// time so "who said what, when" always renders without a populate round-trip.
const StepCommentSchema = new Schema({
  userId:   { type: Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: null },
  text:     { type: String, required: true },
  at:       { type: Date, default: Date.now },
}, { _id: true });

// ── O2DProcess step sub-document (runtime) ──────────────────────────────────
const ProcessStepSchema = new Schema({
  stepCode: { type: String, required: true },

  planned:   { type: Date, default: null },
  actual:    { type: Date, default: null },
  startedAt: { type: Date, default: null }, // when this step became the current/active step
  delayMins: { type: Number, default: 0 },   // max(0, actual - planned) in minutes; auto-computed
  leadTimeMins: { type: Number, default: null }, // resolved lead time (template override of SLA)

  status: { type: String, enum: Object.values(O2D_STEP_STATUS), default: O2D_STEP_STATUS.PENDING },

  // ── Task layer (the work to do at this step) ──
  taskTitle:    { type: String, default: null },
  instructions: { type: String, default: null },
  checklist:    [ChecklistItemSchema],
  verifications:[VerificationItemSchema],
  formFields:   [FormFieldItemSchema],
  proof:        { type: ProofConfigSchema, default: null },
  approval:     { type: ApprovalSchema, default: null },
  // Key into the frontend action-link registry — renders a "Do it now →" deep
  // link to the real screen (dispatch planning, order entry…) for THIS order.
  // `actionLink` is the legacy single key; `actionLinks` allows several connected
  // screens on one step (each gets its own "Do it now"). actionProgress records
  // which of them have been completed — none are mandatory to finish the step.
  actionLink:   { type: String, default: null },
  actionLinks:  [{ type: String }],
  actionProgress: [new Schema({
    key:        { type: String, required: true }, // matches an entry in actionLinks
    link:       { type: String, default: null },  // the record's deep-link captured when done
    doneAt:     { type: Date, default: Date.now },
    doneBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
    doneByName: { type: String, default: null },
  }, { _id: false })],
  comments:     [StepCommentSchema],

  // Per-step "a link is required to complete" override. null = inherit the
  // Step Definition's default; true/false = explicit choice set on the template.
  requiresLink: { type: Boolean, default: null },

  link:    { type: String, default: null },
  remarks: { type: String, default: null },
  attachments: [StepAttachmentSchema],

  // Multiple doers / buddies can share a step — any of them can action it, and
  // because it's one step record, their ticks/completion stay consistent for all.
  assignees:   [{ type: Schema.Types.ObjectId, ref: 'User' }],
  buddies:     [{ type: Schema.Types.ObjectId, ref: 'User' }],
  // Legacy "primary" mirrors (assignees[0] / buddies[0]) — kept for dashboard
  // aggregation and back-compat with older processes.
  assignedTo:  { type: Schema.Types.ObjectId, ref: 'User', default: null },
  buddyUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

  escalatedAt: { type: Date, default: null }, // set when an SLA-breach email was sent (dedup guard)
}, { _id: true });

// ── O2DProcess (one per Sales Order) ────────────────────────────────────────
const O2DProcessSchema = new Schema({
  ...baseSchemaFields,

  // A process attaches to a Sales Order and/or an Order Intake. At least one is set.
  // Uniqueness is enforced by PARTIAL indexes below — `unique sparse` is wrong here
  // because both fields default to null, and sparse indexes DO index explicit nulls,
  // so the second intake-only (or second direct-SO) process would E11000.
  salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
  intakeId:     { type: Schema.Types.ObjectId, ref: 'OrderIntake', default: null },
  source:       { type: String, enum: ['SALES_ORDER', 'INTAKE'], default: 'SALES_ORDER' },

  // Denormalised for fast list/dashboard rendering without populating the order.
  soNumber:   { type: String, trim: true },
  poNumber:   { type: String, trim: true },
  partyName:  { type: String, trim: true },
  uniqueO2DId:{ type: String, trim: true },

  currentStepCode: { type: String, default: null },
  isCompleted:     { type: Boolean, default: false },
  completedAt:     { type: Date, default: null },

  steps: [ProcessStepSchema],
}, baseSchemaOptions);

// One process per Sales Order / per Intake — but only when the id is actually set.
O2DProcessSchema.index({ salesOrderId: 1 }, { unique: true, partialFilterExpression: { salesOrderId: { $type: 'objectId' } } });
O2DProcessSchema.index({ intakeId: 1 },     { unique: true, partialFilterExpression: { intakeId: { $type: 'objectId' } } });
O2DProcessSchema.index({ currentStepCode: 1, isCompleted: 1 });
O2DProcessSchema.index({ 'steps.assignedTo': 1, 'steps.status': 1 });

// ── TaskTemplate (the reusable "how-to" for each step) ──────────────────────
export const LEAD_TIME_UNIT = Object.freeze({
  MINUTES: 'MINUTES', HOURS: 'HOURS', DAYS: 'DAYS', WEEKS: 'WEEKS', MONTHS: 'MONTHS',
});
export const LEAD_TIME_UNIT_MINUTES = Object.freeze({
  MINUTES: 1, HOURS: 60, DAYS: 1440, WEEKS: 10080, MONTHS: 43200,
});

const TemplateStepSchema = new Schema({
  stepCode:     { type: String, required: true },
  taskTitle:    { type: String, default: null },
  instructions: { type: String, default: null },
  checklist:    [{ text: { type: String, required: true } }],
  // Requirement types beyond the checklist (all optional).
  verifications:[{ question: { type: String, required: true } }],
  formFields:   [{
    label:     { type: String, required: true },
    fieldType: { type: String, enum: Object.values(FORM_FIELD_TYPE), default: FORM_FIELD_TYPE.TEXT },
    required:  { type: Boolean, default: true },
  }],
  proof:        { type: ProofConfigSchema, default: null },
  approval:     { type: ApprovalSchema, default: null }, // runtime fields stay null on templates
  actionLink:   { type: String, default: null }, // legacy single frontend action-registry key
  actionLinks:  [{ type: String }],              // multiple connected screens (each a "Do it now")
  // Per-step "a link is required to complete" choice. null = inherit the Step
  // Definition's default; true/false = explicit override for this template.
  requiresLink: { type: Boolean, default: null },
  leadTime:     {
    value: { type: Number, default: null },
    unit:  { type: String, enum: Object.values(LEAD_TIME_UNIT), default: LEAD_TIME_UNIT.HOURS },
  },
  assigneeRole:    { type: String, default: null },
  assigneeUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }], // multiple doers
  buddyUserIds:    [{ type: Schema.Types.ObjectId, ref: 'User' }], // multiple buddies
  // Legacy single fields (back-compat).
  assigneeUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  buddyUserId:    { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true });

const TaskTemplateSchema = new Schema({
  ...baseSchemaFields,
  // Which FMS catalog this template builds on (its steps reference that FMS's codes).
  fmsKey:      { type: String, default: 'V1', trim: true, index: true },
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  isDefault:   { type: Boolean, default: false }, // the one auto-applied to new orders (per FMS)
  isActive:    { type: Boolean, default: true },
  steps:       [TemplateStepSchema],
}, baseSchemaOptions);

TaskTemplateSchema.index({ fmsKey: 1, isDefault: 1, isActive: 1 });

export const StepDefinition = mongoose.models.StepDefinition || model('StepDefinition', StepDefinitionSchema);
export const O2DProcess = mongoose.models.O2DProcess || model('O2DProcess', O2DProcessSchema, 'o2dprocesses');
export const TaskTemplate = mongoose.models.TaskTemplate || model('TaskTemplate', TaskTemplateSchema);

export default O2DProcess;
