/**
 * Seed runner — inserts all data from AGL sheets into MongoDB.
 * Run: npm run seed
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { logger } from '../utils/logger.js';
import { setCounter } from '../utils/docNumberGenerator.js';

// Models
import Party from '../modules/party/party.model.js';
import SKU from '../modules/sku/sku.model.js';
import SalesOrder from '../modules/order/order.model.js';
import DeliveryChallan from '../modules/challan/challan.model.js';
import Invoice from '../modules/invoice/invoice.model.js';
import Shipment from '../modules/shipment/shipment.model.js';
import Payment from '../modules/payment/payment.model.js';

// Data
import { partiesData, skusData, ordersData, challansData, fmsData } from './seedData.js';

const run = async () => {
  await connectDB();
  logger.info('🌱 Starting seed...');

  // ── 1. Clear existing data ──────────────────────────────
  await Promise.all([
    Party.deleteMany({}),
    SKU.deleteMany({}),
    SalesOrder.deleteMany({}),
    DeliveryChallan.deleteMany({}),
    Invoice.deleteMany({}),
    Shipment.deleteMany({}),
    Payment.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({}),
  ]);
  logger.info('🗑️  Cleared all collections');

  // ── 2. Insert Parties ───────────────────────────────────
  const parties = await Party.insertMany(partiesData);
  const partyMap = {};
  parties.forEach((p) => { partyMap[p.code] = p; });
  logger.info(`✅ Inserted ${parties.length} parties`);

  // ── 3. Insert SKUs ──────────────────────────────────────
  const skus = await SKU.insertMany(skusData);
  const skuMap = {};
  skus.forEach((s) => { skuMap[s.code] = s; });
  logger.info(`✅ Inserted ${skus.length} SKUs`);

  // ── 4. Insert Sales Orders ──────────────────────────────
  const orderDocs = ordersData.map((o) => {
    const party = partyMap[o.partyCode];
    const items = o.items.map((item) => {
      const sku = skuMap[item.skuCode];
      return {
        skuId:         sku?._id,
        skuName:       sku?.name || item.skuCode,
        skuCode:       item.skuCode,
        orderQty:      item.orderQty,
        dispatchedQty: item.dispatchedQty || 0,
        balanceQty:    Math.max(0, item.orderQty - (item.dispatchedQty || 0)),
        remark:        item.remark || null,
      };
    });

    const fy = o.soNumber.split('/').pop(); // "24-25" or "25-26"

    return {
      soNumber:      o.soNumber,
      poNumber:      o.poNumber,
      partyId:       party?._id,
      partyName:     party?.name,
      location:      party?.location,
      orderDate:     new Date(o.orderDate),
      receivedAt:    new Date(o.orderDate),
      financialYear: fy,
      leadTimeDays:  o.leadTimeDays || 7,
      status:        o.status || 'RECEIVED',
      items,
      totalOrderQty:      items.reduce((s, i) => s + i.orderQty, 0),
      totalDispatchedQty: items.reduce((s, i) => s + i.dispatchedQty, 0),
      totalBalanceQty:    items.reduce((s, i) => s + i.balanceQty, 0),
    };
  });

  const orders = await SalesOrder.insertMany(orderDocs);
  logger.info(`✅ Inserted ${orders.length} sales orders`);

  // ── 5. Insert Delivery Challans ─────────────────────────
  const challanDocs = challansData.map((dc) => {
    const party = partyMap[dc.partyCode];
    const items = dc.items.map((item, idx) => ({
      srNo:        idx + 1,
      skuName:     item.skuName,
      quantityPcs: item.quantityPcs,
      noOfBoxes:   item.noOfBoxes,
      pcsPerBox:   item.pcsPerBox,
      weightKg:    item.weightKg,
    }));

    return {
      dcNumber:         dc.dcNumber,
      soNumber:         dc.soNumber,
      partyId:          party?._id,
      partyName:        party?.name,
      dcDate:           new Date(dc.dcDate),
      items,
      totalQuantityPcs: items.reduce((s, i) => s + i.quantityPcs, 0),
      totalBoxes:       items.reduce((s, i) => s + i.noOfBoxes, 0),
      totalWeightKg:    items.reduce((s, i) => s + i.weightKg, 0),
      dispatchedThrough:'Freight Paid',
      status:           'DELIVERED',
    };
  });

  const challans = await DeliveryChallan.insertMany(challanDocs);
  logger.info(`✅ Inserted ${challans.length} delivery challans`);

  // ── 6. Insert FMS (Invoices + Shipments + Payments) ─────
  let invoiceCount = 0;
  for (const fms of fmsData) {
    const party = partyMap[fms.partyCode];
    const dc = challans.find((c) => c.dcNumber === fms.dcNumber);

    // Invoice
    const invoice = await Invoice.create({
      invoiceNo:      fms.invoiceNo,
      dcId:           dc?._id,
      dcNumber:       fms.dcNumber,
      partyId:        party?._id,
      partyName:      party?.name,
      invoiceDate:    new Date(fms.invoiceDate),
      invoiceAmount:  fms.invoiceAmount,
      amountReceived: fms.amountReceived,
      balance:        fms.invoiceAmount - fms.amountReceived,
      status:         fms.amountReceived >= fms.invoiceAmount ? 'PAID' : 'PARTIAL',
      creation: { status: 'DONE', actual: new Date(fms.invoiceDate) },
      emailToClient: { status: 'DONE' },
    });

    // Shipment
    await Shipment.create({
      dcId:            dc?._id,
      dcNumber:        fms.dcNumber,
      invoiceId:       invoice._id,
      transportType:   fms.transportType || 'Freight Paid',
      transporterName: fms.transporterName,
      lrNumber:        fms.lrNumber || '',
      tracking: {
        status:       'DONE',
        deliveryDate: fms.deliveryDate ? new Date(fms.deliveryDate) : null,
      },
    });

    // Payment
    await Payment.create({
      invoiceId: invoice._id,
      dcId:      dc?._id,
      dcNumber:  fms.dcNumber,
      partyId:   party?._id,
      partyName: party?.name,
      type:      'CLIENT_PAYMENT',
      followUp:     { status: 'DONE' },
      confirmation: {
        creditPeriodDays: fms.creditPeriodDays || 30,
        receivedDate:     fms.receivedDate ? new Date(fms.receivedDate) : null,
        receivedAmount:   fms.receivedAmount || 0,
        status:           'DONE',
      },
    });

    invoiceCount++;
  }
  logger.info(`✅ Inserted ${invoiceCount} FMS records (invoice + shipment + payment each)`);

  // ── 7. Set counters to avoid conflicts ──────────────────
  await setCounter('AGL/SO_24-25', 8);
  await setCounter('AGL/SO_25-26', 3);
  await setCounter('AGL/SO_26-27', 2);
  await setCounter('AGL/DC_24-25', 17);
  await setCounter('AGL/DC_26-27', 15);
  await setCounter('AGL/TI_24-25', 17);
  await setCounter('AGL-O2D', 21);
  logger.info('✅ Counters set');

  logger.info('🎉 Seed complete!');
  process.exit(0);
};

run().catch((err) => {
  logger.error(`Seed failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
