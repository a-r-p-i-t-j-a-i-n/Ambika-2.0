import mongoose from 'mongoose';
import env from '../config/env.js';
import Party from '../modules/clients/party.model.js';
import Sku from '../modules/skus/sku.model.js';
import User from '../modules/auth/auth.model.js';

const mittalData = {
  party: {
    code: 'MITTAL',
    name: 'Mittal Electronics',
    location: 'Delhi',
    state: 'Delhi',
    addresses: [{
      label: 'Primary',
      line1: '38 SSI Industrial Area, G T Karnal Road',
      line2: 'Jahagir Puri Metro Station, Near Piller No 144',
      city: 'Delhi',
      state: 'Delhi',
      pin: '110033'
    }],
    creditPeriodDays: 30,
    leadTimeDays: 20,
    toEmails: ['purchase@sujatamail.com', 'purchase1@sujatamail.com', 'ea3@sujatamail.com'],
    ccEmails: ['gaurav@msambikaglobal.in'],
    bccEmails: ['agl.mailout@gmail.com'],
    isActive: true
  },
  skus: [
    {
      code: 'GJ1000-204',
      name: 'Grinder Jar',
      unit: 'Pcs',
      pcsPerBox: 126,
      weightPerBox: 30.80,
      leadDays: 5
    },
    {
      code: 'CK0600-204',
      name: 'Chutney Katori',
      unit: 'Pcs',
      pcsPerBox: 144,
      weightPerBox: 21.80,
      leadDays: 5
    },
    {
      code: 'DJ1500-204',
      name: 'Dome Jar',
      unit: 'Pcs',
      pcsPerBox: 105,
      weightPerBox: 34.80,
      leadDays: 5
    }
  ]
};

async function importData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected.');

    // Get a user for auditing
    const adminUser = await User.findOne({ role: 'ADMIN' }) || await User.findOne();
    const userId = adminUser?._id;

    if (!userId) {
      console.warn('No user found for auditing. Activity timeline will have null actorId.');
    }

    // 1. Upsert Party
    console.log(`Upserting Party: ${mittalData.party.name}...`);
    const party = await Party.findOneAndUpdate(
      { code: mittalData.party.code },
      { 
        $set: { ...mittalData.party, updatedBy: userId },
        $push: { 
          activityTimeline: {
            action: 'UPDATE',
            description: 'Imported/Updated from Excel data',
            actorId: userId,
            timestamp: new Date()
          }
        }
      },
      { upsert: true, new: true, runValidators: true }
    );
    console.log(`Party ${party.code} ready.`);

    // 2. Upsert SKUs
    for (const skuData of mittalData.skus) {
      console.log(`Upserting SKU: ${skuData.code} (${skuData.name})...`);
      await Sku.findOneAndUpdate(
        { code: skuData.code },
        { 
          $set: { 
            ...skuData, 
            clientId: party._id, // linking to party
            updatedBy: userId 
          },
          $push: {
            activityTimeline: {
              action: 'UPDATE',
              description: 'Imported/Updated from Excel data',
              actorId: userId,
              timestamp: new Date()
            }
          }
        },
        { upsert: true, new: true, runValidators: true }
      );
    }

    console.log('Successfully imported Mittal Electronics data and SKUs.');
  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

importData();
