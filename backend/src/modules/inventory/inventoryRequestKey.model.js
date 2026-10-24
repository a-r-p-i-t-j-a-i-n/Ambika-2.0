import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One row per idempotent inventory entry.
 *
 * The entry screens mint an id for a submission and send it with the request.
 * The first request to arrive claims that id here; a replay — a double-click, a
 * browser retry, a second tab, a network retry — hits the unique `_id` and is
 * answered with what the first one did instead of moving stock a second time.
 * The uniqueness is the database's, not the application's, so two requests
 * racing each other still produce exactly one entry.
 *
 * Keys are disposable: they only have to outlive the retry window, so they are
 * expired after 7 days rather than kept forever. Nothing reads them after that,
 * and the movements they guarded keep their own copy of the id.
 */
const inventoryRequestKeySchema = new Schema({
  _id: { type: String, required: true },          // the client-supplied request id

  sourceModule: { type: String, trim: true, default: '' },  // IMS | FG_IMS | …
  action:       { type: String, trim: true, default: '' },  // receive | issue | produce | dispatch
  count:        { type: Number, default: 0 },               // lines the first request wrote
  // True once the first request finished writing. A key still false was
  // claimed by a request that may have died mid-save — never treat it as done
  // without checking the ledger (see claimRequestKey).
  settled:      { type: Boolean, default: false },
  performedBy:  { type: Schema.Types.ObjectId, ref: 'User' },

  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
}, { versionKey: false });

const InventoryRequestKey = model('InventoryRequestKey', inventoryRequestKeySchema);
export default InventoryRequestKey;
