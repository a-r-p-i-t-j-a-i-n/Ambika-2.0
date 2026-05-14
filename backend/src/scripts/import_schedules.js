import mongoose from 'mongoose';
import env from '../config/env.js';
import DispatchSchedule from '../modules/schedule/schedule.model.js';
import SalesOrder from '../modules/order/order.model.js';
import Party from '../modules/clients/party.model.js';
import Sku from '../modules/skus/sku.model.js';

const scheduleDataRaw = [
  {
    soNumber: 'AGL/SO-002/24-25',
    poNumber: '1100009188',
    partyName: 'Epack Durable Ltd',
    skuName: 'PP Flat Wet',
    skuCode: 'PP-FW-001',
    orderQty: 3500,
    phases: [
      { 
        plannedDate: '15/04/24', 
        plannedQty: 2500, 
        actualDates: '15/04/24', 
        actualQtys: '2500', 
        invoices: 'AGL/TI-015/24-25', 
        invDates: '15/04/2024',
        docs: 'https://drive.google.com/open?id=1th-Nv4OT8iYY5xEHaJdOyvcUl-Q1F0GJ'
      },
      { 
        plannedDate: '09/05/24', 
        plannedQty: 1000, 
        actualDates: '15/04/24, 09/05/24', 
        actualQtys: '20, 720', 
        invoices: 'AGL/TI-015/24-25, AGL/TI-024/24-25', 
        invDates: '15/04/2024, 09/05/2024',
        docs: 'https://drive.google.com/open?id=1th-Nv4OT8iYY5xEHaJdOyvcUl-Q1F0GJ, https://drive.google.com/open?id=1zh1JebIPgtE5NzQpOFD2T_BhsTnBV3oX'
      }
    ]
  },
  {
    soNumber: 'AGL/SO-004/24-25',
    poNumber: '4600036282',
    partyName: 'Elin Electronics Limited.',
    skuName: 'VA Wet',
    skuCode: 'VA-W-001',
    orderQty: 1500,
    phases: [
      { 
        plannedDate: '24/04/24', 
        plannedQty: 960, 
        actualDates: '24/04/24', 
        actualQtys: '960', 
        invoices: 'AGL/TI-016/24-25', 
        invDates: '24/04/2024',
        docs: 'https://drive.google.com/open?id=1xW3zjvLNaJlcuieWwaF_Hk2yiI8fRviB'
      },
      { 
        plannedDate: '27/04/24', 
        plannedQty: 540, 
        actualDates: '27/04/24', 
        actualQtys: '480', 
        invoices: 'AGL/TI-018/24-25', 
        invDates: '27/04/2024',
        docs: 'https://drive.google.com/open?id=1gzkVONzc7HD4oqlBxapgEsg5A8VXs5ll'
      }
    ]
  }
];

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  let [day, month, year] = parts;
  if (year.length === 2) year = '20' + year;
  return new Date(`${year}-${month}-${day}`);
}

function parseList(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim().replace(/\s*\/\s*/g, '/'));
}

async function importSchedules() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected.');

    const grouped = {};
    for (const row of scheduleDataRaw) {
      if (!grouped[row.soNumber]) {
        grouped[row.soNumber] = {
          soNumber: row.soNumber,
          poNumber: row.poNumber,
          partyName: row.partyName,
          items: []
        };
      }
      grouped[row.soNumber].items.push(row);
    }

    for (const soNumber in grouped) {
      const data = grouped[soNumber];
      console.log(`Processing Schedule for SO: ${soNumber}...`);

      const order = await SalesOrder.findOne({ soNumber });
      const party = await Party.findOne({ name: data.partyName });

      const scheduleItems = [];
      for (const itemRow of data.items) {
        const sku = await Sku.findOne({ code: itemRow.skuCode });
        
        const phases = itemRow.phases.map((p, idx) => {
          const actualDates = parseList(p.actualDates);
          const actualQtys = parseList(p.actualQtys).map(q => Number(q.replace(/[^\d]/g, '')) || 0);
          const invoices = parseList(p.invoices);
          const invDates = parseList(p.invDates);
          const docs = parseList(p.docs);

          const actualDispatches = actualDates.map((date, i) => ({
            date: parseDate(date),
            qty: actualQtys[i] || 0,
            invoiceNo: invoices[i] || '',
            invoiceDate: parseDate(invDates[i]),
            invoiceDoc: docs[i] || ''
          }));

          const totalActualQty = actualDispatches.reduce((sum, d) => sum + d.qty, 0);

          return {
            phaseNo: `P${idx + 1}`,
            plannedDate: parseDate(p.plannedDate),
            plannedQty: p.plannedQty,
            actualDispatches,
            totalActualQty,
            status: totalActualQty >= p.plannedQty ? 'COMPLETE' : totalActualQty > 0 ? 'PARTIAL' : 'PENDING'
          };
        });

        scheduleItems.push({
          skuId: sku?._id,
          skuName: itemRow.skuName,
          skuCode: itemRow.skuCode,
          poQty: itemRow.orderQty,
          dispatchedQty: phases.reduce((sum, p) => sum + p.totalActualQty, 0),
          balanceQty: itemRow.orderQty - phases.reduce((sum, p) => sum + p.totalActualQty, 0),
          phases
        });
      }

      await DispatchSchedule.findOneAndUpdate(
        { soNumber },
        {
          $set: {
            poNumber: data.poNumber,
            partyId: party?._id,
            partyName: data.partyName,
            orderId: order?._id,
            items: scheduleItems,
            status: 'ACTIVE'
          }
        },
        { upsert: true, new: true }
      );
    }

    console.log('Successfully imported Advanced Dispatch Schedules.');
  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

importSchedules();
