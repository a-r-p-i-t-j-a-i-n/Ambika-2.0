import mongoose from 'mongoose';
import ScrapBuyer from './scrapBuyer.model.js';
import { buyerNameKey, normalizeGstNo } from './scrapUom.js';
import { generateScrapBuyerCode } from '../../utils/docNumberGenerator.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * Scrap Buyer master — find, and find-or-create.
 *
 * Search builds its own ESCAPED regex instead of going through ApiFeatures,
 * whose search compiles the raw text: a buyer called "C++ Metals" or a stray
 * "(" typed into the picker would throw there. The scrap ledger escapes its
 * search the same way (see `rx` in scrapIms.service.js).
 */
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The fields a Scrap Out keeps of its buyer — a snapshot, so the ledger still
 *  says who bought the scrap even if the master is later edited or removed. */
export const toBuyerSnapshot = (b) => ({
  buyerId: b._id,
  code: b.code || '',
  name: b.name || '',
  contactPerson: b.contactPerson || '',
  phone: b.phone || '',
  gstNo: b.gstNo || '',
});

/** A live buyer that is the same business as `data`, and why it matched. */
const findExisting = async ({ name, gstNo }) => {
  const live = { isDeleted: { $ne: true } };
  const byName = await ScrapBuyer.findOne({ ...live, nameKey: buyerNameKey(name) }).lean();
  if (byName) return { buyer: byName, matchedOn: 'name' };
  const gst = normalizeGstNo(gstNo);
  if (gst) {
    const byGst = await ScrapBuyer.findOne({ ...live, gstNo: gst }).lean();
    if (byGst) return { buyer: byGst, matchedOn: 'gstNo' };
  }
  return null;
};

export const scrapBuyerService = {
  async list(query = {}) {
    const filter = { isDeleted: { $ne: true } };
    if (!query.includeInactive) filter.isActive = { $ne: false };
    const term = String(query.search || '').trim();
    if (term) {
      const r = new RegExp(escapeRx(term), 'i');
      filter.$or = [{ name: r }, { code: r }, { contactPerson: r }, { phone: r }, { gstNo: r }];
    }
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    return ScrapBuyer.find(filter).sort({ name: 1 }).limit(limit).lean();
  },

  async getById(id) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) throw new AppError('Invalid buyer id.', 400);
    const b = await ScrapBuyer.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!b) throw new AppError('Scrap buyer not found', 404);
    return b;
  },

  /**
   * Create a buyer, or hand back the one that already exists.
   *
   * "Add new buyer" is pressed from inside Scrap Out, often by someone who did
   * not see the buyer in the list because they spelled it differently in case
   * or spacing. Refusing with an error would leave them stuck mid-entry; handing
   * back the existing buyer (created:false) lets the screen select it and say
   * so — no second record either way.
   *
   * @returns {{ buyer, created: boolean, matchedOn?: 'name'|'gstNo' }}
   */
  async create(data, user) {
    const name = String(data.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw new AppError('Buyer name must be at least 2 characters.', 400);
    const gstNo = normalizeGstNo(data.gstNo);

    const existing = await findExisting({ name, gstNo });
    if (existing) return { buyer: existing.buyer, created: false, matchedOn: existing.matchedOn };

    const doc = {
      name,
      nameKey: buyerNameKey(name),
      contactPerson: String(data.contactPerson || '').trim(),
      phone: String(data.phone || '').trim(),
      email: String(data.email || '').trim(),
      address: String(data.address || '').trim(),
      state: String(data.state || '').trim(),
      gstNo,
      remarks: String(data.remarks || '').trim(),
      createdBy: user?._id,
    };

    try {
      const created = await ScrapBuyer.create({ ...doc, code: await generateScrapBuyerCode() });
      return { buyer: created.toObject(), created: true };
    } catch (e) {
      // Two saves of the same new buyer raced; the unique index let one in.
      // Hand back that one — the caller asked for this buyer, and now it exists.
      if (e?.code === 11000 && (e.keyPattern?.nameKey || e.keyPattern?.gstNo)) {
        const winner = await findExisting({ name, gstNo });
        if (winner) return { buyer: winner.buyer, created: false, matchedOn: winner.matchedOn };
      }
      throw e;
    }
  },
};

export default scrapBuyerService;
