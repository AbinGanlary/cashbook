import { BookOpen, CheckSquare, PlusCircle, Square, X } from 'lucide-react';
import { fmtDate } from '../utils';

export default function BrsItemTable({ section, items, label, sectionLetter, pickerTxList,
    isLocked, workingRecord, brsPickerOpen, setBrsPickerOpen,
    brsManualOpen, setBrsManualOpen, brsManualForm, setBrsManualForm,
    brsMonth, addBrsItem, removeBrsItem, toggleBrsTxPicker }) {
  const isA = section === 'a2' || section === 'a3';
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{sectionLetter} — {label}</span>
        {!isLocked && workingRecord && (
          <div className="flex gap-2">
            {isA && (
              <button onClick={() => setBrsPickerOpen(brsPickerOpen === section ? null : section)}
                className="flex items-center gap-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1 rounded-lg font-medium transition-colors">
                <CheckSquare size={12} /> Pick from Transactions
              </button>
            )}
            <button onClick={() => setBrsManualOpen(brsManualOpen === section ? null : section)}
              className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-600 px-2.5 py-1 rounded-lg font-medium transition-colors">
              <PlusCircle size={12} /> Add Manual
            </button>
          </div>
        )}
      </div>

      {isA && brsPickerOpen === section && !isLocked && (
        <div className="mb-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-2 flex items-center gap-1">
            <BookOpen size={12} /> Bank {section === 'a2' ? 'Payments' : 'Receipts'} in {brsMonth} — tick to include
          </p>
          {pickerTxList.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No bank {section === 'a2' ? 'payments' : 'receipts'} found for {brsMonth}.</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {pickerTxList.map(tx => {
                const selected = items?.some(i => i.txId === tx.id);
                return (
                  <button key={tx.id} onClick={() => toggleBrsTxPicker(section, tx)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors text-xs ${selected ? 'bg-indigo-200 dark:bg-indigo-800/50 text-indigo-900 dark:text-indigo-100' : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'}`}>
                    {selected ? <CheckSquare size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" /> : <Square size={14} className="text-gray-400 shrink-0" />}
                    <span className="flex-1 truncate font-medium">{tx.particulars}</span>
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">{fmtDate(tx.date)}</span>
                    <span className="font-bold text-gray-800 dark:text-gray-200 shrink-0">₹{tx.amount.toLocaleString('en-IN')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {brsManualOpen === section && !isLocked && (
        <div className="mb-3 bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Add Manual Entry</p>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Date</label>
              <input type="date" value={brsManualForm.date} onChange={e => setBrsManualForm(p => ({ ...p, date: e.target.value }))}
                className="w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Cheque / Ref. No.</label>
              <input type="text" placeholder="Optional" value={brsManualForm.refNo} onChange={e => setBrsManualForm(p => ({ ...p, refNo: e.target.value }))}
                className="w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Particulars</label>
              <input type="text" placeholder="Payee / Description" value={brsManualForm.particulars} onChange={e => setBrsManualForm(p => ({ ...p, particulars: e.target.value }))}
                className="w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Amount (₹)</label>
              <div className="flex gap-1">
                <input type="number" placeholder="0.00" value={brsManualForm.amount} onChange={e => setBrsManualForm(p => ({ ...p, amount: e.target.value }))}
                  className="flex-1 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
                <button onClick={() => {
                  if (!brsManualForm.particulars || !brsManualForm.amount) return;
                  addBrsItem(section, { date: brsManualForm.date, refNo: brsManualForm.refNo, particulars: brsManualForm.particulars, amount: brsManualForm.amount });
                  setBrsManualForm(p => ({ ...p, date: '', refNo: '', particulars: '', amount: '' }));
                }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 rounded text-xs font-bold transition-colors">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {items && items.length > 0 ? (
        <table className="w-full text-xs border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <thead className="bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-center w-8">#</th>
              <th className="px-3 py-2 text-center w-24">Date</th>
              <th className="px-3 py-2 text-center w-28">Cheque / Ref.</th>
              <th className="px-3 py-2 text-left">Particulars</th>
              <th className="px-3 py-2 text-right w-28">Amount (₹)</th>
              {!isLocked && <th className="px-3 py-2 w-8 print:hidden"></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className="border-t border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                <td className="px-3 py-2 text-center text-gray-500">{i + 1}</td>
                <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{fmtDate(item.date) || '—'}</td>
                <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{item.refNo || '—'}</td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{item.particulars}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-800 dark:text-gray-200">{parseFloat(item.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                {!isLocked && (
                  <td className="px-2 py-2 text-center print:hidden">
                    <button onClick={() => removeBrsItem(section, item.id)} className="text-gray-300 hover:text-rose-500 transition-colors"><X size={13} /></button>
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 font-bold">
              <td colSpan={4} className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">TOTAL</td>
              <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              {!isLocked && <td className="print:hidden"></td>}
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic py-2 pl-1">No entries — {isLocked ? 'nil' : 'use buttons above to add'}.</p>
      )}
    </div>
  );
}


