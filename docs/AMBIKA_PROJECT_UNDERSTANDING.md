# Ambika Global ERP: Project Understanding

> **Status:** read-only architecture analysis, produced from code inspection on 2026-11-16.
> **Repos covered:** `Ambika_2.0` (the ERP, HEAD `b7fec98`) and `ambika-group-` (the "Delegation Suite", HEAD `c0e316f`). The ERP is embedded inside the Delegation Suite.
> **Method:** source files, schemas, routes and config were read directly. Nothing was executed: no servers, tests, scripts or database queries.
> **Conventions:** paths are relative to the repo named in each section. "(inferred)" marks conclusions drawn from code structure or comments rather than a directly observed code path. §12 lists the areas that are **not verified**.
> No secret values appear in this document. Environment variables are listed **by name only**.

---

## Table of contents

1. [System landscape](#1-system-landscape)
2. [ERP backend architecture](#2-erp-backend-architecture-ambika_20backend)
3. [Authentication and authorization (ERP)](#3-authentication-and-authorization-erp)
4. [Data model: MongoDB collections and relationships](#4-data-model-mongodb-collections-and-relationships)
5. [Business workflows](#5-business-workflows)
6. [ERP frontend architecture](#6-erp-frontend-architecture-ambika_20frontend)
7. [Delegation Suite (`ambika-group-`)](#7-delegation-suite-ambika-group-)
8. [ERP ↔ Delegation integration](#8-erp--delegation-integration)
9. [Infrastructure, deployment, CI and tests](#9-infrastructure-deployment-ci-and-tests)
10. [Development conventions](#10-development-conventions)
11. [Technical debt, risks and security findings](#11-technical-debt-risks-and-security-findings)
12. [Gaps and unverified areas](#12-gaps-and-unverified-areas)
13. [Architecture summary](#13-architecture-summary)
14. [Recommendations for safely extending the ERP](#14-recommendations-for-safely-extending-the-erp)

---

## 1. System landscape

```
┌──────────────────────── Browser ────────────────────────┐
│  Delegation Suite SPA (React 19, Tailwind, RTK Query)   │
│   └─ /delegation/erp/*  →  <iframe> ERP SPA             │
│        (React 18, MUI 5, RTK Query)                     │
│        postMessage protocol  ns:"agl-embed" v1          │
└──────────┬────────────────────────────────┬─────────────┘
           │ Bearer JWT (Suite)             │ Bearer JWT (ERP, from /auth/sso)
           ▼                                ▼
┌──────────────────────┐   signed JWT    ┌──────────────────────────┐
│ Suite backend        │◄──envelopes────►│ ERP backend              │
│ Express 5, CommonJS  │  ERP_SSO_SECRET │ Express 4, ESM, Node 22  │
│ node-cron, FCM,      │                 │ setInterval jobs, pdfkit │
│ Gmail API, Maytapi,  │                 │ S3, Brevo/SMTP           │
│ OpenAI, socket.io    │                 │                          │
└─────────┬────────────┘                 └───────────┬──────────────┘
          ▼                                          ▼
  MongoDB Atlas cluster A                    MongoDB Atlas cluster B
  (Suite DB; users, tasks, checklists)      (db `dpes_agl`; ERP data)
```

| Aspect | ERP (`Ambika_2.0`) | Delegation Suite (`ambika-group-`) |
|---|---|---|
| Purpose | Manufacturing ERP covering Order-to-Delivery (O2D), Purchase FMS, inventory (RM/FG/consumables/scrap), PPC/DPR, pricing, masters | Task delegation, recurring checklists, attendance, MIS scores, outreach, AI chat; hosts the ERP in an iframe |
| Backend | Node 22, Express ^4.21, Mongoose ^8.6, ESM | Express ^5.2, Mongoose ^9.3, CommonJS |
| Frontend | React 18.3, MUI 5, MUI X DataGrid, RTK Query, Vite | React 19.2, Tailwind 4, RTK Query, Vite 8, PWA, Firebase |
| Database | Separate Atlas cluster, database `dpes_agl` | Separate Atlas cluster |
| Identity | Own `users` collection; Suite users are matched **by email** and auto-created on first SSO | Own `users` collection (system of record for employees) |

**The two systems do not share a database.** The only links between them are signed HTTP calls and the browser `postMessage` bridge (§8).

> "FMS" in this codebase means **Flow Management System**: a step-by-step workflow tracker with planned and actual timestamps, doers, and delay or TAT scoring. The ERP has two: **O2D FMS** and **Purchase FMS**.

---

## 2. ERP backend architecture (`Ambika_2.0/backend`)

### 2.1 Boot sequence (`src/server.js`)

1. `connectDB()`. `config/db.js` overrides DNS resolvers to 1.1.1.1 and 8.8.8.8, uses a pool of 2–10, and calls `process.exit(1)` on failure.
2. `seedAccessControl()` seeds the system roles and backfills `User.roles[]`.
3. `seedPricing()`.
4. `verifyInvoiceNumberIndex()`. Vendor-invoice writes return 503 until a partial unique index is confirmed.
5. HTTP server plus socket.io (`cors.origin:'*'`).
6. Three in-process `setInterval` jobs (§2.5).
7. Graceful shutdown on SIGTERM and SIGINT. `unhandledRejection` and `uncaughtException` also shut the process down.

### 2.2 Middleware order (`src/app.js`)

`trust proxy` → `helmet` (CORP cross-origin) → `cors({origin:'*', credentials:true})` → `express-mongo-sanitize` → `hpp` → *(rate limiter commented out, L88-99)* → JSON and urlencoded parsers (10mb) → `requestContext` (AsyncLocalStorage) → `compression` → `morgan` → health routes (`/`, `/health`, `/api/health`, `/api/health/invoice-numbering`) → routers → static `/uploads` → 404 → `errorHandler`.

### 2.3 Route mounts (all under `/api/v1`)

| Mount | Router | Route-level guard |
|---|---|---|
| `/auth` | `modules/auth` | mixed (see §3) |
| `/clients` | `modules/clients/client.routes.js` (legacy) | **none** |
| `/parties` | `modules/clients/party.routes.js` | protect + permissions |
| `/skus` | `modules/skus` | protect + permissions |
| `/machines`, `/machine-operators` | `modules/masters/*` | protect + delete permission |
| `/purchase-orders` | `modules/purchase-orders` (legacy **customer** PO) | **none** |
| `/orders` **and** `/sales-orders` | `modules/order` (same router mounted twice) | protect, `orders.delete` |
| `/vendors`, `/transporters` | masters | protect + delete permission |
| `/schedules`, `/challans` | `modules/schedule`, `modules/challan` | protect only |
| `/fms` | `modules/fms/fms.routes.js` (legacy) | **none** |
| `/ppc`, `/dpr`, `/production-plans` | `modules/ppc/*` | protect only |
| `/dispatch-control` | `modules/dispatch-control` | protect only |
| `/uploads` | `common/uploads` | **none** |
| `/access-control` | `modules/access-control` | protect + permissions |
| `/pricing`, `/quotes` | pricing, quotes | protect + permissions |
| `/sales-invoices` | `modules/invoice` | protect only |
| `/o2d-fulfillment` | `modules/o2d-fulfillment` | protect only |
| `/o2d-fms` | `modules/o2d-fms` | protect + `o2dfms.*` |
| `/suite-link` | `modules/o2d-fms/suite-link.routes.js` | signed envelope (no user JWT) |
| `/notifications` | `modules/notifications` | protect |
| `/order-intake` | `modules/order-intake` | protect + `orders.*` |
| `/recycle-bin` | `modules/recycle-bin` | protect + controller checks |
| `/fms-doers` | `modules/fms-doers` | protect, `fms.manageDoers` on config |
| `/procurement/*` (15 sub-routers) | `modules/procurement/*` | protect; permissions mostly on DELETE only |
| `/inventory`, `/ims`, `/rm-ims`, `/fg-ims`, `/scrap-ims` | `modules/inventory/*` | protect only |
| `/approvals` | `modules/approvals` | protect + MD role |

The `fmsWorkflowSync` middleware (`modules/fms-doers/fmsDoerSync.middleware.js`) runs in front of `/procurement` and `/approvals`. It reconciles FMS doer tasks after each successful write.

**Modules that exist but are never mounted:** `dispatch-actuals`, `dispatch-phases` and `dispatch-schedules` are dead model files. `dispatch-schedules` registers the same model name `DispatchSchedule` as `schedule/`, so importing both would throw `OverwriteModelError`. `payment`, `shipment` and `transport` are models only; other routers use them.

### 2.4 Shared infrastructure

| Area | Location | Notes |
|---|---|---|
| Config | `src/config/env.js`, `constants.js`, `db.js` | Document prefixes such as `AGL/SO` and `AGL/DC`, and status enums, live in `constants.js` |
| Base schema | `src/database/BaseSchema.js` | `createdBy`/`updatedBy`/`deletedBy`, `isDeleted`, `isActive`, `companyId`/`branchId` (no Company/Branch models exist), `attachments`, `activityTimeline`; `timestamps` plus `optimisticConcurrency` |
| Doc numbers | `src/utils/docNumberGenerator.js` | Atomic `Counter` collection, keyed per fiscal year (`fiscalYear.js`) |
| Responses and errors | `utils/apiResponse.js` (`AppError`, `ApiResponse`), `middleware/errorHandler.js`, `middleware/asyncHandler.js` | |
| Validation | `middleware/validate.js` | Joi, `stripUnknown`, returns 422 |
| Uploads | `common/uploads/*` | multer, MIME allow-list, 15MB. Uses S3 when all AWS variables are set, otherwise local `uploads/`. Presigned URLs last 1 hour |
| PDF | `services/pdf.service.js` + per-module `*.pdf.js` | pdfkit |
| Email | `services/email.service.js` | Brevo API → SMTP (nodemailer) → disabled |
| WhatsApp | `services/whatsapp.service.js` | **Stub: logs only** |
| Logger | `utils/logger.js` | winston, console transport only |
| Recycle bin | `modules/recycle-bin` | Soft delete with a restore plan; 30-day TTL; the `x-client-page` header records which screen a delete came from |
| Audit | `middlewares/audit.middleware.js` (note the plural directory name) | Generic write audit on 5 routers only; `AccessAuditLog` records access-control changes |
| Static master data | `src/data/*` | Material master, coil→circle map, item classifier |
| Spreadsheets | `src/sheets/*`, `/excel/*` | Business .xlsx files read **only** by offline import scripts. **There is no Google Sheets API integration.** |

### 2.5 Background jobs and real-time

All jobs are **in-process `setInterval`**. There is no cron library, no Redis and no BullMQ.

| Job | Cadence | Off switch |
|---|---|---|
| `jobs/o2d-fms.escalation.job.js`: emails SLA breaches to the step owner and MD | 15 min | `O2D_FMS_ESCALATION=off` |
| `jobs/fms-doer.sync.job.js`: reconciles Purchase FMS tasks | `FMS_DOER_SYNC_INTERVAL_MS` (default 10 min) | `FMS_DOER_SYNC=off` |
| `modules/o2d-fms/o2d-delegation.js`: close-only sync to the Suite | 60s, plus 3s debounce after an O2D change | `O2D_DELEGATION_SYNC=off` |

Dead or unwired pieces:
- `queues/index.js` and `jobs/email.worker.js` import `bullmq`, which is **not installed**. Nothing imports either file.
- `events/index.js` has an emitter with no live listener-emit pair.
- socket.io (`sockets/socketService.js`) is attached, but `notifyClients()` is never called.

Notifications reach users only by **polling** (`/notifications/unread-count`).

### 2.6 Environment variables (names only)

- **In `.env.example`:** `NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ERP_SSO_SECRET`, `COMPANY_*`, `SERVER_URL`, `CLIENT_URL`, `FRONTEND_URL`, `SMTP_*`, `MAIL_FROM`, `BREVO_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_PREFIX`, `O2D_FMS_ESCALATION`, `O2D_ACTIVE_FMS`, `RATE_LIMIT_*`.
- **Read by code but missing from the example:** `SUITE_API_URL`, `FMS_DOER_SYNC`, `FMS_DOER_SYNC_INTERVAL_MS`, `O2D_DELEGATION_SYNC`, `SERVER_BASE`, `REDIS_HOST`, `REDIS_PORT`.

---

## 3. Authentication and authorization (ERP)

### 3.1 Authentication

| Route | Guard | Behaviour |
|---|---|---|
| `POST /auth/register` | **public** | `authService.register` passes `req.body` straight to `User.create` (`auth.service.js:80-84`). See §11 S1 |
| `POST /auth/login` | public | bcrypt compare; returns `{token, user}` in the body |
| `POST /auth/sso` | ticket | Verifies a Suite ticket (HS256, `ERP_SSO_SECRET`, `iss ambika-suite`, `aud agl-erp`) and auto-creates the user if missing |
| `GET /auth/me` | protect | |
| `GET`/`POST /auth/employees` | protect + `restrictTo('MD')` | |

- **Tokens:** stateless JWT, HS256, `JWT_EXPIRES_IN` default `7d`. There are **no refresh tokens, no logout or revocation, and no cookies**. The frontend stores the JWT in `localStorage`.
- **`protect`** (`middleware/auth.middleware.js`): reads the Bearer token, verifies it, loads the user, and attaches `req.user`, `req.sessionGrants` and `req.sessionDenies`. It does **not** check `isActive`; only SSO does.
- **Passwords:** bcryptjs cost 12 in a pre-save hook; `select:false`.
- **User model** (`modules/auth/auth.model.js`):
  - `name`, `email` (unique), `mobile` (Indian 10-digit)
  - legacy `role` (job-title enum) and `roles[]` (Role keys)
  - `permissionGrants[]`, `permissionDenies[]`
  - `isActive`, `lastLoginAt`

### 3.2 Authorization (RBAC)

- **Permission registry:** `src/common/permissions/registry.js` is a frozen list of `<module>.<action>` slugs with risk levels. The root permission is `'*'`.
- **Role model:** `modules/access-control/role.model.js` has `key`, `name`, `isSystem`, `isRoot` and `permissions[]`. Slugs are validated against the registry.
- **Seeded roles:** `MD` (root), `PLANNER`, `SALES_EXEC`, `DISPATCH_SUPERVISOR`, `FINANCE`, `VIEWER`.
- **Effective permissions** (`middleware/permission.middleware.js:118-155`):
  `∪ role.permissions` + `permissionGrants` + session grants − `permissionDenies` − session denies, and `'*'` if any role is root.
  Role permissions are cached **in process memory**, so the cache would go stale with more than one instance.
- **Middleware:** `attachUserPermissions`, `requirePermission(...slugs)` (any-of), `requireAllPermissions`, `unlessSessionDenies(slug)`, `userHasPermission(req, slug)`.
  ```js
  router.use(protect, attachUserPermissions);
  router.get('/users', requirePermission('accessControl.manageUsers'), c.listUsers);
  ```
- **MD document approvals:** `modules/approvals/approval.middleware.js` `requireApprovalRole('MD')` is a hard role check that deliberately cannot be granted as a permission.
- **Session grants and denies** come from the Suite ticket and are whitelisted by `SESSION_GRANTABLE` and `SESSION_DENIABLE` (`auth.middleware.js:11-25`).

**Coverage is uneven.** Many write routes only check that the user is logged in (§11).

---

## 4. Data model: MongoDB collections and relationships

All ERP models use Mongoose. Newer models spread `baseSchemaFields`, which gives soft delete, optimistic concurrency and an activity timeline. Older O2D models (`SalesOrder`, `DeliveryChallan`, `Invoice`, `Payment`, `Shipment`, `TransportBill`, `DispatchSchedule`, `PPCEntry`) use plain schemas with timestamps.

### 4.1 Masters

| Model | Key fields | Notes |
|---|---|---|
| **Party** (`clients/party.model.js`) | `code`, `name`, GST/PAN, `creditPeriodDays`, `leadTimeDays`, `addresses[]`, `suppliedProducts[]` (vendor side), `orderedSkus[]` with `priceHistory[]` (sales side) | The **real** customer master and the legacy vendor reference |
| Client (`clients/client.model.js`) | `companyName`, contacts, `preferredTransporterIds` | **Legacy duplicate of Party**; unauthenticated routes |
| **Vendor** (`vendors/vendor.model.js`) | vendor master with `products[]` (sku, rate) | Used by the newer Purchase flow (see §11 D3) |
| **SKU** (`skus/sku.model.js`) | `code`, `itemType` (16-value enum), `unit`, `purchaseUnit` + `purchaseConversionFactor`, box/weight fields, cached `sellingPrice`/`rmCost` | `inventoryDestinationOf()` routes items to RM_IMS or CP_IMS |
| Transporter | code, name, modes, vehicle types | Not referenced by DeliveryChallan, which stores a free-text name |
| Machine, Operator, MachineOperatorAssignment | machine type/status/capacity/SPM; operator `machineCodes[]` | |
| ProcessRoute, Die | keyed by `skuCode` / `completeDieNo` strings | DPR masters |
| CompanySettings | PDF logo/signature, pricing thresholds | |

### 4.2 Sales / O2D

| Model | Key fields and statuses |
|---|---|
| **OrderIntake** | channel; `NEW/CONVERTED/CANCELLED`; `linkedSalesOrderId` |
| **Quote** | `quoteNumber`, `lines[]` (→PriceRevision); `DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED/CONVERTED_TO_SO`; `convertedToSo` is **never written** |
| **PriceRevision** | append-only per `(skuId, SELLING\|RM_COST)`; `LIVE/PENDING_APPROVAL/REJECTED/SUPERSEDED`; auto-LIVE when the change is ≤ threshold (default 5%) |
| **SalesOrder** (`salesorders`) | `soNumber`, `partyId`→Party, `items[]` (orderQty, dispatchedQty, balanceQty, rate); `RECEIVED/PLANNING/IN_PROGRESS/COMPLETED/SHORT_CLOSED/CANCELLED` (derived in pre-save); plus a **legacy embedded 13-step tracker** |
| **O2DProcess** (`o2dprocesses`) | one per SO or intake; `steps[]` with `planned`, `actual`, `delayMins`, status `PENDING/IN_PROGRESS/DONE/DELAYED/SKIPPED`, checklist, verifications, form fields, proofs, assignees/buddies, dispatch and consignment progress; `consignmentLog[]` |
| StepDefinition / TaskTemplate | SOP catalog per `fmsKey` (`V1`, `CURRENT_SHEET`); SLA, `triggerKey`, gates; per-step checklists/forms/lead times |
| **DispatchSchedule** (`schedule/`) | per SO; `items[].phases[]` (P1..Pn) with planned date/qty and `actualDispatches[]` |
| **DeliveryChallan** | `dcNumber`, `orderId`, `phaseRef(s)`, transport fields; `CREATED/DISPATCHED/DELIVERED/CANCELLED` |
| **Invoice** (sales) | `invoiceNo`, `dcId`, amounts and balance; `PENDING/CREATED/SENT/PAID/PARTIAL/CANCELLED` |
| Payment, TransportBill, Shipment | Payment has follow-up/confirmation; TransportBill has receipt/payment; Shipment is legacy |

### 4.3 Purchase FMS (`modules/procurement/*`)

| Model | Key statuses | Main refs |
|---|---|---|
| **PurchaseIndent** | approval `DRAFT/PENDING_APPROVAL/APPROVED/REJECTED`; `overallStatus` (INDENT_GENERATED … QUOTATION_APPROVED … PO_READY … SERVICE_* … CLOSED); `requestType` MATERIAL_PURCHASE / INTERNAL_SERVICE | `items[].poId`, `items[].vendorId`→Vendor |
| **VendorPurchaseOrder** | `poStatus` DRAFT/APPROVED/RELEASED_TO_VENDOR/PARTIAL_RECEIVED/FULLY_RECEIVED/CANCELLED/CLOSED; mirrors `followUpStatus`, `piStatus`, `advancePaymentStatus` | `indentId`/`indentIds[]`; `vendorId` (**polymorphic Vendor or Party, no ref**) |
| RateChangeRequest / RateChangeHistory | PENDING/APPROVED/REJECTED/WITHDRAWN | Vendor, PO, SKU |
| PurchaseFollowUp | PENDING/DONE/RESCHEDULED/READY_FOR_GRN/CLOSED (one active per PO) | poId |
| ProformaInvoice | `piStatus` …READY_FOR_ADVANCE_PAYMENT/PAYMENT_COMPLETED; `mdApprovalStatus` | poId |
| AdvancePayment | PART/FULL/SHORT_PAYMENT_COMPLETED/CANCELLED | piId, poId |
| **GoodsReceiptNote** | DRAFT/RECEIVED/PARTIAL/FULLY_RECEIVED/CANCELLED; `qcStatus`; line `stockStatus` AWAITING_QC/POSTED | poId + `poIds[]`, piId |
| **IncomingQC** | DRAFT/IN_PROGRESS/PASSED/FAILED/PARTIAL/CANCELLED; `sourceType` GRN/SERVICE | grnId, line → InventoryMovement |
| VendorInvoice | DRAFT/RECEIVED/APPROVED/REJECTED/PAYMENT_PENDING/PAYMENT_COMPLETED | `qcIds[]`, `grnIds[]`, poId |
| VendorVoucher | type PURCHASE/EXPENSE/DIRECT_PURCHASE; DRAFT/POSTED/PARTIALLY_PAID/FULLY_PAID/SHORT_CLOSED/CANCELLED | invoice, PO/GRN |
| PurchaseTallyEntry | PENDING/COMPLETED/CANCELLED + checklist | voucherId |
| VendorFinalPayment | PART/FULL/SHORT_PAYMENT_COMPLETED/CANCELLED | voucherId |
| DocumentApproval | READY_FOR_APPROVAL/APPROVED; signature history; unique `(documentType, documentId)` | GRN, VOUCHER, PROFORMA_INVOICE |
| PurchaseCascadeDeletion | RUNNING/…; lock keys | |
| FmsDoerAssignment / FmsTask | per `(fmsKey, stepKey)` doers and backups; runtime OPEN/DONE/CLOSED tasks with `plannedAt` | polymorphic entity |

### 4.4 Inventory, production and planning

| Model | Notes |
|---|---|
| **InventoryMovement** | Append-only ledger. `txnType`: GRN_IN, OPENING, ADJUST_IN/OUT, TRANSFER_IN/OUT, RETURN_OUT, QC_REJECT_OUT, DISPATCH_OUT, CONSUME_OUT, CONVERT_OUT/IN, PRODUCE_IN, SALES_RETURN_IN, SCRAP_IN/OUT. Signed `qtyDelta`, `balanceAfter`, optional kg measure, cost, `batchNo`, polymorphic `refType`/`refId` |
| **InventoryStock** | Unique `(skuId, warehouse)`; `qtyOnHand`, `qtyOnHandKg`, weighted `avgCost`; `qtyReserved` is unused |
| InventoryPolicy | Per-SKU reorder parameters (ADC low/normal/peak, lead days, safety factor, MOQ, max level) |
| InventoryRequestKey | Idempotency key, 7-day TTL |
| CoilConversion, ManualCoil | RM coil → circles with scrap and yield |
| ScrapRecord, ScrapBuyer | Scrap register and sales |
| ProductionPlan | Per (SKU, month): `netToProduce = ceil(max(0, demand − fgStock − openingWip) × (1+buffer%))`. `fgStock` is **typed by the planner**, not read from stock |
| ProductionPlanEntry | Per party/date plan; drawn into dispatch phases |
| PPCEntry | Legacy mirror written only by dispatch-control |
| DprEntry | Per machine × operation × shift × date, with server-computed OEE (A × P × Q) |

### 4.5 Relationship overview (ER-style)

```
Party 1─* SalesOrder 1─0..1 O2DProcess ─(stepCode string)→ StepDefinition
Party 1─* Quote *─1 PriceRevision ─→ SKU
OrderIntake 0..1─1 SalesOrder
SalesOrder 1─1 DispatchSchedule 1─* items 1─* phases ←* DeliveryChallan.phaseRef
SalesOrder 1─* DeliveryChallan 1─0..1 Invoice 1─* Payment ; DC 1─0..1 TransportBill

PurchaseIndent 1─* VendorPurchaseOrder 1─* PurchaseFollowUp
VendorPurchaseOrder 1─0..1 ProformaInvoice 1─* AdvancePayment
VendorPurchaseOrder *─* GoodsReceiptNote 1─* IncomingQC ─→ InventoryMovement ─→ InventoryStock
IncomingQC *─1 VendorInvoice 1─0..1 VendorVoucher 1─0..1 PurchaseTallyEntry
VendorVoucher 1─* VendorFinalPayment
DocumentApproval ─→ {GRN | VendorVoucher | ProformaInvoice}
Vendor 1─* PricingHistory ; Vendor.products[] ─→ SKU

SKU 1─* InventoryStock (per warehouse) ; SKU 1─1 InventoryPolicy ; SKU 1─* InventoryMovement
Machine *─* Operator (MachineOperatorAssignment) ; DprEntry ─→ Machine, Operator, SKU
FmsDoerAssignment(fmsKey, stepKey) ─→ User[] ; FmsTask ─→ polymorphic entity
```

---

## 5. Business workflows

### 5.1 Order-to-Delivery (O2D)

The flow below is derived from the actual service calls and gates.

```
OrderIntake (optional) ─convert→ SalesOrder ─→ O2DProcess created (ORDER_ENTRY advanced)
   ─→ Dispatch planning (DispatchSchedule phases; can inherit ProductionPlanEntry)   [DISPATCH_PLAN]
   ─→ Actual dispatch = DeliveryChallan (auto-allocates qty to phases, updates SO + PPCEntry, PDF) [ACTUAL_DISPATCH]
   ─→ per-challan fork: Sales Invoice [INVOICE] → Track delivery [POD] → Payment follow-up
      → Payment receipt [PAYMENT] → Transport bill receive → Transport bill payment
```

**Active step catalog.** `O2D_ACTIVE_FMS`, default `CURRENT_SHEET`, seeded by `scripts/seed_current_sheet_fms.js`, has 13 steps:

1.01 Order Received → 2.02 PO entry in Tally → 2.03 Check Inventory → 2.04 Create Dispatch Scheduler → 2.05 Email Schedule → 2.06 Create DC (quantity-gated) → 2.07 Invoice & E-way (consignment-gated) → 2.08 Email invoice → 2.09 Track delivery → 2.10 Payment follow-up → 2.11 Payment confirmation → 2.12 Receive transport bill → 2.13 Transport bill payment.

**Engine** (`modules/o2d-fms/o2d-fms.service.js`):
- **Planned dates:** every step's `planned` date is seeded up front as a cumulative lead-time cursor from `receivedAt`.
- **Completing a step:** `completeStep` computes `delayMins = max(0, actual − planned)` and marks the step `DELAYED` or `DONE`.
- **Checks before completion:** `unmetRequirements()` checks the checklist, verifications, fields, proofs, approval and link. Quantity gates and consignment gates block completion unless `force` is passed.
- **Auto-advance:** `advanceByTrigger(order, triggerKey)` moves the process forward when the business action happens. Order, dispatch-control, invoice and fulfillment code all call it.
- **Sequential gate:** `assertActionAllowed` returns 409 for dispatch-plan or actual-dispatch writes until the earlier steps are done.
- **Overdue and escalation:** "overdue" is derived, not stored (PENDING and `planned < now`). The escalation job emails breaches.
- **Doer check:** `assertCanAct` requires the caller to be an assignee or buddy, unless privileged.

**Duplicate write paths that bypass these gates:**

| Action | Gated path | Bypass path(s) |
|---|---|---|
| Create DC | `/dispatch-control/...` | `/challans` |
| Create invoice | `/sales-invoices` | `/fms/invoices` |
| Create order | `/orders` | `/dispatch-control/order-entry` (gated equivalently) |
| Edit schedule | dispatch-control phases | raw `/schedules` CRUD |

### 5.2 Purchase FMS (Procure-to-Pay)

**Material purchase**, with the sequence enforced by the service-level checks:

1. **Indent:** create (DRAFT) → submit → **approve per item**.
2. **Quote / comparative** (Step 1.2), or *quote not required*.
3. **Quotation approval** (Step 1.3) → `QUOTATION_APPROVED`.
4. **PO** draft → **approve** (all rate changes must be approved; mints `AGL/PO-NNN/FY`; writes vendor pricing history) → **release** (PDF and email; follow-up becomes PENDING).
5. Two branches run in parallel:
   - **Follow-up**, ending in `READY_FOR_GRN` once there is a final material date.
   - **Proforma Invoice** (optional, or marked *not required*) → approve → **MD signs PI** → **Advance payment**. The MD signature is required before payment.
6. **GRN:** needs `READY_FOR_GRN` and a settled PI. The advance payment does **not** block it. Completing the GRN updates PO received quantities and raises an MD approval (non-blocking). **No stock is posted yet.**
7. **Incoming QC complete:** the **accepted** quantity is posted as `GRN_IN` to InventoryStock in one transaction.
8. **Vendor invoice** (from PASSED or PARTIAL QC, single PO) → approve → `PAYMENT_PENDING`, and a draft purchase voucher is auto-created.
9. **Voucher post:** MD approval is raised.
10. **Tally entry complete** (checklist).
11. **Final payment:** needs the tally completed **and** the voucher MD-signed. The invoice becomes `PAYMENT_COMPLETED`.

**Variants:**
- **Internal service:** indent → quotation → `SERVICE_PENDING` → service QC.
- **GRN without PO.**
- **Expense and direct-purchase vouchers:** financial only, no stock effect.

**Approvals engine** (`modules/approvals`):
- Single level, **MD only**, with a drawn or uploaded signature stamped into the PDF.
- Policy: *MD approval never blocks the workflow, only payments*.
- Adapters exist only for GRN, VOUCHER and PROFORMA_INVOICE. Other enum types have no adapter.

**Deletes:**
- **Single delete:** each step's `remove` is a soft delete with a "nothing after me" guard (`laterSteps.js`), then goes to the Recycle Bin. Restore hooks refuse a restore if the surrounding records have moved on.
- **Cascade delete:** `preview` → `planToken` → `execute`. It needs an identical plan, acknowledgement and all the required permissions, and runs in a transaction behind a lock row. Records holding money, stock or a signature block it.

**Purchase FMS doer tasks** (`modules/fms-doers`):
- `fmsCatalog.js` maps document statuses to the "waiting at step X" state.
- `FmsTask` rows are opened and closed after every procurement write and every 10 minutes.
- `plannedAt = openedAt + leadTime`.

### 5.3 Inventory (IMS)

| Module | Scope | Key operations |
|---|---|---|
| `/inventory` | Core | Stock, movements, `adjust`, **stock-correction** (posts only the difference; refused if the figure changed meanwhile) |
| `/ims` | Consumables and packaging | receive, issue (`CONSUME_OUT`), reorder, forecast. Vendor receipts must come via GRN |
| `/rm-ims` | Raw material (coils in kg, circles in pcs) | coil → circle conversion with scrap and yield; batch lineage |
| `/fg-ims` | Finished goods | `PRODUCE_IN`, `DISPATCH_OUT`. **Standalone: not wired to DC or DPR** (`fgIms.service.js:19-21`) |
| `/scrap-ims` | Scrap | scrap-in/out, buyers, KG/Quintal/Ton |

- **Stock engine** (`inventory.service.js`): every movement goes through `createStockMovement` → `applyStockDelta`. That does a version-guarded update with retries, refuses negative stock unless `allowNegative` is set, and recomputes weighted-average cost.
- **Reorder logic:** leadTimeDemand = ADC × leadDays; reorderPoint = leadTimeDemand; maxLevel = ADC × lead × safety factor; projected = onHand + in-transit + awaiting-QC.

### 5.4 Production (PPC / DPR)

- **PPC board** (`/ppc`): demand is taken from live open SO balances, minus the planner-entered FG stock and WIP, plus a buffer.
- **DPR** (`/dpr`): hourly production entries with server-computed OEE.
- **Not wired:** DPR does **not** post FG stock, update plan `producedQty`, or consume RM. Production → inventory has no link.

### 5.5 Pricing and quotes

- **Price revisions:** an append-only journal. Changes above the threshold need `pricing.approve`, and a LIVE revision refreshes the SKU's cached price.
- **Quotes:** DRAFT → SENT → ACCEPTED/REJECTED. **Quote → SO conversion is not wired on the server** (`markConverted` is never called).

---

## 6. ERP frontend architecture (`Ambika_2.0/frontend`)

### 6.1 Stack

React 18.3, react-router-dom 6 (v7 future flags), Redux Toolkit 2 with **RTK Query**, MUI 5 with `sx` styling, MUI X DataGrid, lucide-react icons, notistack toasts, recharts, dayjs, xlsx, jspdf/html2canvas (lazy-loaded), react-signature-canvas.

- There is **no form library**; forms are controlled `useState`.
- Vite builds with manual vendor chunks and a `version.json` emitter that drives an "update available" banner.

### 6.2 Boot and routing

- **Provider order** (`src/main.jsx`): `ErrorBoundary → Redux Provider → ThemeProvider → SnackbarProvider → BrowserRouter → EmbedBridge → App`. `./utils/embed` is imported first so the storage fallback is in place before anything else runs.
- **Routing** (`src/App.jsx`): every page except Login and Dashboard is lazy-loaded through `lazyWithRetry`.
- **Guard chain:**
  - `ProtectedRoute` (requires authentication)
  - → `AccessHydrator` (`GET /access-control/me` → `setAccess`)
  - → `MainLayout`
  - → optional per-route `RequirePermission slug|slugs`
- **Main route groups:**
  - Orders and planning: `/orders`, `/dispatch-planning/*`, `/production-planning`, `/ppc-planning`
  - Execution: `/challans`, `/o2d/*` (step screens)
  - O2D FMS: `/o2d-fms/*`
  - Purchase FMS: `/purchase-fms/:step` (hub), `/procurement/*`
  - Doer tasks: `/fms/my-tasks` (the default landing page when embedded), `/fms/doer-assignment`
  - Inventory and production: `/ims`, `/rm-ims`, `/fg-ims`, `/scrap-ims`, `/ppc/dpr/*`
  - Masters: `/skus`, `/parties`, `/machines`, `/machine-operators`
  - Admin and commercial: `/pricing/*`, `/quotes/*`, `/access-control`, `/company-settings`
- **Ungated routes:** many routes have no route-level permission check, including Employees, Orders, Planning, Challans, all IMS screens, DPR, Masters and `/procurement/*`. These pages rely on the backend and on in-page button checks.

### 6.3 Navigation (`src/layouts/MainLayout.jsx`)

- `SHOW_FULL_NAV = false`. The live menu (`navSectionsSimple`) shows My FMS Tasks, Planning, FMS (O2D, Purchase, Doer Assignment), IMS, Masters, Employees and Company Settings.
- The legacy `navSectionsFull` is retained but **dead**.
- Pricing, Quotes, Access Control, Dashboard and the O2D pipeline pages are **reachable only by URL**.

### 6.4 State and API layer

- **Store:** `api` (RTK Query) plus `auth`. `authSlice` holds `user`, `token`, `isAuthenticated`, `permissions[]` and `isRoot`.
- **`store/api/baseApi.js`:**
  - `baseUrl = VITE_API_URL || 'http://localhost:5000/api/v1'`.
  - Adds `Authorization: Bearer <localStorage.token>` to every request, and `x-client-page` to mutations.
  - **Logs out on any 401.** There is no token refresh.
- **28 `injectEndpoints` slices** in `store/api/`. The largest is `procurementApi.js` (about 147 endpoints). `fmsApi.js` is dead.
- **Tag convention:** a list tag plus `{type, id}`. Mutations invalidate list, stats and id tags, often across modules (e.g. a procurement delete also invalidates `FmsTasks`). `{id:'LIST'}` is used inconsistently.
- **Raw `fetch` calls that skip the 401 guard:** `ChallanDetail`, `GenerateChallanPdf`, `RevisePriceDialog`, `QuoteDetail`, `CompanySettings`.

### 6.5 Permissions in the UI

- `hooks/usePermission.js` provides `{can, canAny, canAll, isRoot}`.
- Every slug the UI uses exists in the backend registry, so the keys map one to one.
- Delete buttons combine an ERP permission with the Suite's narrowing:
  ```js
  usePermission('masters.deleteSku') && useMasterRights('skuMaster').canDelete
  ```

### 6.6 Feature map (`src/features/*`)

| Feature | Purpose |
|---|---|
| `procurement/*` | Purchase FMS. A single hub with a step rail, plus list, detail, drawer and PDF preview per step, approvals (signature pad), rate changes, vendors, vouchers. Shared kit: `AdaptiveFilterBar`, `StepQueueGrid`, `RowActionsCell`, `useRecordDelete`, `CascadeDeleteDialog`, `PfmsKpiCard` |
| `o2d-fms` | O2D Step Board (main view), My Tasks, Task page, processes, master/pipeline, dashboard, step config, templates, MIS scores, step screens (invoice, email, delivery, payments, transport bill) |
| `fms-doers` | Doer Assignment and the unified **My FMS Tasks** across O2D and Purchase |
| `ims`, `rm-ims`, `fg-ims`, `scrap-ims` | Inventory modules built from parallel near-copies of the same pattern |
| `planning`, `orders`, `order-intake`, `execution` | Dispatch plans, calendars, plan vs actual, SO management, challans |
| `ppc` (+ `ppc/dpr`) | PPC planning and DPR/OEE (hidden from the nav) |
| `masters` | SKU, Party, Machine, Operator |
| `pricing`, `quotes`, `ledger` | Price hub, approvals, quotes; sales invoices list |
| `access-control`, `settings`, `employees`, `profile`, `notifications`, `dashboard` | Admin and shell features |

### 6.7 UI patterns

- **Styling:** MUI `sx` everywhere. Shared tokens and helpers are in `components/pageKit.jsx` (`PageHero`, `pageSx`, `panelSx`, `fieldSx`). There are per-module themes (`o2dTheme`, `pfmsTheme` with `PurchaseFmsThemeScope`, `imsTheme`).
- **Lists:** MUI X DataGrid (mostly procurement) or plain MUI Table.
- **Forms:** forms open in Dialogs or Drawers. Deep links use query parameters (`?so=`, `?convert=`, `?fmsTask=`).
- **Feedback:** `enqueueSnackbar(err?.data?.message || 'Failed…')`. A few places still use `window.confirm`.
- **Naming:** PascalCase `.jsx` for components, camelCase `useX.js` for hooks, `camelCaseApi.js` for API slices, `*Meta.jsx` for per-module constants and renderers.

---

## 7. Delegation Suite (`ambika-group-`)

### 7.1 Backend

**Boot and middleware** (`backend/src/server.js`, `app.js`):
- Startup runs four node-cron schedulers: reminders every minute, checklists at `0,30 * * * *`, and the outreach config log and outreach scheduler.
- Middleware: compression, `cors({origin: CORS_ORIGIN || "*"})`, a 5mb JSON body limit only on `/erp/fms` (16kb elsewhere), cookie parser.

**Auth:**
- `verifyJWT` accepts the cookie `accessToken` or a Bearer token and rejects inactive users.
- `ACCESS_TOKEN_SECRET` falls back to the literal `"fallback_secret"`.
- Login is rate-limited (`authLimiter`). Nothing else is.

**Access:**
- Role capability booleans (`role.model.js`), per-user `accessOverrides.capabilities` (the "lock-icon" switches, including the ERP ones), and access rules (`self | all | explicit` visibility).
- These are merged by `effectiveAccess.service.js` into `req.user.access`.

**Default roles** (`shared/config/defaultRoles.js`): md, chief_of_staff, ea, factory_manager, production_head, quality_check, store_manager, deo, process_coordinator, process_coordinator_accounts, accountant, member.

**Modules:**

| Module | Summary |
|---|---|
| tasks | Status `pending/in-progress/awaiting-approval/completed/cancelled/overdue`, approval flow, transfers, time extensions, clarity requests, proofs, watchers. The `fms` sub-doc links a task to an ERP O2D step |
| checklists | Recurring (one-time … yearly/custom); occurrences have a unique `(checklistId, cycleKey)` and are aware of off-days and holidays |
| master-tasks / master-checklists | Admin views across all users |
| teams | Groups of users |
| holidays | Company holidays |
| attendance | Geofenced punch in/out |
| mis-score | Scores computed in `score100.js` |
| notifications | In-app plus FCM, Socket.io per-user rooms, email, WhatsApp (Maytapi) |
| reminders | Driven by the per-minute cron |
| report-tasks | Reporting views |
| transfers | Task and checklist transfer history |
| search | Universal search |
| outreach | WhatsApp and email to external contacts |
| chatboard / chatbot | OpenAI (gpt-4o-mini / gpt-4o escalation); `chatbot` is deprecated |
| email-logs | Audit log of sent email |
| attachments | HMAC-tokenised S3 proxy |
| **erp-sso, erp-fms** | Integration (§8) |

**Email** goes through the Gmail API with a service account, falling back to SMTP, and is logged to `EmailLog`.

**Tests:** none. The `test` script just errors.

### 7.2 Frontend

- **Stack:** React 19, react-router 7, RTK Query, Tailwind 4, vite-plugin-pwa, Firebase messaging.
- **Routing:** `/delegation/*` sits under `DelegationLayout`. `ProtectedRoute` checks only `isAuthenticated` and an optional `allowedRoles`.
- **ERP inside the Suite:** `erp/*` routes render `ErpFramePage`. The sidebar merges ERP nav items, filtered by the module switches and by the ERP-reported access.

---

## 8. ERP ↔ Delegation integration

### 8.1 Single sign-on (browser, postMessage + ticket)

1. The user opens `/delegation/erp/<path>` in the Suite. `ErpFramePage` mounts **one persistent iframe** at `VITE_ERP_ORIGIN/<path>`.
2. The ERP `EmbedBridge` logs out any stale session and posts `erp:ready`. Embedding is active only when the page is framed **and** `VITE_SHELL_ORIGIN` is set.
3. The Suite calls `GET /api/v1/erp/ticket`. This is a JWT: HS256, `ERP_SSO_SECRET`, `exp 60s`, `iss ambika-suite`, `aud agl-erp`. Claims: email, name, mobile, role, grants, denies.
4. The Suite posts `shell:auth {ticket}`. The ERP calls `POST /api/v1/auth/sso` and gets back an ERP JWT.
5. The ERP posts `erp:auth-ok` and `erp:access {isRoot, permissions}`. Routes are kept in sync both ways with `shell:navigate` and `erp:route`.
6. Both sides check the message: origin equals the configured origin, source equals the parent or frame window, and `ns:"agl-embed"`.

**Identity mapping** (`Ambika_2.0/backend/src/modules/auth/auth.service.js:109-126`):
- Users are matched **by email**. A missing user is auto-created.
- Suite `md` or `admin` becomes ERP `MD` (root). Everyone else becomes `VIEWER`.

**Permission layers in effect for an embedded user:**

| Layer | Source | Enforced where |
|---|---|---|
| (a) ERP roles and grants | ERP Access Control | Server |
| (b) Ticket grants and denies | Suite `erpGrantsFor` / `erpDeniesFor` (`ambika-group-/backend/src/modules/erp-sso/erp-sso.routes.js`) | Server; only `orders.delete`, `masters.delete*` and `masters.edit*` |
| (c) `shell:prefs` hidden steps and rights | Suite | **ERP UI only** |
| (d) Sidebar filtering | Suite | **UI only** |

The switch keys must stay in sync in three places: the Suite's `MASTER_PERMISSIONS`, the frontend `erpSwitches.js`, and the ERP's `SESSION_GRANTABLE` / `SESSION_DENIABLE`.

### 8.2 Server-to-server (signed envelopes)

The envelope is `{data, sig}`, where `sig` is a JWT over `{sha: sha256(JSON(data))}` signed with the same `ERP_SSO_SECRET` (`iss`/`aud` differ by direction).

| Direction | Endpoint | Purpose |
|---|---|---|
| ERP → Suite | `POST /api/v1/erp/fms/sync` (`closeOnly:true`), `/erp/fms/close` | Close Suite tasks for O2D steps that are no longer due |
| ERP → Suite | `POST /api/v1/erp/fms/people` | Doer list for ERP Doer Assignment (cached 60s) |
| Suite → ERP | `POST /api/v1/suite-link/o2d/complete` | Completing an FMS-linked Suite task completes the ERP step (`force:true`, acting as the user matched by email) |

**Current state:**
- Since about October 2026 the ERP shows O2D work in its own **My FMS Tasks**. The Suite **only closes legacy O2D tasks** and no longer creates new ones (`o2d-delegation.js` header comments). The task-creation path in the Suite (`_sync` without `closeOnly`) is dormant.
- On the Suite side, `TaskDetailPage` shows an `O2dWorkPanel` for tasks with `fms.key`.

### 8.3 Notifications

There are two separate stores. The Suite bell (`NotificationsPopover.jsx`) merges them **client-side** by polling the ERP's `/notifications/unread-count` every 60 seconds through an in-memory ERP session (`erpSession.js`).

---

## 9. Infrastructure, deployment, CI and tests

**ERP deployment** (`deploy/`, `.github/workflows/deploy.yml`):
- pm2 runs a single fork `ambika-backend` on :3006 with a 400M limit.
- nginx on a shared EC2 host listens on :3005 over **plain HTTP**. It serves `frontend/dist` and proxies `/api`, `/socket.io` and `/uploads`.
- Deploy runs on every push to `main`, **not gated on CI**: build the frontend, rsync `backend/` (excluding `.env`, `node_modules`, `uploads`), `npm install --omit=dev`, `pm2 startOrReload`, `nginx -t`, curl health check.
- The `.env` file is copied to the server by hand.

**ERP frontend hosting configs disagree:**
- `netlify.toml` and `public/_redirects` proxy to one hard-coded plain-HTTP IP backend and allow framing by the Suite origin (`frame-ancestors`).
- `vercel.json` proxies to a **different** IP and sets `X-Frame-Options: SAMEORIGIN`, which would **break embedding**.

**ERP CI** (`ci.yml`):
- Advisory frontend lint, frontend build, a backend "import app.js" smoke check, and a secret scan.
- It does **not** run `npm test`. Its comment claiming "no test suite" is stale.

**Tests:**

| Repo | Test suite | Notes |
|---|---|---|
| ERP backend | `node:test`, about 59 files in `src/**/__tests__` | Mostly procurement and inventory pure-rule tests. No HTTP/DB integration, except the `skuWriteAuth` router test. **No tests** for O2D FMS, orders, dispatch, invoices, PPC/DPR, pricing or quotes |
| ERP frontend | 35 Playwright-library scripts in `e2e/` | Guarded by `_e2eSafety.mjs` plus backend `e2eServer.js` (scratch DB, S3 and mail off). Heavy on Purchase FMS and IMS. None for O2D, access control, pricing or embedding. Two stray `node:test` unit files |
| Suite | None | |

**Scripts:**
- **ERP** `backend/src/scripts` holds 102 ad-hoc Node scripts: e2e fixtures (about 46), imports from `src/sheets` and `excel/`, seeds, backfills and migrations, fixes and cleanups, verify/audit. **There is no migration framework.**
- Several scripts are destructive:
  - `npm run seed` wipes core collections against whatever `MONGO_URI` points to.
  - `reset_all_passwords.js` resets every user to a hard-coded password.

---

## 10. Development conventions

### ERP backend
- **Module layout:** `modules/<name>/` with `x.model.js`, `x.service.js` (object-literal service), `x.controller.js` (thin, `asyncHandler`), `x.routes.js`, `x.validation.js` (Joi), and optionally `x.pdf.js`, `*.rules.js` (pure logic for unit tests) and `__tests__/`.
- **Legacy modules** put service, controller and routes in one `*.routes.js` file: `challan`, `invoice`, `schedule`, `fms`, `o2d-fulfillment`.
- **Responses:** `ApiResponse.ok/created`, errors via `throw new AppError(msg, status)`.
- **Models:** new models spread `baseSchemaFields` / `baseSchemaOptions`; soft delete via `isDeleted` plus a Recycle Bin record.
- **Concurrency:** atomic status flips with a precondition (e.g. `findOneAndUpdate({_id, status: expected, updatedAt})`) and `optimisticConcurrency`. Multi-document stock changes run in transactions (`inventoryService.runAtomically`, `withMaybeTransaction`). Both of those need a replica set; Atlas is one.
- **Document numbers:** always `generateDocNumber(...)`, never computed client-side.
- **Workflow hooks:**
  - O2D actions call `o2dFmsService.advanceByTrigger(...)`.
  - Procurement writes are picked up automatically by `fmsWorkflowSync`.
  - Deletes call the recycle-bin helpers and a `laterSteps` guard.

### ERP frontend
- One RTK Query slice per backend module, using `baseApi.injectEndpoints`, with list and id tags.
- Pages are lazy-loaded through `lazyWithRetry`. Routes needing a permission are wrapped in `RequirePermission`. Buttons are gated with `usePermission` (and `useMasterRights` / `useO2dRights` when embedded).
- MUI `sx` with `pageKit` tokens, toasts through notistack, Drawers or Dialogs for forms.

---

## 11. Technical debt, risks and security findings

Each item was observed in code. **[V]** means I re-checked it directly while compiling this document.

### Security (highest priority)

| # | Finding | Evidence |
|---|---|---|
| S1 [V] | **Public self-registration with mass assignment.** `POST /api/v1/auth/register` is unauthenticated and passes `req.body` to `User.create`, so a caller can set `roles:['MD']` and become root | `auth.routes.js:7`, `auth.service.js:80-84` |
| S2 [V] | **Unauthenticated routers:** `/clients` (read and write), `/purchase-orders` (legacy, incl. `generate-so`), `/fms/*` (raw `req.body` writes to invoices and payments, which also advances O2D), `/uploads` (any upload; presigned URL for any key) | `client.routes.js`, `fms/fms.routes.js:114+`, `upload.routes.js` |
| S3 [V] | **JWT secret fallbacks:** ERP `'fallback-secret'` (`config/env.js:9`), Suite `"fallback_secret"` | Tokens become forgeable if the env var is missing |
| S4 [V] | **CORS `*` with credentials; rate limiting disabled** (ERP entirely; Suite everywhere except login) | `app.js:84`, `app.js:88-99` |
| S5 | **Deactivated users keep access.** ERP `login` and `protect` ignore `isActive`, and 7-day tokens cannot be revoked | `auth.service.js:89-92`, `auth.middleware.js:46-51` |
| S6 [V] | **Logged-in-only gates on critical actions.** Indent, PO, PI and invoice approval, PO release, voucher post, tally, final payment, all inventory adjustments, dispatch, challans, PPC/DPR and **cascade-delete** have no permission check | `indent.routes.js:43,47`, `purchaseOrder.routes.js:71-72` |
| S7 | **Production over plain HTTP** (nginx :3005, IP-based proxies). Bearer tokens travel in clear text | `deploy/nginx.conf`, `netlify.toml`, `vercel.json` |
| S8 | **SSO privilege mapping.** Anyone who is md or admin in the Suite becomes root in the ERP. `canUseErp` defaults to true. Tickets are replayable within 60s (no `jti`). One secret is used for SSO and both S2S directions | `auth.service.js:109-126`, `erp-sso.routes.js` |
| S9 | **UI-only restrictions.** O2D step hide/edit switches and module switches are enforced only in the UI | §8.1 |
| S10 | **Sensitive data tracked in git:** ERP `backend/backups/*.json` (DB dumps), business spreadsheets in `src/sheets` and `excel/`, `bash.exe.stackdump`, a stray file named `tash push -u -m …`. Suite: `backend/logs/error.log` (exposes the DB host), `priya_sheet_dump.json`, staff spreadsheets, `MISSED_CHECKLISTS_REPORT.md` (employee names), scripts with hard-coded passwords and contact details. `.env` files are **not** tracked |
| S11 | **The parent folder is inside a git repo rooted at the user's home directory.** A careless `git add .` there could stage `.ssh/` and other private files | `git rev-parse --show-toplevel` from the workspace root resolves to the home directory |
| S12 | **Dependency advisories:** `xlsx@0.18.5` (prototype pollution / ReDoS) and `multer@1.4.5-lts.1`. This comes from general knowledge, not from an audit run here |

### Correctness and design debt

| # | Finding |
|---|---|
| D1 | **Duplicate write paths bypass O2D gates** (§5.1 table) |
| D2 | **Three O2D trackers:** embedded steps on SalesOrder/Invoice/Payment/Shipment, `O2DProcess`, and the V1 vs CURRENT_SHEET catalogs. Both catalogs reuse the same `stepCode` values with different meanings, and `loadDefMap` merges them |
| D3 | **Vendor vs Party split** in Purchase. Indents, new POs and rate changes reference `Vendor`, but follow-up, PI, GRN, QC, invoice, voucher and payments declare `ref:'Party'`. PO `vendorId` is polymorphic with no ref |
| D4 | **Bad ref:** `ServiceCompletion.qcId` refs `'IncomingQc'`, but the model is `'IncomingQC'` [V] |
| D5 | **Unwired integrations:** quote → SO; DPR → FG stock / plan producedQty / RM consumption; DC → FG `DISPATCH_OUT`; planner-typed `fgStock`; `qtyReserved` unused |
| D6 | **Dead code:** dispatch-actuals/phases/schedules models (name collision), BullMQ queues, events bus, socket emits, WhatsApp stub, `test-flow.js`, the legacy customer `purchase-orders` module (it also reads non-existent fields), `fmsApi.js`, `navSectionsFull`, mock-data context, about 14 unimported frontend files |
| D7 | **Status enum values never set** (e.g. PO `CLOSED`, invoice `APPROVED`, PI `APPROVED`). Approval types listed in the enum have no adapter |
| D8 | **Audit middleware bug:** `action` is scoped inside `try` but used in `catch`. The audit records no old values and covers only 5 routers |
| D9 | **Inconsistent folder naming** (`middleware/` vs `middlewares/`). Plan documents at the repo root are partly stale (e.g. `PARTY_VENDOR_EXTENSION.md` says "no Vendor model", but one exists) |
| D10 | **In-process role cache and in-process jobs.** Running more than one backend instance would duplicate jobs and serve stale permissions |
| D11 | **Frontend:** six raw `fetch` call sites bypass the 401 guard; `npm run lint` likely fails (ESLint 9 rejects `--ext`, inferred); unused dependencies; four parallel IMS module copies; very large files (`PurchaseOrderFormDrawer.jsx` about 4.4k lines, `rmIms.service.js` about 3.7k, `dispatch-control.service.js` about 2.3k) |
| D12 | **Suite:** `/auth/refresh-token` is mounted after `router.use(verifyJWT)`, so refresh requires a valid access token [V]. The Reminder enum lacks `skipped`, but the scheduler writes it. An uncommitted local change points the frontend's default API URL at `localhost` |

---

## 12. Gaps and unverified areas

These were **not** verified and should not be assumed:

- **Runtime behaviour.** Nothing was executed. Test pass/fail status, build success and lint results are unknown.
- **Production configuration.** Which hosting config (Netlify or Vercel) is live, whether `O2D_ACTIVE_FMS` / `VITE_SHELL_ORIGIN` are set in production, the security-group state of ports 3005/3006, and the production values of any secret.
- **Controller- or service-level permission checks** on the routers listed as "protect only". Route-level middleware was surveyed, but some services check internally (e.g. the SKU `itemType` change and MD-only PO direct save). Treat the S6 list as "no route-level check", pending a per-service audit.
- **Internals not read in full:** `fmsWorkflowSync`, recycle-bin restore internals, cascade-delete blocking rules, `stepTiming` rules, PDF builders, inventory transaction internals, chatboard model config, outreach validation, mis-score internals.
- **Plan documents** (`DISPATCH_PLANNING_PLAN.md`, `ORDER_360_PLAN.md`, `PPC_PLAN.md`, `PRICE_TRACKER_MIS_PLAN.md`, `CHECKLIST_RECURRENCE_FIX_PLAN.md`, `OUTREACH_MODULE_PLAN.md`). Implementation status was **inferred** from the presence of matching code, not confirmed against every requirement.
- **`docs/TASK_CUSTOM_FMS_FORM_BUILDER.md`** is a developer-assessment brief, **not** a description of this system.
- **Dead-code lists** were derived by import grep. Dynamic imports could be missed.
- Whether the **frontend still calls the legacy endpoints** (`/fms/*`, `/challans` create, `/schedules` CRUD) from any screen.
- The **email worker** and production email and WhatsApp behaviour of either app.
- Whether a **Company/Branch multi-tenancy** model was ever intended. The `companyId` and `branchId` fields exist, but no models back them.

---

## 13. Architecture summary

Ambika is **two cooperating MERN applications**:

- **Ambika 2.0 ERP:** an Express/Mongoose modular monolith plus a React/MUI/RTK Query SPA. It runs two workflow engines:
  - **O2D FMS:** a per-order `O2DProcess` with SOP-driven steps, planned and actual dates, gates and auto-advance triggers.
  - **Purchase FMS:** an 11-step procure-to-pay chain from Indent to Final Payment, whose status flags gate each step, with MD e-signature approvals that gate payments.

  Around those sit an **append-only inventory ledger** (`InventoryMovement` → `InventoryStock`), four IMS views, PPC/DPR production planning, pricing and quotes, and a code-defined RBAC permission registry.
- **Delegation Suite:** the employee-facing shell for tasks, checklists, attendance and MIS. It **embeds the ERP in an iframe** and signs users in through short-lived HS256 tickets, matching identities by email across **separate databases**. Server-to-server traffic uses hash-signed JWT envelopes over one shared secret.

**Strongest parts:**
- The procurement domain: atomic state flips, transactions, the cascade-delete planner, the recycle bin and about 40 rule-test files.
- The inventory ledger design.

**Weakest parts:**
- Authorization coverage: a public register with mass assignment, unauthenticated legacy routers, and many logged-in-only write routes.
- Transport security: plain HTTP, CORS `*`, no rate limits.
- Legacy duplication across the O2D path.
- Missing production → inventory wiring.
- Operations: in-process jobs and caches, deploys not gated on CI, no migration framework.

---

## 14. Recommendations for safely extending the ERP

**Before adding features (blocking hygiene):**
1. **Close S1 and S2 first.** Remove or protect `/auth/register` and whitelist its fields. Add `protect` to `/clients`, `/purchase-orders`, `/fms` and `/uploads`, or unmount the legacy routers. Remove the JWT secret fallbacks and fail fast at boot instead.
2. **Add `requirePermission` to every new write route** and back-fill the S6 routes. Approvals and money or stock actions come first, using the existing registry slugs (add new slugs to `common/permissions/registry.js`). Never rely on UI hiding or `shell:prefs` alone.
3. **Check `isActive` in `protect` and `login`.** Consider shorter token lifetimes plus revocation.
4. **Turn on HTTPS, a CORS allow-list and a login rate limit** before widening access.

**Conventions for new code:**

5. **Follow the procurement module pattern:** `model/service/controller/routes/validation`, `baseSchemaFields`, Joi validation, `AppError`, pure `*.rules.js` with `node:test` tests, `generateDocNumber` for numbering, Recycle Bin and `laterSteps` for deletes. Use atomic precondition updates and `runAtomically`/transactions for multi-document changes.
6. **Never write stock directly.** Go through `inventoryService.createStockMovement`/`increaseStock`/`decreaseStock` with a proper `txnType`, `refType`/`refId` and an idempotency key.
7. **Use the gated O2D paths.** Use `/dispatch-control` and `/sales-invoices`, and call `advanceByTrigger`. Do not add more writers to `/challans`, `/schedules` or `/fms`. Plan to retire those paths.
8. **For a new FMS step or workflow,** extend `fmsCatalog.js` (Purchase) or the StepDefinition/TaskTemplate seeds (O2D). Keep `stepCode` values unique across catalogs, or fix `loadDefMap` first.
9. **Frontend work:**
   - Add an `injectEndpoints` slice with list and id tags, and wrap the route in `RequirePermission`.
   - Gate buttons with `usePermission` (and `useMasterRights` or `useO2dRights` if the screen can be embedded).
   - Use `baseApi` instead of raw `fetch`, and reuse `pageKit` and the procurement list kit.
   - Add the nav entry to `navSectionsSimple`.
10. **Integration changes:**
    - Any new ERP switch or grant must be added consistently in `erp-sso.routes.js` (Suite), `erpSwitches.js`, and the ERP's `SESSION_GRANTABLE`/`SESSION_DENIABLE`.
    - Treat email as the identity join key: it must be unique and stable in both systems.
    - Test inside the iframe (Netlify-style headers).

**Process and operations:**

11. **Gate deploys on CI** (`needs: ci`) and run `npm test` in CI. Add API-level tests for O2D gates and RBAC before refactoring those areas.
12. **Introduce a migration convention** (versioned, idempotent scripts with a dry-run flag) instead of ad-hoc scripts. Add environment guards to `npm run seed` and any destructive script, as `e2eSafety.js` already does.
13. **Plan for more than one instance before scaling horizontally.** Move the `setInterval` jobs and the role cache to a single scheduler or a shared store (e.g. Redis), or keep pm2 at exactly one instance.
14. **Purge tracked data and log files** (backups, spreadsheets, dumps, logs) from both repos. Rotate any credential that ever appeared in them, and keep the `Ambika` folder out of the home-directory git repo.
15. **Resolve the duplicated masters** (`Party` vs `Client`, `Vendor` vs `Party` refs) and the dead models before building reports on them. Otherwise joins will silently miss data.
