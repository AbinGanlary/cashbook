export const formatClaimNo = (yyyymm) => {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-');
  return `${m}/${y}`;
};


export const fmtDate = (d) => {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
};


export const sectionKey = (section) => `${section}Items`;


// A new ledger-transaction id: the creation time in ms, as a numeric string.
export const newTxId = () => String(Date.now());

// Bill locking compares Number(tx.id) with a bill's generation time, so every
// transaction id must be a numeric creation timestamp. Earlier versions let the
// Petty Cash Voucher link create text ids, which were left out of generated
// bills. This repairs such records from their createdAt (deterministic, so every
// synced PC computes the same id) and returns the same array if nothing needs it.
export const normalizeTxIds = (list) => {
  if (!Array.isArray(list)) return list;
  const isNumeric = (tx) => Number.isFinite(Number(tx.id)) && String(tx.id).trim() !== '';
  if (list.every(isNumeric)) return list;
  const used = new Set(list.map(tx => String(tx.id)));
  return list.map(tx => {
    if (isNumeric(tx)) return tx;
    let n = Number(tx.createdAt) || Date.now();
    while (used.has(String(n))) n += 1;
    used.add(String(n));
    return { ...tx, id: String(n) };
  });
};


// The Petty Cash Voucher link used to store `amount` as a string,
// which turns every `sum + tx.amount` total into string concatenation ("0" + "500").
// This coerces such amounts back to numbers and returns the same array if
// nothing needs it.
export const normalizeTxAmounts = (list) => {
  if (!Array.isArray(list)) return list;
  if (list.every(tx => typeof tx.amount === 'number')) return list;
  return list.map(tx => (typeof tx.amount === 'number' ? tx : { ...tx, amount: parseFloat(tx.amount) || 0 }));
};

export const normalizeTransactions = (list) => normalizeTxAmounts(normalizeTxIds(list));


// LAN-sync PINs: anything shorter is too easy to guess, and generated ones come
// from the browser's secure random source (not Math.random) as 8 digits.
export const MIN_PIN_LENGTH = 6;
export const generatePin = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(10000000 + (buf[0] % 90000000));
};


// Previous / Pending Claim entries are signed numbers: a negative amount is a
// "Less" line (e.g. extra funds received from HQ that must be deducted so the
// summary still reconciles to the imprest). Prefix it unless already worded as one.
export const claimLabel = (claim) => {
  const desc = claim?.description || '';
  const isLess = (parseFloat(claim?.amount) || 0) < 0;
  return isLess && !/^less\b/i.test(desc.trim()) ? `Less: ${desc}` : desc;
};


// Lets an Amount field accept a sum expression like "(200+300+200)" and
// resolves it to a plain number on blur. Only addition is supported —
// deliberately no eval()/Function(), just a strict regex-checked sum so a
// malformed expression is caught rather than silently producing NaN.
// - Plain numbers pass through untouched (changed: false).
// - A valid "+"-only expression resolves to its total (changed: true).
// - Anything containing +()  that doesn't parse is flagged (invalid: true)
//   so the field can show a hint instead of silently accepting garbage.
export const resolveAmountExpression = (raw) => {
  if (raw == null) return { value: raw, changed: false, invalid: false };
  const trimmed = String(raw).trim();
  if (trimmed === '' || /^\d+(\.\d+)?$/.test(trimmed)) {
    return { value: raw, changed: false, invalid: false };
  }
  const stripped = trimmed.replace(/[()\s]/g, '');
  if (/^\d+(\.\d+)?(\+\d+(\.\d+)?)+$/.test(stripped)) {
    const sum = stripped.split('+').reduce((s, part) => s + parseFloat(part), 0);
    return { value: String(Math.round(sum * 100) / 100), changed: true, invalid: false };
  }
  if (/[+()]/.test(trimmed)) {
    return { value: raw, changed: false, invalid: true };
  }
  return { value: raw, changed: false, invalid: false };
};


// Resizes an uploaded image file down to maxWidth (keeping aspect ratio) and
// returns a PNG data URL, so logos stay well under localStorage size limits.
export const resizeImageToDataURL = (file, maxWidth = 700) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not read image'));
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});


// Safe storage: falls back to in-memory when localStorage is unavailable (e.g. sandboxed preview)
const _memStore = {};
export const safeStorage = (() => {
  try { localStorage.setItem('__ls_test__', '1'); localStorage.removeItem('__ls_test__'); return localStorage; }
  catch {
    return {
      getItem: k => Object.prototype.hasOwnProperty.call(_memStore, k) ? _memStore[k] : null,
      setItem: (k, v) => { _memStore[k] = v; },
      removeItem: k => { delete _memStore[k]; }
    };
  }
})();


