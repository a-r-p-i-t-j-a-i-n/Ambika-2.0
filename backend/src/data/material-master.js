/**
 * MATERIAL MASTER — Raw Materials & Consumables
 * ════════════════════════════════════════════════════════════════════
 *
 * Source: client's "Master Sheet" (Material / SKU Codes / Description).
 * This file is the single, reviewable source of truth for the buy-side
 * items that `scripts/importMaterialMaster.js` loads into the `skus`
 * collection.
 *
 * SCOPE — this file intentionally contains ONLY:
 *     • RAW_MATERIAL  (7 items)
 *     • CONSUMABLE    (106 items)
 *     • PACKING       (68 items)
 *   It does NOT contain Finished Goods or Circles:
 *     • Finished Goods — already in the database.
 *     • Circles — excluded by client instruction.
 *
 * DATA DECISIONS applied here (see DATA_NOTES at the bottom):
 *   1. "Green Pad - Fiber" appeared twice with two codes (CO-GF-00-00 and
 *      CO-GP-FB-00). It is one physical item — kept once as CO-GF-00-00
 *      with CO-GP-FB-00 recorded as an alias.
 *   2. The 5 "WPS Pomex Material" rows had a blank code. Stable codes were
 *      generated from their size (OD + length) and flagged `codeGenerated`.
 *   3. Packing: PK-PP10-BX was used for two different items. It is assigned
 *      to "PP Dry Box"; the mis-coded "1.0 Ltr SG Box" row was dropped — its
 *      correct code PK-SG10-BX is kept.
 *   4. Packing: duplicate Tapper-Jar rows and 6 blank-code MG box/partition
 *      rows were dropped — the coded originals are kept.
 *
 * Fields per item:
 *   name          display name
 *   code          unique SKU code (UPPER-CASE, trimmed by the importer)
 *   itemType      RAW_MATERIAL | CONSUMABLE  (applied per section below)
 *   category      sub-group within the itemType (drives the UI chips)
 *   unit          stock-keeping unit (PCS default; KGS / LTR where natural)
 *   aliases       optional alternate codes / names
 *   codeGenerated optional — true when the importer should report the code
 *                 as auto-generated (no code existed in the source sheet)
 */

const withDefaults = (itemType) => (row) => ({
  unit: 'PCS',
  aliases: [],
  codeGenerated: false,
  ...row,
  itemType,
});

// ── RAW MATERIAL ─────────────────────────────────────────────────────
// DD = Deep-Drawing steel grade, Cu = copper-bearing grade. Bought by weight.
const RAW_MATERIALS = [
  { name: 'DD 0.80 mm', code: 'JSL202-08', category: 'DD Steel', unit: 'KGS' },
  { name: 'DD 0.70 mm', code: 'JSL202-07', category: 'DD Steel', unit: 'KGS' },
  { name: 'DD 0.60 mm', code: 'JSL202-06', category: 'DD Steel', unit: 'KGS' },
  { name: 'Cu 0.80 mm', code: 'JSL204-08', category: 'Copper',   unit: 'KGS' },
  { name: 'Cu 0.70 mm', code: 'JSL204-07', category: 'Copper',   unit: 'KGS' },
  { name: 'Cu 0.60 mm', code: 'JSL204-06', category: 'Copper',   unit: 'KGS' },
  { name: 'Cu 1.00 mm', code: 'JSL204-10', category: 'Copper',   unit: 'KGS' },
].map(withDefaults('RAW_MATERIAL'));

