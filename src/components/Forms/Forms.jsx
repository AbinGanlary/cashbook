import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Printer, ChevronLeft, X, Wallet, Search } from 'lucide-react';
import { dbGetAll, dbPut, dbDelete } from './formsDb.js';
import { uid, todayISO, numberToWords, dateDMY } from '../../utils/format.js';
import { resolveAmountExpression, newTxId } from '../../utils';

const DEFAULT_PAYEES = [
  'Alex Morgan', 'Priya Sharma', 'Rahul Verma', 'Sam Carter', 'Neha Singh', 'Jordan Lee',
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Voucher No. is derived, not stored: sequence resets each month, so reusing
// the same voucher next month (just editing its date) renumbers it automatically —
// e.g. "01-Aug/2026" -> "01-Sep/2026" the moment the date field changes.
function computeVoucherNumbers(vouchers) {
  const counts = {};
  const map = {};
  [...vouchers]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach(v => {
      if (!v.date) { map[v.id] = '—'; return; }
      const [y, m] = v.date.split('-');
      const monthKey = `${y}-${m}`;
      counts[monthKey] = (counts[monthKey] || 0) + 1;
      map[v.id] = `${String(counts[monthKey]).padStart(2, '0')}-${MONTH_ABBR[Number(m) - 1]}/${y}`;
    });
  return map;
}

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="text-sm border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={onConfirm} className="text-sm bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   VOUCHER EDITOR + PRINTABLE PAPER
══════════════════════════════════════════════ */
function VoucherEditor({ voucher, voucherNo, payees, particularsOptions, accountCodes, branding, onBack, onSave, onDelete, onAddLedgerTransaction }) {
  const [local, setLocal] = useState(voucher);
  const [lineInput, setLineInput] = useState('');
  const [amountInvalid, setAmountInvalid] = useState(false);

  useEffect(() => { setLocal(voucher); setLineInput(''); setAmountInvalid(false); }, [voucher.id]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const update = (patch) => {
    let next = { ...local, ...patch };
    // Auto-link to the cashbook ledger once the voucher is meaningful, exactly once.
    if (next.addToLedger && !next.ledgerTxId && next.payee && next.amount && (next.particulars || []).length > 0) {
      // Must be a numeric creation timestamp like every other ledger transaction:
      // bill generation/locking compares Number(tx.id) with the bill's generation
      // time, so a text id (e.g. from uid()) is silently left out of generated bills.
      const txId = newTxId();
      onAddLedgerTransaction({
        id: txId,
        date: next.date,
        particulars: `Petty Cash: ${next.payee} - ${next.particulars.join('; ')}`,
        amount: next.amount,
        accountCode: next.budgetCode,
      });
      next = { ...next, ledgerTxId: txId };
    }
    setLocal(next);
    onSave(next);
  };

  const codeOptions = useMemo(() => {
    const fromSettings = (accountCodes || []).map(c => c.code);
    return [...new Set([...fromSettings, ...(local.budgetCode ? [local.budgetCode] : [])])];
  }, [accountCodes, local.budgetCode]);

  const addLine = () => {
    if (!lineInput.trim()) return;
    update({ particulars: [...(local.particulars || []), lineInput.trim()] });
    setLineInput('');
  };

  const removeLine = (idx) => {
    update({ particulars: (local.particulars || []).filter((_, i) => i !== idx) });
  };

  const inputCls = 'bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-16">
      {/* Toolbar (screen only) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          <ChevronLeft size={16} /> All Vouchers
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500" title="Auto-derived from the Paid On date — changes automatically if you edit it">Voucher No. {voucherNo}</span>
          <button onClick={onDelete} className="text-sm text-rose-500 hover:underline">Delete Voucher</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Edit fields (screen only) */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Paid On</label>
            <input type="date" value={local.date} onChange={e => update({ date: e.target.value })} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Payee</label>
            <input type="text" list="voucher-payee-options" value={local.payee || ''} onChange={e => update({ payee: e.target.value })} className={`${inputCls} w-full`} />
            <datalist id="voucher-payee-options">
              {payees.map(p => <option key={p.id} value={p.name} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount (₹)</label>
            <input type="text" inputMode="decimal" value={local.amount || ''} onChange={e => update({ amount: e.target.value })}
              onBlur={e => {
                const resolved = resolveAmountExpression(e.target.value);
                if (resolved.changed) update({ amount: resolved.value });
                setAmountInvalid(resolved.invalid);
              }}
              placeholder="e.g. 200+300+200" className={`${inputCls} w-full ${amountInvalid ? 'ring-1 ring-rose-400 border-rose-400' : ''}`} />
            {amountInvalid && <p className="text-[10px] text-rose-500 mt-0.5">Only numbers and + are supported, e.g. 200+300</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Budget Code</label>
            <input type="text" list="voucher-code-options" value={local.budgetCode || ''} onChange={e => update({ budgetCode: e.target.value.toUpperCase() })} className={`${inputCls} w-full`} />
            <datalist id="voucher-code-options">
              {codeOptions.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Prepared By</label>
            <input type="text" value={local.preparedBy || ''} onChange={e => update({ preparedBy: e.target.value })} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Approved By</label>
            <input type="text" value={local.approvedBy || ''} onChange={e => update({ approvedBy: e.target.value })} className={`${inputCls} w-full`} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Particulars — services rendered / items received</label>
          <div className="flex gap-2 mb-2">
            <input type="text" list="voucher-particulars-options" value={lineInput} onChange={e => setLineInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLine())}
              placeholder="e.g. Internet bill - August 2026" className={`${inputCls} flex-1`} />
            <datalist id="voucher-particulars-options">
              {particularsOptions.map(p => <option key={p} value={p} />)}
            </datalist>
            <button onClick={addLine} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded-lg text-xs font-bold transition-colors shrink-0">Add</button>
          </div>
          {(local.particulars || []).length > 0 && (
            <ul className="space-y-1">
              {local.particulars.map((line, i) => (
                <li key={i} className="flex items-center justify-between bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300">
                  <span>* {line}</span>
                  <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-rose-500"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {local.ledgerTxId ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Linked to Cashbook Ledger as a Cash Payment (deleting this voucher will not remove that transaction)</p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer w-fit">
            <input type="checkbox" checked={local.addToLedger !== false} onChange={e => update({ addToLedger: e.target.checked })} className="accent-indigo-600" />
            Also add as Cash Payment transaction in Cashbook Ledger
          </label>
        )}
      </div>

      {/* Printable paper */}
      <div className="bg-white p-10 shadow-xl border border-gray-200 min-h-[500px] font-serif text-gray-900 print:shadow-none print:border-none print:p-0">
        {branding?.headerLogo && (
          <div className="mb-4 pb-4 border-b-2 border-black">
            <img src={branding.headerLogo} alt="" className="max-h-20 max-w-full object-contain" />
          </div>
        )}
        <div className={`flex items-center justify-between mb-6 pb-3 ${branding?.headerLogo ? '' : 'border-b-2 border-black'}`}>
          <h2 className="text-xl font-bold uppercase tracking-wide">Petty Cash Voucher</h2>
          <span className="text-sm">Voucher No. <strong>{voucherNo}</strong></span>
        </div>

        <div className="grid grid-cols-2 gap-y-4 text-sm mb-6">
          <div>Paid on : <strong>{dateDMY(local.date) || '—'}</strong></div>
          <div />
          <div>Payee : <strong>{local.payee || '—'}</strong></div>
          <div className="text-right">
            <div className="inline-block text-center">
              <div className="w-40 border-b border-gray-500 h-8"></div>
              <div className="text-xs mt-1">Received By (Signature)</div>
            </div>
          </div>
          <div>Amount (in figure) : <strong>₹{(parseFloat(local.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
          <div>Budget Code : <strong>{local.budgetCode || '—'}</strong></div>
          <div className="col-span-2">Amount (in words) Rupees : <strong>{numberToWords(parseFloat(local.amount) || 0)} Only</strong></div>
        </div>

        <p className="text-sm font-semibold mb-2">For the services rendered and/or items received as follows:</p>
        {(local.particulars || []).length === 0 ? (
          <p className="text-sm text-gray-400 italic mb-8">No particulars added yet.</p>
        ) : (
          <ul className="text-sm mb-8 space-y-1">
            {local.particulars.map((line, i) => <li key={i}>* {line}</li>)}
          </ul>
        )}

        <div className="mt-16 pt-6 grid grid-cols-2 gap-16 text-center text-sm font-bold border-t border-gray-400">
          <div><div className="h-14 border-b border-gray-500 mb-2"></div>{local.preparedBy || 'Prepared By'}</div>
          <div><div className="h-14 border-b border-gray-500 mb-2"></div>{local.approvedBy || 'Approved By'}</div>
        </div>

        {branding?.footerHtml && (
          // 2in of real space (not rem/px) so it holds when printed regardless of
          // screen zoom — room to physically stamp the voucher below the signatures.
          <div className="pt-3 border-t border-gray-300 text-xs text-center [&_a]:no-underline" style={{ marginTop: '2in' }}
            dangerouslySetInnerHTML={{ __html: branding.footerHtml }} />
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN — voucher list → voucher editor
══════════════════════════════════════════════ */
export default function Forms({ appSettings, accountCodes, onAddTransaction, voucherBranding }) {
  const [payees, setPayees] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedVoucherId, setSelectedVoucherId] = useState(null);
  const [confirmBox, setConfirmBox] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      let [p, v] = await Promise.all([dbGetAll('payees'), dbGetAll('vouchers')]);
      if (p.length === 0) {
        p = DEFAULT_PAYEES.map(name => ({ id: uid(), name }));
        await Promise.all(p.map(x => dbPut('payees', x)));
      }
      setPayees(p);
      setVouchers(v);
      setLoaded(true);
    })();
  }, []);

  const selectedVoucher = vouchers.find(v => v.id === selectedVoucherId);

  const particularsOptions = useMemo(
    () => [...new Set(vouchers.flatMap(v => v.particulars || []))].sort(),
    [vouchers]
  );

  const voucherNumbers = useMemo(() => computeVoucherNumbers(vouchers), [vouchers]);

  const filteredVouchers = useMemo(() => {
    const sorted = [...vouchers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!q.trim()) return sorted;
    const term = q.toLowerCase();
    return sorted.filter(v =>
      (v.payee || '').toLowerCase().includes(term) ||
      (v.particulars || []).some(p => p.toLowerCase().includes(term)) ||
      (voucherNumbers[v.id] || '').toLowerCase().includes(term)
    );
  }, [vouchers, q, voucherNumbers]);

  const persistVoucher = async (nextVoucher) => {
    setVouchers(prev => prev.map(v => v.id === nextVoucher.id ? nextVoucher : v));
    await dbPut('vouchers', nextVoucher);
    // Grow the payee directory organically as new names are typed.
    const name = (nextVoucher.payee || '').trim();
    if (name && !payees.some(p => p.name === name)) {
      const p = { id: uid(), name };
      await dbPut('payees', p);
      setPayees(prev => [...prev, p]);
    }
  };

  const addVoucher = async () => {
    const v = {
      id: uid(), date: todayISO(), payee: '', amount: '', budgetCode: '',
      particulars: [], addToLedger: true, ledgerTxId: null,
      preparedBy: appSettings?.signatories?.preparedBy || '',
      approvedBy: appSettings?.signatories?.approvedBy || appSettings?.signatories?.authorizedBy || '',
      createdAt: Date.now(),
    };
    await dbPut('vouchers', v);
    setVouchers(prev => [...prev, v]);
    setSelectedVoucherId(v.id);
  };

  const deleteVoucher = (id) => {
    setConfirmBox({
      title: 'Delete Voucher?',
      message: 'This will permanently remove this petty cash voucher. Any linked Cashbook Ledger transaction will NOT be removed.',
      onConfirm: async () => {
        await dbDelete('vouchers', id);
        setVouchers(prev => prev.filter(v => v.id !== id));
        if (selectedVoucherId === id) setSelectedVoucherId(null);
        setConfirmBox(null);
      }
    });
  };

  if (!loaded) return <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>;

  if (selectedVoucher) {
    return (
      <>
        <VoucherEditor
          voucher={selectedVoucher}
          voucherNo={voucherNumbers[selectedVoucher.id]}
          payees={payees}
          particularsOptions={particularsOptions}
          accountCodes={accountCodes}
          branding={voucherBranding}
          onBack={() => setSelectedVoucherId(null)}
          onSave={persistVoucher}
          onDelete={() => deleteVoucher(selectedVoucher.id)}
          onAddLedgerTransaction={onAddTransaction}
        />
        {confirmBox && <ConfirmModal {...confirmBox} onCancel={() => setConfirmBox(null)} />}
      </>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Petty Cash Vouchers</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Create, store and print petty cash vouchers</p>
        </div>
        <button onClick={addVoucher} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
          <Plus size={16} /> New Voucher
        </button>
      </div>

      {vouchers.length > 0 && (
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
          <Search size={15} className="text-gray-400" />
          <input type="text" placeholder="Search by payee, particulars, voucher no…" value={q} onChange={e => setQ(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 outline-none placeholder-gray-400" />
        </div>
      )}

      {vouchers.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
          <Wallet size={36} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">No vouchers yet</h3>
          <button onClick={addVoucher} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg">Create first voucher</button>
        </div>
      ) : filteredVouchers.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-8 text-center text-sm text-gray-400">Nothing matched "{q}"</div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700/50 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">Voucher No.</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Payee</th>
                <th className="px-4 py-2 text-left">Budget Code</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVouchers.map(v => (
                <tr key={v.id} className="border-t border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setSelectedVoucherId(v.id)}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{voucherNumbers[v.id]}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{dateDMY(v.date)}</td>
                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">{v.payee || '—'}</td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-500">{v.budgetCode || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-800 dark:text-gray-200">₹{(parseFloat(v.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={e => { e.stopPropagation(); deleteVoucher(v.id); }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-rose-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmBox && <ConfirmModal {...confirmBox} onCancel={() => setConfirmBox(null)} />}
    </div>
  );
}
