import mongoose from 'mongoose';
import env from '../config/env.js';
import SalesOrder from '../modules/order/order.model.js';
import Party from '../modules/clients/party.model.js';
import Sku from '../modules/skus/sku.model.js';
import User from '../modules/auth/auth.model.js';

const orderDataRaw = [
  {
    soNumber: 'AGL/SO-001/25-26',
    soDate: '17/12/2025',
    poDate: '04/11/2025',
    poNumber: 'PODM02537/25-26',
    partyName: 'Maya Appliances Pvt. Ltd.',
    skuName: 'Bowl 2.0 Ltr',
    skuCode: 'BO2000-202',
    orderQty: 288,
    location: 'Tamilnadu',
    transport: 'Road',
    totalDispatchedQty: 288,
    balanceQty: 0,
    soStatus: 'COMPLETE',
    orderDocument: 'https://drive.google.com/file/d/1J6W2KilzCvQKiWfat4ZE2urIwL0USVlM/view?usp=drivesdk'
  },
  {
    soNumber: 'AGL/SO-002/25-26',
    soDate: '17/12/2025',
    poDate: '21/11/2025',
    poNumber: '5120',
    partyName: 'Versuni India Home Solutions Limited',
    skuName: 'Steele 1.5 Ltr',
    skuCode: 'ST1500-202',
    orderQty: 3484,
    location: 'Tamilnadu',
    transport: 'Road',
    totalDispatchedQty: 0,
    balanceQty: 3484,
    soStatus: 'PENDING',
    orderDocument: 'https://drive.google.com/file/d/1wFhPKoJCqgwc3fUxtOvQLU6BJ9xeLHYr/view?usp=drivesdk'
  },
  {
    soNumber: 'AGL/SO-002/25-26',
    soDate: '17/12/2025',
    poDate: '21/11/2025',
    poNumber: '5120',
    partyName: 'Versuni India Home Solutions Limited',
    skuName: 'Steele 1.0 Ltr',
    skuCode: 'ST1000-202',
    orderQty: 2412,
    location: 'Tamilnadu',
    transport: 'Road',
    totalDispatchedQty: 0,
    balanceQty: 2412,
    soStatus: 'PENDING',
    orderDocument: 'https://drive.google.com/file/d/1wFhPKoJCqgwc3fUxtOvQLU6BJ9xeLHYr/view?usp=drivesdk'
  },
  {
    soNumber: 'AGL/SO-002/25-26',
    soDate: '17/12/2025',
    poDate: '21/11/2025',
    poNumber: '5120',
    partyName: 'Versuni India Home Solutions Limited',
    skuName: 'Galaxy 1.5 Ltr',
    skuCode: 'GX1500-202',
    orderQty: 1608,
    location: 'Tamilnadu',
    transport: 'Road',
    totalDispatchedQty: 200,
    balanceQty: 1408,
    soStatus: 'PENDING',
    orderDocument: 'https://drive.google.com/file/d/1wFhPKoJCqgwc3fUxtOvQLU6BJ9xeLHYr/view?usp=drivesdk'
  }
];

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split('/');
  return new Date(`${year}-${month}-${day}`);
}

async function importOrders() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected.');

    const adminUser = await User.findOne({ role: 'ADMIN' }) || await User.findOne();
    const userId = adminUser?._id;

    // Group by soNumber
    const groupedOrders = {};
    for (const item of orderDataRaw) {
      if (!groupedOrders[item.soNumber]) {
        groupedOrders[item.soNumber] = {
          soNumber: item.soNumber,
          soDate: parseDate(item.soDate),
          poDate: parseDate(item.poDate),
          poNumber: item.poNumber,
          partyName: item.partyName,
          location: item.location,
          transport: item.transport,
          orderDocument: item.orderDocument,
          soStatus: item.soStatus.toUpperCase(),
          items: []
        };
      }
      groupedOrders[item.soNumber].items.push(item);
    }

    for (const soNumber in groupedOrders) {
      const order = groupedOrders[soNumber];
      console.log(`Processing Order: ${soNumber}...`);

      const party = await Party.findOne({ name: order.partyName });
      if (!party) {
        console.warn(`Party not found: ${order.partyName}. Skipping.`);
        continue;
      }

      const orderItems = [];

      for (const item of order.items) {
        const sku = await Sku.findOne({ code: item.skuCode });
        if (!sku) {
          console.warn(`SKU not found: ${item.skuCode}. Skipping item.`);
          continue;
        }

        orderItems.push({
          skuId: sku._id,
          skuName: sku.name,
          skuCode: sku.code,
          orderQty: item.orderQty,
          dispatchedQty: item.totalDispatchedQty,
          balanceQty: item.balanceQty,
          asnCode: item.asnCode,
          remark: item.remarks
        });
      }

      const receivedAt = order.soDate;
      const addHours = (date, hours) => new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
      const addDays = (date, days) => new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);

      await SalesOrder.findOneAndUpdate(
        { soNumber },
        {
          $set: {
            partyId: party._id,
            partyName: party.name,
            soDate: order.soDate,
            orderDate: order.soDate,
            poDate: order.poDate,
            poNumber: order.poNumber,
            location: order.location || party.location,
            transport: order.transport,
            orderDocument: order.orderDocument,
            status: order.soStatus === 'COMPLETE' ? 'COMPLETED' : 'RECEIVED',
            items: orderItems,
            financialYear: '25-26',
            poEntry: { planned: addHours(receivedAt, 1), status: 'PENDING' },
            inventoryCheck: { planned: addHours(receivedAt, 2), status: 'PENDING' },
            scheduling: { planned: addDays(receivedAt, 2), status: 'PENDING' },
            emailSchedule: { planned: addDays(receivedAt, 2), status: 'PENDING' },
          },
          $push: {
            activityTimeline: {
              action: 'UPDATE',
              description: 'Imported from Order Data sheet',
              actorId: userId,
              timestamp: new Date()
            }
          }
        },
        { upsert: true, new: true, runValidators: true }
      );
    }

    console.log('Successfully imported Sales Orders.');
  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

importOrders();
