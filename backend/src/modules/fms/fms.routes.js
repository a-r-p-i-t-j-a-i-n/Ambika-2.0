import Invoice from '../invoice/invoice.model.js';
import Shipment from '../shipment/shipment.model.js';
import Payment from '../payment/payment.model.js';
import TransportBill from '../transport/transport.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';

// ── FMS Service (Invoices + Shipments + Payments + Transport) ──
export const fmsService = {
  // ── INVOICES ──────────────────────────────────────────────
  async createInvoice(data) {
    if (!data.invoiceNo) {
      data.invoiceNo = await generateDocNumber('TAX_INVOICE', data.invoiceDate || new Date());
    }
    return Invoice.create(data);
  },
  async getAllInvoices(query) {
    const features = new ApiFeatures(Invoice.find(), query)
      .filter().search(['invoiceNo', 'dcNumber', 'partyName']).sort().select().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code' }]);
    return features.exec();
  },
  async getInvoiceById(id) {
    const doc = await Invoice.findById(id).populate('partyId dcId').lean();
    if (!doc) throw new AppError('Invoice not found', 404);
    return doc;
  },
  async updateInvoice(id, data) {
    const doc = await Invoice.findById(id);
    if (!doc) throw new AppError('Invoice not found', 404);
    Object.assign(doc, data);
    await doc.save();
    return doc.toObject();
  },

  // ── SHIPMENTS ─────────────────────────────────────────────
  async createShipment(data) { return Shipment.create(data); },
  async getAllShipments(query) {
    const features = new ApiFeatures(Shipment.find(), query)
      .filter().search(['dcNumber', 'transporterName', 'lrNumber']).sort().select().paginate();
    return features.exec();
  },
  async getShipmentById(id) {
    const doc = await Shipment.findById(id).populate('dcId invoiceId').lean();
    if (!doc) throw new AppError('Shipment not found', 404);
    return doc;
  },
  async updateShipment(id, data) {
    const doc = await Shipment.findByIdAndUpdate(id, data, { new: true }).lean();
    if (!doc) throw new AppError('Shipment not found', 404);
    return doc;
  },

  // ── PAYMENTS ──────────────────────────────────────────────
  async createPayment(data) { return Payment.create(data); },
  async getAllPayments(query) {
    const features = new ApiFeatures(Payment.find(), query)
      .filter().search(['dcNumber', 'partyName']).sort().select().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code' }]);
    return features.exec();
  },
  async updatePayment(id, data) {
    const doc = await Payment.findByIdAndUpdate(id, data, { new: true }).lean();
    if (!doc) throw new AppError('Payment not found', 404);
    return doc;
  },

  // ── TRANSPORT BILLS ───────────────────────────────────────
  async createTransportBill(data) { return TransportBill.create(data); },
  async getAllTransportBills(query) {
    const features = new ApiFeatures(TransportBill.find(), query)
      .filter().search(['dcNumber']).sort().select().paginate();
    return features.exec();
  },
  async updateTransportBill(id, data) {
    const doc = await TransportBill.findByIdAndUpdate(id, data, { new: true }).lean();
    if (!doc) throw new AppError('Transport Bill not found', 404);
    return doc;
  },
};

// ── Controller ──────────────────────────────────────────────
const ctrl = (svcMethod, msg, code = 200) => asyncHandler(async (req, res) => {
  const result = await svcMethod(req.params.id || req.body, req.query);
  res.status(code).json(code === 201 ? ApiResponse.created(msg, result) : ApiResponse.ok(msg, result));
});
const listCtrl = (svcMethod, msg) => asyncHandler(async (req, res) => {
  const { docs, pagination } = await svcMethod(req.query);
  res.json(ApiResponse.ok(msg, docs, pagination));
});

// ── Routes ──────────────────────────────────────────────────
const router = Router();

// Invoices
router.post('/invoices', asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Invoice created', await fmsService.createInvoice(req.body))); }));
router.get('/invoices', listCtrl(fmsService.getAllInvoices.bind(fmsService), 'Invoices retrieved'));
router.get('/invoices/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Invoice retrieved', await fmsService.getInvoiceById(req.params.id))); }));
router.put('/invoices/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Invoice updated', await fmsService.updateInvoice(req.params.id, req.body))); }));

// Shipments
router.post('/shipments', asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Shipment created', await fmsService.createShipment(req.body))); }));
router.get('/shipments', listCtrl(fmsService.getAllShipments.bind(fmsService), 'Shipments retrieved'));
router.get('/shipments/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Shipment retrieved', await fmsService.getShipmentById(req.params.id))); }));
router.put('/shipments/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Shipment updated', await fmsService.updateShipment(req.params.id, req.body))); }));

// Payments
router.post('/payments', asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Payment created', await fmsService.createPayment(req.body))); }));
router.get('/payments', listCtrl(fmsService.getAllPayments.bind(fmsService), 'Payments retrieved'));
router.put('/payments/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Payment updated', await fmsService.updatePayment(req.params.id, req.body))); }));

// Transport Bills
router.post('/transport-bills', asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Transport Bill created', await fmsService.createTransportBill(req.body))); }));
router.get('/transport-bills', listCtrl(fmsService.getAllTransportBills.bind(fmsService), 'Transport Bills retrieved'));
router.put('/transport-bills/:id', asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Transport Bill updated', await fmsService.updateTransportBill(req.params.id, req.body))); }));

export default router;
