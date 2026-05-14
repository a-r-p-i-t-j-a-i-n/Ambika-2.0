import XLSX from 'xlsx';
import path from 'path';
import mongoose from 'mongoose';
import env from '../config/env.js';
import Party from '../modules/clients/party.model.js';
import Sku from '../modules/skus/sku.model.js';
import User from '../modules/auth/auth.model.js';

const filePath = path.resolve('src/sheets/c;ient details.xlsx');

const PARTY_CODE_MAP = {
  'Versuni India Home Solutions Limited': 'VERSUNI',
  'Epack Durable Ltd': 'EPACK',
  'Mittal Electronics': 'MITTAL',
  'Elin Electronics Limited.': 'ELIN',
  'Maya Appliances Pvt. Ltd.': 'MAYA',
  'Atomberg Technologies Pvt. Ltd.': 'ATOMBERG'
};

function generatePartyCode(name) {
  if (PARTY_CODE_MAP[name]) return PARTY_CODE_MAP[name];
  // Generate acronym or first word
  return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 10);
}

function parseEmails(emailStr) {
  if (!emailStr) return [];
  return emailStr.split(',').map(e => e.trim().toLowerCase()).filter(e => e);
}

async function runImport() {
  try {
    console.log('🚀 Starting Bulk Import from Excel...');
    await mongoose.connect(env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    const adminUser = await User.findOne({ role: 'ADMIN' }) || await User.findOne();
    const userId = adminUser?._id;

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📊 Found ${data.length} rows in Excel.`);

    const partyMap = new Map(); // name -> docId

    for (const row of data) {
      const clientName = row['Client Name'];
      if (!clientName) continue;

      // 1. Handle Party
      if (!partyMap.has(clientName)) {
        const partyCode = generatePartyCode(clientName);
        console.log(`👤 Processing Party: ${clientName} (${partyCode})`);
        
        const toEmails = parseEmails(row['To Email Address']);
        const ccEmails = parseEmails(row['CC Email Address']);
        const bccEmails = parseEmails(row['BCC Email Address']);

        const addressRaw = row['Address'] || '';
        const addresses = [];
        if (addressRaw) {
          addresses.push({
            label: 'Primary',
            line1: addressRaw.split('\n')[0].trim(),
            line2: addressRaw.split('\n').slice(1).join(', ').trim(),
            city: row['Place'] || '',
            state: row['Place'] || '', // Fallback
          });
        }

        const partyDoc = await Party.findOneAndUpdate(
          { name: clientName },
          {
            $set: {
              code: partyCode,
              location: row['Place'],
              state: row['Place'],
              toEmails,
              ccEmails,
              bccEmails,
              creditPeriodDays: parseInt(row['Credit Period']) || 30,
              addresses,
              updatedBy: userId,
              isActive: true
            },
            $push: {
              activityTimeline: {
                action: 'UPDATE',
                description: 'Bulk imported/updated from Excel',
                actorId: userId,
                timestamp: new Date()
              }
            }
          },
          { upsert: true, new: true }
        );
        partyMap.set(clientName, partyDoc._id);
      }

      // 2. Handle SKU
      const skuName = row['SKU'];
      const skuCode = row['SKU Code'];
      if (skuName) {
        // If SKU Code is missing, generate one from name + clientCode
        const finalSkuCode = skuCode || `${generatePartyCode(clientName)}-${skuName.replace(/\s+/g, '-').toUpperCase()}`;
        
        console.log(`  📦 SKU: ${skuName} [${finalSkuCode}]`);

        // Pcs Per Box might have " Pcs" suffix in string, Weight might have " Kgs"
        const pcsPerBox = parseInt(String(row['Pcs Per Box']).replace(/[^0-9]/g, '')) || 1;
        const weightPerBox = parseFloat(String(row['Weight Per Box']).replace(/[^\d.]/g, '')) || 0;
        const leadDays = parseInt(row['Approx Days']) || 7;

        await Sku.findOneAndUpdate(
          { code: finalSkuCode },
          {
            $set: {
              name: skuName,
              clientId: partyMap.get(clientName),
              unit: row['Unit'] || 'Pcs',
              pcsPerBox,
              weightPerBox,
              leadDays,
              updatedBy: userId,
              isActive: true
            },
            $push: {
              activityTimeline: {
                action: 'UPDATE',
                description: 'Bulk imported/updated from Excel',
                actorId: userId,
                timestamp: new Date()
              }
            }
          },
          { upsert: true }
        );
      }
    }

    console.log('✅ Bulk Import Completed Successfully!');
  } catch (error) {
    console.error('❌ Import Failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runImport();
