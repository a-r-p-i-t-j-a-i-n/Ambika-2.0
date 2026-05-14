import dotenv from 'dotenv';
dotenv.config();

import connectDB from '../config/db.js';
import SKU from '../modules/skus/sku.model.js';
import { logger } from '../utils/logger.js';

const skuMasterItems = [
  {
    name: 'PP Wet',
    code: 'PP1500-202',
    category: 'PP Jar',
    pcsPerBox: 120,
    weightPerPc: 0.266,
  },
  {
    name: 'PP Dry',
    code: 'PP1000-202',
    category: 'PP Jar',
    pcsPerBox: 120,
    weightPerPc: 0.233,
    aliases: ['PP-DRY'],
  },
  {
    name: 'PP Chutney',
    code: 'PP0400-202',
    category: 'PP Jar',
    pcsPerBox: 180,
    weightPerPc: 0.1317,
    aliases: ['PP-CHUTNEY'],
  },
  {
    name: 'PP Flat Wet',
    code: 'PF1500-202',
    category: 'PP Flat',
    pcsPerBox: 120,
    weightPerPc: 0.266,
  },
  {
    name: 'PP Flat Dry',
    code: 'PF1000-202',
    category: 'PP Flat',
    pcsPerBox: 120,
    weightPerPc: 0.233,
    aliases: ['PPF-DRY'],
  },
  {
    name: 'PP Flat Chutney',
    code: 'PF0600-202',
    category: 'PP Flat',
    pcsPerBox: 180,
  },
  {
    name: 'VA Wet',
    code: 'VA1500-202',
    category: 'VA Jar',
    pcsPerBox: 120,
    weightPerPc: 0.266,
    aliases: ['VA-WET'],
  },
  {
    name: 'VA Dry',
    code: 'VA1000-202',
    category: 'VA Jar',
    pcsPerBox: 120,
  },
  {
    name: 'VA Chutney',
    code: 'VA0400-202',
    category: 'VA Jar',
    pcsPerBox: 180,
  },
  {
    name: 'Value Flat Wet',
    code: 'VF1500-202',
    category: 'Value Flat',
    pcsPerBox: 120,
    weightPerPc: 0.266,
    aliases: ['VF-WET'],
  },
  {
    name: 'Value Flat Dry',
    code: 'VF1000-202',
    category: 'Value Flat',
    pcsPerBox: 120,
  },
  {
    name: 'Value Flat Chutney',
    code: 'VF0400-202',
    category: 'Value Flat',
    pcsPerBox: 180,
  },
  {
    name: 'Steele 1.5 Ltr',
    code: 'ST1500-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.27,
  },
  {
    name: 'Steele 1.0 Ltr',
    code: 'ST1000-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.187,
  },
  {
    name: 'Galaxy 1.5 Ltr',
    code: 'GX1500-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.27,
  },
  {
    name: 'Galaxy 1.0 Ltr',
    code: 'GX1000-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.187,
  },
  {
    name: 'Chutney Katori',
    code: 'CK0600-204',
    category: 'Katori',
    pcsPerBox: 144,
    weightPerPc: 0.1514,
    aliases: ['CHUT-KAT'],
  },
  {
    name: 'Grinder Jar',
    code: 'GJ1000-204',
    category: 'Jar',
    pcsPerBox: 126,
    weightPerPc: 0.2445,
    aliases: ['GRIND-JAR'],
  },
  {
    name: 'Grinder Jar - DD',
    code: 'GJ1000-202',
    category: 'Jar',
    pcsPerBox: 120,
  },
  {
    name: 'Dome Jar',
    code: 'DJ1500-204',
    category: 'Jar',
    pcsPerBox: 105,
    weightPerPc: 0.3307,
    aliases: ['DOME-JAR'],
  },
  {
    name: 'Flat Jar',
    code: 'FJ1000-204',
    category: 'Jar',
    pcsPerBox: 120,
    weightPerPc: 0.275,
    aliases: ['FLAT-JAR'],
  },
  {
    name: 'Nano Dome Jar',
    code: 'ND1500-204',
    category: 'Nano Jar',
    pcsPerBox: 100,
  },
  {
    name: 'Nano Flat Jar',
    code: 'NF1000-204',
    category: 'Nano Jar',
    pcsPerBox: 100,
  },
  {
    name: 'Nano Chutney Jar',
    code: 'NC0400-204',
    category: 'Nano Jar',
    pcsPerBox: 100,
  },
  {
    name: 'MA Wet Jar',
    code: 'MA1500-204',
    category: 'MA Jar',
    pcsPerBox: 100,
  },
  {
    name: 'MA Dry Jar',
    code: 'MA1000-204',
    category: 'MA Jar',
    pcsPerBox: 100,
  },
  {
    name: 'MA Chutney Jar',
    code: 'MA0400-204',
    category: 'MA Jar',
    pcsPerBox: 100,
  },
  {
    name: 'MG 1.1 Wet Jar Celum',
    code: 'MG1650-304',
    category: 'MG Jar',
    pcsPerBox: 120,
    aliases: ['MG 1.1 Wet Jar', 'MG11-WET'],
  },
  {
    name: 'MG 1.1 Wet Jar',
    code: 'MG1650-204',
    category: 'MG Jar',
    pcsPerBox: 120,
  },
  {
    name: 'MG 1.1 Dry Jar Celum',
    code: 'MG1100-304',
    category: 'MG Jar',
    pcsPerBox: 120,
  },
  {
    name: 'MG 1.1 Dry Jar',
    code: 'MG1100-204',
    category: 'MG Jar',
    pcsPerBox: 120,
  },
  {
    name: 'MG 1.1 Chutney Jar',
    code: 'MG0500-204',
    category: 'MG Jar',
    pcsPerBox: 120,
  },
  {
    name: 'Bowl 2.0 Ltr',
    code: 'BO2000-202',
    category: 'Bowl',
    pcsPerBox: 100,
  },
  {
    name: 'Taper Jar - Bidding 1.5 Ltr',
    code: 'TB1500-204',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.25,
  },
  {
    name: 'Taper Jar - Bidding 1.0 Ltr',
    code: 'TB1000-204',
    category: 'Mixer Jar',
    pcsPerBox: 100,
  },
  {
    name: 'Taper Jar - Patti 1.5 Ltr',
    code: 'TP1500-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
  },
  {
    name: 'Taper Jar - Patti 1.0 Ltr',
    code: 'TP1000-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
  },
  {
    name: 'Taper Jar - Patti 0.750 Ltr',
    code: 'TP0750-202',
    category: 'Mixer Jar',
    pcsPerBox: 100,
    weightPerPc: 0.15,
  },
];

const run = async () => {
  await connectDB();

  let created = 0;
  let updated = 0;

  for (const item of skuMasterItems) {
    const code = item.code.trim().toUpperCase();
    const result = await SKU.findOneAndUpdate(
      { code },
      {
        $set: {
          ...item,
          code,
          unit: item.unit || 'PCS',
          isActive: true,
          isDeleted: false,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        rawResult: true,
      },
    );

    if (result.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  logger.info(`SKU master bulk upsert complete. Total: ${skuMasterItems.length}, Created: ${created}, Updated: ${updated}`);
  process.exit(0);
};

run().catch((err) => {
  logger.error(`SKU master bulk upsert failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
