/**
 * Capital One Accessibility Banking Dashboard
 * Central State Store and Action Registry
 * 
 * Fictional data demo for WHACK 2026.
 * All state mutations must occur strictly through the exported action functions.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.C1Store = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ============================================================================
  // 1. DATE HELPERS (All dates relative to getToday())
  // ============================================================================

  function getToday() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  function getRelativeDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, parseInt(month, 10) - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatCurrency(amount) {
    const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount < 0 ? `-$${abs}` : `$${abs}`;
  }

  // ============================================================================
  // 2. CENTRAL STATE STORE
  // ============================================================================

  const initialState = {
    currentPage: 'checking',
    pageParams: {},

    accounts: {
      checking: {
        id: 'checking',
        name: '360 Checking',
        number: '...0096',
        fullNumber: '10984420096',
        routingNumber: '031176110',
        balance: 4200.10,
        availableBalance: 4200.10,
        type: 'Checking',
        status: 'Active',
        openedDate: getRelativeDate(-730),
      },
      savings: {
        id: 'savings',
        name: '360 Performance Savings',
        number: '...3886',
        fullNumber: '10984423886',
        routingNumber: '031176110',
        balance: 18450.75,
        availableBalance: 18450.75,
        apy: '4.25%',
        interestYTD: 521.80,
        type: 'Savings',
        status: 'Active',
        openedDate: getRelativeDate(-600),
      },
      credit: {
        id: 'credit',
        name: 'Venture X Card',
        number: '...9794',
        fullNumber: '4147209844209794',
        balance: 1420.50,
        creditLimit: 15000.00,
        availableCredit: 13579.50,
        locked: false,
        apr: '19.99%',
        minPaymentDue: 35.00,
        paymentDueDate: getRelativeDate(14),
        type: 'Credit Card',
        status: 'Active',
        openedDate: getRelativeDate(-450),
      },
      loans: {
        id: 'loans',
        name: 'Auto Loan',
        number: '...2284',
        fullNumber: '55018902284',
        balance: 12350.00,
        originalAmount: 25000.00,
        monthlyPayment: 345.20,
        nextDueDate: getRelativeDate(10),
        interestRate: '5.19%',
        termMonthsRemaining: 38,
        type: 'Loan',
        status: 'Active',
        openedDate: getRelativeDate(-500),
      }
    },

    rewards: {
      miles: 64250,
      cashEquivalent: 642.50,
      tier: 'Venture Miles Elite',
      featuredDeals: [
        { id: 'deal-1', merchant: 'Target', discount: '5% Cash Back', expires: getRelativeDate(12) },
        { id: 'deal-2', merchant: 'Starbucks', discount: '10% Cash Back', expires: getRelativeDate(6) },
        { id: 'deal-3', merchant: 'Delta Air Lines', discount: '2x Bonus Miles', expires: getRelativeDate(25) },
        { id: 'deal-4', merchant: 'Best Buy', discount: '4% Cash Back', expires: getRelativeDate(18) }
      ]
    },

    creditWise: {
      score: 790,
      rating: 'Excellent',
      lastUpdated: getRelativeDate(-2),
      onTimePaymentRate: '100%',
      creditUtilization: '9%',
    },

    transactions: [
      { id: 'tx-1', accountId: 'checking', date: getRelativeDate(-1), description: 'Spotify', category: 'Bills & Utilities', amount: -18.98, icon: 'spotify' },
      { id: 'tx-2', accountId: 'checking', date: getRelativeDate(-3), description: 'Chick-Fil-A', category: 'Food & Drink', amount: -20.40, icon: 'chickfila' },
      { id: 'tx-3', accountId: 'checking', date: getRelativeDate(-5), description: 'Netflix', category: 'Bills & Utilities', amount: -9.96, icon: 'netflix' },
      { id: 'tx-4', accountId: 'checking', date: getRelativeDate(-7), description: 'Hulu', category: 'Bills & Utilities', amount: -8.98, icon: 'hulu' },
      { id: 'tx-5', accountId: 'checking', date: getRelativeDate(-8), description: 'Walmart', category: 'Groceries', amount: -40.24, icon: 'walmart' },
      { id: 'tx-6', accountId: 'checking', date: getRelativeDate(-11), description: "McDonald's", category: 'Food & Drink', amount: -10.40, icon: 'mcdonalds' },
      { id: 'tx-7', accountId: 'checking', date: getRelativeDate(-14), description: 'Exxon Fuel', category: 'Transportation', amount: -40.00, icon: 'exxon' },
      { id: 'tx-8', accountId: 'checking', date: getRelativeDate(-15), description: 'Payroll Direct Deposit', category: 'Income', amount: 2450.00, icon: 'deposit' },
      { id: 'tx-9', accountId: 'savings', date: getRelativeDate(-15), description: 'Automatic Savings Transfer', category: 'Transfer', amount: 500.00, icon: 'transfer' },
      { id: 'tx-10', accountId: 'credit', date: getRelativeDate(-2), description: 'Amazon.com', category: 'Shopping', amount: -64.20, icon: 'amazon' },
      { id: 'tx-11', accountId: 'credit', date: getRelativeDate(-4), description: 'Trader Joe’s', category: 'Groceries', amount: -82.15, icon: 'traderjoes' },
    ],

    upcomingTransactions: [
      { id: 'up-1', accountId: 'checking', date: getRelativeDate(2), description: 'Walmart Delivery', category: 'Groceries', amount: -120.30, icon: 'walmart' },
      { id: 'up-2', accountId: 'checking', date: getRelativeDate(4), description: 'Chick-Fil-A Catering', category: 'Food & Drink', amount: -8.20, icon: 'chickfila' },
      { id: 'up-3', accountId: 'checking', date: getRelativeDate(6), description: 'Exxon Fleet Autopay', category: 'Transportation', amount: -40.00, icon: 'exxon' },
      { id: 'up-4', accountId: 'checking', date: getRelativeDate(8), description: "McDonald's Mobile Order", category: 'Food & Drink', amount: -6.30, icon: 'mcdonalds' },
      { id: 'up-5', accountId: 'checking', date: getRelativeDate(10), description: 'Capital One Auto Loan Payment', category: 'Loan Payment', amount: -345.20, icon: 'loan' },
    ],

    statements: [
      { id: 'stmt-1', month: 'October 2026', date: getRelativeDate(-8), account: '360 Checking', size: '240 KB' },
      { id: 'stmt-2', month: 'September 2026', date: getRelativeDate(-38), account: '360 Checking', size: '235 KB' },
      { id: 'stmt-3', month: 'August 2026', date: getRelativeDate(-69), account: '360 Checking', size: '248 KB' },
      { id: 'stmt-4', month: 'October 2026', date: getRelativeDate(-8), account: 'Venture X Card', size: '190 KB' },
      { id: 'stmt-5', month: 'September 2026', date: getRelativeDate(-38), account: 'Venture X Card', size: '210 KB' },
    ],

    pendingConfirmation: null,
    highContrast: false,
    notification: null,
  };

  let state = JSON.parse(JSON.stringify(initialState));
  const listeners = new Set();

  function getState() {
    return state;
  }

  function notifySubscribers() {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.error('State listener error:', e);
      }
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // ============================================================================
  // 3. ACTION REGISTRY
  // ============================================================================

  const ACTION_REGISTRY = [
    {
      name: 'navigateTo',
      description: 'Switches the visible dashboard page/view and focuses its header.',
      parameters: [
        { name: 'page', type: 'string', required: true, description: 'Target view id' },
        { name: 'params', type: 'object', required: false, description: 'Optional view parameters' }
      ],
      isMoneyMoving: false,
    },
    {
      name: 'requestTransfer',
      description: 'Prepares a transfer between accounts and opens confirmation prompt.',
      parameters: [
        { name: 'fromAccountId', type: 'string', required: true, description: 'Source account id' },
        { name: 'toAccountId', type: 'string', required: true, description: 'Destination account id' },
        { name: 'amount', type: 'number', required: true, description: 'Dollar amount' }
      ],
      isMoneyMoving: true,
    },
    {
      name: 'requestSendMoney',
      description: 'Prepares a Zelle-style money transfer to a recipient with confirmation prompt.',
      parameters: [
        { name: 'recipient', type: 'string', required: true, description: 'Recipient name, phone or email' },
        { name: 'amount', type: 'number', required: true, description: 'Dollar amount' },
        { name: 'note', type: 'string', required: false, description: 'Optional note' },
        { name: 'sourceAccountId', type: 'string', required: false, description: 'Source account id' }
      ],
      isMoneyMoving: true,
    },
    {
      name: 'toggleCardLock',
      description: 'Instantly locks or unlocks a credit card for security.',
      parameters: [
        { name: 'cardId', type: 'string', required: false, description: 'Card id to toggle' }
      ],
      isMoneyMoving: false,
    },
    {
      name: 'requestOpenAccount',
      description: 'Creates a new deposit or credit account in the dashboard.',
      parameters: [
        { name: 'accountType', type: 'string', required: true, description: 'Type: Checking, Savings, or CD' },
        { name: 'initialDeposit', type: 'number', required: true, description: 'Initial deposit' },
        { name: 'accountName', type: 'string', required: false, description: 'Nickname' }
      ],
      isMoneyMoving: true,
    },
    {
      name: 'cancelUpcomingPayment',
      description: 'Cancels a pending or scheduled future payment.',
      parameters: [
        { name: 'paymentId', type: 'string', required: true, description: 'Payment ID' }
      ],
      isMoneyMoving: false,
    },
    {
      name: 'confirmPendingAction',
      description: 'Executes the pending money-moving transaction after user confirmation.',
      parameters: [],
      isMoneyMoving: false,
    },
    {
      name: 'cancelPendingAction',
      description: 'Discards the pending money-moving transaction.',
      parameters: [],
      isMoneyMoving: false,
    },
    {
      name: 'getBalance',
      description: 'Read-only helper to inspect current balance of any account.',
      parameters: [
        { name: 'accountId', type: 'string', required: false, description: 'Account id or all' }
      ],
      isMoneyMoving: false,
    },
    {
      name: 'getSpending',
      description: 'Calculates total spending grouped by category over past days.',
      parameters: [
        { name: 'category', type: 'string', required: false, description: 'Category' },
        { name: 'days', type: 'number', required: false, description: 'Days lookback' }
      ],
      isMoneyMoving: false,
    },
    {
      name: 'toggleHighContrast',
      description: 'Toggles high-contrast accessibility theme.',
      parameters: [],
      isMoneyMoving: false,
    }
  ];

  // ============================================================================
  // 4. ACTION FUNCTIONS
  // ============================================================================

  function navigateTo(page, params = {}) {
    const validPages = [
      'checking', 'savings', 'credit-cards', 'loans', 'rewards',
      'account-details', 'send-money', 'transfer', 'lock-card',
      'statements', 'open-account', 'upcoming-all', 'recent-all', 'merchants'
    ];

    if (!validPages.includes(page)) {
      console.warn(`Unknown page "${page}", falling back to "checking"`);
      page = 'checking';
    }

    state.currentPage = page;
    state.pageParams = params;
    notifySubscribers();
  }

  function requestTransfer(fromAccountId, toAccountId, amount) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Please enter a valid positive transfer amount.');
    }

    const fromAcc = state.accounts[fromAccountId];
    const toAcc = state.accounts[toAccountId];

    if (!fromAcc || !toAcc) {
      throw new Error('Invalid source or destination account.');
    }

    if (fromAccountId === toAccountId) {
      throw new Error('Source and destination accounts must be different.');
    }

    if (fromAcc.balance < numAmount) {
      throw new Error(`Insufficient funds in ${fromAcc.name}. Available balance is $${fromAcc.balance.toFixed(2)}.`);
    }

    state.pendingConfirmation = {
      type: 'transfer',
      title: 'Confirm Account Transfer',
      summary: `Transfer $${numAmount.toFixed(2)} from ${fromAcc.name} to ${toAcc.name}?`,
      details: [
        { label: 'From Account', value: `${fromAcc.name} (${fromAcc.number})` },
        { label: 'To Account', value: `${toAcc.name} (${toAcc.number})` },
        { label: 'Transfer Amount', value: `$${numAmount.toFixed(2)}` },
        { label: 'Date', value: 'Instant / Today' },
      ],
      payload: { fromAccountId, toAccountId, amount: numAmount },
    };

    notifySubscribers();
  }

  function requestSendMoney(recipient, amount, note = '', sourceAccountId = 'checking') {
    const numAmount = parseFloat(amount);
    if (!recipient || !recipient.trim()) {
      throw new Error('Please specify a recipient name, phone, or email.');
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Please enter a valid positive amount.');
    }

    const fromAcc = state.accounts[sourceAccountId] || state.accounts.checking;
    if (fromAcc.balance < numAmount) {
      throw new Error(`Insufficient funds in ${fromAcc.name}. Available: $${fromAcc.balance.toFixed(2)}.`);
    }

    state.pendingConfirmation = {
      type: 'sendMoney',
      title: 'Confirm Send Money with Zelle®',
      summary: `Send $${numAmount.toFixed(2)} to ${recipient.trim()}?`,
      details: [
        { label: 'Recipient', value: recipient.trim() },
        { label: 'From Account', value: `${fromAcc.name} (${fromAcc.number})` },
        { label: 'Amount', value: `$${numAmount.toFixed(2)}` },
        { label: 'Memo / Note', value: note.trim() || 'None' },
        { label: 'Delivery', value: 'Typically within minutes' },
      ],
      payload: { recipient: recipient.trim(), amount: numAmount, note: note.trim(), sourceAccountId: fromAcc.id },
    };

    notifySubscribers();
  }

  function confirmPendingAction() {
    if (!state.pendingConfirmation) return;

    const { type, payload } = state.pendingConfirmation;

    if (type === 'transfer') {
      if (state.currentPage === 'transfer') state.pageParams = {};
      const { fromAccountId, toAccountId, amount } = payload;
      const fromAcc = state.accounts[fromAccountId];
      const toAcc = state.accounts[toAccountId];

      fromAcc.balance = Math.round((fromAcc.balance - amount) * 100) / 100;
      if (fromAcc.availableBalance !== undefined) fromAcc.availableBalance = fromAcc.balance;

      toAcc.balance = Math.round((toAcc.balance + amount) * 100) / 100;
      if (toAcc.availableBalance !== undefined) toAcc.availableBalance = toAcc.balance;

      const newTxFrom = {
        id: `tx-${Date.now()}-out`,
        accountId: fromAccountId,
        date: getToday(),
        description: `Transfer to ${toAcc.name}`,
        category: 'Transfer',
        amount: -amount,
        icon: 'transfer'
      };
      const newTxTo = {
        id: `tx-${Date.now()}-in`,
        accountId: toAccountId,
        date: getToday(),
        description: `Transfer from ${fromAcc.name}`,
        category: 'Transfer',
        amount: amount,
        icon: 'transfer'
      };

      state.transactions.unshift(newTxFrom, newTxTo);
      setNotification(`Successfully transferred $${amount.toFixed(2)} to ${toAcc.name}.`, 'success');
    } 
    else if (type === 'sendMoney') {
      if (state.currentPage === 'send-money') state.pageParams = {};
      const { recipient, amount, note, sourceAccountId } = payload;
      const fromAcc = state.accounts[sourceAccountId];

      fromAcc.balance = Math.round((fromAcc.balance - amount) * 100) / 100;
      if (fromAcc.availableBalance !== undefined) fromAcc.availableBalance = fromAcc.balance;

      const newTx = {
        id: `tx-${Date.now()}`,
        accountId: sourceAccountId,
        date: getToday(),
        description: `Zelle payment to ${recipient}${note ? ` - ${note}` : ''}`,
        category: 'Transfer',
        amount: -amount,
        icon: 'zelle'
      };

      state.transactions.unshift(newTx);
      setNotification(`Successfully sent $${amount.toFixed(2)} to ${recipient}.`, 'success');
    }
    else if (type === 'openAccount') {
      const { accountType, initialDeposit, accountName } = payload;
      const newId = `acc-${Date.now().toString().slice(-4)}`;
      const fromAcc = state.accounts.checking;

      if (initialDeposit > 0 && fromAcc.balance >= initialDeposit) {
        fromAcc.balance = Math.round((fromAcc.balance - initialDeposit) * 100) / 100;
        state.transactions.unshift({
          id: `tx-${Date.now()}`,
          accountId: 'checking',
          date: getToday(),
          description: `Initial funding for new ${accountType}`,
          category: 'Transfer',
          amount: -initialDeposit,
          icon: 'transfer'
        });
      }

      state.accounts[newId] = {
        id: newId,
        name: accountName || `360 ${accountType}`,
        number: `...${Math.floor(1000 + Math.random() * 9000)}`,
        fullNumber: `109844${Math.floor(10000 + Math.random() * 90000)}`,
        routingNumber: '031176110',
        balance: initialDeposit,
        availableBalance: initialDeposit,
        type: accountType,
        status: 'Active',
        openedDate: getToday(),
      };

      setNotification(`New ${accountType} account opened successfully!`, 'success');
      navigateTo('checking');
    }

    state.pendingConfirmation = null;
    notifySubscribers();
  }

  function cancelPendingAction() {
    state.pendingConfirmation = null;
    setNotification('Action cancelled.', 'info');
    notifySubscribers();
  }

  function toggleCardLock(cardId = 'credit') {
    const card = state.accounts[cardId];
    if (!card) throw new Error(`Card ${cardId} not found.`);

    card.locked = !card.locked;
    const statusStr = card.locked ? 'Locked' : 'Unlocked';
    setNotification(`${card.name} is now ${statusStr}.`, card.locked ? 'info' : 'success');
    notifySubscribers();
    return card.locked;
  }

  function requestOpenAccount(accountType, initialDeposit, accountName) {
    const deposit = parseFloat(initialDeposit) || 0;
    if (deposit < 0) throw new Error('Initial deposit cannot be negative.');

    if (deposit > 0 && state.accounts.checking.balance < deposit) {
      throw new Error(`Insufficient checking funds for $${deposit.toFixed(2)} deposit.`);
    }

    state.pendingConfirmation = {
      type: 'openAccount',
      title: 'Confirm Open New Account',
      summary: `Open a new 360 ${accountType} account with initial deposit of $${deposit.toFixed(2)}?`,
      details: [
        { label: 'Account Type', value: `360 ${accountType}` },
        { label: 'Account Nickname', value: accountName || `360 ${accountType}` },
        { label: 'Initial Deposit', value: `$${deposit.toFixed(2)}` },
        { label: 'Funding Source', value: '360 Checking (...0096)' },
      ],
      payload: { accountType, initialDeposit: deposit, accountName },
    };

    notifySubscribers();
  }

  function cancelUpcomingPayment(paymentId) {
    const idx = state.upcomingTransactions.findIndex(p => p.id === paymentId);
    if (idx !== -1) {
      const item = state.upcomingTransactions[idx];
      state.upcomingTransactions.splice(idx, 1);
      setNotification(`Cancelled scheduled payment: ${item.description}`, 'info');
      notifySubscribers();
    }
  }

  function toggleHighContrast() {
    state.highContrast = !state.highContrast;
    notifySubscribers();
  }

  function setNotification(message, type = 'info') {
    state.notification = { message, type, timestamp: Date.now() };
    notifySubscribers();
  }

  function clearNotification() {
    state.notification = null;
    notifySubscribers();
  }

  function getBalance(accountId) {
    if (!accountId || accountId === 'all') {
      return Object.values(state.accounts).map(a => ({ name: a.name, balance: a.balance }));
    }
    return state.accounts[accountId]?.balance ?? null;
  }

  function getSpending(category, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return state.transactions
      .filter(t => t.amount < 0)
      .filter(t => new Date(t.date) >= cutoff)
      .filter(t => !category || t.category.toLowerCase() === category.toLowerCase())
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }

  return {
    getToday,
    getRelativeDate,
    formatDate,
    formatCurrency,
    getState,
    subscribe,
    ACTION_REGISTRY,
    navigateTo,
    requestTransfer,
    requestSendMoney,
    confirmPendingAction,
    cancelPendingAction,
    toggleCardLock,
    requestOpenAccount,
    cancelUpcomingPayment,
    toggleHighContrast,
    setNotification,
    clearNotification,
    getBalance,
    getSpending
  };
});
