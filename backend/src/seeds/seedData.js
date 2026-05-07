/**
 * Seed data extracted from AGL's Google Sheets.
 * Parties, SKUs, Sales Orders, Delivery Challans, and FMS records.
 */

// ── PARTIES ─────────────────────────────────────────────────
export const partiesData = [
  { code: 'VERSUNI', name: 'Versuni India Home Solutions Limited', location: 'Tamilnadu', state: 'Tamil Nadu', creditPeriodDays: 45, leadTimeDays: 10 },
  { code: 'EPACK',   name: 'Epack Durable Ltd',                   location: 'Bhiwadi',    state: 'Rajasthan',   creditPeriodDays: 30, leadTimeDays: 6 },
  { code: 'MITTAL',  name: 'Mittal Electronics',                  location: 'Delhi',      state: 'Delhi',       creditPeriodDays: 30, leadTimeDays: 20 },
  { code: 'ELIN',    name: 'Elin Electronics Limited.',            location: 'Himachal Pradesh', state: 'Himachal Pradesh', creditPeriodDays: 45, leadTimeDays: 6 },
  { code: 'MAYA',    name: 'Maya Appliances Pvt. Ltd.',            location: 'Maharashtra', state: 'Maharashtra', creditPeriodDays: 30, leadTimeDays: 10 },
  { code: 'ATOMBERG',name: 'Atomberg Technologies Pvt. Ltd.',      location: 'Pune',       state: 'Maharashtra', creditPeriodDays: 30, leadTimeDays: 10, addresses: [{ label: 'Plant', line1: 'Plant 1030 Chakan, Mind Space Shelters Llp/Vithai Developers Llp', line2: 'Gate No 51-59, Bhamboli, Chakan', city: 'Pune', state: 'Maharashtra', pin: '410507' }] },
];

