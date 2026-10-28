import { createElement, useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  Plus, Wallet, Building2, FileText, Landmark,
  LayoutDashboard, ReceiptText, List, Settings,
  Printer, Download, X,
  Menu, Tag, AlertCircle, Lock, CheckCircle2,
  Moon, Sun, Database, ShieldAlert, Users, Trash2, HardDrive, Upload,
  TrendingUp, TrendingDown, ArrowRight, Bell, Zap, BarChart2, RefreshCw,
  ClipboardList, FileSpreadsheet, Calendar, PackageCheck,
  Scale, ChevronsUpDown, PlusCircle, BookOpen,
  History, Unlock, ChevronDown, ChevronRight, Clock,
  Image as ImageIcon, Bold, Italic, Underline, Palette,
  Server, Wifi, Copy, Radio
} from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import BrsItemTable from './components/BrsItemTable';
// Code-split: each is a full sub-module (own IndexedDB store, forms, print views)
// only ever needed when its tab is opened, so keep it out of the main bundle.
const VendorBills = lazy(() => import('./components/VendorBills/VendorBills'));
const Forms = lazy(() => import('./components/Forms/Forms'));
import { INITIAL_ACCOUNT_CODES } from './constants';
import { formatClaimNo, fmtDate, safeStorage, sectionKey, resizeImageToDataURL, claimLabel, normalizeTransactions, generatePin, MIN_PIN_LENGTH } from './utils';
import { useCashbookSync } from './hooks/useCashbookSync';
import { sanitizeHtml } from './utils/sanitizeHtml';
import { buildSampleData } from './sampleData';

