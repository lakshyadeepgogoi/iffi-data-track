import ExcelJS from 'exceljs';

/** Reads one tab of an .xlsx (default Sheet2) as a 2-D array of display text. */
export async function readSheet(file, name = 'Sheet2') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`No "${name}" tab in ${file}`);
  const width = ws.getRow(1).cellCount;
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const line = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      line.push(cell.value == null ? '' : cell.text);
    }
    rows[n - 1] = line;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ||= new Array(width).fill('');
  while (rows.length > 1 && rows.at(-1).every((v) => v === '')) rows.pop();
  return rows;
}