// ── CONSUMABLE ───────────────────────────────────────────────────────
const CONSUMABLES = [
  // Buffing Wheel ─────────────────────────────────────────────────────
  { name: 'Side Buff - Bharat', code: 'CO-SB-15-02', category: 'Buffing Wheel' },
  { name: 'Buff - 3"',          code: 'CO-BF-30-00', category: 'Buffing Wheel' },
  { name: 'Buff - 3.5"',        code: 'CO-BF-35-00', category: 'Buffing Wheel' },
  { name: 'Buff - 5"',          code: 'CO-BF-50-00', category: 'Buffing Wheel' },
  { name: 'Buff - 4.5"',        code: 'CO-BF-45-00', category: 'Buffing Wheel' },
  { name: 'Buff - 4"',          code: 'CO-BF-40-00', category: 'Buffing Wheel' },
  { name: 'Khila Buff - 3.5"',  code: 'CO-KB-35-00', category: 'Buffing Wheel' },
  { name: 'Khila Buff - 4.5"',  code: 'CO-KB-45-00', category: 'Buffing Wheel' },
  { name: 'Khila Buff - 4"',    code: 'CO-KB-40-00', category: 'Buffing Wheel' },
  { name: 'Khila Buff - 5"',    code: 'CO-KB-50-00', category: 'Buffing Wheel' },
  { name: 'Jeans Buff - 8"',    code: 'CO-JB-80-00', category: 'Buffing Wheel' },
  { name: 'Cotton Buff',        code: 'CO-CB-00-00', category: 'Buffing Wheel' },

  // Brush ─────────────────────────────────────────────────────────────
  { name: 'Brush 7"',                                code: 'CO-BS-70-00', category: 'Brush' },
  { name: 'Brush - 5"',                              code: 'CO-BS-50-00', category: 'Brush' },
  { name: 'Brush - 4.5"',                            code: 'CO-BS-45-00', category: 'Brush' },
  { name: 'Lokhand Brush 800 grm. 45 No. (7X2)',     code: 'CO-LK-80-45', category: 'Brush' },
  { name: 'Lokhand Brush 600 grm. 45 No',            code: 'CO-LK-60-45', category: 'Brush' },
  { name: 'Lokhand Brush 1000 grm. 35 No. (5X2)',    code: 'CO-LK-10-35', category: 'Brush' },
  { name: 'Lokhand Brush 800 grm. 35 No. (5X2)',     code: 'CO-LK-80-35', category: 'Brush' },
  { name: 'Lokhand Brush 800 grm. (8X2)',            code: 'CO-LK-80-82', category: 'Brush' },
  { name: 'Lokhand Brush 700 grm. (7X2)',            code: 'CO-LK-70-72', category: 'Brush' },
  { name: 'Lokhand Brush 1000 grm. 35 No. (8X2)',    code: 'CO-LK-10-82', category: 'Brush' },
  { name: 'Lokhand Brush 700 grm. (8X2)',            code: 'CO-LK-70-82', category: 'Brush' },
  { name: 'Tar Brush 1000 grm.',                     code: 'CO-TB-10-00', category: 'Brush' },
  { name: 'Tar Brush 900 grm.',                      code: 'CO-TB-90-00', category: 'Brush' },
  { name: 'Tar Brush 800 grm.',                      code: 'CO-TB-80-00', category: 'Brush' },
  { name: 'Tar Brush 700 grm.',                      code: 'CO-TB-70-00', category: 'Brush' },

  // Abrasive (flap wheels, polish paper, fiber, pads, pomex) ───────────
  { name: 'Fiber',           code: 'CO-FB-14-02', category: 'Abrasive' },
  {
    name: 'Green Pad - Fiber', code: 'CO-GF-00-00', category: 'Abrasive',
    aliases: ['CO-GP-FB-00'], // merged duplicate row — see DATA_NOTES #1
  },
  { name: 'FW - 120No 6 X 2',  code: 'CO-FW-12-62',  category: 'Abrasive' },
  { name: 'FW - 120No 6 X 1',  code: 'CO-FW-12-61',  category: 'Abrasive' },
  { name: 'FW - 120No 8 X 1',  code: 'CO-FW-12-81',  category: 'Abrasive' },
  { name: 'FW - 220No 3 X 1',  code: 'CO-FW-22-31',  category: 'Abrasive' },
  { name: 'FW - 220No 6 X 1',  code: 'CO-FW-22-61',  category: 'Abrasive' },
  { name: 'FW - 220No 6 X 2',  code: 'CO-FW-22-62',  category: 'Abrasive' },
  { name: 'FW - 220No 12 X 2', code: 'CO-FW-22-122', category: 'Abrasive' },
  { name: 'FW - 320No 3 X 1',  code: 'CO-FW-32-31',  category: 'Abrasive' },
  { name: 'FW - 320No 6 X 1',  code: 'CO-FW-32-61',  category: 'Abrasive' },
  { name: 'FW - 320No 6 X 2',  code: 'CO-FW-32-62',  category: 'Abrasive' },
  { name: 'FW - 320No 12 X 2', code: 'CO-FW-32-122', category: 'Abrasive' },
  { name: 'FW - 400No 3 X 1',  code: 'CO-FW-40-31',  category: 'Abrasive' },
  { name: 'FW - 400No 12 X 2', code: 'CO-FW-40-122', category: 'Abrasive' },
  { name: 'FW - 600No 3 X 1',  code: 'CO-FW-60-31',  category: 'Abrasive' },
  { name: 'FW - 600No 12 X 2', code: 'CO-FW-60-122', category: 'Abrasive' },
  { name: 'Polish Paper - Hemri Roll - 120No', code: 'CO-PP-HR-12', category: 'Abrasive' },
  { name: 'Polish Paper - Hemri Roll - 220No', code: 'CO-PP-HR-22', category: 'Abrasive' },
  { name: 'Polish Paper - Hemri Roll - 320No', code: 'CO-PP-HR-32', category: 'Abrasive' },
  { name: 'Polish Paper - Belt - 120No',       code: 'CO-PP-BE-12', category: 'Abrasive' },
  { name: 'Grinder wheel', code: 'CO-GW-00-00', category: 'Abrasive' },
  {
    name: 'WPS Pomex Material - OD 190mm X Length - 2½"', code: 'CO-WPS-190-25',
    category: 'Abrasive', codeGenerated: true,
  },
  {
    name: 'WPS Pomex Material - OD 155mm X Length - 2"', code: 'CO-WPS-155-20',
    category: 'Abrasive', codeGenerated: true,
  },
  {
    name: 'WPS Pomex Material - OD 160mm X Length - 2½"', code: 'CO-WPS-160-25',
    category: 'Abrasive', codeGenerated: true,
  },
  {
    name: 'WPS Pomex Material - OD 140mm X Length - 2½"', code: 'CO-WPS-140-25',
    category: 'Abrasive', codeGenerated: true,
  },
  {
    name: 'WPS Pomex Material - OD 6" X Length - 3"', code: 'CO-WPS-006-30',
    category: 'Abrasive', codeGenerated: true,
  },

  // Polishing Compound ────────────────────────────────────────────────
  { name: 'Shriwari (Green Powder)', code: 'CO-GP-00-00', category: 'Polishing Compound', unit: 'KGS' },
  { name: 'Yellow Powder',           code: 'CO-YP-00-00', category: 'Polishing Compound', unit: 'KGS' },

  // Chemical & Oil ────────────────────────────────────────────────────
  { name: 'Chuna',                        code: 'CO-CN-00-00', category: 'Chemical & Oil', unit: 'KGS' },
  { name: 'Deep Drawing White Chemical',  code: 'CO-DD-WC-00', category: 'Chemical & Oil', unit: 'KGS' },
  { name: 'Deep Drawing Yellow Chemical', code: 'CO-DD-YC-00', category: 'Chemical & Oil', unit: 'KGS' },
  { name: 'Deep Drawing Green Chemical',  code: 'CO-GO-00-00', category: 'Chemical & Oil', unit: 'KGS' },
  { name: 'Press Oil',                    code: 'CO-PO-00-00', category: 'Chemical & Oil', unit: 'LTR' },
  { name: 'Black Oil',                    code: 'CO-BO-00-00', category: 'Chemical & Oil', unit: 'LTR' },
  { name: 'Rolling Oil',                  code: 'CO-RO-00-00', category: 'Chemical & Oil', unit: 'LTR' },
  { name: 'Grease',                       code: 'CO-GR-00-00', category: 'Chemical & Oil', unit: 'KGS' },

  // Bearing ───────────────────────────────────────────────────────────
  { name: 'Bearing - 30204', code: 'CO-BR-30-204', category: 'Bearing' },
  { name: 'Bearing - 32212', code: 'CO-BR-32-212', category: 'Bearing' },
  { name: 'Bearing - 32213', code: 'CO-BR-32-213', category: 'Bearing' },
  { name: 'Bearing - 32214', code: 'CO-BR-32-214', category: 'Bearing' },
  { name: 'Bearing - 32210', code: 'CO-BR-32-210', category: 'Bearing' },
  { name: 'Bearing - 32211', code: 'CO-BR-32-211', category: 'Bearing' },
  { name: 'Bearing - 6308',  code: 'CO-BR-63-08',  category: 'Bearing' },
  { name: 'Bearing - 05',    code: 'CO-BR-00-05',  category: 'Bearing' },
  { name: 'Bearing - 06',    code: 'CO-BR-00-06',  category: 'Bearing' },
  { name: 'Bearing - 08',    code: 'CO-BR-00-08',  category: 'Bearing' },
  { name: 'Bearing - 09',    code: 'CO-BR-00-09',  category: 'Bearing' },

  // V-Belt ────────────────────────────────────────────────────────────
  { name: 'Belt B-70',  code: 'CO-BT-B-070', category: 'V-Belt' },
  { name: 'Belt B-71',  code: 'CO-BT-B-071', category: 'V-Belt' },
  { name: 'Belt B-74',  code: 'CO-BT-B-074', category: 'V-Belt' },
  { name: 'Belt B-75',  code: 'CO-BT-B-075', category: 'V-Belt' },
  { name: 'Belt B-76',  code: 'CO-BT-B-076', category: 'V-Belt' },
  { name: 'Belt B-77',  code: 'CO-BT-B-077', category: 'V-Belt' },
  { name: 'Belt B-78',  code: 'CO-BT-B-078', category: 'V-Belt' },
  { name: 'Belt B-85',  code: 'CO-BT-B-085', category: 'V-Belt' },
  { name: 'Belt B-112', code: 'CO-BT-B-112', category: 'V-Belt' },
  { name: 'Belt B-126', code: 'CO-BT-B-126', category: 'V-Belt' },
  { name: 'Belt B-140', code: 'CO-BT-B-140', category: 'V-Belt' },
  { name: 'Belt C-71',  code: 'CO-BT-C-071', category: 'V-Belt' },

  // Tooling ───────────────────────────────────────────────────────────
  { name: 'Cutting Tool',     code: 'CO-CT-00-00', category: 'Tooling' },
  { name: 'Lathe Tool',       code: 'CO-LT-00-00', category: 'Tooling' },
  { name: 'File',             code: 'CO-FL-00-00', category: 'Tooling' },
  { name: 'Hand Grinder',     code: 'CO-HG-00-00', category: 'Tooling' },
  { name: 'Goni Tapper',      code: 'CO-GT-14-02', category: 'Tooling' },
  { name: 'Bal Black Tapper', code: 'BB-BT-00-00', category: 'Tooling' },

  // Shop General (housekeeping / safety / misc.) ──────────────────────
  { name: 'Yellow Duster',               code: 'CO-YD-00-00', category: 'Shop General' },
  { name: 'Life Buoy Soap',              code: 'CO-LB-00-00', category: 'Shop General' },
  { name: 'Sargam Soap',                 code: 'CO-SG-SP-00', category: 'Shop General' },
  { name: 'Raju Gota Soap',              code: 'CO-RG-SP-00', category: 'Shop General' },
  { name: 'Wooden bhoosa',               code: 'CO-WB-00-00', category: 'Shop General', unit: 'KGS' },
  { name: 'Handgloves - Blue',           code: 'CO-HG-BL-00', category: 'Shop General' },
  { name: 'Handgloves - White',          code: 'CO-HG-WT-00', category: 'Shop General' },
  { name: 'Handgloves - Blue (2nd hand)', code: 'CO-HG-02-00', category: 'Shop General' },
  { name: 'Cotton Chindhi',              code: 'CO-CC-00-00', category: 'Shop General', unit: 'KGS' },
  { name: 'Cotton Cloth',                code: 'CO-CL-00-00', category: 'Shop General', unit: 'KGS' },
  { name: 'Jute Bag',                    code: 'CO-JB-00-00', category: 'Shop General' },
  { name: 'Chun (40 x 55)',              code: 'CO-CH-55-40', category: 'Shop General' },
  { name: 'Blue Mats',                   code: 'CO-BL-MT-00', category: 'Shop General' },
].map(withDefaults('CONSUMABLE'));