function AppInner() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const loadSavedData = (key, defaultData) => {
    try {
      const saved = safeStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultData;
    } catch { return defaultData; }
  };

  const [transactions, setTransactions] = useState(() => {
    const data = loadSavedData('cashbook_transactions', []);
    return Array.isArray(data) ? normalizeTransactions(data) : [];
  });
  const [generatedBills, setGeneratedBills] = useState(() => {
    const data = loadSavedData('cashbook_bills', []);
    return Array.isArray(data) ? data : [];
  });
  const [brsRecords, setBrsRecords] = useState(() => {
    const data = loadSavedData('cashbook_brs', []);
    return Array.isArray(data) ? data : [];
  });
  const [accountCodes, setAccountCodes] = useState(() => {
    const data = loadSavedData('cashbook_codes', INITIAL_ACCOUNT_CODES);
    return Array.isArray(data) ? data : INITIAL_ACCOUNT_CODES;
  });

  const [appSettings, setAppSettings] = useState(() => {
    const defaultSettings = {
      orgName: 'Your Organization',
      imprestAmount: 600000,
      allowEditGenerated: false,
      monthlyBackupReminder: true,
      isDarkMode: false,
      openingCashBalance: 0,
      openingBankBalance: 0,
      signatories: { preparedBy: 'Accountant', authorizedBy: 'Finance Manager', approvedBy: 'Director' },
      pettyCashVoucher: { headerLogo: null, footerHtml: '' },
      // 'standalone' = today's behavior (local-only). 'host' / 'client' are
      // stage 2 of LAN sync — connection config only; actual data still lives
      // in localStorage until stage 3 wires the persistence layer through it.
      network: { mode: 'standalone', hostIp: '', port: 4321, pin: '' }
    };
    try {
      const saved = safeStorage.getItem('cashbook_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...defaultSettings, ...parsed,
            signatories: { ...defaultSettings.signatories, ...(parsed.signatories || {}) },
            pettyCashVoucher: { ...defaultSettings.pettyCashVoucher, ...(parsed.pettyCashVoucher || {}) },
            network: { ...defaultSettings.network, ...(parsed.network || {}) }
          };
        }
      }
    } catch (e) { console.error("Failed to load settings", e); }
    return defaultSettings;
  });

  const orgName = appSettings.orgName || 'Your Organization';

  const [newCodeForm, setNewCodeForm] = useState({ code: '', limit: '', description: '' });

  // ── Previous Claims state (for Summary / Letter reconciliation) ──
  const [previousClaims, setPreviousClaims] = useState(() => {
    const data = loadSavedData('cashbook_prev_claims', []);
    return Array.isArray(data) ? data : [];
  });
  const [prevClaimForm, setPrevClaimForm] = useState({ description: '', amount: '', kind: 'add' }); // kind: 'add' | 'less'

  const saveData = (key, data) => {
    try { safeStorage.setItem(key, JSON.stringify(data)); }
    catch (e) { console.warn(`Could not save ${key}`, e); }
  };

  useEffect(() => { saveData('cashbook_transactions', transactions); }, [transactions]);
  useEffect(() => { saveData('cashbook_bills', generatedBills); }, [generatedBills]);
  useEffect(() => { saveData('cashbook_brs', brsRecords); }, [brsRecords]);
  useEffect(() => { saveData('cashbook_codes', accountCodes); }, [accountCodes]);
  useEffect(() => { saveData('cashbook_settings', appSettings); }, [appSettings]);
  useEffect(() => { saveData('cashbook_prev_claims', previousClaims); }, [previousClaims]);

  // ── DARK MODE: Tailwind v4's `.dark` class-variant (see index.css) reads this class directly. ──
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !!appSettings.isDarkMode);
  }, [appSettings.isDarkMode]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    particulars: '', type: 'Payment', mode: 'Cash', amount: '', accountCode: ''
  });

  const [filterType, setFilterType] = useState('month');
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterStartDate, setFilterStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterEndDate, setFilterEndDate] = useState(new Date().toISOString().split('T')[0]);

  const [claimNoOverride, setClaimNoOverride] = useState('');
  const claimNo = claimNoOverride || (filterType === 'month'
    ? formatClaimNo(filterMonth)
    : `${filterStartDate.slice(5, 7)}/${filterStartDate.slice(0, 4)}`);

  const [msgBox, setMsgBox] = useState({ isOpen: false, title: '', message: '', type: 'info' });
  const [confirmBox, setConfirmBox] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

  // --- LAN SYNC (stage 3): wires the Main Cashbook's data through the server
  //     from stages 1-2 instead of localStorage-only, once Host/Client mode is on. ---
  const hasLocalData = (key) => {
    switch (key) {
      case 'transactions': return transactions.length > 0;
      case 'bills': return generatedBills.length > 0;
      case 'brs': return brsRecords.length > 0;
      case 'prev_claims': return previousClaims.length > 0;
      default: return false;
    }
  };

  const confirmOverwritePrompt = () => new Promise(resolve => {
    setConfirmBox({
      isOpen: true,
      title: 'Replace local data with the host’s?',
      message: 'This device already has Cashbook records that aren’t on the host yet. Connecting will replace what you see here with the host’s shared data. Export a backup first (Settings → Data Backup) if you want to keep a copy.',
      confirmLabel: 'Replace & Connect',
      onConfirm: () => { setConfirmBox(prev => ({ ...prev, isOpen: false })); resolve(true); },
      onCancel: () => resolve(false),
    });
  });

  const cashbookSync = useCashbookSync({
    network: appSettings.network,
    stores: {
      transactions: { value: transactions, setValue: setTransactions },
      bills: { value: generatedBills, setValue: setGeneratedBills },
      brs: { value: brsRecords, setValue: setBrsRecords },
      codes: { value: accountCodes, setValue: setAccountCodes },
      settings: { value: appSettings, setValue: setAppSettings },
      prev_claims: { value: previousClaims, setValue: setPreviousClaims },
    },
    hasLocalData,
    onOverwritePrompt: confirmOverwritePrompt,
  });

  // Resume Client-mode sync automatically on launch if this machine was left
  // connected last time — this is what makes updates "automatic" rather than
  // needing Settings revisited every time the app opens. (Host mode's
  // equivalent auto-resume is wired further down, next to handleStartHostServer,
  // since it needs the embedded server started first.)
  useEffect(() => {
    if (appSettings.network.mode === 'client') cashbookSync.startSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileInputRef = useRef(null);
  const voucherLogoInputRef = useRef(null);
  const voucherFooterRef = useRef(null);

  // ── BRS State ──
  const [brsMonth] = useState(new Date().toISOString().slice(0, 7));
  const [brsBillId, setBrsBillId] = useState(null); // selected bill for BRS tab
  const [brsDraft, setBrsDraft] = useState(null);
  const EMPTY_BRS_DRAFT = { bankStatementBalance: '', a2Items: [], a3Items: [], b2Items: [], b3Items: [] };
  const [brsPickerOpen, setBrsPickerOpen] = useState(null);
  const [brsManualForm, setBrsManualForm] = useState({ section: null, date: '', refNo: '', particulars: '', amount: '' });
  const [brsManualOpen, setBrsManualOpen] = useState(null);
  const [brsHistoryYear, setBrsHistoryYear] = useState(new Date().getFullYear());

  // ── Refs so addBrsItem can self-initialise when brsDraft is null ──
  const brsBillIdRef = useRef(null);
  const brsRecordsRef = useRef(brsRecords);
  useEffect(() => { brsBillIdRef.current = brsBillId; }, [brsBillId]);
  useEffect(() => { brsRecordsRef.current = brsRecords; }, [brsRecords]);
  // Fixes the case where "View BRS" navigates without calling setBrsDraft,
  // leaving brsDraft null and causing addBrsItem / removeBrsItem to crash.
  useEffect(() => {
    if (activeTab === 'brs' && brsBillId && !brsDraft) {
      const rec = brsRecords.find(r => r.billId === brsBillId);
      if (rec && !rec.lockedAt) {
        setBrsDraft({
          bankStatementBalance: rec.bankStatementBalance,
          a2Items: rec.a2Items || [],
          a3Items: rec.a3Items || [],
          b2Items: rec.b2Items || [],
          b3Items: rec.b3Items || [],
        });
      }
    }
  }, [activeTab, brsBillId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bills Generated: inline bill viewer state ──
  const [viewBillId, setViewBillId] = useState(null);
  const [viewTab, setViewTab] = useState('expenses'); // 'expenses' | 'ledger' | 'summary'


  useEffect(() => {
    if (appSettings.monthlyBackupReminder) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      if (tomorrow.getDate() === 1) {
        setMsgBox({ isOpen: true, type: 'info', title: 'End of Month Reminder', message: 'Last day of the month. Please export a full backup from Settings.' });
      }
    }
  }, [appSettings.monthlyBackupReminder]);

  // --- GLOBAL LEDGER ---
  const globalLedger = useMemo(() => {
    let currentCash = appSettings.openingCashBalance || 0;
    let currentBank = appSettings.openingBankBalance || 0;
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);
    const rows = sortedTx.map((tx) => {
      let cashRec = 0, bankRec = 0, cashPaid = 0, bankPaid = 0;
      if (tx.type === 'Contra') { cashRec = tx.amount; bankPaid = tx.amount; }
      else if (tx.type === 'Payment' || tx.type === 'Ratification') { if (tx.mode === 'Cash') cashPaid = tx.amount; else bankPaid = tx.amount; }
      else if (tx.type === 'Receipt') { if (tx.mode === 'Cash') cashRec = tx.amount; else bankRec = tx.amount; }
      currentCash += (cashRec - cashPaid);
      currentBank += (bankRec - bankPaid);
      return { ...tx, cashRec, bankRec, cashPaid, bankPaid, balCash: currentCash, balBank: currentBank };
    });
    return { rows, finalCash: currentCash, finalBank: currentBank };
  }, [transactions, appSettings.openingCashBalance, appSettings.openingBankBalance]);

  // --- FILTERED LEDGER (full — used by BRS module) ---
  // --- DRAFT LEDGER (for Expenses / Transactions / Summary — excludes locked/billed transactions) ---
  const draftLedger = useMemo(() => {
    let start, end;
    if (filterType === 'month') { start = `${filterMonth}-01`; end = `${filterMonth}-31`; }
    else { start = filterStartDate; end = filterEndDate; }
    // Only include transactions that are NOT part of any generated bill
    const draftRows = globalLedger.rows.filter(tx => {
      if (tx.date < start || tx.date > end) return false;
      return !generatedBills.some(bill => {
        const inRange = bill.type === 'month'
          ? tx.date.startsWith(bill.value)
          : tx.date >= bill.start && tx.date <= bill.end;
        const genTime = bill.generatedAt ? new Date(bill.generatedAt).getTime() : 0;
        return inRange && Number(tx.id) <= genTime;
      });
    });
    // Opening balance uses ALL transactions before start (locked + unlocked) for financial accuracy
    const priorRows = globalLedger.rows.filter(tx => tx.date < start);
    const openingCash = priorRows.length > 0 ? priorRows[priorRows.length - 1].balCash : 0;
    const openingBank = priorRows.length > 0 ? priorRows[priorRows.length - 1].balBank : 0;
    return { rows: draftRows, openingCash, openingBank };
  }, [globalLedger, filterType, filterMonth, filterStartDate, filterEndDate, generatedBills]);

  // --- PERIOD SUMMARY (draft transactions only) ---
  const periodSummary = useMemo(() => {
    const expenses = draftLedger.rows.filter(tx => tx.type === 'Payment' && !tx.isAdjustment);
    const totalExpenses = expenses.reduce((sum, tx) => sum + tx.amount, 0);
    const totalClaimReceived = draftLedger.rows
      .filter(tx => tx.type === 'Receipt' && tx.particulars.toLowerCase().includes('claim'))
      .reduce((sum, tx) => sum + tx.amount, 0);
    const lastRow = draftLedger.rows[draftLedger.rows.length - 1];
    const closingCash = lastRow ? lastRow.balCash : draftLedger.openingCash;
    const closingBank = lastRow ? lastRow.balBank : draftLedger.openingBank;
    return { totalExpenses, totalClaimReceived, closingCash, closingBank };
  }, [draftLedger]);

  const filteredExpenses = useMemo(() => draftLedger.rows.filter(tx => tx.type === 'Payment' && !tx.isAdjustment), [draftLedger]);
  const summaryAdjustments = useMemo(() => draftLedger.rows.filter(tx => tx.isAdjustment), [draftLedger]);
  const totalAdjustmentAmount = useMemo(() => summaryAdjustments.reduce((sum, tx) => sum + (tx.type === 'Receipt' ? -tx.amount : tx.amount), 0), [summaryAdjustments]);

  const uniqueParticulars = useMemo(() => {
    return [...new Set(transactions.map(t => t.particulars).filter(Boolean))].sort();
  }, [transactions]);

  // --- BUDGET VALIDATION ---
  const getAccountCodeUsage = useCallback((codeStr, excludeId = null) => {
    const rows = globalLedger.rows.filter(tx => tx.accountCode === codeStr && tx.id !== excludeId);
    const paid     = rows.filter(tx => tx.type === 'Payment').reduce((sum, tx) => sum + tx.amount, 0);
    const credited = rows.filter(tx => tx.type === 'Receipt').reduce((sum, tx) => sum + tx.amount, 0);
    return { paid, credited, net: Math.max(0, paid - credited) };
  }, [globalLedger.rows]);
  const activeAccountCode = useMemo(() => accountCodes.find(c => c.code.toUpperCase() === formData.accountCode.toUpperCase()), [formData.accountCode, accountCodes]);
  const budgetWarning = useMemo(() => {
    if (!activeAccountCode || formData.type !== 'Payment') return null;
    const { net } = getAccountCodeUsage(activeAccountCode.code, editingId);
    const amount = parseFloat(formData.amount || 0);
    if ((net + amount) > activeAccountCode.limit)
      return `Warning: Exceeds annual limit of ₹${activeAccountCode.limit.toLocaleString('en-IN')} for ${activeAccountCode.code}.`;
    return null;
  }, [activeAccountCode, formData.amount, formData.type, editingId, getAccountCodeUsage]);

  // --- LOCK LOGIC ---
  // A transaction is locked only if:
  //   (a) its date falls in a generated bill's range, AND
  //   (b) it was created BEFORE that bill was generated (not a late backdated entry)
  const isTransactionLocked = (tx) => {
    if (appSettings.allowEditGenerated) return false;
    return generatedBills.some(bill => {
      const inRange = bill.type === 'month'
        ? tx.date.startsWith(bill.value)
        : tx.date >= bill.start && tx.date <= bill.end;
      if (!inRange) return false;
      // tx.id is Date.now() string at creation time
      return Number(tx.id) <= new Date(bill.generatedAt).getTime();
    });
  };

  // A date-only lock check (for the form date picker warning, not for tx actions)
  // Is a tx a late entry? (date in locked range but entered after bill was generated)
  const isLateEntry = (tx) => {
    if (appSettings.allowEditGenerated) return false;
    return generatedBills.some(bill => {
      const inRange = bill.type === 'month'
        ? tx.date.startsWith(bill.value)
        : tx.date >= bill.start && tx.date <= bill.end;
      if (!inRange) return false;
      return Number(tx.id) > new Date(bill.generatedAt).getTime();
    });
  };

  const isPeriodLocked = useMemo(() => {
    if (filterType === 'month') {
      const bill = generatedBills.find(b => b.type === 'month' && b.value === filterMonth);
      return !!bill;
    }
    return generatedBills.some(b => b.type === 'period' && b.start === filterStartDate && b.end === filterEndDate);
  }, [generatedBills, filterType, filterMonth, filterStartDate, filterEndDate]);

  const getExpenseSerial = (row, index) => {
    if (isPeriodLocked && row.expenseSerial != null) return row.expenseSerial;
    return index + 1;
  };

  // --- HANDLERS ---
  const handleRowDoubleClick = (tx) => {
    if (isTransactionLocked(tx)) {
      setMsgBox({ isOpen: true, type: 'error', title: 'Edit Locked', message: 'This transaction is part of a generated bill and cannot be edited. Enable override in Settings if needed.' });
      return;
    }
    setEditingId(tx.id);
    setFormData({ date: tx.date, particulars: tx.particulars, type: tx.type, mode: tx.mode || 'Cash', amount: tx.amount, accountCode: tx.accountCode === 'NONE' ? '' : tx.accountCode });
    setIsModalOpen(true);
  };

  const openNewTransactionModal = () => {
    setEditingId(null);
    setFormData({ date: new Date().toISOString().split('T')[0], particulars: '', type: 'Payment', mode: 'Cash', amount: '', accountCode: '' });
    setIsModalOpen(true);
  };

  const handleAddVoucherTransaction = useCallback(({ id, date, particulars, amount, accountCode }) => {
    const newTx = {
      id: id || (Date.now() + Math.random()),
      date,
      particulars,
      type: 'Payment',
      mode: 'Cash',
      amount: parseFloat(amount) || 0,
      accountCode: accountCode ? accountCode.toUpperCase() : 'NONE',
      createdAt: Date.now(),
    };
    setTransactions(prev => [...prev, newTx]); // persisted by the transactions effect
  }, []);

  const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.particulars || !formData.amount) return;
    const txData = {
      date: formData.date, particulars: formData.particulars, type: formData.type,
      mode: formData.type === 'Contra' ? null : formData.mode,
      amount: parseFloat(formData.amount),
      accountCode: formData.accountCode ? formData.accountCode.toUpperCase() : 'NONE'
    };
    if (editingId) {
      setTransactions(prev => prev.map(t => t.id === editingId ? { ...t, ...txData } : t));
    } else {
      setTransactions(prev => [...prev, { id: Date.now().toString(), ...txData, isAdjustment: false, expenseSerial: null }]);
    }
    setFormData(prev => ({ ...prev, particulars: '', amount: '', accountCode: '' }));
    setIsModalOpen(false);
    setEditingId(null);
  };

  const toggleAdjustment = (id) => {
    const tx = transactions.find(t => t.id === id);
    if (tx && isTransactionLocked(tx)) {
      setMsgBox({ isOpen: true, type: 'error', title: 'Edit Locked', message: 'Cannot modify adjustments for a generated bill without override.' });
      return;
    }
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, isAdjustment: !t.isAdjustment } : t));
  };

  const handleDeleteTransaction = (id) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    if (isTransactionLocked(tx)) {
      setMsgBox({ isOpen: true, type: 'error', title: 'Delete Locked', message: 'This transaction belongs to a generated bill and cannot be deleted. Enable "Allow Editing Generated Bills" in Settings to override.' });
      return;
    }
    setConfirmBox({
      isOpen: true,
      title: 'Delete Transaction?',
      message: `"${tx.particulars}" on ${fmtDate(tx.date)} (₹${tx.amount.toLocaleString('en-IN')}) will be permanently removed.`,
      onConfirm: () => {
        setTransactions(prev => prev.filter(t => t.id !== id));
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteBill = (bill) => {
    const { claimNoStr, periodLabel } = getBillLedgerData(bill);
    setConfirmBox({
      isOpen: true,
      title: 'Delete Bill Record?',
      message: `Claim No. ${claimNoStr} (${periodLabel}) will be removed. This will UNLOCK the period and reset all frozen expense serial numbers. This cannot be undone.`,
      onConfirm: () => {
        // Remove the bill from generatedBills
        setGeneratedBills(prev => prev.filter(b => {
          if (b.type !== bill.type) return true;
          if (b.type === 'month') return b.value !== bill.value;
          return !(b.start === bill.start && b.end === bill.end);
        }));
        // Reset expenseSerial for all transactions in this period
        const start = bill.type === 'month' ? `${bill.value}-01` : bill.start;
        const end   = bill.type === 'month' ? `${bill.value}-31` : bill.end;
        setTransactions(prev => prev.map(t =>
          (t.date >= start && t.date <= end) ? { ...t, expenseSerial: null } : t
        ));
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
        setMsgBox({ isOpen: true, type: 'success', title: 'Bill Deleted', message: `Claim No. ${claimNoStr} removed. Period is now unlocked and expense serials have been reset.` });
      }
    });
  };

  const handleGenerateBill = () => {
    const newBill = filterType === 'month'
      ? { type: 'month', value: filterMonth }
      : { type: 'period', start: filterStartDate, end: filterEndDate };
    const isAlreadyGenerated = generatedBills.some(b =>
      b.type === newBill.type &&
      (b.type === 'month' ? b.value === newBill.value : (b.start === newBill.start && b.end === newBill.end)));
    if (isAlreadyGenerated) {
      setMsgBox({ isOpen: true, type: 'info', title: 'Already Generated', message: 'Bill for this period has already been generated.' });
      return;
    }
    const expenseIds = filteredExpenses.map((tx, idx) => ({ id: tx.id, serial: idx + 1 }));
    setTransactions(prev => prev.map(t => {
      const found = expenseIds.find(e => e.id === t.id);
      return found ? { ...t, expenseSerial: found.serial } : t;
    }));
    // Save rich metadata with the bill for the Bills Generated page
    const billWithMeta = {
      id: Date.now().toString(),
      ...newBill,
      claimNo,
      generatedAt: new Date().toISOString(),
      totalExpenses: periodSummary.totalExpenses,
      expenseCount: filteredExpenses.length,
      previousClaims: [...previousClaims],
    };
    setGeneratedBills(prev => [...prev, billWithMeta]);
    setMsgBox({ isOpen: true, type: 'success', title: 'Bill Generated & Locked', message: 'Expense serial numbers have been stamped and locked. This period is now read-only.' });
  };

  const handleSaveSettings = () => setMsgBox({ isOpen: true, type: 'success', title: 'Settings Saved', message: 'All configurations saved successfully.' });

  // --- PETTY CASH VOUCHER BRANDING ---
  const handleVoucherLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataURL(file, 700);
      setAppSettings(prev => ({ ...prev, pettyCashVoucher: { ...(prev.pettyCashVoucher || {}), headerLogo: dataUrl } }));
    } catch {
      setMsgBox({ isOpen: true, type: 'error', title: 'Upload Failed', message: 'Could not read that image file.' });
    }
    if (voucherLogoInputRef.current) voucherLogoInputRef.current.value = '';
  };

  const handleRemoveVoucherLogo = () => {
    setAppSettings(prev => ({ ...prev, pettyCashVoucher: { ...(prev.pettyCashVoucher || {}), headerLogo: null } }));
  };

  const applyFooterFormat = (command, value = null) => {
    voucherFooterRef.current?.focus();
    document.execCommand(command, false, value);
    setAppSettings(prev => ({ ...prev, pettyCashVoucher: { ...(prev.pettyCashVoucher || {}), footerHtml: sanitizeHtml(voucherFooterRef.current?.innerHTML || '') } }));
  };

  const handleFooterInput = () => {
    setAppSettings(prev => ({ ...prev, pettyCashVoucher: { ...(prev.pettyCashVoucher || {}), footerHtml: sanitizeHtml(voucherFooterRef.current?.innerHTML || '') } }));
  };

  const handleClearFooter = () => {
    if (voucherFooterRef.current) voucherFooterRef.current.innerHTML = '';
    setAppSettings(prev => ({ ...prev, pettyCashVoucher: { ...(prev.pettyCashVoucher || {}), footerHtml: '' } }));
  };

  // --- NETWORK / LAN SYNC (stage 2: server control + connectivity check only —
  //     the Main Cashbook doesn't read/write through this yet) ---
  const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const [serverStatus, setServerStatus] = useState({ running: false, port: null, lanIp: null });
  const [serverBusy, setServerBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [clientTest, setClientTest] = useState({ testing: false, connected: null, error: '' });

  const refreshServerStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke('get_server_status');
      setServerStatus({ running: status.running, port: status.port, lanIp: status.lan_ip });
    } catch (e) { console.error('Failed to read server status', e); }
  }, []);

  useEffect(() => { refreshServerStatus(); }, [refreshServerStatus]);

  const updateNetwork = (patch) => setAppSettings(prev => ({ ...prev, network: { ...prev.network, ...patch } }));

  const handleGeneratePin = () => updateNetwork({ pin: generatePin() });

  const handleStopHostServer = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setServerBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_host_server');
      setServerStatus({ running: false, port: null, lanIp: null });
      cashbookSync.stopSync();
    } catch (e) { setServerError(String(e)); }
    finally { setServerBusy(false); }
  }, [cashbookSync]);

  const handleSetNetworkMode = async (mode) => {
    if (appSettings.network.mode === 'host' && mode !== 'host' && serverStatus.running) {
      await handleStopHostServer();
    }
    cashbookSync.stopSync();
    setServerError('');
    setClientTest({ testing: false, connected: null, error: '' });
    updateNetwork({ mode, pin: appSettings.network.pin || (mode === 'host' ? generatePin() : '') });
  };

  const handleStartHostServer = async () => {
    if (!isTauriRuntime()) { setServerError('Network Sync requires the desktop app — this preview is running in a plain browser.'); return; }
    if (appSettings.network.pin.trim().length < MIN_PIN_LENGTH) { setServerError(`Use a PIN of at least ${MIN_PIN_LENGTH} characters (Generate makes a strong one).`); return; }
    setServerBusy(true); setServerError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke('start_host_server', { pin: appSettings.network.pin, port: Number(appSettings.network.port) || 4321 });
      setServerStatus({ running: status.running, port: status.port, lanIp: status.lan_ip });
      cashbookSync.startSync();
    } catch (e) {
      setServerError(String(e));
    } finally { setServerBusy(false); }
  };

  // Resume Host mode automatically on launch if this machine was left hosting
  // last time (mirrors the Client auto-resume declared up near cashbookSync).
  useEffect(() => {
    if (appSettings.network.mode === 'host') handleStartHostServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestClientConnection = async () => {
    const { hostIp, port, pin } = appSettings.network;
    if (!hostIp.trim()) { setClientTest({ testing: false, connected: false, error: "Enter the host PC's IP address." }); return; }
    setClientTest({ testing: true, connected: null, error: '' });
    try {
      const base = `http://${hostIp}:${port || 4321}`;
      const pingRes = await fetch(`${base}/api/ping`);
      if (!pingRes.ok) throw new Error('Host not reachable');
      const dataRes = await fetch(`${base}/api/data`, { headers: { 'X-Cashbook-Pin': pin } });
      if (dataRes.status === 401) throw new Error('Wrong PIN');
      if (!dataRes.ok) throw new Error(`Host responded with ${dataRes.status}`);
      setClientTest({ testing: false, connected: true, error: '' });
    } catch (e) {
      setClientTest({ testing: false, connected: false, error: e.message || 'Could not reach host' });
    }
  };

  const handleAddAccountCode = () => {
    if (newCodeForm.code && newCodeForm.limit) {
      setAccountCodes([...accountCodes, { id: Date.now().toString(), code: newCodeForm.code.toUpperCase(), limit: parseFloat(newCodeForm.limit), description: newCodeForm.description }]);
      setNewCodeForm({ code: '', limit: '', description: '' });
    }
  };

  const handleRemoveAccountCode = (id) => setAccountCodes(prev => prev.filter(c => c.id !== id));
  const handlePrint = () => window.print();

  const handleExportCSV = (data, filename) => {
    const csvString = data.map(row => row.map(cell => {
      let val = cell === null || cell === undefined ? '' : String(cell);
      // Text starting with = + - @ is run as a formula when the CSV is opened in
      // Excel; a leading apostrophe makes it plain text. Real numbers are left alone.
      if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(val)) val = `'${val}`;
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  const exportFullBackup = () => {
    // Exclude `network` (host IP / PIN) — that's this machine's own identity,
    // not something that should travel inside a shareable backup file.
    const { network: _network, ...settingsForBackup } = appSettings;
    const backupData = { timestamp: new Date().toISOString(), appSettings: settingsForBackup, accountCodes, generatedBills, brsRecords, previousClaims, transactions };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `Cashbook_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleImportData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (importedData.appSettings && typeof importedData.appSettings === 'object' && Array.isArray(importedData.transactions)) {
          setAppSettings(prev => ({
            ...prev, ...importedData.appSettings,
            signatories: { ...(prev.signatories || {}), ...(importedData.appSettings.signatories || {}) },
            pettyCashVoucher: {
              ...(prev.pettyCashVoucher || {}), ...(importedData.appSettings.pettyCashVoucher || {}),
              // A backup is untrusted input: never keep markup that was not produced by the editor.
              footerHtml: sanitizeHtml(importedData.appSettings.pettyCashVoucher?.footerHtml || prev.pettyCashVoucher?.footerHtml || ''),
            },
            // Network config is this machine's own identity (host IP/PIN), not
            // portable data — never let an imported backup from another PC overwrite it.
            network: prev.network
          }));
          if (Array.isArray(importedData.accountCodes)) setAccountCodes(importedData.accountCodes);
          if (Array.isArray(importedData.generatedBills)) setGeneratedBills(importedData.generatedBills);
          if (Array.isArray(importedData.brsRecords)) setBrsRecords(importedData.brsRecords);
          if (Array.isArray(importedData.previousClaims)) setPreviousClaims(importedData.previousClaims);
          setTransactions(normalizeTransactions(importedData.transactions));
          setMsgBox({ isOpen: true, type: 'success', title: 'Import Successful', message: 'Database restored successfully.' });
        } else throw new Error('Invalid format');
      } catch { setMsgBox({ isOpen: true, type: 'error', title: 'Import Failed', message: 'Not a valid Cashbook backup JSON.' }); }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const loadSampleData = () => {
    setConfirmBox({
      isOpen: true,
      title: 'Load sample data?',
      message: 'This replaces all transactions and generated bills with a small demo ledger. Export a backup first if you want to keep your current data.',
      confirmLabel: 'Load Sample Data',
      onConfirm: () => {
        const sample = buildSampleData();
        setTransactions(sample.transactions);
        setGeneratedBills([]);
        setBrsRecords([]);
        setPreviousClaims(sample.previousClaims);
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
        setMsgBox({ isOpen: true, type: 'success', title: 'Sample Data Loaded', message: 'A demo ledger for the last two months is ready. Try the Expenses, Summary and Bills tabs.' });
      }
    });
  };

  const exportTransactions = () => {
    const headers = ["Sr.#", "Date", "Particulars", "Type", "Cash Rec", "Bank Rec", "Cash Paid", "Bank Paid", "Bal Cash", "Bal Bank", "Is Adjustment"];
    const rows = draftLedger.rows.map((r, i) => [i + 1, r.date, r.particulars, r.type, r.cashRec, r.bankRec, r.cashPaid, r.bankPaid, r.balCash, r.balBank, r.isAdjustment ? "Yes" : "No"]);
    handleExportCSV([headers, ...rows], "transactions_ledger.csv");
  };

  const exportExpenses = () => {
    const headers = ["Sr.#", "Date", "Payee", "Cash", "Bank", "Total", "Account Code"];
    const rows = filteredExpenses.map((r, i) => [getExpenseSerial(r, i), r.date, r.particulars, r.cashPaid, r.bankPaid, r.amount, r.accountCode]);
    handleExportCSV([headers, ...rows], "expense_statement.csv");
  };

  // --- SHEETJS (bundled, loaded on first export so it stays out of the main chunk) ---
  const loadXLSX = () => import('xlsx');

  // --- Helper: compute ledger data for a given bill ---
  // Only includes transactions that existed at the time the bill was generated
  const getBillLedgerData = (bill) => {
    const start = bill.type === 'month' ? `${bill.value}-01` : bill.start;
    const end   = bill.type === 'month' ? `${bill.value}-31` : bill.end;
    const billGenTime = bill.generatedAt ? new Date(bill.generatedAt).getTime() : Infinity;
    // A tx belongs to this bill only if its date is in range AND it was created before bill generation
    const filteredRows = globalLedger.rows.filter(tx =>
      tx.date >= start && tx.date <= end && Number(tx.id) <= billGenTime
    );
    const priorRows    = globalLedger.rows.filter(tx => tx.date < start && Number(tx.id) <= billGenTime);
    const openingCash  = priorRows.length > 0 ? priorRows[priorRows.length - 1].balCash : 0;
    const openingBank  = priorRows.length > 0 ? priorRows[priorRows.length - 1].balBank : 0;
    const expenses     = filteredRows.filter(tx => tx.type === 'Payment' && !tx.isAdjustment);
    const adjustments  = filteredRows.filter(tx => tx.isAdjustment);
    const totalExpenses = expenses.reduce((s, tx) => s + tx.amount, 0);
    const totalAdjAmt   = adjustments.reduce((s, tx) => s + (tx.type === 'Receipt' ? -tx.amount : tx.amount), 0);
    const lastRow       = filteredRows[filteredRows.length - 1];
    const closingCash   = lastRow ? lastRow.balCash : openingCash;
    const closingBank   = lastRow ? lastRow.balBank : openingBank;
    const claimNoStr    = bill.claimNo || (bill.type === 'month' ? formatClaimNo(bill.value) : `${start.slice(5,7)}/${start.slice(0,4)}`);
    const periodLabel   = bill.type === 'month' ? bill.value : `${start} to ${end}`;
    return { filteredRows, openingCash, openingBank, closingCash, closingBank, expenses, adjustments, totalExpenses, totalAdjAmt, claimNoStr, periodLabel };
  };

  // --- EXCEL EXPORT for a bill (3 sheets) ---
  const exportBillExcel = async (bill) => {
    try {
      const XLSX = await loadXLSX();
      const { filteredRows, openingCash, openingBank, closingCash, closingBank,
              expenses, adjustments, totalExpenses, totalAdjAmt, claimNoStr, periodLabel } = getBillLedgerData(bill);

      const wb = XLSX.utils.book_new();
      const org = orgName;

      // ── SHEET 1: Expenses ──
      const expData = [
        [org],
        ['Expense Statement'],
        [`Claim No. ${claimNoStr}`],
        [`Period: ${periodLabel}`],
        [],
        ['Sr.#', 'Date', 'Payee / Particulars', 'Cash (₹)', 'Bank (₹)', 'Total (₹)', 'Account Code'],
      ];
      expenses.forEach((r, i) => {
        expData.push([
          r.expenseSerial || (i + 1),
          r.date,
          r.particulars,
          r.cashPaid || '',
          r.bankPaid || '',
          r.amount,
          r.accountCode !== 'NONE' ? r.accountCode : ''
        ]);
      });
      expData.push([
        '', '', 'TOTAL',
        expenses.reduce((s, r) => s + r.cashPaid, 0),
        expenses.reduce((s, r) => s + r.bankPaid, 0),
        totalExpenses,
        ''
      ]);
      expData.push([]);
      expData.push(['Prepared By', '', appSettings.signatories?.preparedBy || '']);
      expData.push(['Authorized By', '', appSettings.signatories?.authorizedBy || '']);
      const wsExp = XLSX.utils.aoa_to_sheet(expData);
      wsExp['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

      // ── SHEET 2: Ledger ──
      const ledData = [
        [org],
        [`Transaction Ledger — Claim No. ${claimNoStr}`],
        [`Period: ${periodLabel}   |   Printed: ${new Date().toLocaleDateString('en-IN')}`],
        [],
        ['Sr.#', 'Date', 'Particulars', 'Cash Rec (₹)', 'Bank Rec (₹)', 'Cash Paid (₹)', 'Bank Paid (₹)', 'Bal Cash (₹)', 'Bal Bank (₹)', 'Adj?'],
        ['—', '—', `Opening Balance (as of ${bill.type === 'month' ? bill.value + '-01' : bill.start})`, '', '', '', '', openingCash.toFixed(2), openingBank.toFixed(2), ''],
      ];
      filteredRows.forEach((r, i) => {
        ledData.push([
          i + 1, r.date, r.particulars,
          r.cashRec || '', r.bankRec || '',
          r.cashPaid || '', r.bankPaid || '',
          r.balCash.toFixed(2), r.balBank.toFixed(2),
          r.isAdjustment ? 'Adj' : r.type === 'Ratification' ? 'Ratification' : ''
        ]);
      });
      ledData.push(['', '', 'CLOSING BALANCE', '', '', '', '', closingCash.toFixed(2), closingBank.toFixed(2), '']);
      const wsLed = XLSX.utils.aoa_to_sheet(ledData);
      wsLed['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 38 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsLed, 'Ledger');

      // ── SHEET 3: Summary ──
      const sumData = [
        [org],
        [`Petty Cash Replenishment No. ${claimNoStr}`],
        [`Date: ${new Date().toLocaleDateString('en-IN')}`],
        [],
        ['#', 'Particulars', 'Amount (Rs.)'],
        ['1', 'Cash Balance (Period Closing)', closingCash.toFixed(2)],
        ['2', 'Bank Balance as per Cash Book (Period Closing)', closingBank.toFixed(2)],
        ['3', `Current Claim Expenses (${periodLabel})`, totalExpenses.toFixed(2)],
      ];
      adjustments.forEach(tx => {
        sumData.push(['', `${tx.type === 'Receipt' ? 'Less' : 'Add'}: ${tx.particulars}`, (tx.type === 'Receipt' ? -tx.amount : tx.amount).toFixed(2)]);
      });
      const billPrevClaims = bill.previousClaims || [];
      billPrevClaims.forEach(claim => {
        sumData.push(['', claimLabel(claim), parseFloat(claim.amount).toFixed(2)]);
      });
      const billPrevClaimsTotal = billPrevClaims.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
      sumData.push(['', '', (totalExpenses + totalAdjAmt + billPrevClaimsTotal).toFixed(2)]);
      sumData.push(['', 'TOTAL IMPREST AMOUNT', (appSettings.imprestAmount || 600000).toFixed(2)]);
      sumData.push([]);
      sumData.push(['Prepared By', appSettings.signatories?.preparedBy || '', '']);
      sumData.push(['Authorized By', appSettings.signatories?.authorizedBy || '', '']);
      sumData.push(['Approved By', appSettings.signatories?.approvedBy || '', '']);
      const wsSum = XLSX.utils.aoa_to_sheet(sumData);
      wsSum['!cols'] = [{ wch: 6 }, { wch: 52 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');

      // Download
      XLSX.writeFile(wb, `Cashbook_Claim_${claimNoStr.replace('/', '-')}_${periodLabel.replace(/\s/g, '_')}.xlsx`);
    } catch {
      setMsgBox({ isOpen: true, type: 'error', title: 'Export Failed', message: 'Could not generate the Excel file.' });
    }
  };

  // ── BRS: get actual date range from a bill ──
  const getBillDateRange = (bill) => {
    if (!bill) return { startDate: '', endDate: '' };
    if (bill.type === 'month') {
      return { startDate: `${bill.value}-01`, endDate: `${bill.value}-31` };
    }
    return { startDate: bill.start || '', endDate: bill.end || '' };
  };

  // ── BRS: closing bank balance over an actual date range ──
  const getBrsClosingBankByRange = (startDate, endDate) => {
    const rangeRows = globalLedger.rows.filter(tx => tx.date >= startDate && tx.date <= endDate);
    const priorRows = globalLedger.rows.filter(tx => tx.date < startDate);
    const openBank  = priorRows.length ? priorRows[priorRows.length - 1].balBank : 0;
    const lastRow   = rangeRows[rangeRows.length - 1];
    return lastRow ? lastRow.balBank : openBank;
  };

  // ── BRS: compute totals — uses startDate/endDate if present, falls back to month ──
  const computeBrsTotals = (record) => {
    const startDate = record.startDate || (record.month ? `${record.month}-01` : '');
    const endDate   = record.endDate   || (record.month ? `${record.month}-31` : '');
    const a1 = getBrsClosingBankByRange(startDate, endDate);
    const a2Total = (record.a2Items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const a3Total = (record.a3Items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const adjCashBook = a1 + a2Total - a3Total;
    const b1 = parseFloat(record.bankStatementBalance || 0);
    const b2Total = (record.b2Items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const b3Total = (record.b3Items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const adjBank = b1 + b2Total - b3Total;
    const difference = adjCashBook - adjBank;
    return { a1, a2Total, a3Total, adjCashBook, b1, b2Total, b3Total, adjBank, difference, startDate, endDate };
  };

  // ── BRS: get BRS record for a bill ──
  const getBrsForBill = (bill) => brsRecords.find(r => r.billId === bill.id);

  // ── BRS: get status for a bill ──
  const getBrsBillStatus = (bill) => {
    const rec = getBrsForBill(bill);
    if (!rec) return 'missing';
    if (!rec.lockedAt) return 'draft';
    const totals = computeBrsTotals(rec);
    return totals.difference === 0 ? 'balanced' : 'mismatched';
  };

  // ── BRS: bill's claimNo display string ──
  const getBillClaimNo = (bill) => {
    if (bill.claimNo) return bill.claimNo;
    const { startDate } = getBillDateRange(bill);
    return startDate ? `${startDate.slice(5,7)}/${startDate.slice(0,4)}` : '—';
  };

  // ── BRS: save draft — keyed by billId ──
  const handleSaveBrsDraft = () => {
    if (!brsDraft || !brsBillId) return;
    const bill = generatedBills.find(b => b.id === brsBillId);
    if (!bill) return;
    const { startDate, endDate } = getBillDateRange(bill);
    const claimNo = getBillClaimNo(bill);
    const existing = brsRecords.find(r => r.billId === brsBillId);
    const baseRecord = { billId: brsBillId, claimNo, startDate, endDate, month: startDate.slice(0, 7) };
    if (existing) {
      setBrsRecords(prev => prev.map(r => r.billId === brsBillId
        ? { ...r, ...baseRecord, ...brsDraft, updatedAt: new Date().toISOString() } : r));
    } else {
      setBrsRecords(prev => [...prev, { id: Date.now().toString(), ...baseRecord, ...brsDraft, createdAt: new Date().toISOString(), lockedAt: null }]);
    }
    setMsgBox({ isOpen: true, type: 'success', title: 'BRS Saved', message: `Draft BRS for Claim ${claimNo} saved.` });
  };

  // ── BRS: lock / finalise ──
  const handleLockBrs = () => {
    if (!brsDraft || !brsBillId) return;
    const bill = generatedBills.find(b => b.id === brsBillId);
    if (!bill) return;
    const { startDate, endDate } = getBillDateRange(bill);
    const claimNo = getBillClaimNo(bill);
    const totals = computeBrsTotals({ ...brsDraft, startDate, endDate });
    const confirmMsg = totals.difference === 0
      ? `BRS for Claim ${claimNo} is balanced (Difference = 0). Finalise and lock?`
      : `Difference is ₹${Math.abs(totals.difference).toLocaleString('en-IN')} (${totals.difference > 0 ? 'surplus' : 'shortfall'}). Lock anyway?`;
    setConfirmBox({
      isOpen: true,
      title: `Lock BRS — Claim ${claimNo}`,
      message: confirmMsg + ' Locked records cannot be edited without re-opening.',
      confirmLabel: 'Yes, Finalise',
      confirmBtnClass: 'bg-emerald-600 hover:bg-emerald-700',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
      iconEl: <Lock size={20} className="text-emerald-600 dark:text-emerald-400" />,
      onConfirm: () => {
        const baseRecord = { billId: brsBillId, claimNo, startDate, endDate, month: startDate.slice(0, 7) };
        const existing = brsRecords.find(r => r.billId === brsBillId);
        const now = new Date().toISOString();
        if (existing) {
          setBrsRecords(prev => prev.map(r => r.billId === brsBillId
            ? { ...r, ...baseRecord, ...brsDraft, lockedAt: now } : r));
        } else {
          setBrsRecords(prev => [...prev, { id: Date.now().toString(), ...baseRecord, ...brsDraft, createdAt: now, lockedAt: now }]);
        }
        setBrsDraft(null);
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
        setMsgBox({ isOpen: true, type: 'success', title: 'BRS Locked', message: `BRS for Claim ${claimNo} has been finalised and locked.` });
      }
    });
  };

  // ── BRS: delete record ──
  const handleDeleteBrs = (billId) => {
    const rec = brsRecords.find(r => r.billId === billId);
    const label = rec?.claimNo || billId;
    setConfirmBox({
      isOpen: true,
      title: 'Delete BRS Record?',
      message: `BRS for Claim ${label} will be permanently deleted. All reconciliation data will be lost. This cannot be undone.`,
      onConfirm: () => {
        setBrsRecords(prev => prev.filter(r => r.billId !== billId));
        if (brsBillId === billId) setBrsDraft(null);
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
        setMsgBox({ isOpen: true, type: 'success', title: 'BRS Deleted', message: `BRS record for Claim ${label} removed.` });
      }
    });
  };

  // ── BRS: re-open a locked record ──
  const handleReOpenBrs = (billId) => {
    const rec = brsRecords.find(r => r.billId === billId);
    if (!rec) return;
    const label = rec.claimNo || billId;
    setConfirmBox({
      isOpen: true,
      title: `Re-open BRS — Claim ${label}?`,
      message: 'This will unlock the BRS record and allow editing again. It will revert to Draft status until you re-finalise.',
      confirmLabel: 'Yes, Re-open',
      confirmBtnClass: 'bg-amber-500 hover:bg-amber-600',
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
      iconEl: <Unlock size={20} className="text-amber-600 dark:text-amber-400" />,
      onConfirm: () => {
        setBrsRecords(prev => prev.map(r => r.billId === billId ? { ...r, lockedAt: null } : r));
        setBrsBillId(billId);
        setBrsDraft({ bankStatementBalance: rec.bankStatementBalance, a2Items: rec.a2Items || [], a3Items: rec.a3Items || [], b2Items: rec.b2Items || [], b3Items: rec.b3Items || [] });
        setActiveTab('brs');
        setConfirmBox(prev => ({ ...prev, isOpen: false }));
        setMsgBox({ isOpen: true, type: 'info', title: 'BRS Re-opened', message: `BRS for Claim ${label} is now editable. Remember to finalise and lock when done.` });
      }
    });
  };

  // ── BRS: get status for dashboard/history grids — by claimNo month (MM/YYYY → find bill → find BRS) ──
  // ── BRS: export entire year as one Excel (each bill-BRS = one sheet) ──
  const exportBrsYearExcel = async (year) => {
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.utils.book_new();
      const org = orgName;
      // Find all bills whose claimNo year matches
      const billsInYear = generatedBills.filter(b => {
        const cn = getBillClaimNo(b);
        return cn.endsWith(`/${year}`);
      }).sort((a, b) => getBillDateRange(a).startDate.localeCompare(getBillDateRange(b).startDate));

      let sheetsAdded = 0;
      billsInYear.forEach(bill => {
        const rec = getBrsForBill(bill);
        if (!rec) return;
        const totals = computeBrsTotals(rec);
        const claimNo = getBillClaimNo(bill);
        const { startDate, endDate } = getBillDateRange(bill);
        const status = rec.lockedAt ? (totals.difference === 0 ? 'BALANCED' : 'MISMATCHED') : 'DRAFT';
        const periodLabel = bill.type === 'month' ? bill.value : `${startDate} to ${endDate}`;

        const sheetData = [
          [org],
          ['BANK RECONCILIATION STATEMENT'],
          [`Claim No. ${claimNo}  |  Period: ${periodLabel}`],
          [`Status: ${status}  |  Prepared: ${new Date().toLocaleDateString('en-IN')}`],
          [],
          ['A', 'CASH BOOK BALANCE', ''],
          ['1', 'Balance as per cash book', totals.a1.toFixed(2)],
          ['2', 'Add: Cheques issued but not cleared', totals.a2Total > 0 ? totals.a2Total.toFixed(2) : '-'],
          ['3', 'Less: Cheques deposited but not credited', totals.a3Total > 0 ? `(${totals.a3Total.toFixed(2)})` : '-'],
          ['', 'Adjusted Cash Book Balance', totals.adjCashBook.toFixed(2)],
          [],
          ['B', 'BANK BALANCE', ''],
          ['1', 'Balance as per bank statement', totals.b1.toFixed(2)],
          ['2', 'Add: Bank charges not in cash book', totals.b2Total > 0 ? totals.b2Total.toFixed(2) : '-'],
          ['3', 'Less: Bank credits not in cash book', totals.b3Total > 0 ? `(${totals.b3Total.toFixed(2)})` : '-'],
          ['', 'Adjusted Bank Balance', totals.adjBank.toFixed(2)],
          [],
          ['C', 'Difference (A - B)', totals.difference.toFixed(2)],
          [],
        ];
        if (rec.a2Items?.length) { sheetData.push(['A2 — Cheques Issued But Not Cleared','','','','']); sheetData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); rec.a2Items.forEach((item, i) => sheetData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); sheetData.push(['','','','TOTAL',totals.a2Total.toFixed(2)]); sheetData.push([]); }
        if (rec.a3Items?.length) { sheetData.push(['A3 — Cheques Deposited But Not Credited','','','','']); sheetData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); rec.a3Items.forEach((item, i) => sheetData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); sheetData.push(['','','','TOTAL',totals.a3Total.toFixed(2)]); sheetData.push([]); }
        if (rec.b2Items?.length) { sheetData.push(['B2 — Bank Charges','','','','']); sheetData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); rec.b2Items.forEach((item, i) => sheetData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); sheetData.push(['','','','TOTAL',totals.b2Total.toFixed(2)]); sheetData.push([]); }
        if (rec.b3Items?.length) { sheetData.push(['B3 — Bank Credits','','','','']); sheetData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); rec.b3Items.forEach((item, i) => sheetData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); sheetData.push(['','','','TOTAL',totals.b3Total.toFixed(2)]); sheetData.push([]); }
        sheetData.push(['Prepared By', appSettings.signatories?.preparedBy || '', '', 'Authorized By', appSettings.signatories?.authorizedBy || '']);

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws['!cols'] = [{ wch: 4 }, { wch: 44 }, { wch: 16 }, { wch: 28 }, { wch: 16 }];
        // Sheet name: Claim 07-2025 (safe for Excel)
        XLSX.utils.book_append_sheet(wb, ws, `Claim ${claimNo.replace('/', '-')}`);
        sheetsAdded++;
      });

      if (sheetsAdded === 0) {
        setMsgBox({ isOpen: true, type: 'info', title: 'No BRS Records', message: `No BRS records found for bills in ${year}.` });
        return;
      }
      XLSX.writeFile(wb, `BRS_Annual_${year}.xlsx`);
    } catch {
      setMsgBox({ isOpen: true, type: 'error', title: 'Export Failed', message: 'Could not generate the Excel file.' });
    }
  };

  // ── BRS: add item to a section ──
  const addBrsItem = (section, item) => {
    const key = sectionKey(section);
    setBrsDraft(prev => {
      if (prev === null) {
        const rec = brsRecordsRef.current.find(r => r.billId === brsBillIdRef.current);
        prev = rec
          ? { bankStatementBalance: rec.bankStatementBalance, a2Items: [...(rec.a2Items||[])], a3Items: [...(rec.a3Items||[])], b2Items: [...(rec.b2Items||[])], b3Items: [...(rec.b3Items||[])] }
          : { bankStatementBalance: '', a2Items: [], a3Items: [], b2Items: [], b3Items: [] };
      }
      return { ...prev, [key]: [...(prev[key] || []), { id: Date.now().toString(), ...item, amount: parseFloat(item.amount) || 0 }] };
    });
  };

  const removeBrsItem = (section, itemId) => {
    const key = sectionKey(section);
    setBrsDraft(prev => {
      if (!prev) return prev;
      return { ...prev, [key]: (prev[key] || []).filter(i => i.id !== itemId) };
    });
  };

  // ── BRS: toggle a transaction as A2/A3 item ──
  const toggleBrsTxPicker = (section, tx) => {
    const key = sectionKey(section);
    const existing = (brsDraft?.[key] ?? []).find(i => i.txId === tx.id);
    if (existing) {
      removeBrsItem(section, existing.id);
    } else {
      addBrsItem(section, { txId: tx.id, date: tx.date, refNo: '', particulars: tx.particulars, amount: tx.amount });
    }
  };

  // ── BRS: Excel export (single record) ──
  const exportBrsExcel = async (record) => {
    try {
      const XLSX = await loadXLSX();
      const totals = computeBrsTotals(record);
      const claimNo = record.claimNo || record.month || '';
      const periodLabel = record.startDate && record.endDate && record.startDate !== record.endDate
        ? `${record.startDate} to ${record.endDate}`
        : (record.startDate || record.month || '');
      const printDate = new Date().toLocaleDateString('en-IN');
      const org = orgName;
      const wb = XLSX.utils.book_new();
      const brsData = [
        [org],
        ['BANK RECONCILIATION STATEMENT'],
        [`Claim No. ${claimNo}  |  Period: ${periodLabel}`],
        [`Prepared: ${printDate}`],
        [],
        ['A', 'CASH BOOK BALANCE', ''],
        ['1', 'Balance as per cash book', totals.a1.toFixed(2)],
        ['2', 'Add: Cheques issued but not cleared', totals.a2Total.toFixed(2)],
        ['3', 'Less: Cheques deposited but not credited by bank', totals.a3Total ? `(${totals.a3Total.toFixed(2)})` : '-'],
        ['', 'Adjusted Cash Book Balance', totals.adjCashBook.toFixed(2)],
        [],
        ['B', 'BANK BALANCE', ''],
        ['1', 'Balance as per bank statement', totals.b1.toFixed(2)],
        ['2', 'Add: Bank charges not reflected in cash book', totals.b2Total ? totals.b2Total.toFixed(2) : '-'],
        ['3', 'Less: Bank credits not reflected in cash book', totals.b3Total ? `(${totals.b3Total.toFixed(2)})` : '-'],
        ['', 'Adjusted Bank Balance', totals.adjBank.toFixed(2)],
        [],
        ['C', `Difference (A - B)`, totals.difference.toFixed(2)],
        [],
      ];
      if (record.a2Items?.length) { brsData.push(['','A2 — Cheques Issued But Not Cleared','']); brsData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); record.a2Items.forEach((item,i)=>brsData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); brsData.push(['','','','TOTAL',totals.a2Total.toFixed(2)]); brsData.push([]); }
      if (record.a3Items?.length) { brsData.push(['','A3 — Cheques Deposited But Not Credited','']); brsData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); record.a3Items.forEach((item,i)=>brsData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); brsData.push(['','','','TOTAL',totals.a3Total.toFixed(2)]); brsData.push([]); }
      if (record.b2Items?.length) { brsData.push(['','B2 — Bank Charges Not in Cash Book','']); brsData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); record.b2Items.forEach((item,i)=>brsData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); brsData.push(['','','','TOTAL',totals.b2Total.toFixed(2)]); brsData.push([]); }
      if (record.b3Items?.length) { brsData.push(['','B3 — Bank Credits Not in Cash Book','']); brsData.push(['#','Date','Ref. No.','Particulars','Amount (Rs.)']); record.b3Items.forEach((item,i)=>brsData.push([i+1,item.date,item.refNo||'',item.particulars,parseFloat(item.amount).toFixed(2)])); brsData.push(['','','','TOTAL',totals.b3Total.toFixed(2)]); brsData.push([]); }
      brsData.push(['Prepared By', appSettings.signatories?.preparedBy || '', '', 'Authorized By', appSettings.signatories?.authorizedBy || '']);
      const wsBrs = XLSX.utils.aoa_to_sheet(brsData);
      wsBrs['!cols'] = [{ wch: 4 }, { wch: 48 }, { wch: 18 }, { wch: 30 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsBrs, 'BRS');
      XLSX.writeFile(wb, `BRS_Claim_${claimNo.replace('/', '-')}.xlsx`);
    } catch {
      setMsgBox({ isOpen: true, type: 'error', title: 'Export Failed', message: 'Could not generate the Excel file.' });
    }
  };


  // ── SIGNATURE BLOCK for Expenses & Transactions PDFs (2 signatories only) ──
  const SignatureBlock = () => (
    <div className="hidden print:grid grid-cols-2 gap-16 mt-16 pt-8 text-center text-sm font-bold border-t border-gray-400">
      <div><div className="h-16 border-b border-gray-600 mb-2"></div>{appSettings.signatories?.preparedBy || 'Prepared By'}</div>
      <div><div className="h-16 border-b border-gray-600 mb-2"></div>{appSettings.signatories?.authorizedBy || 'Authorized By'}</div>
    </div>
  );

  // --- FILTER BAR ---
  const FilterBar = ({ onExport, exportLabel }) => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 mb-6 flex flex-wrap gap-4 items-end print:hidden transition-colors">
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Filter By</label>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-md p-2">
          <option value="month">Month-wise</option>
          <option value="period">Period-wise</option>
        </select>
      </div>
      {filterType === 'month' ? (
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Select Month</label>
          <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-md p-2" />
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Start Date</label>
            <input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} className="bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-md p-2" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">End Date</label>
            <input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} className="bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-md p-2" />
          </div>
        </>
      )}
      <div className="flex-1"></div>
      <div className="flex gap-2">
        <button onClick={handlePrint} className="flex items-center gap-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-md text-sm font-medium transition-colors">
          <Printer size={16} /> Print / PDF
        </button>
        {onExport && (
          <button onClick={onExport} className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-md text-sm font-medium transition-colors border border-emerald-200 dark:border-emerald-800">
            <Download size={16} /> {exportLabel || 'Export CSV'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={`flex h-screen print:h-auto print:bg-white font-sans transition-colors duration-300 ${appSettings.isDarkMode ? 'dark bg-slate-900 text-gray-100' : 'bg-gray-100 text-gray-900'}`}>

      {/* SIDEBAR */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-[72px]'} bg-slate-900 text-white flex flex-col shadow-xl z-20 print:hidden transition-all duration-300 ease-in-out`}>
        <div className={`p-6 bg-slate-950 flex items-center ${isSidebarOpen ? 'gap-3' : 'justify-center'} h-20`}>
          <Landmark size={28} className="text-indigo-400 min-w-max" />
          {isSidebarOpen && <h1 className="text-xl font-bold tracking-wider whitespace-nowrap">CASHBOOK</h1>}
        </div>
        <nav className="flex-1 px-3 py-6 space-y-2 overflow-x-hidden">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'expenses', icon: ReceiptText, label: 'Expenses' },
            { id: 'transactions', icon: List, label: 'Transactions' },
            { id: 'summary', icon: FileText, label: 'Summary / Letter' },
            { id: 'bills', icon: ClipboardList, label: 'Bills Generated' },
            { id: 'brs', icon: Scale, label: 'Bank Reconciliation' },
            { id: 'brs-history', icon: History, label: 'BRS History' },
            { id: 'vendor-bills', icon: FileSpreadsheet, label: 'Vendor Bill Summary' },
            { id: 'forms', icon: Wallet, label: 'Petty Cash Voucher' },
            { id: 'settings', icon: Settings, label: 'Settings' }
          ].map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)} title={!isSidebarOpen ? item.label : ''}
              className={`w-full flex items-center ${isSidebarOpen ? 'px-4 gap-3' : 'justify-center px-0'} py-3 rounded-lg transition-all text-sm font-medium ${activeTab === item.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
              <item.icon size={20} className="min-w-max" />
              {isSidebarOpen && <span className="whitespace-nowrap">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50 dark:bg-slate-900 print:bg-white print:w-full print:absolute print:left-0 print:top-0 print:z-50 transition-colors">
        <header className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-5 flex justify-between items-center shadow-sm z-10 print:hidden h-20 transition-colors">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors"><Menu size={24} /></button>
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-white tracking-tight">
              {({'dashboard':'Dashboard','expenses':'Expenses','transactions':'Transactions','summary':'Summary / Letter','bills':'Bills Generated','brs':'BANK RECONCILIATION','brs-history':'BRS HISTORY','vendor-bills':'Vendor Bill Summary','forms':'Petty Cash Voucher','settings':'Settings'})[activeTab] || activeTab}
            </h2>
          </div>
          <button onClick={openNewTransactionModal} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg">
            <Plus size={18} /> <span className="hidden sm:inline">New Transaction</span>
          </button>
        </header>

        <div className="flex-1 overflow-auto p-8 print:p-4 print:overflow-visible">
        <Suspense fallback={<div className="text-center py-20 text-gray-400 text-sm">Loading…</div>}>

          {/* ═══════════ DASHBOARD ═══════════ */}
          {activeTab === 'dashboard' && (() => {
            const imprest = appSettings.imprestAmount || 600000;
            const totalBalance = globalLedger.finalCash + globalLedger.finalBank;
            const utilized = imprest - totalBalance;
            const utilizedPct = Math.min(100, Math.max(0, (utilized / imprest) * 100));
            const replenishmentDue = periodSummary.totalExpenses + totalAdjustmentAmount;

            const prevMonth = (() => {
              const [y, m] = filterMonth.split('-').map(Number);
              const pm = m === 1 ? 12 : m - 1;
              const py = m === 1 ? y - 1 : y;
              return `${py}-${String(pm).padStart(2, '0')}`;
            })();
            const prevMonthExpenses = globalLedger.rows
              .filter(tx => tx.type === 'Payment' && !tx.isAdjustment && tx.date.startsWith(prevMonth))
              .reduce((s, tx) => s + tx.amount, 0);
            const expenseDelta = periodSummary.totalExpenses - prevMonthExpenses;
            const expenseDeltaPct = prevMonthExpenses > 0 ? ((expenseDelta / prevMonthExpenses) * 100).toFixed(1) : null;

            const recentTx = [...globalLedger.rows].reverse().slice(0, 5);

            const last6Months = Array.from({ length: 6 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const label = d.toLocaleString('default', { month: 'short' });
              const amt = globalLedger.rows
                .filter(tx => tx.type === 'Payment' && !tx.isAdjustment && tx.date.startsWith(key))
                .reduce((s, tx) => s + tx.amount, 0);
              return { key, label, amt };
            });
            const maxBarAmt = Math.max(...last6Months.map(m => m.amt), 1);

            return (
              <div className="max-w-6xl mx-auto space-y-6">

                {/* ── PENDING ACTIONS WIDGET ── */}
                {(() => {
                  const billsNoBrs     = generatedBills.filter(b => !getBrsForBill(b));
                  const billsMismatch  = generatedBills.filter(b => getBrsBillStatus(b) === 'mismatched');
                  const lateEntries    = globalLedger.rows.filter(tx => isLateEntry(tx));
                  const unbilledMonths = (() => {
                    const months = new Set(globalLedger.rows.map(tx => tx.date.slice(0, 7)));
                    return [...months].filter(m => {
                      const hasTx = globalLedger.rows.some(tx => tx.date.startsWith(m));
                      const hasBill = generatedBills.some(b => b.type === 'month' && b.value === m);
                      const isPast = m < new Date().toISOString().slice(0, 7);
                      return hasTx && !hasBill && isPast;
                    });
                  })();

                  const actions = [
                    billsNoBrs.length > 0 && {
                      icon: <Scale size={15} className="text-amber-600 dark:text-amber-400" />,
                      color: 'amber',
                      title: `${billsNoBrs.length} bill${billsNoBrs.length > 1 ? 's' : ''} missing BRS`,
                      detail: billsNoBrs.slice(0, 3).map(b => getBillClaimNo(b)).join(', ') + (billsNoBrs.length > 3 ? ` +${billsNoBrs.length - 3} more` : ''),
                      label: 'Start BRS',
                      action: () => { setBrsBillId(billsNoBrs[0].id); setBrsDraft(null); setActiveTab('brs'); },
                    },
                    billsMismatch.length > 0 && {
                      icon: <AlertCircle size={15} className="text-rose-600 dark:text-rose-400" />,
                      color: 'rose',
                      title: `${billsMismatch.length} BRS mismatch${billsMismatch.length > 1 ? 'es' : ''} to resolve`,
                      detail: billsMismatch.slice(0, 3).map(b => getBillClaimNo(b)).join(', '),
                      label: 'View BRS',
                      action: () => { setBrsBillId(billsMismatch[0].id); setBrsDraft(null); setActiveTab('brs'); },
                    },
                    lateEntries.length > 0 && {
                      icon: <Clock size={15} className="text-indigo-600 dark:text-indigo-400" />,
                      color: 'indigo',
                      title: `${lateEntries.length} late entr${lateEntries.length > 1 ? 'ies' : 'y'} in draft`,
                      detail: 'Backdated into a locked period — will appear in the next bill',
                      label: 'View Ledger',
                      action: () => setActiveTab('transactions'),
                    },
                    unbilledMonths.length > 0 && {
                      icon: <FileText size={15} className="text-violet-600 dark:text-violet-400" />,
                      color: 'violet',
                      title: `${unbilledMonths.length} past period${unbilledMonths.length > 1 ? 's' : ''} not yet billed`,
                      detail: unbilledMonths.slice(0, 3).join(', ') + (unbilledMonths.length > 3 ? ` +${unbilledMonths.length - 3} more` : ''),
                      label: 'Go to Summary',
                      action: () => setActiveTab('summary'),
                    },
                  ].filter(Boolean);

                  if (actions.length === 0) return (
                    <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded-xl px-5 py-3.5">
                      <CheckCircle2 size={18} className="shrink-0" />
                      <p className="text-sm font-medium">All caught up — no pending actions.</p>
                    </div>
                  );

                  const colorMap = {
                    amber:  { bg: 'bg-amber-50 dark:bg-amber-900/10',   border: 'border-amber-200 dark:border-amber-800',   badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'   },
                    rose:   { bg: 'bg-rose-50 dark:bg-rose-900/10',     border: 'border-rose-200 dark:border-rose-800',     badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'       },
                    indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/10', border: 'border-indigo-200 dark:border-indigo-800', badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
                    violet: { bg: 'bg-violet-50 dark:bg-violet-900/10', border: 'border-violet-200 dark:border-violet-800', badge: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
                  };

                  return (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-slate-700">
                        <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                          <Bell size={16} className="text-amber-500" />
                          Pending Actions
                          <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-500 text-white text-[11px] font-bold">{actions.length}</span>
                        </h4>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{actions.length} item{actions.length > 1 ? 's' : ''} require attention</p>
                      </div>
                      <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
                        {actions.map((a, i) => {
                          const c = colorMap[a.color];
                          return (
                            <div key={i} className={`flex items-center gap-4 px-5 py-3.5 ${c.bg}`}>
                              <div className="shrink-0">{a.icon}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{a.title}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{a.detail}</p>
                              </div>
                              <button onClick={a.action}
                                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border ${c.badge} ${c.border} hover:opacity-80 transition-opacity flex items-center gap-1`}>
                                {a.label} <ArrowRight size={11} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Row 1: Stat Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-slate-700 flex items-center gap-4 transition-colors">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl"><Wallet size={22} /></div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Cash Balance</p>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">₹{globalLedger.finalCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-slate-700 flex items-center gap-4 transition-colors">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl"><Building2 size={22} /></div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Bank Balance</p>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">₹{globalLedger.finalBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-slate-700 flex items-center gap-4 transition-colors">
                    <div className="p-3 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl"><ReceiptText size={22} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Expenses ({filterMonth})</p>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">₹{periodSummary.totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
                      {expenseDeltaPct !== null && (
                        <p className={`text-xs font-medium flex items-center gap-1 mt-0.5 ${expenseDelta > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {expenseDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {Math.abs(expenseDeltaPct)}% vs last month
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="bg-indigo-600 rounded-2xl p-5 shadow-md flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/40 text-white rounded-xl"><RefreshCw size={22} /></div>
                    <div>
                      <p className="text-xs text-indigo-200 font-semibold uppercase tracking-wider mb-0.5">Replenishment Due</p>
                      <h3 className="text-xl font-bold text-white">₹{replenishmentDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
                      <p className="text-xs text-indigo-300 mt-0.5">Claim {claimNo}</p>
                    </div>
                  </div>
                </div>

                {/* Row 2: Imprest Utilization + Spend Chart */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2"><Landmark size={16} className="text-indigo-500" /> Imprest Utilization</h4>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Total sanctioned: ₹{imprest.toLocaleString('en-IN')}</p>
                      </div>
                      <span className={`text-2xl font-bold ${utilizedPct >= 80 ? 'text-rose-600 dark:text-rose-400' : utilizedPct >= 60 ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {utilizedPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-4 overflow-hidden mb-3">
                      <div
                        className={`h-4 rounded-full transition-all duration-700 ${utilizedPct >= 80 ? 'bg-rose-500' : utilizedPct >= 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                        style={{ width: `${utilizedPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>Utilized: <strong className="text-gray-800 dark:text-gray-200">₹{utilized.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
                      <span>Remaining: <strong className="text-gray-800 dark:text-gray-200">₹{totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
                    </div>
                    {utilizedPct >= 80 && (
                      <p className="mt-3 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2 font-medium flex items-center gap-2">
                        <AlertCircle size={14} /> Over 80% of imprest utilized. Consider filing a replenishment soon.
                      </p>
                    )}
                  </div>

                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                    <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2 mb-5">
                      <BarChart2 size={16} className="text-indigo-500" /> Monthly Spend (Last 6 Months)
                    </h4>
                    <div className="flex items-end gap-2 h-32">
                      {last6Months.map(({ key, label, amt }) => {
                        const heightPct = maxBarAmt > 0 ? (amt / maxBarAmt) * 100 : 0;
                        const isCurrentMonth = key === filterMonth;
                        return (
                          <div key={key} className="flex-1 flex flex-col items-center gap-1.5 group relative">
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              ₹{amt.toLocaleString('en-IN')}
                            </div>
                            <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                              <div
                                className={`w-full rounded-t-md transition-all duration-500 ${isCurrentMonth ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-indigo-200 dark:bg-indigo-800 group-hover:bg-indigo-300 dark:group-hover:bg-indigo-700'}`}
                                style={{ height: `${Math.max(heightPct, amt > 0 ? 4 : 0)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium ${isCurrentMonth ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'}`}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Row 3: Account Code Budgets + Recent Transactions */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                    <div className="flex items-center justify-between mb-5">
                      <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                        <Database size={16} className="text-indigo-500" /> Account Code Budgets
                      </h4>
                      <button onClick={() => setActiveTab('settings')} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors">
                        Manage <ArrowRight size={12} />
                      </button>
                    </div>
                    {accountCodes.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No account codes configured.</p>
                    ) : (
                      <div className="space-y-4">
                        {accountCodes.map(code => {
                          const { credited, net } = getAccountCodeUsage(code.code);
                          const pct = Math.min(100, (net / code.limit) * 100);
                          const over = net > code.limit;
                          return (
                            <div key={code.id}>
                              <div className="flex justify-between items-center mb-1.5">
                                <div>
                                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 uppercase">{code.code}</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{code.description}</span>
                                </div>
                                <span className={`text-xs font-bold ${over ? 'text-rose-600 dark:text-rose-400' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                  {pct.toFixed(0)}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-2 rounded-full transition-all duration-500 ${over ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
                                <span>
                                  ₹{net.toLocaleString('en-IN')} net used
                                  {credited > 0 && <span className="ml-1 text-emerald-600 dark:text-emerald-400">(−₹{credited.toLocaleString('en-IN')} claimed back)</span>}
                                </span>
                                <span className={over ? 'text-rose-500 font-semibold' : ''}>
                                  {over ? `₹${(net - code.limit).toLocaleString('en-IN')} over limit` : `₹${(code.limit - net).toLocaleString('en-IN')} remaining`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                    <div className="flex items-center justify-between mb-5">
                      <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                        <List size={16} className="text-indigo-500" /> Recent Entries
                      </h4>
                      <button onClick={() => setActiveTab('transactions')} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors">
                        View All <ArrowRight size={12} />
                      </button>
                    </div>
                    {recentTx.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No transactions recorded yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {recentTx.map(tx => (
                          <div key={tx.id} className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tx.type === 'Receipt' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : tx.type === 'Contra' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : tx.type === 'Ratification' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'}`}>
                              {tx.type === 'Receipt' ? <TrendingUp size={14} /> : tx.type === 'Contra' ? <RefreshCw size={14} /> : <TrendingDown size={14} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{tx.particulars}</p>
                              <p className="text-xs text-gray-400 dark:text-gray-500">{fmtDate(tx.date)} · {tx.type}{tx.mode ? ` · ${tx.mode}` : ''}</p>
                            </div>
                            <span className={`text-sm font-bold shrink-0 ${tx.type === 'Receipt' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {tx.type === 'Receipt' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Quick Actions REMOVED as requested ── */}

                {/* Row 4: Bills Overview + BRS Overview side-by-side */}
                {(() => {
                  const dashYear = new Date().getFullYear();
                  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

                  // Build 12 cells keyed by claimNo month MM/YYYY
                  const monthCells = Array.from({ length: 12 }, (_, i) => {
                    const mm = String(i + 1).padStart(2, '0');
                    const claimNo = `${mm}/${dashYear}`;
                    const monthKey = `${dashYear}-${mm}`;
                    const today = new Date().toISOString().slice(0, 7);
                    // Bill: any bill whose claimNo matches this month
                    const bill = generatedBills.find(b => getBillClaimNo(b) === claimNo);
                    // Bill status
                    const hasTx = globalLedger.rows.some(tx => tx.date.startsWith(monthKey));
                    const billStatus = bill ? 'generated' : (hasTx ? 'pending' : (monthKey > today ? 'future' : 'empty'));
                    // BRS status
                    const brsStatus = bill ? getBrsBillStatus(bill) : (monthKey > today ? 'future' : 'pending');
                    return { mm, claimNo, monthKey, label: MONTH_SHORT[i], bill, billStatus, brsStatus };
                  });

                  const billStatusStyle = {
                    generated: { bg: 'bg-emerald-500', text: 'text-white',                    ring: 'ring-emerald-600', label: 'Generated' },
                    pending:   { bg: 'bg-amber-400',   text: 'text-amber-900',                ring: 'ring-amber-500',  label: 'Pending'   },
                    empty:     { bg: 'bg-gray-200 dark:bg-slate-700', text: 'text-gray-500 dark:text-slate-400', ring: 'ring-gray-300', label: 'Empty' },
                    future:    { bg: 'bg-gray-200 dark:bg-slate-700', text: 'text-gray-400 dark:text-slate-500', ring: 'ring-gray-300', label: 'Future' },
                  };
                  const brsStatusStyle = {
                    balanced:   { bg: 'bg-emerald-500', text: 'text-white',           ring: 'ring-emerald-600', label: 'Balanced'   },
                    mismatched: { bg: 'bg-rose-500',    text: 'text-white',           ring: 'ring-rose-600',   label: 'Mismatch'   },
                    draft:      { bg: 'bg-amber-400',   text: 'text-amber-900',       ring: 'ring-amber-500',  label: 'Draft'      },
                    missing:    { bg: 'bg-yellow-300',  text: 'text-yellow-900',      ring: 'ring-yellow-400', label: 'Missing'    },
                    pending:    { bg: 'bg-yellow-300',  text: 'text-yellow-900',      ring: 'ring-yellow-400', label: 'Pending'    },
                    future:     { bg: 'bg-gray-200 dark:bg-slate-700', text: 'text-gray-400 dark:text-slate-500', ring: 'ring-gray-300', label: 'Future' },
                  };

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                      {/* Bills Overview */}
                      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                        <div className="flex items-center justify-between mb-5">
                          <div>
                            <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                              <ClipboardList size={16} className="text-indigo-500" /> Bills Overview — {dashYear}
                            </h4>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Bill generation status by claim month</p>
                          </div>
                          <button onClick={() => setActiveTab('bills')} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors">
                            View All <ArrowRight size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-6 gap-2 mb-4">
                          {monthCells.map(({ claimNo, label, bill, billStatus, monthKey }) => {
                            const s = billStatusStyle[billStatus] || billStatusStyle.future;
                            return (
                              <button key={claimNo}
                                onClick={() => bill ? setActiveTab('bills') : (globalLedger.rows.some(tx => tx.date.startsWith(monthKey)) ? setActiveTab('summary') : null)}
                                title={`${claimNo} — ${s.label}`}
                                className={`${s.bg} ${s.text} rounded-xl py-3 flex flex-col items-center justify-center gap-0.5 text-sm font-semibold transition-all hover:ring-2 hover:ring-offset-1 ${s.ring} shadow-sm`}>
                                <span>{label}</span>
                                <span className="text-xs opacity-70 font-normal">{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-gray-100 dark:border-slate-700">
                          {Object.entries(billStatusStyle).map(([k, s]) => {
                            const cnt = monthCells.filter(m => m.billStatus === k).length;
                            return cnt > 0 ? (
                              <div key={k} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                <span className={`w-2.5 h-2.5 rounded-full ${s.bg} shrink-0`}></span>
                                <span>{s.label}</span><span className="font-bold text-gray-700 dark:text-gray-300">{cnt}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>

                      {/* BRS Overview */}
                      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700 transition-colors">
                        <div className="flex items-center justify-between mb-5">
                          <div>
                            <h4 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                              <Scale size={16} className="text-indigo-500" /> BRS Overview — {dashYear}
                            </h4>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Reconciliation status per bill claim month</p>
                          </div>
                          <button onClick={() => setActiveTab('brs-history')} className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors">
                            View History <ArrowRight size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-6 gap-2 mb-4">
                          {monthCells.map(({ claimNo, label, bill, brsStatus }) => {
                            const s = brsStatusStyle[brsStatus] || brsStatusStyle.future;
                            return (
                              <button key={claimNo}
                                onClick={() => { if (bill) { setBrsBillId(bill.id); setBrsDraft(null); setActiveTab('brs'); } }}
                                title={`${claimNo} — ${s.label}`}
                                className={`${s.bg} ${s.text} rounded-xl py-3 flex flex-col items-center justify-center gap-0.5 text-sm font-semibold transition-all hover:ring-2 hover:ring-offset-1 ${s.ring} shadow-sm`}>
                                <span>{label}</span>
                                <span className="text-xs opacity-70 font-normal">{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-gray-100 dark:border-slate-700">
                          {Object.entries(brsStatusStyle).filter(([k]) => k !== 'pending').map(([k, s]) => {
                            const cnt = monthCells.filter(m => m.brsStatus === k).length;
                            return cnt > 0 ? (
                              <div key={k} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                <span className={`w-2.5 h-2.5 rounded-full ${s.bg} shrink-0`}></span>
                                <span>{s.label}</span><span className="font-bold text-gray-700 dark:text-gray-300">{cnt}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              </div>
            );
          })()}

          {/* ═══════════ EXPENSES ═══════════ */}
          {activeTab === 'expenses' && (
            <div className="max-w-7xl mx-auto print-landscape">
              <FilterBar onExport={exportExpenses} exportLabel="Export Expenses CSV" />

              <div className="hidden print:block text-center mb-6 pb-4 border-b-2 border-black">
                <h2 className="text-xl font-bold uppercase tracking-widest">{orgName}</h2>
                <h3 className="text-lg font-semibold mt-2">Expense Statement</h3>
                <p className="text-base font-bold mt-1">Claim No. {claimNo}</p>
                <p className="text-sm text-gray-600 mt-1">Period: {filterType === 'month' ? filterMonth : `${fmtDate(filterStartDate)} to ${fmtDate(filterEndDate)}`}</p>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-gray-200 dark:border-slate-700 overflow-hidden print:border-none print:shadow-none transition-colors">
                <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 print:hidden">
                  <h3 className="text-lg font-bold text-gray-800 dark:text-white text-center uppercase tracking-wide">Expense Statement</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-0.5 flex items-center justify-center gap-2 flex-wrap">
                    <span>Claim No. <strong className="text-indigo-600 dark:text-indigo-400">{claimNo}</strong></span>
                    <span>&bull;</span>
                    <span>{filterType === 'month' ? filterMonth : `${filterStartDate} to ${filterEndDate}`}</span>
                    <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border border-amber-200 dark:border-amber-800/50">Draft – Unbilled Entries Only</span>
                    {generatedBills.length > 0 && (
                      <button onClick={() => setActiveTab('bills')} className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"><History size={10} /> View Generated Bills</button>
                    )}
                  </p>
                </div>

                <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300 print:text-[11px]">
                  <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-slate-700 border-b border-gray-200 dark:border-slate-600 print:bg-white print:border-b-2 print:border-black print:text-black">
                    <tr>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-center w-20">Sr.#</th>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-center w-28">Date</th>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600">Payee / Particulars</th>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-32">Cash (₹)</th>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-32">Bank (₹)</th>
                      <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-32 font-bold bg-gray-200 dark:bg-slate-600 print:bg-white">Total (₹)</th>
                      <th className="px-4 py-3 text-center w-36">Account Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((row, idx) => {
                      const lateEntry = isLateEntry(row);
                      return (
                      <tr key={row.id} onDoubleClick={() => handleRowDoubleClick(row)}
                        title={lateEntry ? "Late entry — will go into next bill" : "Double-click to edit"}
                        className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700/50 cursor-pointer print:border-gray-300 transition-colors">
                        <td className="px-4 py-3 text-center font-medium border-r border-gray-100 dark:border-slate-700">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-gray-500 italic">{idx + 1}</span>
                            <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-wider print:hidden">Draft</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center border-r border-gray-100 dark:border-slate-700">{fmtDate(row.date)}</td>
                        <td className="px-4 py-3 border-r border-gray-100 dark:border-slate-700 text-gray-900 dark:text-gray-200 print:text-black">
                          <div className="flex items-center gap-2 flex-wrap">
                            {row.particulars}
                            {lateEntry && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 print:hidden" title="Backdated — will go into next bill">Late Entry</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right border-r border-gray-100 dark:border-slate-700">{row.cashPaid > 0 ? row.cashPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-4 py-3 text-right border-r border-gray-100 dark:border-slate-700">{row.bankPaid > 0 ? row.bankPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white border-r border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 print:bg-white print:text-black">{row.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-center font-medium text-indigo-600 dark:text-indigo-400 uppercase">{row.accountCode !== 'NONE' ? row.accountCode : ''}</td>
                      </tr>
                      );
                    })}
                    {filteredExpenses.length === 0 && (
                      <tr><td colSpan="7" className="p-8 text-center text-gray-500 dark:text-gray-400">
                        No unbilled expenses for this period.
                        {generatedBills.length > 0 && <button onClick={() => setActiveTab('bills')} className="text-indigo-600 dark:text-indigo-400 hover:underline ml-2">View generated bills →</button>}
                      </td></tr>
                    )}
                    <tr className="bg-gray-100 dark:bg-slate-700 font-bold text-gray-900 dark:text-white print:bg-gray-50 print:border-t-2 print:border-black print:text-black">
                      <td colSpan="3" className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">TOTAL</td>
                      <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{filteredExpenses.reduce((s, r) => s + r.cashPaid, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{filteredExpenses.reduce((s, r) => s + r.bankPaid, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{filteredExpenses.reduce((s, r) => s + r.amount, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <SignatureBlock />
            </div>
          )}
          {/* ═══════════ TRANSACTIONS ═══════════ */}
          {activeTab === 'transactions' && (() => {
            const totalCashReceived = draftLedger.openingCash + draftLedger.rows.reduce((s, r) => s + (r.cashRec || 0), 0);
            const totalBankReceived = draftLedger.openingBank + draftLedger.rows.reduce((s, r) => s + (r.bankRec || 0), 0);
            const totalCashPaid = draftLedger.rows.reduce((s, r) => s + (r.cashPaid || 0), 0);
            const totalBankPaid = draftLedger.rows.reduce((s, r) => s + (r.bankPaid || 0), 0);

            return (
            <div className="max-w-[1500px] mx-auto print-landscape">
              <FilterBar onExport={exportTransactions} exportLabel="Export Ledger CSV" />

              <div className="hidden print:block text-center mb-6 pb-4 border-b-2 border-black">
                <h2 className="text-xl font-bold uppercase tracking-widest">{orgName}</h2>
                <h3 className="text-lg font-bold mt-2">Claim No. {claimNo}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Period: {filterType === 'month' ? filterMonth : `${fmtDate(filterStartDate)} to ${fmtDate(filterEndDate)}`}
                  &nbsp;|&nbsp; Printed: {new Date().toLocaleDateString('en-IN')}
                </p>
              </div>

              {generatedBills.length > 0 && (
                <div className="mb-4 flex items-center gap-2 print:hidden">
                  <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
                    <History size={13} /> Showing unbilled transactions only.
                  </span>
                  <button onClick={() => setActiveTab('bills')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                    View generated bills →
                  </button>
                </div>
              )}

              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-gray-200 dark:border-slate-700 overflow-hidden print:border-none print:shadow-none transition-colors">
                <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300">
                  <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-slate-700 sticky top-0 border-b border-gray-200 dark:border-slate-600 print:relative print:bg-white print:border-b-2 print:border-black print:text-black z-10 transition-colors">
                    <tr>
                      <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 w-12 text-center">Sr.#</th>
                      <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 w-28 text-center">Date</th>
                      <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 min-w-[240px] print:w-[44%]">Particulars</th>
                      <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-emerald-50 dark:bg-emerald-900/20 print:bg-white">Received (₹)</th>
                      <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-rose-50 dark:bg-rose-900/20 print:bg-white">Paid (₹)</th>
                      <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-blue-50 dark:bg-blue-900/20 print:bg-white">Balance (₹)</th>
                      <th rowSpan={2} className="px-3 py-3 w-24 text-center bg-indigo-50/50 dark:bg-indigo-900/20 print:hidden">Actions</th>
                    </tr>
                    <tr>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-emerald-50/50 dark:bg-emerald-900/10 print:bg-white">Cash</th>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-emerald-50/50 dark:bg-emerald-900/10 print:bg-white">Bank</th>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-rose-50/50 dark:bg-rose-900/10 print:bg-white">Cash</th>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-rose-50/50 dark:bg-rose-900/10 print:bg-white">Bank</th>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-blue-50/50 dark:bg-blue-900/10 print:bg-white">Cash</th>
                      <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-blue-50/50 dark:bg-blue-900/10 print:bg-white">Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-amber-50/30 dark:bg-amber-900/10 border-b border-gray-100 dark:border-slate-700 font-medium print:bg-white print:text-black">
                      <td className="px-3 py-3 text-center text-gray-400">—</td>
                      <td className="px-3 py-3 text-center text-gray-500 dark:text-gray-400 whitespace-nowrap border-r border-gray-100 dark:border-slate-700">{filterType === 'month' ? fmtDate(`${filterMonth}-01`) : fmtDate(filterStartDate)}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300 italic border-r border-gray-100 dark:border-slate-700 print:text-black">Opening Balance</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{draftLedger.openingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{draftLedger.openingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 border-r border-gray-100 dark:border-slate-700"></td>
                      <td className="px-3 py-3 border-r border-gray-100 dark:border-slate-700"></td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-white bg-blue-50/20 dark:bg-blue-900/10 border-r border-gray-100 dark:border-slate-700 print:text-black print:bg-white">{draftLedger.openingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-white bg-blue-50/20 dark:bg-blue-900/10 border-r border-gray-100 dark:border-slate-700 print:text-black print:bg-white">{draftLedger.openingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="print:hidden"></td>
                    </tr>

                    {draftLedger.rows.map((row, idx) => {
                      const lateEntry = isLateEntry(row);
                      return (
                      <tr key={row.id} onDoubleClick={() => handleRowDoubleClick(row)}
                        title={lateEntry ? "Late entry — will go into next bill" : "Double-click to edit"}
                        className={`border-b border-gray-100 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700/50 cursor-pointer transition-colors ${row.isAdjustment ? 'bg-indigo-50/30 dark:bg-indigo-900/20' : ''} print:border-gray-300`}>
                        <td className="px-3 py-3 text-center font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-slate-700 print:text-black">{idx + 1}</td>
                        <td className="px-3 py-3 text-center text-gray-500 dark:text-gray-400 whitespace-nowrap border-r border-gray-100 dark:border-slate-700">{fmtDate(row.date)}</td>
                        <td className="px-3 py-3 border-r border-gray-100 dark:border-slate-700">
                          <div className="text-gray-900 dark:text-gray-200 print:text-black flex items-center gap-2 flex-wrap">
                            {row.particulars}
                            {row.isAdjustment && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-300 print:border print:border-black">Adj.</span>}
                            {row.type === 'Ratification' && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 print:border print:border-black">Ratification</span>}
                            {lateEntry && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 print:hidden">Late Entry</span>}
                          </div>
                          {row.accountCode !== 'NONE' && <div className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-0.5 uppercase">{row.accountCode}</div>}
                        </td>
                        <td className="px-3 py-3 text-right text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{row.cashRec > 0 ? row.cashRec.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-3 py-3 text-right text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{row.bankRec > 0 ? row.bankRec.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-3 py-3 text-right text-rose-700 dark:text-rose-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{row.cashPaid > 0 ? row.cashPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-3 py-3 text-right text-rose-700 dark:text-rose-400 border-r border-gray-100 dark:border-slate-700 print:text-black">{row.bankPaid > 0 ? row.bankPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td>
                        <td className="px-3 py-3 text-right font-medium text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-slate-700 bg-blue-50/20 dark:bg-blue-900/10 print:bg-white print:text-black">{row.balCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-3 text-right font-medium text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-slate-700 bg-blue-50/20 dark:bg-blue-900/10 print:bg-white print:text-black">{row.balBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-3 text-center print:hidden" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => toggleAdjustment(row.id)} title={row.isAdjustment ? "Remove adjustment" : "Mark as adjustment"}
                              className={`p-1.5 rounded-md transition-colors shadow-sm border ${row.isAdjustment ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white dark:bg-slate-700 text-gray-400 border-gray-200 dark:border-slate-600 hover:text-indigo-600 hover:border-indigo-300'}`}>
                              <Tag size={15} />
                            </button>
                            <button onClick={() => handleDeleteTransaction(row.id)} title="Delete transaction"
                              className="p-1.5 rounded-md transition-colors shadow-sm border bg-white dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}

                    {draftLedger.rows.length === 0 && (
                      <tr><td colSpan="10" className="p-8 text-center text-gray-500 dark:text-gray-400">
                        No unbilled transactions for this period.
                        {generatedBills.length > 0 && <button onClick={() => setActiveTab('bills')} className="text-indigo-600 dark:text-indigo-400 hover:underline ml-2">View generated bills →</button>}
                      </td></tr>
                    )}

                    <tr className="bg-gray-100 dark:bg-slate-700 font-bold border-t-2 border-gray-300 dark:border-slate-500 print:bg-gray-200 print:text-black">
                      <td colSpan={3} className="px-3 py-3 text-right text-gray-800 dark:text-gray-100 border-r border-gray-200 dark:border-slate-600 print:text-black">TOTAL</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{totalCashReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{totalBankReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{totalCashPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{totalBankPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{periodSummary.closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600 print:text-black">{periodSummary.closingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="print:hidden"></td>
                    </tr>

                    <tr className="bg-yellow-100 dark:bg-yellow-900/30 font-bold border-t border-yellow-300 dark:border-yellow-700 print:bg-yellow-200 print:text-black">
                      <td colSpan={7} className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700 print:text-black">CLOSING BALANCE</td>
                      <td className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700 print:text-black">{periodSummary.closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700 print:text-black">{periodSummary.closingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="print:hidden"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <SignatureBlock />
            </div>
            );
          })()}
          {/* ═══════════ SUMMARY ═══════════ */}
          {activeTab === 'summary' && (() => {
            const currentClaimTotal = periodSummary.totalExpenses + totalAdjustmentAmount;
            const prevClaimsTotal = previousClaims.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
            const totalReplenishment = currentClaimTotal + prevClaimsTotal;
            const imprest = appSettings.imprestAmount || 600000;
            const computedImprest = periodSummary.closingCash + periodSummary.closingBank + totalReplenishment;
            const imprestDiff = computedImprest - imprest;

            return (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* ── Toolbar (screen only) ── */}
              <div className="flex flex-wrap justify-between items-center gap-4 print:hidden bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-500" />
                    <strong>{filterType === 'month' ? filterMonth : `${fmtDate(filterStartDate)} to ${fmtDate(filterEndDate)}`}</strong>
                  </div>
                  <div className="flex items-center gap-2 border-l border-gray-300 dark:border-slate-600 pl-4 ml-2">
                    <label className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase whitespace-nowrap">Claim No.</label>
                    <div className="relative flex items-center">
                      <input type="text" value={claimNoOverride} onChange={e => setClaimNoOverride(e.target.value)}
                        placeholder={filterType === 'month' ? formatClaimNo(filterMonth) : `${filterStartDate.slice(5, 7)}/${filterStartDate.slice(0, 4)}`}
                        className="w-24 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded px-2 py-1 text-sm font-mono focus:ring-indigo-500 focus:border-indigo-500 transition-colors" />
                      {claimNoOverride && (
                        <button onClick={() => setClaimNoOverride('')} className="absolute right-2 text-xs text-gray-400 hover:text-rose-500 transition-colors">✕</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleGenerateBill} className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-5 py-2 rounded-md font-medium transition-colors">
                    <Lock size={16} /> Mark Bill as Generated
                  </button>
                  <button onClick={handlePrint} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-md shadow-md">
                    <Printer size={16} /> Print
                  </button>
                </div>
              </div>

              {/* ── Previous / Pending Claims Panel (screen only) ── */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-5 print:hidden transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <ClipboardList size={16} className="text-indigo-500" /> Previous / Pending Claims
                  </h4>
                  <p className="text-xs text-gray-400 dark:text-gray-500">“Add” lines increase the replenishment total, “Less” lines reduce it</p>
                </div>

                {previousClaims.length > 0 && (
                  <table className="w-full text-xs border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden mb-3">
                    <thead className="bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
                      <tr>
                        <th className="px-3 py-2 text-left w-8">#</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-right w-28">Amount (₹)</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {previousClaims.map((claim, i) => (
                        <tr key={claim.id} className="border-t border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                          <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                          <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{claimLabel(claim)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${parseFloat(claim.amount) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-800 dark:text-gray-200'}`}>{parseFloat(claim.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => setPreviousClaims(prev => prev.filter(c => c.id !== claim.id))} className="text-gray-300 hover:text-rose-500 transition-colors"><X size={13} /></button>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50 dark:bg-slate-700 font-bold">
                        <td colSpan={2} className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">TOTAL</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{prevClaimsTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}

                <div className="bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Add Entry</p>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Description</label>
                      <input type="text" placeholder="e.g. Previous claim, Bank charges / Extra funds received from HQ..." value={prevClaimForm.description} onChange={e => setPrevClaimForm(p => ({ ...p, description: e.target.value }))}
                        className="w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Type</label>
                      <div className="flex bg-gray-200 dark:bg-slate-900 p-0.5 rounded">
                        {[['add', 'Add'], ['less', 'Less']].map(([kind, label]) => (
                          <button key={kind} type="button" onClick={() => setPrevClaimForm(p => ({ ...p, kind }))}
                            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${prevClaimForm.kind === kind ? (kind === 'less' ? 'bg-rose-600 text-white' : 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm') : 'text-gray-500 dark:text-gray-400'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 block">Amount (₹)</label>
                      <div className="flex gap-1">
                        <input type="number" placeholder="0.00" value={prevClaimForm.amount} onChange={e => setPrevClaimForm(p => ({ ...p, amount: e.target.value }))}
                          className="w-28 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-1.5 text-xs" />
                        <button onClick={() => {
                          if (!prevClaimForm.description || !prevClaimForm.amount) return;
                          const value = parseFloat(prevClaimForm.amount) || 0;
                          // "Less" is stored as a negative amount so every existing total (panel, paper,
                          // generated-bill snapshot, Excel export) deducts it without further changes.
                          const amount = prevClaimForm.kind === 'less' ? -Math.abs(value) : value;
                          setPreviousClaims(prev => [...prev, { id: Date.now().toString(), description: prevClaimForm.description, amount }]);
                          setPrevClaimForm({ description: '', amount: '', kind: 'add' });
                        }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded text-xs font-bold transition-colors">Add</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Imprest Verification ── */}
                <div className={`mt-4 rounded-xl border-2 p-4 flex items-center justify-between ${imprestDiff === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'}`}>
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-white">Imprest Verification</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Cash ({periodSummary.closingCash.toLocaleString('en-IN')}) + Bank ({periodSummary.closingBank.toLocaleString('en-IN')}) + Replenishment ({totalReplenishment.toLocaleString('en-IN')}) = {computedImprest.toLocaleString('en-IN')}
                    </p>
                    <p className={`text-xs font-medium mt-1 ${imprestDiff === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {imprestDiff === 0 ? '✓ Matches Total Imprest Amount' : `⚠ Difference of ₹${Math.abs(imprestDiff).toLocaleString('en-IN', { minimumFractionDigits: 2 })} vs Total Imprest Amount (₹${imprest.toLocaleString('en-IN')})`}
                    </p>
                  </div>
                  <span className={`text-2xl font-bold ${imprestDiff === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {imprestDiff === 0 ? '✓' : `₹${Math.abs(imprestDiff).toLocaleString('en-IN')}`}
                  </span>
                </div>
              </div>

              {/* ── Paper (print + screen preview) ── */}
              <div className="bg-white p-12 shadow-xl border border-gray-200 min-h-[1000px] font-serif text-gray-900 print:shadow-none print:border-none print:p-0">
                <div className="text-center mb-10">
                  <h2 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4 mb-2">{orgName}</h2>
                  <h3 className="text-lg font-semibold mb-4">Petty Cash Replenishment No. {claimNo}</h3>
                  <p className="text-right text-sm">Date: <strong>{new Date().toLocaleDateString('en-IN')}</strong></p>
                </div>

                <table className="w-full text-base mb-16 border-collapse">
                  <thead>
                    <tr className="border-b-2 border-black">
                      <th className="py-3 text-left w-10">#</th>
                      <th className="py-3 text-left">Particulars</th>
                      <th className="py-3 text-right w-36"></th>
                      <th className="py-3 text-right w-40">Amount - Rs.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Row 1 — Cash Balance */}
                    <tr className="border-b border-gray-300 border-dashed">
                      <td className="py-4">1</td>
                      <td className="py-4">Cash Balance</td>
                      <td></td>
                      <td className="py-4 text-right">{periodSummary.closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {/* Row 2 — Bank Balance */}
                    <tr className="border-b border-gray-300 border-dashed">
                      <td className="py-4">2</td>
                      <td className="py-4 italic">Bank Balance as per cash book</td>
                      <td></td>
                      <td className="py-4 text-right">{periodSummary.closingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {/* Row 3 — Current Claim → sub-amount column */}
                    <tr>
                      <td className="pt-4 pb-1">3</td>
                      <td className="pt-4 pb-1 font-bold italic">
                        Current Claim (#{filterType === 'month' ? formatClaimNo(filterMonth) : `${filterStartDate.slice(5,7)}/${filterStartDate.slice(0,4)}`})
                      </td>
                      <td className="pt-4 pb-1 text-right font-bold">{periodSummary.totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td></td>
                    </tr>
                    {/* Adjustments → same level as Current Claim */}
                    {summaryAdjustments.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-1"></td>
                        <td className="py-1 font-bold">{tx.type === 'Receipt' ? 'Less' : 'Add'}: {tx.particulars}</td>
                        <td className="py-1 text-right font-bold">{(tx.type === 'Receipt' ? -tx.amount : tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    ))}
                    {/* Previous Claims → same level as Current Claim */}
                    {previousClaims.map((claim) => (
                      <tr key={claim.id}>
                        <td className="py-1"></td>
                        <td className="py-1 font-bold">{claimLabel(claim)}</td>
                        <td className="py-1 text-right font-bold">{parseFloat(claim.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    ))}
                    {/* Total Replenishment → right Amount column */}
                    <tr className="border-t border-b-2 border-black">
                      <td className="py-4"></td>
                      <td></td>
                      <td></td>
                      <td className="py-4 text-right font-bold">
                        {totalReplenishment.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    {/* Total Imprest — blue */}
                    <tr className="border-b-4 border-double border-black">
                      <td className="py-5"></td>
                      <td className="py-5 font-bold uppercase italic text-blue-600">TOTAL IMPREST AMOUNT</td>
                      <td></td>
                      <td className="py-5 text-right font-bold text-lg text-blue-600">{imprest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Signatories */}
                <div className="mt-32 pt-8 grid grid-cols-3 gap-8 text-center text-sm font-bold border-t border-gray-400">
                  <div><div className="h-16 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.preparedBy || 'Prepared By'}</div>
                  <div><div className="h-16 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.authorizedBy || 'Authorized By'}</div>
                  <div><div className="h-16 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.approvedBy || 'Approved By'}</div>
                </div>
              </div>
            </div>
            );
          })()}

          {/* ═══════════ BILLS GENERATED ═══════════ */}
          {activeTab === 'bills' && (() => {
            // Use a stable key for each bill (handles legacy bills that have no .id)
            const billKey = (b) => b.id || String(b.generatedAt);
            const viewBill = viewBillId ? generatedBills.find(b => billKey(b) === viewBillId) : null;

            // Sorted newest first for the list
            const sortedBills = [...generatedBills].reverse();

            return (
            <div className="max-w-5xl mx-auto space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between print:hidden">
                <div>
                  <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <ClipboardList size={22} className="text-indigo-500" /> Bills Generated
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {generatedBills.length} bill{generatedBills.length !== 1 ? 's' : ''} generated · Click a bill to view its details
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-2.5 print:hidden">
                  <FileSpreadsheet size={16} className="text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Excel includes: Expenses · Ledger · Summary</span>
                </div>
              </div>

              {generatedBills.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-16 text-center shadow-sm">
                  <PackageCheck size={48} className="mx-auto text-gray-300 dark:text-slate-600 mb-4" />
                  <h4 className="text-lg font-semibold text-gray-500 dark:text-gray-400">No bills generated yet</h4>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Go to <strong>Summary / Letter</strong> and click "Mark Bill as Generated" to lock a period.</p>
                  <button onClick={() => setActiveTab('summary')}
                    className="mt-5 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
                    <FileText size={16} /> Go to Summary
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {/* ── BILL LIST ── */}
                  <div className="space-y-2">
                    {sortedBills.map((bill, idx) => {
                      const { claimNoStr, periodLabel, totalExpenses, closingCash, closingBank } = getBillLedgerData(bill);
                      const genDate = bill.generatedAt ? new Date(bill.generatedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
                      const genTime = bill.generatedAt ? new Date(bill.generatedAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '';
                      const expCount = bill.expenseCount ?? 0;
                      const serialNum = generatedBills.length - idx;
                      const isOpen = viewBill && billKey(viewBill) === billKey(bill);
                      const brsStatus = getBrsBillStatus(bill);
                      const brsCfg = {
                        balanced:   { cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400', label: '✓ BRS Balanced' },
                        mismatched: { cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400', label: '⚠ BRS Mismatch' },
                        draft:      { cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400', label: '● BRS Draft' },
                        missing:    { cls: 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400', label: '— No BRS' },
                      };
                      const brsC = brsCfg[brsStatus] || brsCfg.missing;

                      return (
                        // On print: hide closed cards entirely; show only the open one
                        <div key={bill.id || idx} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm transition-all ${isOpen ? 'border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-100 dark:ring-indigo-900/30 print:border-none print:shadow-none print:ring-0' : 'border-gray-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 print:hidden'}`}>
                          {/* Card header — hidden on print (viewer content is what prints) */}
                          <div className="p-5 flex flex-wrap items-center gap-5 print:hidden">
                            {/* Serial Badge */}
                            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 shadow-md ${isOpen ? 'bg-indigo-600 text-white' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'}`}>
                              <span className="text-xs font-semibold leading-tight opacity-80">Bill</span>
                              <span className="text-lg font-bold leading-tight">{String(serialNum).padStart(2, '0')}</span>
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="text-base font-bold text-gray-900 dark:text-white">Claim No. {claimNoStr}</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bill.type === 'month' ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'}`}>
                                  {bill.type === 'month' ? 'Monthly' : 'Period'}
                                </span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${brsC.cls}`}>{brsC.label}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1"><Calendar size={11} /> {periodLabel}</span>
                                <span className="flex items-center gap-1"><Lock size={11} /> Locked on {genDate} {genTime}</span>
                                <span className="flex items-center gap-1"><ReceiptText size={11} /> {expCount} expense{expCount !== 1 ? 's' : ''}</span>
                              </div>
                            </div>

                            {/* Stats */}
                            <div className="flex gap-5 shrink-0">
                              <div className="text-center">
                                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-0.5">Expenses</p>
                                <p className="text-sm font-bold text-rose-600 dark:text-rose-400">₹{totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                              </div>
                              <div className="text-center">
                                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-0.5">Cash</p>
                                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{closingCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                              </div>
                              <div className="text-center">
                                <p className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold mb-0.5">Bank</p>
                                <p className="text-sm font-bold text-blue-600 dark:text-blue-400">₹{closingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="shrink-0 flex items-center gap-2">
                              <button
                                onClick={() => { setViewBillId(isOpen ? null : billKey(bill)); setViewTab('expenses'); }}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${isOpen ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100'}`}>
                                <BookOpen size={15} /> {isOpen ? 'Close' : 'View Bill'}
                              </button>
                              {brsStatus === 'missing' ? (
                                <button onClick={() => { setBrsBillId(bill.id); setBrsDraft({ ...EMPTY_BRS_DRAFT }); setActiveTab('brs'); }}
                                  className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-indigo-50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-slate-600 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                                  <Scale size={15} /> Start BRS
                                </button>
                              ) : (
                                <button onClick={() => { setBrsBillId(bill.id); setBrsDraft(null); setActiveTab('brs'); }}
                                  className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-indigo-50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-slate-600 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                                  <Scale size={15} /> View BRS
                                </button>
                              )}
                              <button onClick={() => exportBillExcel(bill)}
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md">
                                <FileSpreadsheet size={15} /> Excel
                              </button>
                              <button onClick={() => handleDeleteBill(bill)} title="Delete bill & unlock period"
                                className="p-2.5 rounded-xl text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 hover:border-rose-300 transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>

                          {/* ── INLINE VIEWER ── */}
                          {isOpen && (() => {
                            const { filteredRows: bRows, openingCash: bOC, openingBank: bOB, closingCash: bCC, closingBank: bCB,
                                    expenses: bExp, adjustments: bAdj, totalExpenses: bTotExp, claimNoStr: bClaim, periodLabel: bPeriod } = getBillLedgerData(bill);
                            const bTotAdj = bAdj.reduce((s,t) => s + (t.type==='Receipt' ? -t.amount : t.amount), 0);
                            const bPrevClaims = bill.previousClaims || [];
                            const bPrevClaimsTotal = bPrevClaims.reduce((s,c) => s + (parseFloat(c.amount) || 0), 0);
                            const { startDate: bSD } = getBillDateRange(bill);
                            const bGenDate = bill.generatedAt ? new Date(bill.generatedAt).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '';
                            const bTotalCashReceived = bOC + bRows.reduce((s, r) => s + (r.cashRec || 0), 0);
                            const bTotalBankReceived = bOB + bRows.reduce((s, r) => s + (r.bankRec || 0), 0);
                            const bTotalCashPaid = bRows.reduce((s, r) => s + (r.cashPaid || 0), 0);
                            const bTotalBankPaid = bRows.reduce((s, r) => s + (r.bankPaid || 0), 0);

                            return (
                              <div className={`border-t border-indigo-100 dark:border-indigo-900/50 ${viewTab !== 'summary' ? 'print-landscape' : ''}`}>
                                {/* View sub-tabs */}
                                <div className="flex items-center gap-1 px-5 pt-4 pb-0 print:hidden">
                                  {[
                                    { id:'expenses', label:'Expenses', icon: ReceiptText },
                                    { id:'ledger',   label:'Ledger',   icon: List },
                                    { id:'summary',  label:'Summary',  icon: FileText },
                                  ].map(({id, label, icon}) => (
                                    <button key={id} onClick={() => setViewTab(id)}
                                      className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-all ${viewTab === id ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                                      {createElement(icon, { size: 13 })} {label}
                                    </button>
                                  ))}
                                  <div className="flex-1"></div>
                                  <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 text-xs font-medium transition-colors print:hidden">
                                    <Printer size={13} /> Print
                                  </button>
                                </div>

                                <div className="px-5 pb-5 pt-4">

                                  {/* Print header — for Expenses and Ledger only; Summary has its own */}
                                  {viewTab !== 'summary' && (
                                  <div className="hidden print:block text-center mb-6 pb-4 border-b-2 border-black">
                                    <h2 className="text-xl font-bold uppercase tracking-widest">{orgName}</h2>
                                    <h3 className="text-lg font-semibold mt-2">Claim No. {bClaim} — {viewTab === 'expenses' ? 'Expense Statement' : 'Transaction Ledger'}</h3>
                                    <p className="text-sm text-gray-600 mt-1">Period: {bPeriod} | Printed: {new Date().toLocaleDateString('en-IN')}</p>
                                  </div>
                                  )}

                                  {/* ── Expenses sub-tab ── */}
                                  {viewTab === 'expenses' && (
                                    <div className="overflow-x-auto print:overflow-visible rounded-xl border border-gray-200 dark:border-slate-600 print:border-none print:rounded-none">
                                      <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300 print:text-[11px]">
                                        <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-slate-700 border-b border-gray-200 dark:border-slate-600 print:bg-white print:border-b-2 print:border-black">
                                          <tr>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-center w-16">Sr.#</th>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-center w-28">Date</th>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600">Payee / Particulars</th>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-28">Cash (₹)</th>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-28">Bank (₹)</th>
                                            <th className="px-4 py-3 border-r border-gray-200 dark:border-slate-600 text-right w-28 font-bold bg-gray-200 dark:bg-slate-600 print:bg-white">Total (₹)</th>
                                            <th className="px-4 py-3 text-center w-32">Account Code</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {bExp.map((row, i) => (
                                            <tr key={row.id} className="border-b border-gray-100 dark:border-slate-700 print:border-gray-300">
                                              <td className="px-4 py-2.5 text-center font-medium border-r border-gray-100 dark:border-slate-700">
                                                <div className="flex items-center justify-center gap-1"><Lock size={11} className="text-gray-300 dark:text-slate-600 print:hidden" />{row.expenseSerial ?? i + 1}</div>
                                              </td>
                                              <td className="px-4 py-2.5 text-center border-r border-gray-100 dark:border-slate-700">{fmtDate(row.date)}</td>
                                              <td className="px-4 py-2.5 border-r border-gray-100 dark:border-slate-700 text-gray-900 dark:text-gray-200 print:text-black">{row.particulars}</td>
                                              <td className="px-4 py-2.5 text-right border-r border-gray-100 dark:border-slate-700">{row.cashPaid > 0 ? row.cashPaid.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-4 py-2.5 text-right border-r border-gray-100 dark:border-slate-700">{row.bankPaid > 0 ? row.bankPaid.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-white border-r border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 print:bg-white print:text-black">{row.amount.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                              <td className="px-4 py-2.5 text-center font-medium text-indigo-600 dark:text-indigo-400 uppercase">{row.accountCode !== 'NONE' ? row.accountCode : ''}</td>
                                            </tr>
                                          ))}
                                          {bExp.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-gray-400">No expenses in this bill.</td></tr>}
                                          <tr className="bg-gray-100 dark:bg-slate-700 font-bold text-gray-900 dark:text-white print:bg-gray-50 print:border-t-2 print:border-black">
                                            <td colSpan="3" className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">TOTAL</td>
                                            <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{bExp.reduce((s,r)=>s+r.cashPaid,0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{bExp.reduce((s,r)=>s+r.bankPaid,0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-4 py-3 text-right border-r border-gray-200 dark:border-slate-600">{bExp.reduce((s,r)=>s+r.amount,0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td></td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* ── Ledger sub-tab ── */}
                                  {viewTab === 'ledger' && (
                                    <div className="overflow-x-auto print:overflow-visible rounded-xl border border-gray-200 dark:border-slate-600 print:border-none print:rounded-none">
                                      <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300">
                                        <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-slate-700 border-b border-gray-200 dark:border-slate-600 print:bg-white print:border-b-2 print:border-black">
                                          <tr>
                                            <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 w-12 text-center">Sr.#</th>
                                            <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 w-24 text-center">Date</th>
                                            <th rowSpan={2} className="px-3 py-3 border-r border-gray-200 dark:border-slate-600 min-w-[240px] print:w-[34%]">Particulars</th>
                                            <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-emerald-50 dark:bg-emerald-900/20 print:bg-white">Received (₹)</th>
                                            <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-rose-50 dark:bg-rose-900/20 print:bg-white">Paid (₹)</th>
                                            <th colSpan={2} className="px-3 py-2 border-r border-b border-gray-200 dark:border-slate-600 text-center bg-blue-50 dark:bg-blue-900/20 print:bg-white">Balance (₹)</th>
                                          </tr>
                                          <tr>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-emerald-50/50 dark:bg-emerald-900/10 print:bg-white">Cash</th>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-emerald-50/50 dark:bg-emerald-900/10 print:bg-white">Bank</th>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-rose-50/50 dark:bg-rose-900/10 print:bg-white">Cash</th>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-rose-50/50 dark:bg-rose-900/10 print:bg-white">Bank</th>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-blue-50/50 dark:bg-blue-900/10 print:bg-white">Cash</th>
                                            <th className="px-3 py-2 border-r border-gray-200 dark:border-slate-600 text-right bg-blue-50/50 dark:bg-blue-900/10 print:bg-white">Bank</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr className="bg-amber-50/30 dark:bg-amber-900/10 border-b border-gray-100 dark:border-slate-700 font-medium">
                                            <td className="px-3 py-2.5 text-center text-gray-400 print:text-black">-</td>
                                            <td className="px-3 py-2.5 text-center text-gray-400 print:text-black">-</td>
                                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 italic border-r border-gray-100 dark:border-slate-700">Opening Balance (as of {fmtDate(bSD)})</td>
                                            <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700">{bOC.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700">{bOB.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-2.5 border-r border-gray-100 dark:border-slate-700"></td>
                                            <td className="px-3 py-2.5 border-r border-gray-100 dark:border-slate-700"></td>
                                            <td className="px-3 py-2.5 text-right font-semibold text-gray-900 dark:text-white bg-blue-50/20 print:bg-white border-r border-gray-100 dark:border-slate-700">{bOC.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-2.5 text-right font-semibold text-gray-900 dark:text-white bg-blue-50/20 print:bg-white border-r border-gray-100 dark:border-slate-700">{bOB.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                          {bRows.map((row,i) => (
                                            <tr key={row.id} className={`border-b border-gray-100 dark:border-slate-700 ${row.isAdjustment ? 'bg-indigo-50/30 dark:bg-indigo-900/20' : ''}`}>
                                              <td className="px-3 py-2.5 text-center font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-slate-700">
                                                <div className="flex items-center justify-center gap-1"><Lock size={11} className="text-gray-300 dark:text-slate-600 print:hidden"/>{i+1}</div>
                                              </td>
                                              <td className="px-3 py-2.5 text-center text-gray-500 dark:text-gray-400 whitespace-nowrap border-r border-gray-100 dark:border-slate-700">{fmtDate(row.date)}</td>
                                              <td className="px-3 py-2.5 border-r border-gray-100 dark:border-slate-700">
                                                <div className="text-gray-900 dark:text-gray-200 flex items-center gap-2">
                                                  {row.particulars}
                                                  {row.isAdjustment && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">Adj.</span>}
                                                  {row.type === 'Ratification' && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Ratification</span>}
                                                </div>
                                                {row.accountCode !== 'NONE' && <div className="text-xs text-indigo-600 dark:text-indigo-400 uppercase mt-0.5">{row.accountCode}</div>}
                                              </td>
                                              <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700">{row.cashRec > 0 ? row.cashRec.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-3 py-2.5 text-right text-emerald-700 dark:text-emerald-400 border-r border-gray-100 dark:border-slate-700">{row.bankRec > 0 ? row.bankRec.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-3 py-2.5 text-right text-rose-700 dark:text-rose-400 border-r border-gray-100 dark:border-slate-700">{row.cashPaid > 0 ? row.cashPaid.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-3 py-2.5 text-right text-rose-700 dark:text-rose-400 border-r border-gray-100 dark:border-slate-700">{row.bankPaid > 0 ? row.bankPaid.toLocaleString('en-IN',{minimumFractionDigits:2}) : ''}</td>
                                              <td className="px-3 py-2.5 text-right font-medium text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-slate-700 bg-blue-50/20 print:bg-white">{row.balCash.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                              <td className="px-3 py-2.5 text-right font-medium text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-slate-700 bg-blue-50/20 print:bg-white">{row.balBank.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            </tr>
                                          ))}
                                          {bRows.length === 0 && <tr><td colSpan="9" className="p-6 text-center text-gray-400">No transactions in this bill.</td></tr>}
                                          <tr className="bg-gray-100 dark:bg-slate-700 font-bold border-t-2 border-gray-300 dark:border-slate-500 print:bg-gray-200 print:text-black">
                                            <td colSpan={3} className="px-3 py-3 text-right text-gray-800 dark:text-gray-100 border-r border-gray-200 dark:border-slate-600">TOTAL</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bTotalCashReceived.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bTotalBankReceived.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bTotalCashPaid.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bTotalBankPaid.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bCC.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white border-r border-gray-200 dark:border-slate-600">{bCB.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                          <tr className="bg-yellow-100 dark:bg-yellow-900/30 font-bold border-t border-yellow-300 dark:border-yellow-700 print:bg-yellow-200 print:text-black">
                                            <td colSpan={7} className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700">CLOSING BALANCE</td>
                                            <td className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700">{bCC.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td className="px-3 py-3 text-right text-yellow-900 dark:text-yellow-100 border-r border-yellow-300 dark:border-yellow-700">{bCB.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* ── Summary sub-tab ── */}
                                  {viewTab === 'summary' && (
                                    <div className="bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-600 rounded-xl p-10 font-serif text-gray-900 dark:text-gray-100 print:border-none print:p-0 print:bg-white">
                                      <div className="text-center mb-8">
                                        <h2 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4 mb-2">{orgName}</h2>
                                        <h3 className="text-lg font-semibold mb-3">Petty Cash Replenishment No. {bClaim}</h3>
                                        <p className="text-right text-sm">Date: <strong>{bGenDate}</strong></p>
                                      </div>
                                      <table className="w-full text-base mb-12 border-collapse">
                                        <thead>
                                          <tr className="border-b-2 border-black">
                                            <th className="py-3 text-left w-10">#</th>
                                            <th className="py-3 text-left">Particulars</th>
                                            <th className="py-3 text-right w-36"></th>
                                            <th className="py-3 text-right w-40">Amount - Rs.</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr className="border-b border-gray-300 border-dashed">
                                            <td className="py-3">1</td>
                                            <td className="py-3">Cash Balance</td>
                                            <td></td>
                                            <td className="py-3 text-right">{bCC.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                          <tr className="border-b border-gray-300 border-dashed">
                                            <td className="py-3">2</td>
                                            <td className="py-3 italic">Bank Balance as per cash book</td>
                                            <td></td>
                                            <td className="py-3 text-right">{bCB.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                          <tr>
                                            <td className="pt-4 pb-1">3</td>
                                            <td className="pt-4 pb-1 font-bold italic">Current Claim (#{bClaim})</td>
                                            <td className="pt-4 pb-1 text-right font-bold">{bTotExp.toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                            <td></td>
                                          </tr>
                                          {bAdj.map(tx => (
                                            <tr key={tx.id}>
                                              <td className="py-1"></td>
                                              <td className="py-1 font-bold">{tx.type === 'Receipt' ? 'Less' : 'Add'}: {tx.particulars}</td>
                                              <td className="py-1 text-right font-bold">{(tx.type==='Receipt' ? -tx.amount : tx.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                              <td></td>
                                            </tr>
                                          ))}
                                          {bPrevClaims.map(claim => (
                                            <tr key={claim.id}>
                                              <td className="py-1"></td>
                                              <td className="py-1 font-bold">{claimLabel(claim)}</td>
                                              <td className="py-1 text-right font-bold">{parseFloat(claim.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                              <td></td>
                                            </tr>
                                          ))}
                                          <tr className="border-t border-b-2 border-black">
                                            <td className="py-4"></td>
                                            <td></td>
                                            <td></td>
                                            <td className="py-4 text-right font-bold">{(bTotExp + bTotAdj + bPrevClaimsTotal).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                          <tr className="border-b-4 border-double border-black">
                                            <td className="py-4"></td>
                                            <td className="py-4 font-bold uppercase italic text-blue-600">TOTAL IMPREST AMOUNT</td>
                                            <td></td>
                                            <td className="py-4 text-right font-bold text-lg text-blue-600">{(appSettings.imprestAmount || 600000).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                      <div className="mt-16 pt-6 grid grid-cols-3 gap-8 text-center text-sm font-bold border-t border-gray-400">
                                        <div><div className="h-14 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.preparedBy || 'Prepared By'}</div>
                                        <div><div className="h-14 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.authorizedBy || 'Authorized By'}</div>
                                        <div><div className="h-14 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.approvedBy || 'Approved By'}</div>
                                      </div>
                                    </div>
                                  )}

                                  {viewTab !== 'summary' && <SignatureBlock />}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            );
          })()}
          {/* ═══════════ BRS HISTORY ═══════════ */}
          {activeTab === 'brs-history' && (() => {
            const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

            // Bills for selected year (by claimNo year)
            const yearBills = generatedBills
              .filter(b => parseInt(getBillClaimNo(b).split('/')[1]) === brsHistoryYear)
              .sort((a, b) => getBillDateRange(a).startDate.localeCompare(getBillDateRange(b).startDate));

            // 12-month grid: each cell = claimNo MM/YYYY for that year
            const monthCells = Array.from({ length: 12 }, (_, i) => {
              const mm = String(i + 1).padStart(2, '0');
              const claimNo = `${mm}/${brsHistoryYear}`;
              const bill = generatedBills.find(b => getBillClaimNo(b) === claimNo);
              const brsStatus = bill ? getBrsBillStatus(bill) : (parseInt(mm) > new Date().getMonth() + 1 && brsHistoryYear >= new Date().getFullYear() ? 'future' : 'noBill');
              return { mm, claimNo, label: MONTH_SHORT[i], bill, brsStatus };
            });

            const yearStats = {
              total: yearBills.length,
              withBrs: yearBills.filter(b => getBrsForBill(b)).length,
              balanced: yearBills.filter(b => getBrsBillStatus(b) === 'balanced').length,
              mismatched: yearBills.filter(b => getBrsBillStatus(b) === 'mismatched').length,
              draft: yearBills.filter(b => getBrsBillStatus(b) === 'draft').length,
              missing: yearBills.filter(b => getBrsBillStatus(b) === 'missing').length,
            };

            const statusConfig = {
              balanced:   { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800', badge: 'Balanced',   icon: <CheckCircle2 size={14} /> },
              mismatched: { bg: 'bg-rose-100 dark:bg-rose-900/30',       text: 'text-rose-700 dark:text-rose-400',       dot: 'bg-rose-500',    border: 'border-rose-200 dark:border-rose-800',     badge: 'Mismatched', icon: <AlertCircle size={14} /> },
              draft:      { bg: 'bg-amber-100 dark:bg-amber-900/30',     text: 'text-amber-700 dark:text-amber-400',     dot: 'bg-amber-400',   border: 'border-amber-200 dark:border-amber-800',   badge: 'Draft',      icon: <AlertCircle size={14} /> },
              missing:    { bg: 'bg-yellow-100 dark:bg-yellow-900/20',   text: 'text-yellow-700 dark:text-yellow-400',   dot: 'bg-yellow-400',  border: 'border-yellow-200 dark:border-yellow-800', badge: 'No BRS',     icon: <AlertCircle size={14} /> },
              noBill:     { bg: 'bg-gray-100 dark:bg-slate-700/50',      text: 'text-gray-400 dark:text-slate-500',      dot: 'bg-gray-300 dark:bg-slate-600', border: 'border-gray-200 dark:border-slate-700', badge: 'No Bill', icon: null },
              future:     { bg: 'bg-gray-100 dark:bg-slate-700/50',      text: 'text-gray-400 dark:text-slate-500',      dot: 'bg-gray-300 dark:bg-slate-600', border: 'border-gray-200 dark:border-slate-700', badge: 'Future',  icon: null },
            };

            return (
              <div className="max-w-5xl mx-auto space-y-5">

                {/* ── Top Bar ── */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-5 flex flex-wrap items-center gap-4 transition-colors">
                  <div className="flex items-center gap-3">
                    <History size={20} className="text-indigo-500" />
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">BRS HISTORY</h3>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button onClick={() => setBrsHistoryYear(y => y - 1)}
                      className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center justify-center transition-colors text-gray-600 dark:text-gray-300">
                      <ChevronDown size={16} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <span className="text-xl font-bold text-gray-900 dark:text-white w-14 text-center">{brsHistoryYear}</span>
                    <button onClick={() => setBrsHistoryYear(y => y + 1)}
                      disabled={brsHistoryYear >= new Date().getFullYear()}
                      className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center justify-center transition-colors text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="flex-1"></div>
                  <div className="flex items-center gap-4 text-xs">
                    {[
                      { label: 'Bills', val: yearStats.total, color: 'text-gray-700 dark:text-gray-200' },
                      { label: 'Balanced', val: yearStats.balanced, color: 'text-emerald-600 dark:text-emerald-400' },
                      { label: 'Mismatch', val: yearStats.mismatched, color: 'text-rose-600 dark:text-rose-400' },
                      { label: 'Draft', val: yearStats.draft, color: 'text-amber-600 dark:text-amber-400' },
                      { label: 'No BRS', val: yearStats.missing, color: 'text-yellow-600 dark:text-yellow-400' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="text-center">
                        <p className={`text-lg font-bold ${color}`}>{val}</p>
                        <p className="text-gray-400 dark:text-gray-500 leading-tight">{label}</p>
                      </div>
                    ))}
                  </div>
                  {yearStats.withBrs > 0 && (
                    <button onClick={() => exportBrsYearExcel(brsHistoryYear)}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm shrink-0">
                      <FileSpreadsheet size={16} /> Export {brsHistoryYear} Excel
                    </button>
                  )}
                </div>

                {/* ── 12-month mini grid ── */}
                <div className="grid grid-cols-6 gap-2">
                  {monthCells.map(({ claimNo, label, bill, brsStatus }) => {
                    const s = statusConfig[brsStatus] || statusConfig.noBill;
                    return (
                      <button key={claimNo}
                        onClick={() => { if (bill) { setBrsBillId(bill.id); setBrsDraft(null); setActiveTab('brs'); } }}
                        className={`${s.bg} ${s.text} border ${s.border} rounded-xl py-2.5 flex flex-col items-center justify-center gap-0.5 text-sm font-semibold transition-all hover:opacity-80`}>
                        <span>{label}</span>
                        <span className="text-xs font-normal opacity-70">{s.badge}</span>
                      </button>
                    );
                  })}
                </div>

                {/* ── Full bill table ── */}
                {yearBills.length === 0 ? (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-12 text-center shadow-sm">
                    <History size={40} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
                    <h4 className="text-base font-semibold text-gray-500 dark:text-gray-400">No bills for {brsHistoryYear}</h4>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Bills are listed here once generated from <strong>Summary / Letter</strong>.</p>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden transition-colors">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-700">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Claim No.</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Period</th>
                          <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">BRS Status</th>
                          <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cash Book Bal.</th>
                          <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bank Stmt. Bal.</th>
                          <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Difference</th>
                          <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Locked On</th>
                          <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-36">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {yearBills.map(bill => {
                          const claimNo = getBillClaimNo(bill);
                          const { startDate, endDate } = getBillDateRange(bill);
                          const rec = getBrsForBill(bill);
                          const brsStatus = getBrsBillStatus(bill);
                          const s = statusConfig[brsStatus] || statusConfig.noBill;
                          const totals = rec ? computeBrsTotals(rec) : null;
                          const periodLabel = bill.type === 'month' ? bill.value : `${fmtDate(startDate)} – ${fmtDate(endDate)}`;
                          return (
                            <tr key={bill.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-5 py-3.5 font-bold text-gray-800 dark:text-gray-200">Claim {claimNo}</td>
                              <td className="px-5 py-3.5 text-xs text-gray-500 dark:text-gray-400">{periodLabel}</td>
                              <td className="px-5 py-3.5">
                                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.bg} ${s.text} ${s.border}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>{s.badge}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right text-gray-700 dark:text-gray-300 font-medium">{totals ? `₹${totals.a1.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                              <td className="px-5 py-3.5 text-right text-gray-700 dark:text-gray-300 font-medium">{totals ? `₹${totals.b1.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                              <td className={`px-5 py-3.5 text-right font-bold ${!totals ? 'text-gray-400' : totals.difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {!totals ? '—' : totals.difference === 0 ? '✓ 0' : `₹${Math.abs(totals.difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                              </td>
                              <td className="px-5 py-3.5 text-right text-xs text-gray-400 dark:text-gray-500">
                                {rec?.lockedAt ? new Date(rec.lockedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="italic">—</span>}
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button onClick={() => { setBrsBillId(bill.id); setBrsDraft(null); setActiveTab('brs'); }}
                                    title="Open in BRS" className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 transition-colors">
                                    <Scale size={14} />
                                  </button>
                                  {rec?.lockedAt && (
                                    <>
                                      <button onClick={() => exportBrsExcel(rec)}
                                        title="Export Excel" className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-colors">
                                        <FileSpreadsheet size={14} />
                                      </button>
                                      <button onClick={() => handleReOpenBrs(bill.id)}
                                        title="Re-open" className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 transition-colors">
                                        <Unlock size={14} />
                                      </button>
                                    </>
                                  )}
                                  {rec && (
                                    <button onClick={() => handleDeleteBrs(bill.id)}
                                      title="Delete BRS" className="p-1.5 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>
            );
          })()}

          {/* ═══════════ BANK RECONCILIATION ═══════════ */}
          {activeTab === 'brs' && (() => {
            const sortedBills = [...generatedBills].sort((a, b) => getBillDateRange(b).startDate.localeCompare(getBillDateRange(a).startDate));
            const selectedBill = generatedBills.find(b => b.id === brsBillId) || sortedBills[0] || null;
            const activeBillId = selectedBill?.id || null;
            const { startDate: billStart, endDate: billEnd } = selectedBill ? getBillDateRange(selectedBill) : { startDate: '', endDate: '' };
            const existingRecord = activeBillId ? brsRecords.find(r => r.billId === activeBillId) : null;
            const isLocked = !!(existingRecord?.lockedAt);
            const workingRecord = brsDraft || (existingRecord ? { ...existingRecord } : null);
            const totals = workingRecord ? computeBrsTotals({ ...workingRecord, startDate: billStart, endDate: billEnd }) : null;

            // Linked bill data for reference panel
            const linkedBillData = selectedBill ? getBillLedgerData(selectedBill) : null;

            // Bank transactions for this bill's date range for picker
            const billBankPayments = globalLedger.rows.filter(tx => tx.date >= billStart && tx.date <= billEnd && (tx.type === 'Payment' || tx.type === 'Ratification') && tx.mode === 'Bank');
            const billBankReceipts = globalLedger.rows.filter(tx => tx.date >= billStart && tx.date <= billEnd && tx.type === 'Receipt' && tx.mode === 'Bank');

            const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1";

            return (
              <div className="max-w-5xl mx-auto space-y-5">

                {/* ── Top Bar ── */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-5 flex flex-wrap items-end gap-4 print:hidden transition-colors">
                  <div className="flex-1 min-w-[200px]">
                    <label className={labelCls}>Select Bill</label>
                    {sortedBills.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500 italic mt-1">No bills generated yet. Go to Summary / Letter to generate a bill first.</p>
                    ) : (
                      <select value={activeBillId || ''} onChange={e => { setBrsBillId(e.target.value); setBrsDraft(null); setBrsPickerOpen(null); setBrsManualOpen(null); }}
                        className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg p-2.5 text-sm">
                        {sortedBills.map(b => {
                          const cn = getBillClaimNo(b);
                          const { startDate, endDate } = getBillDateRange(b);
                          const brsStatus = getBrsBillStatus(b);
                          const statusMark = { balanced:'✓ ', mismatched:'⚠ ', draft:'● ', missing:'○ ' }[brsStatus] || '';
                          const label = b.type === 'month' ? `Claim ${cn} (${b.value})` : `Claim ${cn} (${fmtDate(startDate)} – ${fmtDate(endDate)})`;
                          return <option key={b.id} value={b.id}>{statusMark}{label}</option>;
                        })}
                      </select>
                    )}
                  </div>
                  <div className="flex-1"></div>

                  {/* Status badge */}
                  {existingRecord && (
                    <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full ${isLocked ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                      {isLocked ? <><Lock size={11} /> Locked</> : <><AlertCircle size={11} /> Draft</>}
                    </span>
                  )}

                  {/* Action buttons */}
                  {selectedBill && !isLocked && (
                    <>
                      {!workingRecord ? (
                        <button onClick={() => setBrsDraft({ ...EMPTY_BRS_DRAFT })}
                          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
                          <PlusCircle size={16} /> New BRS for Claim {getBillClaimNo(selectedBill)}
                        </button>
                      ) : (
                        <>
                          <button onClick={handleSaveBrsDraft}
                            className="flex items-center gap-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
                            <HardDrive size={16} /> Save Draft
                          </button>
                          <button onClick={handleLockBrs}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
                            <Lock size={16} /> Finalise & Lock
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {isLocked && (
                    <>
                      <button onClick={() => exportBrsExcel(existingRecord)}
                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
                        <FileSpreadsheet size={16} /> Export Excel
                      </button>
                      <button onClick={handlePrint}
                        className="flex items-center gap-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-600 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
                        <Printer size={16} /> Print
                      </button>
                      <button onClick={() => handleReOpenBrs(activeBillId)}
                        className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 hover:border-amber-400 px-3 py-2.5 rounded-lg text-sm transition-colors">
                        <Unlock size={16} /> Re-open
                      </button>
                      <button onClick={() => handleDeleteBrs(activeBillId)}
                        className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-gray-400 hover:text-rose-600 border border-gray-200 dark:border-slate-600 hover:border-rose-300 px-3 py-2.5 rounded-lg text-sm transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>

                {/* ── Linked Bill Reference Panel ── */}
                {selectedBill && linkedBillData && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5 print:hidden">
                    <h4 className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <ClipboardList size={13} /> Linked Bill — Reference Details
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 font-semibold mb-0.5">Claim No.</p>
                        <p className="font-bold text-indigo-800 dark:text-indigo-200">{linkedBillData.claimNoStr}</p>
                      </div>
                      <div>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 font-semibold mb-0.5">Period</p>
                        <p className="font-semibold text-indigo-800 dark:text-indigo-200">{fmtDate(billStart)} → {fmtDate(billEnd)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 font-semibold mb-0.5">Total Expenses</p>
                        <p className="font-bold text-rose-700 dark:text-rose-400">₹{linkedBillData.totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div>
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 font-semibold mb-0.5">Closing Bank (Cash Book)</p>
                        <p className="font-bold text-emerald-700 dark:text-emerald-400">₹{linkedBillData.closingBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-3 italic">The "Balance as per Cash Book" (A1) below is auto-calculated from ledger transactions within this bill's actual date range.</p>
                  </div>
                )}

                {/* ── No bill selected ── */}
                {!selectedBill && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-14 text-center shadow-sm">
                    <ClipboardList size={48} className="mx-auto text-gray-300 dark:text-slate-600 mb-4" />
                    <h4 className="text-lg font-semibold text-gray-500 dark:text-gray-400">No bills generated yet</h4>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Generate a bill from <strong>Summary / Letter</strong> first, then come back to create a BRS.</p>
                    <button onClick={() => setActiveTab('summary')} className="mt-5 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm">
                      <FileText size={16} /> Go to Summary
                    </button>
                  </div>
                )}

                {/* ── No record + not started ── */}
                {selectedBill && !workingRecord && !existingRecord && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-14 text-center shadow-sm">
                    <Scale size={48} className="mx-auto text-gray-300 dark:text-slate-600 mb-4" />
                    <h4 className="text-lg font-semibold text-gray-500 dark:text-gray-400">No BRS for Claim {getBillClaimNo(selectedBill)}</h4>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Click "New BRS" above to start the reconciliation for this bill.</p>
                  </div>
                )}

                {/* ── BRS Form / View ── */}
                {workingRecord && totals && (
                  <div className="space-y-4">

                    {/* ══ PRINT-ONLY: Traditional BRS layout matching PDF sample ══ */}
                    <div className="hidden print:block">
                      <div className="text-center mb-4 pb-3 border-b-2 border-black">
                        <h2 className="text-lg font-bold uppercase tracking-widest">{orgName}</h2>
                        <h3 className="text-base font-bold mt-1 uppercase">
                          Bank Reconciliation Statement as on {(() => {
                            const [y, m] = billStart.split('-').map(Number);
                            const lastDay = new Date(y, m, 0).getDate();
                            const suffix = (lastDay >= 11 && lastDay <= 13) ? 'th' : lastDay % 10 === 1 ? 'st' : lastDay % 10 === 2 ? 'nd' : lastDay % 10 === 3 ? 'rd' : 'th';
                            const monthName = new Date(y, m - 1).toLocaleString('en-IN', { month: 'long' }).toUpperCase();
                            return `${lastDay}${suffix} ${monthName}, ${y}`;
                          })()}
                        </h3>
                        <p className="text-right text-sm mt-1">{new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'})}</p>
                      </div>

                      {/* Summary Table */}
                      <table className="w-full text-sm border-collapse mb-6">
                        <tbody>
                          <tr><td className="py-2 font-bold w-8">A</td><td className="py-2 font-bold" colSpan={2}>Cash Book Balance</td><td></td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">1</td><td colSpan={2} className="py-1.5">Balance as per cash book</td><td className="py-1.5 text-right w-32 font-medium">{totals.a1.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">2</td><td colSpan={2} className="py-1.5">Add : Cheques issued but not cleared</td><td className="py-1.5 text-right font-medium">{totals.a2Total>0?totals.a2Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">3</td><td colSpan={2} className="py-1.5">Less : Cheques deposited but not credited by bank</td><td className="py-1.5 text-right font-medium">{totals.a3Total>0?totals.a3Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          <tr className="border-b-2 border-black"><td></td><td colSpan={2} className="py-2 font-bold">Adjusted Cash Book Balance</td><td className="py-2 text-right font-bold">{totals.adjCashBook.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
                          <tr><td colSpan={4} className="py-2"></td></tr>
                          <tr><td className="py-2 font-bold">B</td><td className="py-2 font-bold" colSpan={2}>Bank Balance</td><td></td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">1</td><td colSpan={2} className="py-1.5">Balance as per bank statement</td><td className="py-1.5 text-right font-medium">{totals.b1.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">2</td><td colSpan={2} className="py-1.5">Add : Bank charges not reflected in the cash book</td><td className="py-1.5 text-right font-medium">{totals.b2Total>0?totals.b2Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          <tr className="border-b border-gray-200"><td className="py-1.5 pl-4">3</td><td colSpan={2} className="py-1.5">Less : Bank credits not reflected in the cash book</td><td className="py-1.5 text-right font-medium">{totals.b3Total>0?totals.b3Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          <tr className="border-b-2 border-black"><td></td><td colSpan={2} className="py-2 font-bold">Adjusted Bank Balance</td><td className="py-2 text-right font-bold">{totals.adjBank.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
                          <tr><td colSpan={4} className="py-2"></td></tr>
                          <tr className="border-t border-gray-300 border-b-2 border-black"><td className="py-2 font-bold">&nbsp;C</td><td colSpan={2} className="py-2 font-bold">Difference (A-B)</td><td className="py-2 text-right font-bold">{totals.difference===0?'-':totals.difference.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
                        </tbody>
                      </table>

                      {/* A2 Detail Table */}
                      <div className="mt-6 mb-4">
                        <p className="font-bold text-sm mb-1">A2 Cheque issued but not cleared</p>
                        <table className="w-full text-xs border-collapse border border-gray-300">
                          <thead><tr className="border-b border-gray-400 bg-gray-50"><th className="px-2 py-1.5 text-left w-8">#</th><th className="px-2 py-1.5 text-left w-24">Date</th><th className="px-2 py-1.5 text-left w-28">Cheque/ Ref. No.</th><th className="px-2 py-1.5 text-left">Particulars</th><th className="px-2 py-1.5 text-right w-28">Amount - Rs.</th></tr></thead>
                          <tbody>
                            {(workingRecord.a2Items||[]).map((item,i)=>(<tr key={item.id} className="border-b border-gray-200"><td className="px-2 py-1">{i+1}</td><td className="px-2 py-1">{fmtDate(item.date)}</td><td className="px-2 py-1">{item.refNo||''}</td><td className="px-2 py-1">{item.particulars}</td><td className="px-2 py-1 text-right">{parseFloat(item.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>))}
                            <tr className="border-t-2 border-gray-400 font-bold"><td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td><td className="px-2 py-1.5 text-right">{totals.a2Total>0?totals.a2Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      {/* A3 Detail Table */}
                      <div className="mb-4">
                        <p className="font-bold text-sm mb-1">A3 Cheque Deposited but not credited</p>
                        <table className="w-full text-xs border-collapse border border-gray-300">
                          <thead><tr className="border-b border-gray-400 bg-gray-50"><th className="px-2 py-1.5 text-left w-8">#</th><th className="px-2 py-1.5 text-left w-24">Date</th><th className="px-2 py-1.5 text-left w-28">Cheque/ Ref. No.</th><th className="px-2 py-1.5 text-left">Particulars</th><th className="px-2 py-1.5 text-right w-28">Amount (Rs.)</th></tr></thead>
                          <tbody>
                            {(workingRecord.a3Items||[]).map((item,i)=>(<tr key={item.id} className="border-b border-gray-200"><td className="px-2 py-1">{i+1}</td><td className="px-2 py-1">{fmtDate(item.date)}</td><td className="px-2 py-1">{item.refNo||''}</td><td className="px-2 py-1">{item.particulars}</td><td className="px-2 py-1 text-right">{parseFloat(item.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>))}
                            <tr className="border-t-2 border-gray-400 font-bold"><td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td><td className="px-2 py-1.5 text-right">{totals.a3Total>0?totals.a3Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      {/* B2 Detail Table */}
                      <div className="mb-4">
                        <p className="font-bold text-sm mb-1">B2 Bank Charges not reflected in the cash book</p>
                        <table className="w-full text-xs border-collapse border border-gray-300">
                          <thead><tr className="border-b border-gray-400 bg-gray-50"><th className="px-2 py-1.5 text-left w-8">#</th><th className="px-2 py-1.5 text-left w-24">Date</th><th className="px-2 py-1.5 text-left w-28">Cheque/ Ref. No.</th><th className="px-2 py-1.5 text-left">Particulars</th><th className="px-2 py-1.5 text-right w-28">Amount - Rs.</th></tr></thead>
                          <tbody>
                            {(workingRecord.b2Items||[]).map((item,i)=>(<tr key={item.id} className="border-b border-gray-200"><td className="px-2 py-1">{i+1}</td><td className="px-2 py-1">{fmtDate(item.date)}</td><td className="px-2 py-1">{item.refNo||''}</td><td className="px-2 py-1">{item.particulars}</td><td className="px-2 py-1 text-right">{parseFloat(item.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>))}
                            <tr className="border-t-2 border-gray-400 font-bold"><td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td><td className="px-2 py-1.5 text-right">{totals.b2Total>0?totals.b2Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      {/* B3 Detail Table */}
                      <div className="mb-4">
                        <p className="font-bold text-sm mb-1">B3 Bank credits not reflected in the cash book</p>
                        <table className="w-full text-xs border-collapse border border-gray-300">
                          <thead><tr className="border-b border-gray-400 bg-gray-50"><th className="px-2 py-1.5 text-left w-8">#</th><th className="px-2 py-1.5 text-left w-24">Date</th><th className="px-2 py-1.5 text-left w-28">Cheque/ Ref. No.</th><th className="px-2 py-1.5 text-left">Particulars</th><th className="px-2 py-1.5 text-right w-28">Amount (Rs.)</th></tr></thead>
                          <tbody>
                            {(workingRecord.b3Items||[]).map((item,i)=>(<tr key={item.id} className="border-b border-gray-200"><td className="px-2 py-1">{i+1}</td><td className="px-2 py-1">{fmtDate(item.date)}</td><td className="px-2 py-1">{item.refNo||''}</td><td className="px-2 py-1">{item.particulars}</td><td className="px-2 py-1 text-right">{parseFloat(item.amount).toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>))}
                            <tr className="border-t-2 border-gray-400 font-bold"><td colSpan={4} className="px-2 py-1.5 text-right">TOTAL</td><td className="px-2 py-1.5 text-right">{totals.b3Total>0?totals.b3Total.toLocaleString('en-IN',{minimumFractionDigits:2}):'-'}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Print Signatures */}
                      <div className="grid grid-cols-2 gap-16 mt-12 pt-8 text-center text-sm font-bold border-t border-gray-400">
                        <div><div className="h-16 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.preparedBy || 'Prepared By'}</div>
                        <div><div className="h-16 border-b border-gray-500 mb-2"></div>{appSettings.signatories?.authorizedBy || 'Authorized By'}</div>
                      </div>
                    </div>
                    {/* ══ END PRINT-ONLY LAYOUT ══ */}

                    {/* ── Section A: Cash Book Balance (screen only) ── */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-6 transition-colors print:hidden">
                      <h4 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
                        <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white text-sm flex items-center justify-center font-bold shrink-0">A</span>
                        Cash Book Balance
                      </h4>

                      {/* A1 — auto */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-700">
                        <div>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">1 &nbsp; Balance as per Cash Book</p>
                          <p className="text-xs text-gray-400 mt-0.5">Auto-calculated from ledger — closing bank balance for period {fmtDate(billStart)} to {fmtDate(billEnd)}</p>
                        </div>
                        <span className="text-base font-bold text-gray-900 dark:text-white">₹{totals.a1.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>

                      {/* A2 */}
                      <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">2 &nbsp; Add: Cheques Issued But Not Cleared</p>
                          <span className={`text-base font-bold ${totals.a2Total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                            {totals.a2Total > 0 ? `₹${totals.a2Total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                          </span>
                        </div>
                        <BrsItemTable section="a2" items={workingRecord.a2Items} label="Cheques Issued But Not Cleared" sectionLetter="A2" pickerTxList={billBankPayments} isLocked={isLocked} workingRecord={workingRecord} brsPickerOpen={brsPickerOpen} setBrsPickerOpen={setBrsPickerOpen} brsManualOpen={brsManualOpen} setBrsManualOpen={setBrsManualOpen} brsManualForm={brsManualForm} setBrsManualForm={setBrsManualForm} brsMonth={brsMonth} addBrsItem={addBrsItem} removeBrsItem={removeBrsItem} toggleBrsTxPicker={toggleBrsTxPicker} />
                      </div>

                      {/* A3 */}
                      <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">3 &nbsp; Less: Cheques Deposited But Not Credited by Bank</p>
                          <span className={`text-base font-bold ${totals.a3Total > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400'}`}>
                            {totals.a3Total > 0 ? `(₹${totals.a3Total.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` : '—'}
                          </span>
                        </div>
                        <BrsItemTable section="a3" items={workingRecord.a3Items} label="Cheques Deposited But Not Credited" sectionLetter="A3" pickerTxList={billBankReceipts} isLocked={isLocked} workingRecord={workingRecord} brsPickerOpen={brsPickerOpen} setBrsPickerOpen={setBrsPickerOpen} brsManualOpen={brsManualOpen} setBrsManualOpen={setBrsManualOpen} brsManualForm={brsManualForm} setBrsManualForm={setBrsManualForm} brsMonth={brsMonth} addBrsItem={addBrsItem} removeBrsItem={removeBrsItem} toggleBrsTxPicker={toggleBrsTxPicker} />
                      </div>

                      {/* Adjusted Cash Book Balance */}
                      <div className="flex items-center justify-between pt-4 mt-1">
                        <p className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wide">Adjusted Cash Book Balance</p>
                        <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">₹{totals.adjCashBook.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* ── Section B: Bank Balance (screen only) ── */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-6 transition-colors print:hidden">
                      <h4 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
                        <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-sm flex items-center justify-center font-bold shrink-0">B</span>
                        Bank Balance
                      </h4>

                      {/* B1 — manual */}
                      <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-700 gap-4">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">1 &nbsp; Balance as per Bank Statement</p>
                          <p className="text-xs text-gray-400">Enter the closing balance from your bank statement for the period {fmtDate(billStart)} to {fmtDate(billEnd)}</p>
                        </div>
                        {isLocked ? (
                          <span className="text-base font-bold text-gray-900 dark:text-white">₹{totals.b1.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        ) : (
                          <input type="number" min="0" step="0.01" placeholder="0.00"
                            value={workingRecord.bankStatementBalance}
                            onChange={e => setBrsDraft(prev => ({ ...prev, bankStatementBalance: e.target.value }))}
                            className="w-44 bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg p-2.5 text-sm text-right font-semibold focus:ring-2 focus:ring-indigo-500 transition-colors" />
                        )}
                      </div>

                      {/* B2 */}
                      <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">2 &nbsp; Add: Bank Charges Not Reflected in Cash Book</p>
                          <span className={`text-base font-bold ${totals.b2Total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                            {totals.b2Total > 0 ? `₹${totals.b2Total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                          </span>
                        </div>
                        <BrsItemTable section="b2" items={workingRecord.b2Items} label="Bank Charges Not in Cash Book" sectionLetter="B2" pickerTxList={[]} isLocked={isLocked} workingRecord={workingRecord} brsPickerOpen={brsPickerOpen} setBrsPickerOpen={setBrsPickerOpen} brsManualOpen={brsManualOpen} setBrsManualOpen={setBrsManualOpen} brsManualForm={brsManualForm} setBrsManualForm={setBrsManualForm} brsMonth={brsMonth} addBrsItem={addBrsItem} removeBrsItem={removeBrsItem} toggleBrsTxPicker={toggleBrsTxPicker} />
                      </div>

                      {/* B3 */}
                      <div className="py-3 border-b border-gray-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">3 &nbsp; Less: Bank Credits Not Reflected in Cash Book</p>
                          <span className={`text-base font-bold ${totals.b3Total > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400'}`}>
                            {totals.b3Total > 0 ? `(₹${totals.b3Total.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` : '—'}
                          </span>
                        </div>
                        <BrsItemTable section="b3" items={workingRecord.b3Items} label="Bank Credits Not in Cash Book" sectionLetter="B3" pickerTxList={[]} isLocked={isLocked} workingRecord={workingRecord} brsPickerOpen={brsPickerOpen} setBrsPickerOpen={setBrsPickerOpen} brsManualOpen={brsManualOpen} setBrsManualOpen={setBrsManualOpen} brsManualForm={brsManualForm} setBrsManualForm={setBrsManualForm} brsMonth={brsMonth} addBrsItem={addBrsItem} removeBrsItem={removeBrsItem} toggleBrsTxPicker={toggleBrsTxPicker} />
                      </div>

                      {/* Adjusted Bank Balance */}
                      <div className="flex items-center justify-between pt-4 mt-1">
                        <p className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wide">Adjusted Bank Balance</p>
                        <span className="text-xl font-bold text-blue-600 dark:text-blue-400">₹{totals.adjBank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* ── Section C: Difference (screen only) ── */}
                    <div className={`rounded-2xl border-2 shadow-sm p-6 flex items-center justify-between transition-colors print:hidden ${
                      totals.difference === 0
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700'
                        : 'bg-rose-50 dark:bg-rose-900/20 border-rose-300 dark:border-rose-700'
                    }`}>
                      <div>
                        <p className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 mb-1">
                          <span className={`w-7 h-7 rounded-lg text-white text-sm flex items-center justify-center font-bold shrink-0 ${totals.difference === 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>C</span>
                          Difference (A − B)
                        </p>
                        <p className={`text-xs mt-0.5 ${totals.difference === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                          {totals.difference === 0
                            ? '✓ Books are reconciled — Adjusted Cash Book Balance matches Adjusted Bank Balance'
                            : `⚠ Discrepancy of ₹${Math.abs(totals.difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })} — please investigate`}
                        </p>
                      </div>
                      <span className={`text-3xl font-bold ${totals.difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        ₹{Math.abs(totals.difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>


                  </div>
                )}

                {/* ── All Bills BRS strip ── */}
                {sortedBills.length > 0 && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-5 print:hidden transition-colors">
                    <h4 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">All Bills — BRS Status</h4>
                    <div className="flex flex-wrap gap-2">
                      {sortedBills.map(bill => {
                        const brsStatus = getBrsBillStatus(bill);
                        const rec = getBrsForBill(bill);
                        const claimNo = getBillClaimNo(bill);
                        const dotColor = { balanced:'bg-emerald-400', mismatched:'bg-rose-400', draft:'bg-amber-400', missing:'bg-gray-300 dark:bg-slate-500' }[brsStatus] || 'bg-gray-300';
                        return (
                          <button key={bill.id} onClick={() => { setBrsBillId(bill.id); setBrsDraft(null); }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                              bill.id === activeBillId
                                ? 'bg-indigo-600 border-indigo-700 text-white shadow-md'
                                : 'bg-gray-50 dark:bg-slate-700 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-600'
                            }`}>
                            {rec?.lockedAt ? <Lock size={11} /> : <AlertCircle size={11} />}
                            Claim {claimNo}
                            <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            );
          })()}

          {/* ═══════════ VENDOR BILL SUMMARY ═══════════ */}
          {activeTab === 'vendor-bills' && (
            <VendorBills appSettings={appSettings} accountCodes={accountCodes} />
          )}

          {/* ═══════════ FORMS — PETTY CASH VOUCHER ═══════════ */}
          {activeTab === 'forms' && (
            <Forms appSettings={appSettings} accountCodes={accountCodes} onAddTransaction={handleAddVoucherTransaction} voucherBranding={appSettings.pettyCashVoucher} />
          )}


          {/* ═══════════ SETTINGS ═══════════ */}
          {activeTab === 'settings' && (
            <div className="max-w-4xl mx-auto space-y-6 pb-12">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
                  <Settings className="text-indigo-600 dark:text-indigo-400" /> System Configurations
                </h3>
                <button onClick={handleSaveSettings} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium shadow-md">
                  Save All Configurations
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Users size={18} className="text-gray-500" /> General Details</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">Organization / Branding Name</label>
                      <input type="text" value={appSettings.orgName || ''} placeholder="Your Organization" onChange={(e) => setAppSettings(prev => ({ ...prev, orgName: e.target.value }))}
                        className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5" />
                      <p className="text-xs text-gray-400 mt-1">Shown on printed statements, letters and Excel exports.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">Total Imprest Amount (₹)</label>
                      <input type="number" value={appSettings.imprestAmount || ''} onChange={(e) => setAppSettings(prev => ({ ...prev, imprestAmount: parseFloat(e.target.value) || 0 }))}
                        className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5" />
                    </div>
                    <div className="pt-2 border-t border-gray-100 dark:border-slate-700 space-y-3">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Summary Signatories</p>
                      <div className="grid grid-cols-3 gap-3">
                        {[['preparedBy', 'Prepared By'], ['authorizedBy', 'Authorized By'], ['approvedBy', 'Approved By']].map(([key, label]) => (
                          <div key={key}>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                            <input type="text" value={appSettings.signatories?.[key] || ''}
                              onChange={(e) => setAppSettings(prev => ({ ...prev, signatories: { ...(prev.signatories || {}), [key]: e.target.value } }))}
                              className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2 text-sm" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><Wallet size={18} className="text-gray-500" /> Opening Balances</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Set the cash and bank balances at the start of your records. All running balances are calculated from these seeds.</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">Opening Cash Balance (₹)</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={appSettings.openingCashBalance ?? ''}
                        onChange={e => setAppSettings(prev => ({ ...prev, openingCashBalance: parseFloat(e.target.value) || 0 }))}
                        placeholder="0.00"
                        className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">Opening Bank Balance (₹)</label>
                      <input
                        type="number" min="0" step="0.01"
                        value={appSettings.openingBankBalance ?? ''}
                        onChange={e => setAppSettings(prev => ({ ...prev, openingBankBalance: parseFloat(e.target.value) || 0 }))}
                        placeholder="0.00"
                        className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 font-mono"
                      />
                    </div>
                    {(appSettings.openingCashBalance > 0 || appSettings.openingBankBalance > 0) && (
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
                        <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                        <span>Opening seeds active — Cash: <strong>₹{(appSettings.openingCashBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>, Bank: <strong>₹{(appSettings.openingBankBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>. All balances reflect these starting values.</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><HardDrive size={18} className="text-gray-500" /> System Preferences</h4>
                  <div className="space-y-5">
                    {[
                      { key: 'isDarkMode', label: 'Dark Mode', desc: 'Toggle app appearance theme', icon: appSettings.isDarkMode ? <Moon size={16} className="text-indigo-400" /> : <Sun size={16} className="text-amber-500" /> },
                      { key: 'allowEditGenerated', label: 'Allow Editing Generated Bills', desc: 'Bypass lock. Warning: alters past sums.', icon: <ShieldAlert size={16} className={appSettings.allowEditGenerated ? "text-amber-500" : "text-gray-400"} /> },
                      { key: 'monthlyBackupReminder', label: 'Monthly Backup Reminder', desc: 'Prompt for backup at end of month', icon: null }
                    ].map(({ key, label, desc, icon }, i) => (
                      <div key={key} className={`flex items-center justify-between ${i > 0 ? 'pt-4 border-t border-gray-100 dark:border-slate-700' : ''}`}>
                        <div className="pr-4">
                          <h5 className="font-medium text-gray-900 dark:text-white text-sm flex items-center gap-2">{icon} {label}</h5>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAppSettings(prev => ({ ...prev, [key]: !prev[key] }))}
                          className={`relative inline-flex shrink-0 rounded-full transition-colors duration-300 focus:outline-none ${appSettings[key] ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'}`}
                          style={{ width: '44px', height: '24px', minWidth: '44px' }}
                        >
                          <span
                            className="absolute top-0.5 bg-white rounded-full shadow-md transition-all duration-300"
                            style={{
                              width: '20px', height: '20px',
                              left: appSettings[key] ? '22px' : '2px'
                            }}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors lg:col-span-2">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Database size={18} className="text-gray-500" /> Account Codes & Budget Limits</h4>
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs uppercase bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-slate-600">
                        <tr>
                          <th className="px-4 py-2 w-32">Code</th>
                          <th className="px-4 py-2">Description</th>
                          <th className="px-4 py-2 text-right w-36">Annual Limit (₹)</th>
                          <th className="px-4 py-2 text-right w-32">Spent (₹)</th>
                          <th className="px-4 py-2 text-right w-36">Claimed Back (₹)</th>
                          <th className="px-4 py-2 text-right w-32">Net Used (₹)</th>
                          <th className="px-4 py-2 text-center w-16">Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {accountCodes.map(code => {
                          const { paid, credited, net } = getAccountCodeUsage(code.code);
                          return (
                            <tr key={code.id} className="text-gray-800 dark:text-gray-200">
                              <td className="px-4 py-2 font-medium uppercase">{code.code}</td>
                              <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{code.description}</td>
                              <td className="px-4 py-2 text-right">{code.limit.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{paid.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400 font-medium">{credited > 0 ? credited.toLocaleString('en-IN') : '—'}</td>
                              <td className={`px-4 py-2 text-right font-semibold ${net > code.limit ? 'text-rose-600 dark:text-rose-400' : 'text-gray-800 dark:text-gray-200'}`}>{net.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-2 text-center">
                                <button onClick={() => handleRemoveAccountCode(code.id)} className="text-gray-400 hover:text-rose-500 transition-colors"><Trash2 size={16} /></button>
                              </td>
                            </tr>
                          );
                        })}
                        {accountCodes.length === 0 && <tr><td colSpan="7" className="p-4 text-center text-gray-500">No account codes configured.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded-lg flex items-end gap-3 border border-gray-200 dark:border-slate-600">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">New Code</label>
                      <input type="text" placeholder="e.g. TEL01" value={newCodeForm.code} onChange={(e) => setNewCodeForm(prev => ({ ...prev, code: e.target.value }))} className="w-28 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-2 text-sm uppercase" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Description</label>
                      <input type="text" placeholder="e.g. Supplies & Services" value={newCodeForm.description} onChange={(e) => setNewCodeForm(prev => ({ ...prev, description: e.target.value }))} className="w-full bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Annual Limit (₹)</label>
                      <input type="number" placeholder="0" value={newCodeForm.limit} onChange={(e) => setNewCodeForm(prev => ({ ...prev, limit: e.target.value }))} className="w-32 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded p-2 text-sm" />
                    </div>
                    <button onClick={handleAddAccountCode} className="bg-slate-800 dark:bg-indigo-600 hover:bg-slate-900 dark:hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm font-medium h-9">Add</button>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors lg:col-span-2 flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Database size={18} className="text-gray-500" /> Data Backup & Restore</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Download a complete JSON backup or restore from a previous file.</p>
                  </div>
                  <div className="flex gap-3">
                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleImportData} className="hidden" />
                    <button onClick={loadSampleData} className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm">
                      <Database size={16} /> Load Sample Data
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm">
                      <Upload size={16} /> Import Backup
                    </button>
                    <button onClick={exportFullBackup} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white border border-slate-300 dark:border-slate-500 px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm">
                      <Download size={16} /> Export Full Backup
                    </button>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors lg:col-span-2">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><ImageIcon size={18} className="text-gray-500" /> Petty Cash Voucher Branding</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Applied as the letterhead on every printed Petty Cash Voucher.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* Header logo */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-2">Header Logo</label>
                      <div className="bg-gray-50 dark:bg-slate-700/50 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg p-4 flex flex-col items-center gap-3">
                        {appSettings.pettyCashVoucher?.headerLogo ? (
                          <>
                            <img src={appSettings.pettyCashVoucher.headerLogo} alt="Voucher header logo" className="max-h-20 max-w-full object-contain bg-white rounded" />
                            <div className="flex gap-2">
                              <button onClick={() => voucherLogoInputRef.current?.click()} className="text-xs bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-slate-600">Replace</button>
                              <button onClick={handleRemoveVoucherLogo} className="text-xs bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-rose-600 dark:text-rose-400 px-3 py-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-900/20">Remove</button>
                            </div>
                          </>
                        ) : (
                          <button onClick={() => voucherLogoInputRef.current?.click()} className="flex flex-col items-center gap-2 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 py-4">
                            <ImageIcon size={28} />
                            <span className="text-xs font-medium">Upload PNG / JPG logo</span>
                          </button>
                        )}
                        <input ref={voucherLogoInputRef} type="file" accept="image/png,image/jpeg" onChange={handleVoucherLogoUpload} className="hidden" />
                      </div>
                    </div>

                    {/* Footer rich text */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-2">Footer Text</label>
                      <div className="border border-gray-300 dark:border-slate-600 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-1 bg-gray-50 dark:bg-slate-700 border-b border-gray-300 dark:border-slate-600 px-2 py-1.5">
                          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyFooterFormat('bold')} title="Bold" className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300"><Bold size={14} /></button>
                          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyFooterFormat('italic')} title="Italic" className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300"><Italic size={14} /></button>
                          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyFooterFormat('underline')} title="Underline" className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300"><Underline size={14} /></button>
                          <span className="w-px h-5 bg-gray-300 dark:bg-slate-600 mx-1" />
                          {['#111827', '#059669', '#dc2626', '#2563eb', '#6b7280'].map(color => (
                            <button key={color} type="button" onMouseDown={e => e.preventDefault()} onClick={() => applyFooterFormat('foreColor', color)} title={color}
                              className="w-5 h-5 rounded-full border border-gray-300 dark:border-slate-500" style={{ backgroundColor: color }} />
                          ))}
                          <span className="flex-1" />
                          <button type="button" onMouseDown={e => e.preventDefault()} onClick={handleClearFooter} title="Clear" className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-400"><Trash2 size={14} /></button>
                        </div>
                        <div
                          ref={el => { voucherFooterRef.current = el; if (el && !el.dataset.init) { el.innerHTML = sanitizeHtml(appSettings.pettyCashVoucher?.footerHtml || ''); el.dataset.init = '1'; } }}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={handleFooterInput}
                          className="min-h-[90px] px-3 py-2 text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-slate-800 focus:outline-none"
                        />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 flex items-center gap-1"><Palette size={11} /> Select text, then use the toolbar to format it.</p>
                    </div>

                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors lg:col-span-2">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><Wifi size={18} className="text-gray-500" /> Network / LAN Sync</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    Share this PC's Main Cashbook (transactions, bills, account codes, BRS, settings) live over your local network. Vendor Bill Summary and Petty Cash Voucher stay local to each PC for now.
                  </p>

                  <div className="flex bg-gray-100 dark:bg-slate-900 p-1 rounded-lg mb-5 max-w-xl">
                    {[
                      ['standalone', 'Standalone'],
                      ['host', 'Host this network'],
                      ['client', 'Connect to a host'],
                    ].map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => handleSetNetworkMode(mode)}
                        className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${appSettings.network.mode === mode ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {appSettings.network.mode === 'standalone' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Data stays on this PC only — nothing is shared over the network.</p>
                  )}

                  {appSettings.network.mode === 'host' && (
                    <div className="space-y-4 max-w-xl">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Port</label>
                          <input type="number" value={appSettings.network.port} onChange={e => updateNetwork({ port: e.target.value })} disabled={serverStatus.running}
                            className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm disabled:opacity-60" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shared PIN</label>
                          <div className="flex gap-2">
                            <input type="text" value={appSettings.network.pin} onChange={e => updateNetwork({ pin: e.target.value })} disabled={serverStatus.running}
                              className="flex-1 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-60" />
                            {!serverStatus.running && (
                              <button type="button" onClick={handleGeneratePin} className="text-xs border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-gray-300 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700">New</button>
                            )}
                          </div>
                        </div>
                      </div>

                      {serverStatus.running ? (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                            <Radio size={15} className="animate-pulse" />
                            <span>Running — other PCs connect to <strong className="font-mono">{serverStatus.lanIp || '?'}:{serverStatus.port}</strong></span>
                          </div>
                          {serverStatus.lanIp && (
                            <button type="button" onClick={() => navigator.clipboard?.writeText(`${serverStatus.lanIp}:${serverStatus.port}`)}
                              title="Copy address" className="p-1.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"><Copy size={14} /></button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5"><Server size={13} /> Server is stopped.</p>
                      )}

                      {cashbookSync.status === 'live' && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Radio size={12} className="animate-pulse" /> Cashbook data is syncing live to connected PCs.</p>
                      )}
                      {cashbookSync.status === 'connecting' && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">Connecting sync…</p>
                      )}
                      {cashbookSync.status === 'error' && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle size={12} /> Sync error: {cashbookSync.error}</p>
                      )}

                      {serverError && <p className="text-xs text-rose-600 dark:text-rose-400">{serverError}</p>}

                      <button type="button" onClick={serverStatus.running ? handleStopHostServer : handleStartHostServer} disabled={serverBusy}
                        className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium shadow-sm disabled:opacity-60 ${serverStatus.running ? 'bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                        <Server size={16} /> {serverBusy ? 'Working…' : serverStatus.running ? 'Stop Server' : 'Start Server'}
                      </button>
                    </div>
                  )}

                  {appSettings.network.mode === 'client' && (
                    <div className="space-y-4 max-w-xl">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Host PC's IP Address</label>
                          <input type="text" placeholder="e.g. 192.168.1.42" value={appSettings.network.hostIp} onChange={e => updateNetwork({ hostIp: e.target.value })}
                            className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Port</label>
                          <input type="number" value={appSettings.network.port} onChange={e => updateNetwork({ port: e.target.value })}
                            className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shared PIN</label>
                        <input type="text" value={appSettings.network.pin} onChange={e => updateNetwork({ pin: e.target.value })}
                          className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm font-mono" placeholder="Ask the host PC for this" />
                      </div>

                      {clientTest.connected === true && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={15} /> Connected — host reachable and PIN accepted.</p>
                      )}
                      {clientTest.connected === false && (
                        <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle size={15} /> {clientTest.error}</p>
                      )}

                      {cashbookSync.status === 'live' && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Radio size={13} className="animate-pulse" /> Syncing live with the host.</p>
                      )}
                      {cashbookSync.status === 'connecting' && (
                        <p className="text-sm text-amber-600 dark:text-amber-400">Connecting…</p>
                      )}
                      {cashbookSync.status === 'error' && (
                        <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertCircle size={15} /> {cashbookSync.error}</p>
                      )}

                      <div className="flex gap-3">
                        <button type="button" onClick={handleTestClientConnection} disabled={clientTest.testing}
                          className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-5 py-2 rounded-lg text-sm font-medium shadow-sm disabled:opacity-60">
                          <Wifi size={16} /> {clientTest.testing ? 'Testing…' : 'Test Connection'}
                        </button>
                        <button type="button" onClick={cashbookSync.status === 'live' ? cashbookSync.stopSync : cashbookSync.startSync} disabled={cashbookSync.status === 'connecting'}
                          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium shadow-sm disabled:opacity-60 ${cashbookSync.status === 'live' ? 'bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                          <Radio size={16} /> {cashbookSync.status === 'connecting' ? 'Connecting…' : cashbookSync.status === 'live' ? 'Stop Syncing' : 'Start Syncing'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 transition-colors lg:col-span-2">
                  <h4 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Landmark size={18} className="text-gray-500" /> About</h4>
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Application</dt>
                      <dd className="text-gray-900 dark:text-white font-medium">CashBook</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Version</dt>
                      <dd className="text-gray-900 dark:text-white font-mono font-medium">v{__APP_VERSION__}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Built on</dt>
                      <dd className="text-gray-900 dark:text-white">{new Date(__APP_BUILD_DATE__).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Running as</dt>
                      <dd className="text-gray-900 dark:text-white">{isTauriRuntime() ? 'Desktop app' : 'Web preview'}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Every PC syncing over the LAN should run the same version.</p>
                </div>

              </div>
            </div>
          )}

        </Suspense>
        </div>
      </main>

      {/* MODAL: NEW / EDIT TRANSACTION */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4 print:hidden">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-slate-700">
            <div className="bg-indigo-600 p-5 text-white flex justify-between items-center">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                {editingId ? <LayoutDashboard size={20} /> : <Plus size={20} />}
                {editingId ? 'Edit Transaction' : 'Add to Ledger'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-indigo-200 hover:text-white"><X size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="flex bg-gray-100 dark:bg-slate-900 p-1 rounded-lg">
                {['Payment', 'Receipt', 'Contra', 'Ratification'].map(type => (
                  <button key={type} type="button" onClick={() => setFormData({ ...formData, type })}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${formData.type === type ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}>
                    {type}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase">Date</label>
                <input type="date" name="date" value={formData.date} onChange={handleInputChange}
                  className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 focus:ring-2 focus:ring-indigo-500" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase">Payee / Particulars</label>
                <input type="text" name="particulars" list="particulars-suggestions" value={formData.particulars} onChange={handleInputChange}
                  className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 focus:ring-2 focus:ring-indigo-500"
                  placeholder="Type to search previous entries…" required autoComplete="off" />
                <datalist id="particulars-suggestions">
                  {uniqueParticulars.map((p, i) => <option key={i} value={p} />)}
                </datalist>
              </div>
              <div className="flex gap-4">
                {formData.type !== 'Contra' && (
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase">Source</label>
                    <select name="mode" value={formData.mode} onChange={handleInputChange}
                      className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 focus:ring-2 focus:ring-indigo-500">
                      <option value="Cash">Cash</option>
                      <option value="Bank">Bank</option>
                    </select>
                  </div>
                )}
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase">Amount (₹)</label>
                  <input type="number" name="amount" value={formData.amount} onChange={handleInputChange} min="0" step="0.01"
                    className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 focus:ring-2 focus:ring-indigo-500" required />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase">Account Code</label>
                <input type="text" name="accountCode" list="account-codes-list" value={formData.accountCode} onChange={handleInputChange}
                  className="w-full bg-gray-50 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white rounded-md p-2.5 focus:ring-2 focus:ring-indigo-500 uppercase"
                  placeholder="e.g., TEL01 or CUSTOM" />
                <datalist id="account-codes-list">
                  {accountCodes.map((c) => <option key={c.id} value={c.code}>{c.description}</option>)}
                </datalist>
                {budgetWarning && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 mt-2 font-medium flex items-center gap-1">
                    <ShieldAlert size={14} /> {budgetWarning}
                  </p>
                )}
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 font-medium rounded-lg text-sm transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm transition-colors shadow-md">
                  {editingId ? 'Update Entry' : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MESSAGE BOX */}
      {msgBox.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex justify-center items-center p-4 print:hidden">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 text-center border border-gray-100 dark:border-slate-700">
            {msgBox.type === 'error' && <AlertCircle size={48} className="mx-auto text-rose-500 mb-4" />}
            {msgBox.type === 'info' && <AlertCircle size={48} className="mx-auto text-blue-500 mb-4" />}
            {msgBox.type === 'success' && <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-4" />}
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{msgBox.title}</h3>
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">{msgBox.message}</p>
            <button onClick={() => setMsgBox({ ...msgBox, isOpen: false })}
              className={`w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors ${msgBox.type === 'error' ? 'bg-rose-600 hover:bg-rose-700' : msgBox.type === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              Understood
            </button>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM DIALOG */}
      {confirmBox.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex justify-center items-center p-4 print:hidden">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 border border-gray-100 dark:border-slate-700">
            <div className="flex items-start gap-4 mb-5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${confirmBox.iconBg || 'bg-rose-100 dark:bg-rose-900/30'}`}>
                {confirmBox.iconEl || <AlertCircle size={20} className="text-rose-600 dark:text-rose-400" />}
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">{confirmBox.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{confirmBox.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { confirmBox.onCancel?.(); setConfirmBox(prev => ({ ...prev, isOpen: false })); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmBox.onConfirm}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition-colors shadow-sm ${confirmBox.confirmBtnClass || 'bg-rose-600 hover:bg-rose-700'}`}>
                {confirmBox.confirmLabel || 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Wrap with ErrorBoundary so render errors show a message instead of blank screen
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
