/**
 * Quick one-off inspector for the SKU sheet.
 * Run:  node src/scripts/_inspect_sku_sheet.js
 */
import XLSX from 'xlsx';
import path from 'path';

const filePath = path.resolve('src/sheets/sku items and codes.xlsx');
const wb = XLSX.readFile(filePath);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  console.log('\n=== Sheet:', sheetName, '— rows:', rows.length, '===');
  if (rows.length === 0) continue;
  console.log('Columns:', Object.keys(rows[0]));
  console.log('First 5 rows:');
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  console.log('Last 3 rows:');
  console.log(JSON.stringify(rows.slice(-3), null, 2));
}