// ── SKUs ─────────────────────────────────────────────────────
export const skusData = [
  { code: 'ST1500-202', name: 'Steele 1.5 Ltr',              category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { code: 'ST1000-202', name: 'Steele 1.0 Ltr',              category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { code: 'GX1500-202', name: 'Galaxy 1.5 Ltr',              category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { code: 'GX1000-202', name: 'Galaxy 1.0 Ltr',              category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { code: 'TB1500-204', name: 'Taper Jar - Bidding 1.5 Ltr', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.25 },
  { code: 'TP0750-202', name: 'Taper Jar - Patti 0.750 Ltr', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.15 },
  { code: 'PP-WET',     name: 'PP Wet',        category: 'PP Jar',    pcsPerBox: 120, weightPerPc: 0.266 },
  { code: 'PP-DRY',     name: 'PP Dry',        category: 'PP Jar',    pcsPerBox: 120, weightPerPc: 0.233 },
  { code: 'PP-CHUTNEY', name: 'PP Chutney',    category: 'PP Jar',    pcsPerBox: 180, weightPerPc: 0.1317 },
  { code: 'PPF-WET',    name: 'PP Flat Wet',   category: 'PP Flat',   pcsPerBox: 120, weightPerPc: 0.266 },
  { code: 'PPF-DRY',    name: 'PP Flat Dry',   category: 'PP Flat',   pcsPerBox: 120, weightPerPc: 0.233 },
  { code: 'PPF-CHUT',   name: 'PP Flat Chutney',category:'PP Flat',   pcsPerBox: 180, weightPerPc: 0.1317 },
  { code: 'VA-WET',     name: 'VA Wet',        category: 'VA Jar',    pcsPerBox: 120, weightPerPc: 0.266 },
  { code: 'VA-DRY',     name: 'VA Dry',        category: 'VA Jar',    pcsPerBox: 120, weightPerPc: 0.233 },
  { code: 'VA-CHUT',    name: 'VA Chutney',    category: 'VA Jar',    pcsPerBox: 180, weightPerPc: 0.1317 },
  { code: 'VF-WET',     name: 'Value Flat Wet',    category: 'Value Flat', pcsPerBox: 120, weightPerPc: 0.266 },
  { code: 'VF-DRY',     name: 'Value Flat Dry',    category: 'Value Flat', pcsPerBox: 120, weightPerPc: 0.233 },
  { code: 'VF-CHUT',    name: 'Value Flat Chutney', category:'Value Flat', pcsPerBox: 180, weightPerPc: 0.1317 },
  { code: 'CHUT-KAT',   name: 'Chutney Katori',   category: 'Katori',    pcsPerBox: 144, weightPerPc: 0.1514 },
  { code: 'DOME-JAR',   name: 'Dome Jar',          category: 'Jar',       pcsPerBox: 105, weightPerPc: 0.3307 },
  { code: 'FLAT-JAR',   name: 'Flat Jar',          category: 'Jar',       pcsPerBox: 120, weightPerPc: 0.275 },
  { code: 'GRIND-JAR',  name: 'Grinder Jar',       category: 'Jar',       pcsPerBox: 126, weightPerPc: 0.2445 },
  { code: 'MG11-WET',   name: 'MG 1.1 Wet Jar',   category: 'MG Jar',    pcsPerBox: 120, weightPerPc: 0.25 },
  { code: 'MG11-DRY',   name: 'MG 1.1 Dry Jar',   category: 'MG Jar',    pcsPerBox: 120, weightPerPc: 0.25 },
  { code: 'MG11-CHUT',  name: 'MG 1.1 Chutney Jar',category:'MG Jar',    pcsPerBox: 180, weightPerPc: 0.15 },
];

// ── SALES ORDERS (from "Saved Order" sheet) ─────────────────
export const ordersData = [
  {
    soNumber: 'AGL/SO-001/24-25', poNumber: '4600035357', partyCode: 'ELIN',
    orderDate: '2024-04-04', leadTimeDays: 6,
    items: [
      { skuCode: 'VA-WET',  orderQty: 1100, dispatchedQty: 1080, remark: 'Short Close' },
      { skuCode: 'VA-DRY',  orderQty: 1000, dispatchedQty: 960,  remark: 'Short Close' },
      { skuCode: 'VA-CHUT', orderQty: 500,  dispatchedQty: 360,  remark: 'Short Close' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-002/24-25', poNumber: '1100009188', partyCode: 'EPACK',
    orderDate: '2024-04-05', leadTimeDays: 6,
    items: [
      { skuCode: 'PPF-WET',  orderQty: 3500, dispatchedQty: 3240, remark: 'Short Close' },
      { skuCode: 'PPF-DRY',  orderQty: 3500, dispatchedQty: 3240, remark: 'Short Close' },
      { skuCode: 'PPF-CHUT', orderQty: 3500, dispatchedQty: 3240, remark: 'Short Close' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-003/24-25', poNumber: 'U2/2425/P-000064', partyCode: 'MITTAL',
    orderDate: '2024-04-08', leadTimeDays: 20,
    items: [
      { skuCode: 'CHUT-KAT',  orderQty: 80000, dispatchedQty: 79920, remark: 'Short Close' },
      { skuCode: 'DOME-JAR',  orderQty: 30000, dispatchedQty: 30030 },
      { skuCode: 'FLAT-JAR',  orderQty: 10000, dispatchedQty: 9960, remark: 'Short Close' },
      { skuCode: 'GRIND-JAR', orderQty: 40000, dispatchedQty: 39942, remark: 'Short Close' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-004/24-25', poNumber: '4600036282', partyCode: 'ELIN',
    orderDate: '2024-04-16', leadTimeDays: 6,
    items: [
      { skuCode: 'VA-WET',  orderQty: 1500, dispatchedQty: 1440, remark: 'Short Close' },
      { skuCode: 'VA-DRY',  orderQty: 1500, dispatchedQty: 1440, remark: 'Short Close' },
      { skuCode: 'VA-CHUT', orderQty: 1500, dispatchedQty: 1440, remark: 'Short Close' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-006/24-25', poNumber: '4600035476', partyCode: 'ELIN',
    orderDate: '2024-05-05', leadTimeDays: 6,
    items: [
      { skuCode: 'VA-WET',  orderQty: 2000, dispatchedQty: 2040, remark: 'Extra Sent' },
      { skuCode: 'VA-DRY',  orderQty: 2200, dispatchedQty: 2160, remark: 'Short Close' },
      { skuCode: 'VA-CHUT', orderQty: 2300, dispatchedQty: 2340, remark: 'Extra Sent' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-007/24-25', poNumber: '343', partyCode: 'VERSUNI',
    orderDate: '2024-04-22', leadTimeDays: 10,
    items: [
      { skuCode: 'ST1500-202', orderQty: 4556, dispatchedQty: 4500, remark: 'Short Close' },
      { skuCode: 'ST1000-202', orderQty: 3484, dispatchedQty: 3400, remark: 'Short Close' },
      { skuCode: 'GX1500-202', orderQty: 7236, dispatchedQty: 4900, remark: 'Short Close' },
      { skuCode: 'GX1000-202', orderQty: 4154, dispatchedQty: 4100, remark: 'Short Close' },
    ],
    status: 'COMPLETED',
  },
  {
    soNumber: 'AGL/SO-008/24-25', poNumber: '1100010108', partyCode: 'EPACK',
    orderDate: '2024-04-30', leadTimeDays: 20,
    items: [
      { skuCode: 'PP-WET', orderQty: 21000, dispatchedQty: 21120, remark: 'Extra Sent' },
      { skuCode: 'PP-DRY', orderQty: 21000, dispatchedQty: 0 },
    ],
    status: 'IN_PROGRESS',
  },
  // ── FY 25-26 Orders ─────────────────────────────────────
  {
    soNumber: 'AGL/SO-002/25-26', poNumber: '5120', partyCode: 'VERSUNI',
    orderDate: '2025-12-17', leadTimeDays: 10,
    items: [
      { skuCode: 'ST1500-202', orderQty: 3484, dispatchedQty: 0 },
      { skuCode: 'ST1000-202', orderQty: 2412, dispatchedQty: 0 },
      { skuCode: 'GX1500-202', orderQty: 1608, dispatchedQty: 200 },
      { skuCode: 'GX1000-202', orderQty: 1608, dispatchedQty: 0 },
    ],
    status: 'IN_PROGRESS',
  },
  {
    soNumber: 'AGL/SO-003/25-26', poNumber: 'PODM02773/25-26', partyCode: 'MAYA',
    orderDate: '2025-12-17', leadTimeDays: 10,
    items: [
      { skuCode: 'TB1500-204', orderQty: 3000, dispatchedQty: 1800 },
      { skuCode: 'TP0750-202', orderQty: 2000, dispatchedQty: 2000 },
    ],
    status: 'IN_PROGRESS',
  },
  {
    soNumber: 'AGL/SO-002/26-27', poNumber: '4101248803', partyCode: 'ATOMBERG',
    orderDate: '2026-03-27', leadTimeDays: 10,
    items: [
      { skuCode: 'MG11-WET',  orderQty: 6700,  dispatchedQty: 4992 },
      { skuCode: 'MG11-DRY',  orderQty: 15900, dispatchedQty: 4992 },
      { skuCode: 'MG11-CHUT', orderQty: 15900, dispatchedQty: 5040 },
    ],
    status: 'IN_PROGRESS',
  },
];

// ── DELIVERY CHALLANS (from "Saved DC" sheet) ───────────────
export const challansData = [
  {
    dcNumber: 'AGL/DC-002/24-25', soNumber: 'AGL/SO-007/24-25', partyCode: 'VERSUNI', dcDate: '2024-04-02',
    items: [
      { skuName: 'Steele 1.5 Ltr', quantityPcs: 800,  noOfBoxes: 8,  pcsPerBox: 100, weightKg: 216 },
      { skuName: 'Steele 1.0 Ltr', quantityPcs: 100,  noOfBoxes: 1,  pcsPerBox: 100, weightKg: 18.7 },
      { skuName: 'Galaxy 1.5 Ltr', quantityPcs: 1600, noOfBoxes: 16, pcsPerBox: 100, weightKg: 432 },
      { skuName: 'Galaxy 1.0 Ltr', quantityPcs: 1400, noOfBoxes: 14, pcsPerBox: 100, weightKg: 261.8 },
    ],
  },
  {
    dcNumber: 'AGL/DC-003/24-25', soNumber: 'AGL/SO-008/24-25', partyCode: 'EPACK', dcDate: '2024-04-04',
    items: [
      { skuName: 'PP Wet',     quantityPcs: 4200, noOfBoxes: 35, pcsPerBox: 120, weightKg: 1118.25 },
      { skuName: 'PP Dry',     quantityPcs: 4200, noOfBoxes: 35, pcsPerBox: 120, weightKg: 978.6 },
      { skuName: 'PP Chutney', quantityPcs: 4140, noOfBoxes: 23, pcsPerBox: 180, weightKg: 545.1 },
    ],
  },
  {
    dcNumber: 'AGL/DC-004/24-25', soNumber: 'AGL/SO-007/24-25', partyCode: 'VERSUNI', dcDate: '2024-04-06',
    items: [
      { skuName: 'Galaxy 1.5 Ltr', quantityPcs: 1500, noOfBoxes: 15, pcsPerBox: 100, weightKg: 405 },
      { skuName: 'Galaxy 1.0 Ltr', quantityPcs: 1400, noOfBoxes: 14, pcsPerBox: 100, weightKg: 261.8 },
    ],
  },
  {
    dcNumber: 'AGL/DC-005/24-25', soNumber: 'AGL/SO-003/24-25', partyCode: 'MITTAL', dcDate: '2024-04-07',
    items: [
      { skuName: 'Grinder Jar',    quantityPcs: 9324,  noOfBoxes: 74,  pcsPerBox: 126, weightKg: 2279.2 },
      { skuName: 'Chutney Katori', quantityPcs: 15552, noOfBoxes: 108, pcsPerBox: 144, weightKg: 2354.4 },
      { skuName: 'Dome Jar',       quantityPcs: 1785,  noOfBoxes: 17,  pcsPerBox: 105, weightKg: 589.9 },
      { skuName: 'Flat Jar',       quantityPcs: 2040,  noOfBoxes: 17,  pcsPerBox: 120, weightKg: 561 },
    ],
  },
  {
    dcNumber: 'AGL/DC-006/24-25', soNumber: 'AGL/SO-001/24-25', partyCode: 'ELIN', dcDate: '2024-04-09',
    items: [
      { skuName: 'VA Wet',     quantityPcs: 1080, noOfBoxes: 9, pcsPerBox: 120, weightKg: 287.55 },
      { skuName: 'VA Dry',     quantityPcs: 960,  noOfBoxes: 8, pcsPerBox: 120, weightKg: 223.68 },
      { skuName: 'VA Chutney', quantityPcs: 360,  noOfBoxes: 2, pcsPerBox: 180, weightKg: 47.4 },
    ],
  },
  {
    dcNumber: 'AGL/DC-007/24-25', soNumber: 'AGL/SO-004/24-25', partyCode: 'ELIN', dcDate: '2024-04-09',
    items: [
      { skuName: 'Value Flat Wet',     quantityPcs: 2040, noOfBoxes: 17, pcsPerBox: 120, weightKg: 543.15 },
      { skuName: 'Value Flat Dry',     quantityPcs: 2040, noOfBoxes: 17, pcsPerBox: 120, weightKg: 475.32 },
      { skuName: 'Value Flat Chutney', quantityPcs: 1980, noOfBoxes: 11, pcsPerBox: 180, weightKg: 260.7 },
    ],
  },
];

// ── FMS DATA (from FMS sheet — first few records) ───────────
export const fmsData = [
  {
    dcNumber: 'AGL/DC-002/24-25', invoiceNo: 'AGL/TI-002/24-25', invoiceDate: '2024-04-02',
    partyCode: 'VERSUNI', invoiceAmount: 388751, amountReceived: 388751,
    transporterName: 'Shailendra Transport', transportType: 'Freight Paid',
    deliveryDate: '2024-04-09', creditPeriodDays: 45,
    receivedDate: '2024-05-22', receivedAmount: 388751,
  },
  {
    dcNumber: 'AGL/DC-003/24-25', invoiceNo: 'AGL/TI-003/24-25', invoiceDate: '2024-04-04',
    partyCode: 'EPACK', invoiceAmount: 947004, amountReceived: 947004,
    transporterName: 'Om Logistics Ltd', lrNumber: '28628623', transportType: 'Freight Paid',
    deliveryDate: '2024-04-15', creditPeriodDays: 30,
    receivedDate: '2024-05-15', receivedAmount: 947004.26,
  },
  {
    dcNumber: 'AGL/DC-004/24-25', invoiceNo: 'AGL/TI-004/24-25', invoiceDate: '2024-04-06',
    partyCode: 'VERSUNI', invoiceAmount: 278131, amountReceived: 278131,
    transporterName: 'Vishwakarma Logistics Ltd', lrNumber: 'MH-04-JU-1406', transportType: 'Freight Paid',
    deliveryDate: '2024-04-14', creditPeriodDays: 45,
    receivedDate: '2024-05-22', receivedAmount: 278131,
  },
  {
    dcNumber: 'AGL/DC-005/24-25', invoiceNo: 'AGL/TI-005/24-25', invoiceDate: '2024-04-07',
    partyCode: 'MITTAL', invoiceAmount: 2428727, amountReceived: 2428727,
    transporterName: 'Aggarwal Roadlines', lrNumber: '42398', transportType: 'Freight Paid',
    deliveryDate: '2024-04-11', creditPeriodDays: 30,
    receivedDate: '2024-05-24', receivedAmount: 2428727,
  },
  {
    dcNumber: 'AGL/DC-006/24-25', invoiceNo: 'AGL/TI-006/24-25', invoiceDate: '2024-04-09',
    partyCode: 'ELIN', invoiceAmount: 210307, amountReceived: 210307,
    transporterName: 'Om Logistics Ltd', lrNumber: '28628667', transportType: 'Freight Paid',
    deliveryDate: '2024-04-14', creditPeriodDays: 45,
    receivedDate: '2024-06-04', receivedAmount: 210307,
  },
];