// ── PACKING ──────────────────────────────────────────────────────────
const PACKING = [
  // Carton Box ────────────────────────────────────────────────────────
  { name: 'PP Liquid Box (750 x 455 x 390)',                   code: 'PK-PP15-BX',   category: 'Carton Box' },
  { name: 'PP Dry Box (PP1000) (750 x 455 x 340)',             code: 'PK-PP10-BX',   category: 'Carton Box' },
  { name: 'Flat Jar Box (FJ1000) (750 x 455 x 340)',           code: 'PK-FJ10-BX',   category: 'Carton Box' },
  { name: 'Grinder Jar Box (16 x 16 x 20 1/8) (126 pcs)',      code: 'PK-GJ10-BX',   category: 'Carton Box' },
  { name: 'PP Chutney Box (26 x 15 1/4 x 14.5)',               code: 'PK-PP04-BX',   category: 'Carton Box' },
  { name: 'Dome Jar Box (810 x 475 x 370)',                    code: 'PK-DJ15-BX',   category: 'Carton Box' },
  { name: 'Chutney Katori Box (29 x 14.5 x 23)',               code: 'PK-CK06-BX',   category: 'Carton Box' },
  { name: '1.5 Ltr SG Box (30 x 12.25 x 17.38)',               code: 'PK-SG15-BX',   category: 'Carton Box' },
  { name: '1.0 Ltr SG Box (26.50 x 10.50 x 16.25)',            code: 'PK-SG10-BX',   category: 'Carton Box' },
  { name: '1.0 Ltr Tapper Jar Dry Box (27.50 x 11.50 x 16.5)', code: 'PK-TD10-BX',   category: 'Carton Box' },
  { name: '1.5 Ltr Tapper Jar Wet Box (30 x 12.50 x 18)',      code: 'PK-TL15-BX',   category: 'Carton Box' },
  { name: 'Bowl Box (602 x 602 x 540)',                        code: 'PK-BW00-BX',   category: 'Carton Box' },
  { name: '1.65 Ltr MG Box (650 x 330 x 380)',                 code: 'PK--MG165-BX', category: 'Carton Box' },
  { name: '1.1 Ltr MG Box (592 x 447 x 368)',                  code: 'PK--MG11-BX',  category: 'Carton Box' },
  { name: '0.5 Ltr MG Box (592 x 447 x 340)',                  code: 'PK--MG05-BX',  category: 'Carton Box' },
  { name: 'MA Wet Box (605 x 310 x 392)',                      code: 'PK-MA15-BX',   category: 'Carton Box' },
  { name: 'MA Dry Box (532 x 400 x 390)',                      code: 'PK-MA10-BX',   category: 'Carton Box' },
  { name: 'MA Chutney Box (532 x 400 x 405)',                  code: 'PK-MA04-BX',   category: 'Carton Box' },

  // Partition ─────────────────────────────────────────────────────────
  { name: 'PP Liquid Partition',              code: 'PK-PP15-PT',   category: 'Partition' },
  { name: 'PP Dry Partition',                 code: 'PK-PP10-PT',   category: 'Partition' },
  { name: 'Flat Jar Partition',               code: 'PK-FJ10-PT',   category: 'Partition' },
  { name: 'Grinder Jar Partition',            code: 'PK-GJ10-PT',   category: 'Partition' },
  { name: 'PP Chutney Partition',             code: 'PK-PP04-PT',   category: 'Partition' },
  { name: 'Dome Jar Partition',               code: 'PK-DJ15-PT',   category: 'Partition' },
  { name: 'Chutney Katori Partition',         code: 'PK-CK06-PT',   category: 'Partition' },
  { name: '1.5 Ltr SG Partition',             code: 'PK-SG15-PT',   category: 'Partition' },
  { name: '1.0 Ltr SG Partition',             code: 'PK-SG10-PT',   category: 'Partition' },
  { name: '1.0 Ltr Tapper Jar Dry Partition', code: 'PK-TD10-PT',   category: 'Partition' },
  { name: '1.5 Ltr Tapper Jar Wet Partition', code: 'PK-TL15-PT',   category: 'Partition' },
  { name: 'Bowl Partition',                   code: 'PK-BW00-PT',   category: 'Partition' },
  { name: '1.65 Ltr MG Partition',            code: 'PK--MG165-PT', category: 'Partition' },
  { name: '1.1 Ltr MG Partition',             code: 'PK--MG11-PT',  category: 'Partition' },
  { name: '0.5 Ltr MG Partition',             code: 'PK--MG05-PT',  category: 'Partition' },
  { name: 'MA Wet Partition',                 code: 'PK-MA15-PT',   category: 'Partition' },
  { name: 'MA Dry Partition',                 code: 'PK-MA10-PT',   category: 'Partition' },
  { name: 'MA Chutney Partition',             code: 'PK-MA04-PT',   category: 'Partition' },

  // Paper Cone ────────────────────────────────────────────────────────
  { name: 'Paper Cone 1.00"',           code: 'PK-PC-01-00', category: 'Paper Cone' },
  { name: 'Paper Cone 1.25"',           code: 'PK-PC-01-25', category: 'Paper Cone' },
  { name: 'Paper Cone 65 mm X 54 mm',   code: 'PK-PC-02-56', category: 'Paper Cone' },
  { name: 'Paper Cone 65 mm X 80 mm',   code: 'PK-PC-65-80', category: 'Paper Cone' },

  // Tape ──────────────────────────────────────────────────────────────
  { name: 'White Tape', code: 'PK-WT-00-00', category: 'Tape', unit: 'ROLL' },
  { name: 'Brown Tape', code: 'PK-BT-00-00', category: 'Tape', unit: 'ROLL' },

  // Bag ───────────────────────────────────────────────────────────────
  { name: 'Plastic Bag Old (White Goni) (55 x 36)', code: 'PK-WB-55-36', category: 'Bag' },
  { name: 'Plastic Bag Old (White Goni) (52 x 44)', code: 'PK-WB-52-44', category: 'Bag' },
  { name: 'Plastic Bag Old (White Goni) (52 x 46)', code: 'PK-WB-52-46', category: 'Bag' },
  { name: 'Plastic Bag Old (White Goni) (44 x 36)', code: 'PK-WB-44-36', category: 'Bag' },
  { name: 'Plastic Bags (14 x 16)',                 code: 'PK-PB-14-16', category: 'Bag' },
  { name: 'Plastic Bags (10 x 12)',                 code: 'PK-PB-10-12', category: 'Bag' },
  { name: 'Plastic Bags (9 x 11)',                  code: 'PK-PB-09-11', category: 'Bag' },
  { name: 'Plastic Bags (8 x 9)',                   code: 'PK-PB-08-09', category: 'Bag' },
  { name: '51" Micron LD Plastic Bags (8 x 9)',     code: 'ML-PB-08-09', category: 'Bag' },
  { name: '51" Micron LD Plastic Bags (9 x 11)',    code: 'ML-PB-09-11', category: 'Bag' },
  { name: '51" Micron LD Plastic Bags (10 x 12)',   code: 'ML-PB-10-12', category: 'Bag' },

  // Sticker & Label ───────────────────────────────────────────────────
  { name: 'AGL Stickers A - Blue',   code: 'PK-ST-BL-01', category: 'Sticker & Label' },
  { name: 'AGL Stickers B - Blue',   code: 'PK-ST-BL-02', category: 'Sticker & Label' },
  { name: 'AGL Stickers C - Blue',   code: 'PK-ST-BL-03', category: 'Sticker & Label' },
  { name: 'AGL Stickers D - Blue',   code: 'PK-ST-BL-04', category: 'Sticker & Label' },
  { name: 'AGL Stickers A - Orange', code: 'PK-ST-OR-01', category: 'Sticker & Label' },
  { name: 'AGL Stickers B - Orange', code: 'PK-ST-OR-02', category: 'Sticker & Label' },
  { name: 'AGL Stickers C - Orange', code: 'PK-ST-OR-03', category: 'Sticker & Label' },
  { name: 'AGL Stickers D - Orange', code: 'PK-ST-OR-04', category: 'Sticker & Label' },
  { name: 'Box Sticker',             code: 'PK-ST-BX-00', category: 'Sticker & Label' },
  { name: 'Arrow Stickers',          code: 'PK-ST-AR-00', category: 'Sticker & Label' },

  // Strapping & Wrap ──────────────────────────────────────────────────
  { name: 'Packing Sutli',      code: 'PK-PS-00-00', category: 'Strapping & Wrap', unit: 'ROLL' },
  { name: 'Stapple Patti Roll', code: 'PK-ST-PR-00', category: 'Strapping & Wrap', unit: 'ROLL' },
  { name: 'PP Wrapping Roll',   code: 'PK-PP-WR-00', category: 'Strapping & Wrap', unit: 'ROLL' },

  // Crate ─────────────────────────────────────────────────────────────
  { name: 'Plastic Blue Crates', code: 'PK-PB-00-00', category: 'Crate' },

  // Other — "FlyWheel" sits in the sheet's Packing section but carries a
  // CO- (consumable) code. Loaded as PACKING per the sheet; see DATA_NOTES.
  { name: 'FlyWheel', code: 'CO-FW-00-00', category: 'Other' },
].map(withDefaults('PACKING'));

