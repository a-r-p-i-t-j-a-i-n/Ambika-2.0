import XLSX from 'xlsx';
import path from 'path';

const filePath = path.resolve('src/sheets/c;ient details.xlsx');

function readExcel() {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error reading Excel:', error.message);
  }
}

readExcel();
