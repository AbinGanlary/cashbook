// Demo ledger for trying the app (Settings → Load Sample Data). All names and
// figures are made up. Dates are relative to today so the dashboard always has
// a recent month to show; ids are creation-style timestamps, like real entries.
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function buildSampleTransactions(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;

  const rows = [
    [iso(prevY, prevM, 1), 'Imprest claim received from HQ', 'Receipt', 'Bank', 400000, 'NONE'],
    [iso(prevY, prevM, 2), 'Cash withdrawn for petty expenses', 'Contra', null, 50000, 'NONE'],
    [iso(prevY, prevM, 4), 'Broadband - monthly bill', 'Payment', 'Bank', 4720, 'TEL01'],
    [iso(prevY, prevM, 6), 'Alex Morgan - stationery purchase', 'Payment', 'Cash', 2350, 'SUP02'],
    [iso(prevY, prevM, 9), 'Courier charges - Priya Sharma', 'Payment', 'Cash', 640, 'POST03'],
    [iso(prevY, prevM, 12), 'Printer cartridges', 'Payment', 'Bank', 8900, 'SUP02'],
    [iso(prevY, prevM, 18), 'Mobile recharge - Rahul Verma', 'Payment', 'Cash', 999, 'TEL01'],
    [iso(prevY, prevM, 25), 'Pantry supplies', 'Payment', 'Cash', 3150, 'SUP02'],
    [iso(y, m, 2), 'Broadband - monthly bill', 'Payment', 'Bank', 4720, 'TEL01'],
    [iso(y, m, 3), 'Speed post - Sam Carter', 'Payment', 'Cash', 420, 'POST03'],
    [iso(y, m, 5), 'Office cleaning supplies', 'Payment', 'Cash', 1875, 'SUP02'],
    [iso(y, m, 7), 'Desk lamp replacement', 'Payment', 'Bank', 2600, 'SUP02'],
  ];

  const base = Date.now() - rows.length * 1000;
  return rows.map(([date, particulars, type, mode, amount, accountCode], i) => ({
    id: String(base + i),
    date, particulars, type, mode, amount, accountCode,
    isAdjustment: false,
    expenseSerial: null,
  }));
}
