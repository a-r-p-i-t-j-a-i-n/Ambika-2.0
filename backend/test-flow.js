import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from './src/modules/clients/client.model.js';
import SKU from './src/modules/skus/sku.model.js';
import PurchaseOrder from './src/modules/purchase-orders/purchase-order.model.js';
import SalesOrder from './src/modules/sales-orders/sales-order.model.js';
import * as poService from './src/modules/purchase-orders/purchase-order.service.js';

dotenv.config();

async function testFlow() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/dpes');
    console.log('📦 Connected to Database');

    // 1. Create Client
    const client = await Client.create({
      companyName: 'Ambika Global Demo Client',
      code: 'AGL-DEMO-001',
      addresses: [{ line1: '123 Test St', city: 'Mumbai', state: 'MH', pin: '400001' }]
    });
    console.log('✅ 1. Client created:', client.code);

    // 2. Create SKU
    const sku = await SKU.create({
      clientId: client._id,
      name: 'Industrial Widget Alpha',
      code: 'IWA-500',
      pcsPerBox: 25
    });
    console.log('✅ 2. SKU created:', sku.code);

    // 3. Create PO
    const po = await PurchaseOrder.create({
      clientId: client._id,
      poNumber: 'PO-DEMO-2026',
      poDate: new Date(),
      orderLines: [{
        skuId: sku._id,
        orderedQty: 10000
      }]
    });
    console.log('✅ 3. Purchase Order created:', po.poNumber);

    // 4. Auto Generate SO
    const so = await poService.generateSalesOrder(po._id, null);
    console.log('✅ 4. Auto-Generated Sales Order:', so.soNumber);

    console.log('\n🎉 E2E Master Data & PO->SO Flow verified successfully!');
    
    // Clean up
    await SalesOrder.deleteOne({ _id: so._id });
    await PurchaseOrder.deleteOne({ _id: po._id });
    await SKU.deleteOne({ _id: sku._id });
    await Client.deleteOne({ _id: client._id });
    console.log('🧹 Cleaned up test data.');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

testFlow();
