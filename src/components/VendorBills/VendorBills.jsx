import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Printer, ChevronLeft, X, PlusCircle, FileSpreadsheet, Pencil, Check } from 'lucide-react';
import { dbGetAll, dbPut, dbDelete } from './billsDb.js';
import { uid, todayISO, numberToWords, dateDMY } from '../../utils/format.js';
import { resolveAmountExpression } from '../../utils';

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

// Inline rename field shared by the vendor list and the vendor page header.
function VendorNameForm({ value, onChange, onSave, onCancel, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} onClick={e => e.stopPropagation()}>
      <input autoFocus type="text" value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
        className="bg-white dark:bg-slate-700 border border-indigo-300 dark:border-indigo-500 text-gray-900 dark:text-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[16rem]" />
      <button onClick={onSave} disabled={!value.trim()} title="Save name" className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-40"><Check size={16} /></button>
      <button onClick={onCancel} title="Cancel" className="p-1 text-gray-400 hover:text-rose-500"><X size={16} /></button>
    </span>
  );
}

/* ══════════════════════════════════════════════
   BATCH EDITOR + PRINTABLE SUMMARY
══════════════════════════════════════════════ */
function BatchEditor({ vendor, batch, accountCodes, onBack, onSave, onDelete }) {
  const [local, setLocal] = useState(batch);
  const [entryForm, setEntryForm] = useState({ date: todayISO(), billNo: '', particulars: '', amount: '', budgetCode: '' });
  const [addLineOpenFor, setAddLineOpenFor] = useState(null);
  const [lineForm, setLineForm] = useState({ particulars: '', amount: '', budgetCode: '' });
  const [editing, setEditing] = useState(null); // { entryId, lineId } | null
  const [editForm, setEditForm] = useState({ date: '', billNo: '', particulars: '', amount: '', budgetCode: '' });
  const [amountErrors, setAmountErrors] = useState({ entry: false, line: false, edit: false });

  useEffect(() => { setLocal(batch); setAddLineOpenFor(null); setEditing(null); }, [batch.id]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  // Resolves a "200+300+200" style sum typed into an Amount field on blur.
  const handleAmountBlur = (field, rawValue, applyValue) => {
    const { value, changed, invalid } = resolveAmountExpression(rawValue);
    if (changed) applyValue(value);
    setAmountErrors(prev => ({ ...prev, [field]: invalid }));
  };

  const update = (patch) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onSave(next);
  };

  const showBudgetCode = local.showBudgetCode !== false;
  const colCount = showBudgetCode ? 7 : 6;

  const codeOptions = useMemo(() => {
    const fromSettings = (accountCodes || []).map(c => c.code);
    const fromBatch = (local.entries || []).flatMap(e => (e.lines || []).map(l => l.budgetCode)).filter(Boolean);
    return [...new Set([...fromSettings, ...fromBatch])];
  }, [accountCodes, local.entries]);

  const totals = useMemo(() => {
    const lines = (local.entries || []).flatMap(e => e.lines || []);
    const totalAmount = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const breakup = {};
    lines.forEach(l => {
      if (!l.budgetCode) return;
      breakup[l.budgetCode] = (breakup[l.budgetCode] || 0) + (parseFloat(l.amount) || 0);
    });
    return { totalAmount, breakup: Object.entries(breakup).sort((a, b) => a[0].localeCompare(b[0])) };
  }, [local.entries]);

  const addEntry = () => {
    const resolved = resolveAmountExpression(entryForm.amount);
    if (resolved.invalid) { setAmountErrors(prev => ({ ...prev, entry: true })); return; }
    if (!entryForm.particulars || !resolved.value) return;
    const entry = {
      id: uid(),
      date: entryForm.date,
      billNo: entryForm.billNo,
      lines: [{ id: uid(), particulars: entryForm.particulars, amount: resolved.value, budgetCode: entryForm.budgetCode.toUpperCase() }],
    };
    update({ entries: [...(local.entries || []), entry] });
    setEntryForm(p => ({ date: p.date, billNo: '', particulars: '', amount: '', budgetCode: '' }));
    setAmountErrors(prev => ({ ...prev, entry: false }));
  };

  const addLineToEntry = (entryId) => {
    const resolved = resolveAmountExpression(lineForm.amount);
    if (resolved.invalid) { setAmountErrors(prev => ({ ...prev, line: true })); return; }
    if (!lineForm.particulars || !resolved.value) return;
    const entries = local.entries.map(e => e.id === entryId
      ? { ...e, lines: [...e.lines, { id: uid(), particulars: lineForm.particulars, amount: resolved.value, budgetCode: lineForm.budgetCode.toUpperCase() }] }
      : e);
    update({ entries });
    setLineForm({ particulars: '', amount: '', budgetCode: '' });
    setAddLineOpenFor(null);
    setAmountErrors(prev => ({ ...prev, line: false }));
  };

  const removeLine = (entryId, lineId) => {
    const entries = local.entries
      .map(e => e.id === entryId ? { ...e, lines: e.lines.filter(l => l.id !== lineId) } : e)
      .filter(e => e.lines.length > 0);
    update({ entries });
  };

  const startEdit = (entry, line) => {
    setAddLineOpenFor(null);
    setEditing({ entryId: entry.id, lineId: line.id });
    setEditForm({
      date: entry.date || '', billNo: entry.billNo || '',
      particulars: line.particulars, amount: line.amount, budgetCode: line.budgetCode || '',
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = () => {
    if (!editing) return;
    const resolved = resolveAmountExpression(editForm.amount);
    if (resolved.invalid) { setAmountErrors(prev => ({ ...prev, edit: true })); return; }
    if (!editForm.particulars || !resolved.value) return;
    const entries = local.entries.map(e => {
      if (e.id !== editing.entryId) return e;
      const isFirstLine = e.lines[0]?.id === editing.lineId;
      const lines = e.lines.map(l => l.id === editing.lineId
        ? { ...l, particulars: editForm.particulars, amount: resolved.value, budgetCode: editForm.budgetCode.toUpperCase() }
        : l);
      return isFirstLine ? { ...e, date: editForm.date, billNo: editForm.billNo, lines } : { ...e, lines };
    });
    update({ entries });
    setEditing(null);
    setAmountErrors(prev => ({ ...prev, edit: false }));
  };

  const inputCls = 'bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-16">
      {/* Toolbar (screen only) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          <ChevronLeft size={16} /> Back to {vendor?.name}
        </button>
        <div className="flex items-center gap-3">
          <button onClick={onDelete} className="text-sm text-rose-500 hover:underline">Delete Summary</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Batch meta (screen only) */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Summary Label (optional)</label>
            <input type="text" value={local.label || ''} onChange={e => update({ label: e.target.value })} placeholder="e.g. March 2026" className={`${inputCls} w-full`} />
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
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer w-fit">
          <input type="checkbox" checked={showBudgetCode} onChange={e => update({ showBudgetCode: e.target.checked })} className="accent-indigo-600" />
          Show Budget Code column &amp; breakup on this summary
        </label>
      </div>

      {/* Add bill entry (screen only) */}
      <div className="bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded-xl p-4 print:hidden">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Add Bill Entry</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Date</label>
            <input type="date" value={entryForm.date} onChange={e => setEntryForm(p => ({ ...p, date: e.target.value }))} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Bill No.</label>
            <input type="text" value={entryForm.billNo} onChange={e => setEntryForm(p => ({ ...p, billNo: e.target.value }))} className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Particulars</label>
            <input type="text" value={entryForm.particulars} onChange={e => setEntryForm(p => ({ ...p, particulars: e.target.value }))} placeholder="Dr. DS Rana - 22 Jan" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Amount (₹)</label>
            <input type="text" inputMode="decimal" value={entryForm.amount} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))}
              onBlur={e => handleAmountBlur('entry', e.target.value, v => setEntryForm(p => ({ ...p, amount: v })))}
              placeholder="e.g. 200+300+200" className={`${inputCls} w-full ${amountErrors.entry ? 'ring-1 ring-rose-400 border-rose-400' : ''}`} />
            {amountErrors.entry && <p className="text-[10px] text-rose-500 mt-0.5">Only numbers and + are supported, e.g. 200+300</p>}
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Budget Code (optional)</label>
            <div className="flex gap-1">
              <input type="text" list="vb-code-options" value={entryForm.budgetCode} onChange={e => setEntryForm(p => ({ ...p, budgetCode: e.target.value.toUpperCase() }))} className={`${inputCls} flex-1 min-w-0`} />
              <button onClick={addEntry} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded-lg text-xs font-bold transition-colors shrink-0">Add</button>
            </div>
          </div>
        </div>
        <datalist id="vb-code-options">
          {codeOptions.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>

      {/* Printable paper */}
      <div className="bg-white p-10 shadow-xl border border-gray-200 min-h-[600px] font-serif text-gray-900 print:shadow-none print:border-none print:p-0">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4 mb-1">{vendor?.name}</h2>
          <h3 className="text-base font-semibold">Summary{local.label ? ` — ${local.label}` : ''}</h3>
        </div>

        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 pr-2 w-10">Sl No</th>
              <th className="py-2 pr-2 w-24">Date</th>
              <th className="py-2 pr-2 w-24">Bill No.</th>
              <th className="py-2 pr-2">Particulars</th>
              <th className="py-2 pr-2 text-right w-28">Amount</th>
              {showBudgetCode && <th className="py-2 pr-2 w-28">Budget Code</th>}
              <th className="py-2 w-8 print:hidden"></th>
            </tr>
          </thead>
          <tbody>
            {(!local.entries || local.entries.length === 0) ? (
              <tr><td colSpan={colCount} className="py-6 text-center text-gray-400 italic text-sm">No bills added yet.</td></tr>
            ) : local.entries.flatMap((entry, idx) => entry.lines.map((line, li) => {
              const isFirstLine = li === 0;
              const isEditing = editing && editing.entryId === entry.id && editing.lineId === line.id;

              if (isEditing) {
                return (
                  <tr key={line.id} className="border-b border-gray-200 border-dashed bg-indigo-50 dark:bg-indigo-900/20">
                    <td className="py-1.5 pr-2 align-top">{isFirstLine ? idx + 1 : ''}</td>
                    <td className="py-1.5 pr-2 align-top">
                      {isFirstLine ? <input type="date" value={editForm.date} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} className={`${inputCls} w-full`} /> : ''}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      {isFirstLine ? <input type="text" value={editForm.billNo} onChange={e => setEditForm(p => ({ ...p, billNo: e.target.value }))} className={`${inputCls} w-full`} /> : ''}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <input type="text" value={editForm.particulars} onChange={e => setEditForm(p => ({ ...p, particulars: e.target.value }))} className={`${inputCls} w-full`} />
                    </td>
                    <td className="py-1.5 pr-2 align-top text-right">
                      <input type="text" inputMode="decimal" value={editForm.amount} onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))}
                        onBlur={e => handleAmountBlur('edit', e.target.value, v => setEditForm(p => ({ ...p, amount: v })))}
                        className={`${inputCls} w-full text-right ${amountErrors.edit ? 'ring-1 ring-rose-400 border-rose-400' : ''}`} />
                      {amountErrors.edit && <p className="text-[10px] text-rose-500 mt-0.5">Only + supported</p>}
                    </td>
                    {showBudgetCode && (
                      <td className="py-1.5 pr-2 align-top">
                        <input type="text" list="vb-code-options" value={editForm.budgetCode} onChange={e => setEditForm(p => ({ ...p, budgetCode: e.target.value.toUpperCase() }))} className={`${inputCls} w-full`} />
                      </td>
                    )}
                    <td className="py-1.5 align-top print:hidden">
                      <div className="flex gap-1">
                        <button onClick={saveEdit} title="Save" className="text-emerald-600 hover:text-emerald-700"><Check size={14} /></button>
                        <button onClick={cancelEdit} title="Cancel" className="text-gray-400 hover:text-rose-500"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={line.id} className="border-b border-gray-200 border-dashed">
                  <td className="py-1.5 pr-2 align-top">{isFirstLine ? idx + 1 : ''}</td>
                  <td className="py-1.5 pr-2 align-top">{isFirstLine ? dateDMY(entry.date) : ''}</td>
                  <td className="py-1.5 pr-2 align-top">{isFirstLine ? (entry.billNo || '') : ''}</td>
                  <td className="py-1.5 pr-2 align-top">{line.particulars}</td>
                  <td className="py-1.5 pr-2 align-top text-right">{(parseFloat(line.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  {showBudgetCode && <td className="py-1.5 pr-2 align-top">{line.budgetCode || ''}</td>}
                  <td className="py-1.5 align-top print:hidden">
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(entry, line)} title="Edit" className="text-gray-300 hover:text-indigo-500"><Pencil size={13} /></button>
                      <button onClick={() => removeLine(entry.id, line.id)} title="Delete" className="text-gray-300 hover:text-rose-500"><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            }))}
            {local.entries && local.entries.length > 0 && (
              <tr className="print:hidden">
                <td colSpan={colCount} className="pt-2">
                  {addLineOpenFor ? (
                    <div className="flex flex-wrap gap-2 items-end bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded-lg">
                      <select onChange={e => setAddLineOpenFor(e.target.value)} value={addLineOpenFor} className={inputCls}>
                        {local.entries.map((e, i) => <option key={e.id} value={e.id}>Add to Sl No {i + 1}</option>)}
                      </select>
                      <input type="text" placeholder="Particulars" value={lineForm.particulars} onChange={e => setLineForm(p => ({ ...p, particulars: e.target.value }))} className={inputCls} />
                      <input type="text" inputMode="decimal" placeholder="Amount" value={lineForm.amount} onChange={e => setLineForm(p => ({ ...p, amount: e.target.value }))}
                        onBlur={e => handleAmountBlur('line', e.target.value, v => setLineForm(p => ({ ...p, amount: v })))}
                        className={`${inputCls} w-24 ${amountErrors.line ? 'ring-1 ring-rose-400 border-rose-400' : ''}`} />
                      {amountErrors.line && <p className="w-full text-[10px] text-rose-500">Only numbers and + are supported, e.g. 200+300</p>}
                      <input type="text" placeholder="Budget Code" list="vb-code-options" value={lineForm.budgetCode} onChange={e => setLineForm(p => ({ ...p, budgetCode: e.target.value.toUpperCase() }))} className={`${inputCls} w-28`} />
                      <button onClick={() => addLineToEntry(addLineOpenFor)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Add</button>
                      <button onClick={() => setAddLineOpenFor(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddLineOpenFor(local.entries[local.entries.length - 1].id)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                      <PlusCircle size={12} /> Add another particular to an existing bill
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-b-4 border-black border-double">
              <td colSpan={4} className="py-3 font-bold text-right pr-2">Total Amount :</td>
              <td className="py-3 font-bold text-right pr-2">{totals.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              {showBudgetCode && <td></td>}
              <td className="print:hidden"></td>
            </tr>
          </tfoot>
        </table>

        <p className="text-sm mb-6"><strong>In Words:</strong> Rupees {numberToWords(totals.totalAmount)} Only</p>

        {showBudgetCode && totals.breakup.length > 0 && (
          <table className="text-sm border-collapse mb-10 w-64">
            <thead>
              <tr className="border-b border-black">
                <th className="py-1.5 text-left pr-4">Budget Code</th>
                <th className="py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {totals.breakup.map(([code, amt]) => (
                <tr key={code} className="border-b border-gray-200 border-dashed">
                  <td className="py-1 pr-4">{code}</td>
                  <td className="py-1 text-right">{amt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
              <tr className="border-t border-black font-bold">
                <td className="py-1.5 pr-4">Total Amount:</td>
                <td className="py-1.5 text-right">{totals.breakup.reduce((s, [, a]) => s + a, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="mt-16 pt-6 grid grid-cols-2 gap-16 text-center text-sm font-bold border-t border-gray-400">
          <div><div className="h-14 border-b border-gray-500 mb-2"></div>{local.preparedBy || 'Prepared By'}</div>
          <div><div className="h-14 border-b border-gray-500 mb-2"></div>{local.approvedBy || 'Approved By'}</div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN — vendor list → batch list → batch editor
══════════════════════════════════════════════ */
export default function VendorBills({ appSettings, accountCodes }) {
  const [vendors, setVendors] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [newVendorName, setNewVendorName] = useState('');
  const [confirmBox, setConfirmBox] = useState(null);
  const [editingVendor, setEditingVendor] = useState(null); // { id, name } | null

  useEffect(() => {
    (async () => {
      const [v, b] = await Promise.all([dbGetAll('vendors'), dbGetAll('batches')]);
      setVendors(v);
      setBatches(b);
      setLoaded(true);
    })();
  }, []);

  const selectedVendor = vendors.find(v => v.id === selectedVendorId);
  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  const vendorBatches = useMemo(
    () => batches.filter(b => b.vendorId === selectedVendorId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [batches, selectedVendorId]
  );

  const persistBatch = async (nextBatch) => {
    setBatches(prev => prev.map(b => b.id === nextBatch.id ? nextBatch : b));
    await dbPut('batches', nextBatch);
  };

  const addVendor = async () => {
    if (!newVendorName.trim()) return;
    const v = { id: uid(), name: newVendorName.trim(), createdAt: Date.now() };
    await dbPut('vendors', v);
    setVendors(prev => [...prev, v]);
    setNewVendorName('');
  };

  // Summaries read the vendor's name live, so renaming here updates every
  // summary (and its printout) for this vendor.
  const saveVendorName = async () => {
    if (!editingVendor) return;
    const name = editingVendor.name.trim();
    const current = vendors.find(v => v.id === editingVendor.id);
    if (name && current && current.name !== name) {
      const renamed = { ...current, name };
      await dbPut('vendors', renamed);
      setVendors(prev => prev.map(v => v.id === renamed.id ? renamed : v));
    }
    setEditingVendor(null);
  };

  const deleteVendor = (id) => {
    setConfirmBox({
      title: 'Delete Vendor?',
      message: 'This will permanently remove the vendor and all its bill summaries.',
      onConfirm: async () => {
        await dbDelete('vendors', id);
        const toDelete = batches.filter(b => b.vendorId === id);
        await Promise.all(toDelete.map(b => dbDelete('batches', b.id)));
        setVendors(prev => prev.filter(v => v.id !== id));
        setBatches(prev => prev.filter(b => b.vendorId !== id));
        if (selectedVendorId === id) { setSelectedVendorId(null); setSelectedBatchId(null); }
        setConfirmBox(null);
      }
    });
  };

  const addBatch = async () => {
    const b = {
      id: uid(), vendorId: selectedVendorId, createdAt: Date.now(),
      label: '', showBudgetCode: true,
      preparedBy: appSettings?.signatories?.preparedBy || '',
      approvedBy: appSettings?.signatories?.approvedBy || appSettings?.signatories?.authorizedBy || '',
      entries: [],
    };
    await dbPut('batches', b);
    setBatches(prev => [...prev, b]);
    setSelectedBatchId(b.id);
  };

  const deleteBatch = (id) => {
    setConfirmBox({
      title: 'Delete Summary?',
      message: 'This will permanently remove this bill summary.',
      onConfirm: async () => {
        await dbDelete('batches', id);
        setBatches(prev => prev.filter(b => b.id !== id));
        if (selectedBatchId === id) setSelectedBatchId(null);
        setConfirmBox(null);
      }
    });
  };

  if (!loaded) return <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>;

  if (selectedBatch) {
    return (
      <>
        <BatchEditor
          vendor={selectedVendor}
          batch={selectedBatch}
          accountCodes={accountCodes}
          onBack={() => setSelectedBatchId(null)}
          onSave={persistBatch}
          onDelete={() => deleteBatch(selectedBatch.id)}
        />
        {confirmBox && <ConfirmModal {...confirmBox} onCancel={() => setConfirmBox(null)} />}
      </>
    );
  }

  if (selectedVendor) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <button onClick={() => setSelectedVendorId(null)} className="flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          <ChevronLeft size={16} /> All Vendors
        </button>
        <div className="flex items-center justify-between">
          {editingVendor?.id === selectedVendor.id ? (
            <VendorNameForm value={editingVendor.name} onChange={name => setEditingVendor(p => ({ ...p, name }))}
              onSave={saveVendorName} onCancel={() => setEditingVendor(null)} />
          ) : (
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              {selectedVendor.name}
              <button onClick={() => setEditingVendor({ id: selectedVendor.id, name: selectedVendor.name })} title="Edit vendor name"
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-indigo-600"><Pencil size={15} /></button>
            </h2>
          )}
          <button onClick={addBatch} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
            <Plus size={16} /> New Summary
          </button>
        </div>
        {vendorBatches.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
            <FileSpreadsheet size={36} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">No bill summaries yet</h3>
            <button onClick={addBatch} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg">Create first summary</button>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-700/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left">Label</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-right">Bills</th>
                  <th className="px-4 py-2 text-right">Total Amount</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vendorBatches.map(b => {
                  const total = (b.entries || []).reduce((s, e) => s + (e.lines || []).reduce((s2, l) => s2 + (parseFloat(l.amount) || 0), 0), 0);
                  return (
                    <tr key={b.id} className="border-t border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setSelectedBatchId(b.id)}>
                      <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">{b.label || '(untitled)'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{new Date(b.createdAt).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{(b.entries || []).length}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-800 dark:text-gray-200">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={e => { e.stopPropagation(); deleteBatch(b.id); }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-rose-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {confirmBox && <ConfirmModal {...confirmBox} onCancel={() => setConfirmBox(null)} />}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Vendor Bill Summaries</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">Store vendor bills and print summary sheets, with an optional Budget Code column.</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 flex gap-2">
        <input type="text" placeholder="New vendor name (e.g. Yadav Taxi Service)" value={newVendorName}
          onChange={e => setNewVendorName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addVendor()}
          className="flex-1 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button onClick={addVendor} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm">
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      {vendors.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-12 text-center">
          <FileSpreadsheet size={36} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">No vendors yet — add one above</h3>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700/50 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">Vendor</th>
                <th className="px-4 py-2 text-right">Summaries</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {[...vendors].sort((a, b) => a.name.localeCompare(b.name)).map(v => (
                <tr key={v.id} className="border-t border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer" onClick={() => setSelectedVendorId(v.id)}>
                  <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">
                    {editingVendor?.id === v.id ? (
                      <VendorNameForm value={editingVendor.name} onChange={name => setEditingVendor(p => ({ ...p, name }))}
                        onSave={saveVendorName} onCancel={() => setEditingVendor(null)} />
                    ) : v.name}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{batches.filter(b => b.vendorId === v.id).length}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={e => { e.stopPropagation(); setEditingVendor({ id: v.id, name: v.name }); }} title="Edit vendor name" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-indigo-600"><Pencil size={14} /></button>
                    <button onClick={e => { e.stopPropagation(); deleteVendor(v.id); }} title="Delete vendor" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-rose-500"><Trash2 size={14} /></button>
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
