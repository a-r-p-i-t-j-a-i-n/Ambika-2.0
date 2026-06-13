# Party → Vendor Extension (Purchase FMS)

> Extends the existing **Party Master** to act as the **Vendor Master** for Purchase FMS.
> **No new Vendor table. No new Vendor API.** Party = Vendor.

---

## 1. Field Mapping (reuse first, add only what's missing)

The Party model already covered most "vendor" fields under the codebase's camelCase convention, so those are **reused as-is**. Only 5 genuinely-new fields were added.

| Requested (spec) | Stored field | Status |
|------------------|--------------|--------|
| contact_person_name | `contactPerson` | reused (existing) |
| phone_no | `phone` | reused |
| email_id | `email` | reused |
| gst_no | `gstNo` | reused |
| credit_period | `creditPeriodDays` | reused |
| to_email | `toEmails[]` | reused |
| cc_email | `ccEmails[]` | reused |
| bcc_email | `bccEmails[]` | reused |
| address | `address` (String) | **added** |
| pan_no | `panNo` (String) | **added** |
| gst_rate | `gstRate` (Number %) | **added** |
| tds_rate | `tdsRate` (Number %) | **added** |
| supplied_products[] | `suppliedProducts[]` | **added** |

### `suppliedProducts[]` sub-document
```js
{
  skuId:       ObjectId(ref 'SKU') | undefined,  // optional link to SKU master (auto-fill)
  productName: String,
  skuCode:     String (uppercase),
  rate:        Number (>= 0, default 0),
  unit:        String (default 'Pcs'),
}
```
> Naming note: the spec used `snake_case`; the entire codebase is `camelCase` (e.g. `gstNo`, `creditPeriodDays`). New fields follow the existing convention to avoid duplicate/inconsistent columns. The frontend form still shows the spec labels ("Contact Person Name", "GST Rate (%)", etc.).

---

## 2. Files Changed

### Backend
- `backend/src/modules/clients/party.model.js` — added `address`, `panNo`, `gstRate`, `tdsRate`, `suppliedProducts[]` (+ `suppliedProductSchema`). All optional with safe defaults.
- `backend/src/modules/clients/party.validation.js` — added the same fields to `createPartySchema` (optional / `allow('', null)` / defaults). `updatePartySchema` inherits via `.fork()`.
- **Unchanged:** routes, controller, service. The existing `create`/`update` already spread `req.body`, so new fields flow through automatically. The 4 endpoints are unchanged:
  `GET /api/v1/parties`, `POST /api/v1/parties`, `PUT /api/v1/parties/:id`, `GET /api/v1/parties/:id`.

### Frontend
- `frontend/src/store/api/partyApi.js` — `updateParty` method fixed `PATCH → PUT` to match the existing backend route (the update path had never been exercised because the edit UI was a stub).
- `frontend/src/features/masters/PartyFormDrawer.jsx` — **new** create/edit drawer (4 sections + dynamic products table). Reuses `useCreatePartyMutation` / `useUpdatePartyMutation` and `useGetSkuLookupQuery` (SKU autocomplete auto-fills code + unit).
- `frontend/src/features/masters/PartiesList.jsx` — wired the (previously stub) "Add Party" button + a per-row edit action to open the drawer; added a "Products" count column.
- `frontend/src/features/masters/PartyDetails.jsx` — added "Edit Vendor" button, surfaced PAN / GST Rate / TDS Rate / Address, and added a **Vendor Products** table section (Product Name · SKU Code · Rate · Unit).

---

## 3. Validation Strategy (why required fields are client-side)

The spec requires **Vendor Name, Contact Person, Phone, ≥1 product**. These are enforced in the **vendor form (`PartyFormDrawer`)**, *not* in the backend Joi schema.

**Reason / backward compatibility:** Parties are also auto-created by the **order-entry / dispatch-control** flow with only a `name` (e.g. `ensureParty()` when booking a sales order). If `phone`/`contactPerson`/`suppliedProducts` were made server-required, that existing flow would break. So:
- **Backend:** only `name` stays required (unchanged) → existing flows keep working.
- **Frontend vendor form:** enforces the 4 vendor-specific requirements before submit.

Optional everywhere: GST Number, PAN, CC/BCC emails, GST/TDS rate.

---

## 4. Database Migration Strategy

**No migration script is required.** All new fields are optional with defaults, and MongoDB/Mongoose is schemaless per-document:
- Existing Party documents simply have the new fields **absent**. On read, Mongoose returns the schema default (`''`, `0`, or `[]`); the UI also guards with `?? 0` / `|| ''` / `?.length`.
- The new fields persist the first time a party is saved through the new form.

**Optional one-time backfill** (only if you want every existing doc to physically contain the defaults — not necessary):
```js
// mongosh, run once against the target DB
db.parties.updateMany(
  { suppliedProducts: { $exists: false } },
  { $set: { address: '', panNo: '', gstRate: 0, tdsRate: 0, suppliedProducts: [] } }
);
```
This is **idempotent** and safe to skip.

**Indexes:** none added/changed. No reindex needed.

---

## 5. Backward Compatibility Notes

- ✅ **Existing Party records work unchanged** — missing fields resolve to defaults; no required-field added on the backend.
- ✅ **Existing endpoints unchanged** — same 4 routes, same response envelope (`ApiResponse`).
- ✅ **Order/dispatch auto-creation of parties unaffected** — backend still only requires `name`.
- ✅ **Customer use of Party intact** — dispatch email routing (`toEmails`/`ccEmails`/`bccEmails`), addresses, credit/lead terms are untouched; vendor fields are additive.
- ✅ **No data loss / no renames** — only additive fields.
- ⚠️ **One behavior change (a fix):** `useUpdatePartyMutation` now sends `PUT` (was `PATCH`, which the backend route never accepted). This had no callers before (edit UI was a stub), so nothing regresses.
- ✅ **Build verified:** `vite build` passes; backend files pass `node --check`.

---

## 6. Purchase FMS Integration Hook

When building **Purchase Requisition / RFQ / Vendor Quotation / Vendor PO / GRN**:
1. **Select a Vendor** = select a Party (`GET /api/v1/parties` / `useGetPartiesQuery`, or a `getPartyById`).
2. **Auto-load products** = read `party.suppliedProducts[]` to pre-fill line items (productName, skuCode, rate, unit; `skuId` links to SKU master where set).
3. Vendor tax fields (`gstRate`, `tdsRate`, `creditPeriodDays`, `panNo`, `gstNo`) feed PO/GRN tax + payment-term calculations.

No new API needed — the existing Party endpoints already return all of this.