export const MATERIAL_MASTER = [...RAW_MATERIALS, ...CONSUMABLES, ...PACKING];

// Human-readable summary of the cleaning decisions — printed by the importer.
export const DATA_NOTES = [
  'Green Pad - Fiber: duplicate row removed — kept CO-GF-00-00, alias CO-GP-FB-00.',
  'WPS Pomex Material (5 rows): source code was blank — codes auto-generated '
    + 'from size (CO-WPS-190-25, -155-20, -160-25, -140-25, -006-30).',
  'Packing: PK-PP10-BX was shared by two items — assigned to "PP Dry Box"; the '
    + 'mis-coded "1.0 Ltr SG Box" row was dropped (correct code PK-SG10-BX kept).',
  'Packing: duplicate Tapper-Jar rows and 6 blank-code MG rows were dropped — '
    + 'the coded originals are kept.',
  'Packing: "FlyWheel" (CO-FW-00-00) is tagged Packing in the sheet but uses a '
    + 'consumable code prefix — loaded as PACKING; reclassify in-app if needed.',
  'Circles: excluded entirely by client instruction.',
  'Finished Goods: not in this file — already loaded in the database.',
];

export const MATERIAL_MASTER_COUNTS = {
  RAW_MATERIAL: RAW_MATERIALS.length,
  CONSUMABLE:   CONSUMABLES.length,
  PACKING:      PACKING.length,
  TOTAL:        MATERIAL_MASTER.length,
};

export default MATERIAL_MASTER;
