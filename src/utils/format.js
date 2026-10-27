export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const dateDMY = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Indian-system amount in words (crore / lakh / thousand), e.g. for voucher amounts.
export function numberToWords(num) {
  if (!num || Number(num) === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigits(n) {
    let s = '';
    if (n >= 100) { s += ones[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' '; }
    if (n) s += twoDigits(n);
    return s;
  }

  const n = Math.floor(Math.abs(Number(num)));
  const paise = Math.round((Math.abs(Number(num)) - n) * 100);
  let result = '';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) result += threeDigits(crore) + ' Crore ';
  if (lakh) result += threeDigits(lakh) + ' Lakh ';
  if (thousand) result += threeDigits(thousand) + ' Thousand ';
  if (rest) result += threeDigits(rest);
  result = result.trim();
  if (paise > 0) result += ' and ' + twoDigits(paise) + ' Paise';
  return result;
}
