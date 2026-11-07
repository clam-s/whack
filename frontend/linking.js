(() => {
  const { getState, subscribe, navigateTo, toggleHighContrast } = window.appStore;
  const byId = (id) => document.getElementById(id);
  const command = byId('voiceCommand');
  const commandStatus = byId('voiceCommandStatus');
  const sendButton = byId('sendVoiceCommand');
  const microphone = byId('voiceMicrophone');
  const drawer = byId('voiceAssistantDrawer');
  const accountDialog = byId('linkedAccountDialog');
  const accountForm = byId('linkedAccountForm');
  const accountStatus = byId('linkedAccountStatus');
  const accountPanel = byId('linkedAccountPanel');
  const accountButton = byId('backendAccountBtn');
  const signOut = byId('linkedAccountSignOut');
  const readToggle = byId('readAloudToggle');
  const readButton = byId('readTabBtn');
  let account;
  let accountRequest;
  let readAloud = false;

  function preference(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key) === 'true';
      localStorage.setItem(key, String(value));
    } catch {
      // The controls remain usable without browser storage.
    }
  }

  if (preference('whack.highContrast') && !getState().highContrast) toggleHighContrast();
  byId('highContrastToggle').addEventListener('click', () => preference('whack.highContrast', getState().highContrast));
  const magnify = byId('magnificationToggle');
  document.body.classList.toggle('magnification', Boolean(preference('whack.magnification')));
  magnify.setAttribute('aria-pressed', String(document.body.classList.contains('magnification')));
  magnify.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('magnification');
    magnify.setAttribute('aria-pressed', String(enabled));
    preference('whack.magnification', enabled);
  });

  async function post(path, body, signal) {
    if (location.protocol === 'file:') throw new Error('Open the dashboard through the Node server to use the backend.');
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  function formatAmount(minor) {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: account.currency });
    return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits);
  }

  function renderAccount(page = getState().currentPage) {
    accountPanel.hidden = !account || !['checking', 'account-details', 'recent-all'].includes(page);
    accountForm.hidden = Boolean(account);
    signOut.hidden = !account;
    accountButton.textContent = account ? 'Demo account' : 'Demo account sign-in';
    byId('linkedAccountName').textContent = account ? `${account.name} · ${account.userId}` : '';
    byId('linkedAccountBalance').textContent = account ? `Available balance: ${formatAmount(account.balanceMinor)}` : '';
    const rows = account?.transactions.map((item) => {
      const row = document.createElement('li');
      row.textContent = `${item.date} · ${item.description} · ${formatAmount(item.amountMinor)}`;
      return row;
    }) ?? [];
    byId('linkedAccountTransactions').replaceChildren(...rows);
  }

  function showSignIn() {
    if (!accountRequest) accountStatus.textContent = '';
    if (!accountDialog.open) accountDialog.showModal();
    if (!account) accountForm.elements.userId.focus();
  }

  accountButton.addEventListener('click', showSignIn);
  accountDialog.addEventListener('close', () => {
    accountRequest?.abort();
    accountForm.elements.password.value = '';
  });
  async function signIn(credentials, automatic = false) {
    if (accountRequest) return;
    const request = new AbortController();
    accountRequest = request;
    const submit = accountForm.querySelector('button');
    submit.disabled = true;
    accountStatus.textContent = 'Signing in…';
    try {
      account = await post('/api/account', credentials, request.signal);
      renderAccount();
      accountStatus.textContent = 'Signed in. Open Checking or Recent Transactions to see your linked demo data.';
      if (accountDialog.open) signOut.focus();
      if (!automatic && readAloud) window.speakText('Signed in. Your linked demo account is ready.');
    } catch (error) {
      if (!request.signal.aborted) {
        accountStatus.textContent = error.message;
        if (automatic && !accountDialog.open) {
          commandStatus.textContent = 'Automatic demo sign-in failed. Use Demo account sign-in to try again.';
        }
      }
    } finally {
      accountRequest = undefined;
      submit.disabled = false;
    }
  }

  accountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (accountRequest) return;
    const credentials = Object.fromEntries(new FormData(accountForm));
    accountForm.elements.password.value = '';
    void signIn(credentials);
  });
  signOut.addEventListener('click', () => {
    account = undefined;
    renderAccount();
    accountStatus.textContent = 'Signed out.';
    if (readAloud) window.speakText('Signed out.');
    accountForm.elements.userId.focus();
  });

  if (location.protocol !== 'file:') {
    // These public credentials belong to the sample SQLite account.
    void signIn({ userId: 'demo-user', password: 'whack-demo-only' }, true);
  }

  const viewLabels = new Map([
    ['checking', 'Checking'], ['savings', 'Savings'], ['credit-cards', 'Credit Cards'],
    ['loans', 'Loans'], ['rewards', 'Rewards and Deals'],
    ['recent-all', 'Recent Transactions'], ['account-details', 'Account Details'],
  ]);
  function readCurrentView() {
    const { currentPage: page, accounts, rewards } = getState();
    const title = viewLabels.get(page) ?? byId('viewContainer').querySelector('h1')?.textContent;
    if (!title) return;
    const sampleSummaries = {
      savings: () => ` Sample balance: ${window.appStore.formatCurrency(accounts.savings.balance)}.`,
      'credit-cards': () => ` Sample card balance: ${window.appStore.formatCurrency(accounts.credit.balance)}.`,
      loans: () => ` Sample remaining balance: ${window.appStore.formatCurrency(accounts.loans.balance)}.`,
      rewards: () => ` Sample rewards: ${rewards.miles.toLocaleString()} miles.`,
    };
    const summary = account && ['checking', 'recent-all', 'account-details'].includes(page)
      ? ` Linked demo balance: ${formatAmount(account.balanceMinor)}. ${account.transactions.length} transactions.` : '';
    window.speakText(title + '.' + (summary || sampleSummaries[page]?.() || ''));
  }

  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    readToggle.disabled = true;
  } else {
    readToggle.addEventListener('click', () => {
      readAloud = !readAloud;
      readToggle.setAttribute('aria-pressed', String(readAloud));
      readButton.disabled = !readAloud;
      if (readAloud) window.speakText('Read aloud is on.');
      else window.speechSynthesis.cancel();
    });
    readButton.addEventListener('click', readCurrentView);
  }

  let previousPage = getState().currentPage;
  subscribe(({ currentPage }) => {
    renderAccount(currentPage);
    if (readAloud && previousPage !== currentPage) readCurrentView();
    previousPage = currentPage;
  });

  const destinations = new Map([
    ['RESPONSE_OPEN_CHECKING', 'checking'], ['RESPONSE_OPEN_SAVINGS', 'savings'],
    ['RESPONSE_OPEN_CREDIT_CARDS', 'credit-cards'], ['RESPONSE_OPEN_LOANS', 'loans'],
    ['RESPONSE_OPEN_REWARDS', 'rewards'], ['RESPONCE_SHOW_BALANCE', 'checking'],
    ['REPONCE_SHOW_TRANSACTIONS', 'recent-all'], ['RESPONSE_SHOW_NAME', 'account-details'],
    ['RESPONSE_SHOW_USER_ID', 'account-details'], ['RESPONSE_SHOW_ACCOUNT_SUMMARY', 'account-details'],
  ]);
  const tabs = [...document.querySelectorAll('.nav-item')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      const direction = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (!direction) return;
      event.preventDefault();
      tabs[(index + direction + tabs.length) % tabs.length].focus();
    });
  });
  const accountActions = new Set([
    'RESPONCE_SHOW_BALANCE', 'REPONCE_SHOW_TRANSACTIONS', 'RESPONSE_SHOW_NAME',
    'RESPONSE_SHOW_USER_ID', 'RESPONSE_SHOW_ACCOUNT_SUMMARY',
  ]);
  function openDestination(code) {
    const page = destinations.get(code);
    if (!page) return false;
    navigateTo(page);
    commandStatus.textContent = `Opened ${viewLabels.get(page)}.`;
    if (accountActions.has(code) && !account) showSignIn();
    return true;
  }

  const localActions = [
    [/^(?:(?:show(?: me)?|tell me|check|view|whats|what is) )?(?:(?:my|the) )?(?:available |current |checking |account )?balance$/, 'RESPONCE_SHOW_BALANCE'],
    [/^(?:(?:show(?: me)?|view|list|check) )?(?:(?:my|the) )?(?:recent |latest |last )?(?:transactions?|transaction history)$/, 'REPONCE_SHOW_TRANSACTIONS'],
    [/^(?:(?:show(?: me)?|view|open) )?(?:(?:my|the) )?account (?:details|summary|holder name)$/, 'RESPONSE_SHOW_ACCOUNT_SUMMARY'],
    [/^(?:(?:show(?: me)?|whats|what is) )?(?:my )?(?:name|user id)$/, 'RESPONSE_SHOW_USER_ID'],
  ];
  const tabActions = new Map([
    ['checking', 'RESPONSE_OPEN_CHECKING'], ['savings', 'RESPONSE_OPEN_SAVINGS'],
    ['credit card', 'RESPONSE_OPEN_CREDIT_CARDS'], ['credit cards', 'RESPONSE_OPEN_CREDIT_CARDS'],
    ['loan', 'RESPONSE_OPEN_LOANS'], ['loans', 'RESPONSE_OPEN_LOANS'],
    ['rewards', 'RESPONSE_OPEN_REWARDS'], ['rewards and deals', 'RESPONSE_OPEN_REWARDS'],
  ]);
  function runLocal(text) {
    const phrase = text.toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/\s+/g, ' ').trim().replace(/[.!?,]+$/, '').trimEnd()
      .replace(/^(?:(?:can|could|would) you )?(?:please )?/, '').replace(/,? please$/, '');
    if (phrase === 'go home') return openDestination('RESPONSE_OPEN_CHECKING');
    if (phrase === 'focus command') {
      command.focus();
      return true;
    }
    if (phrase === 'read this tab') {
      if (readAloud) readCurrentView();
      else commandStatus.textContent = 'Turn on Read aloud first.';
      return true;
    }
    const match = localActions.find(([pattern]) => pattern.test(phrase));
    const tab = phrase.replace(/^(?:open|show(?: me)?|view|go to|switch to|take me to) /, '')
      .replace(/^(?:my|the) /, '').replace(/ (?:account|tab)$/, '');
    return openDestination(match?.[1] ?? tabActions.get(tab));
  }

  document.querySelectorAll('[data-quick-command]').forEach((button) => {
    button.addEventListener('click', () => {
      command.value = button.dataset.quickCommand;
      runLocal(command.value);
    });
  });
  byId('voiceCommandForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = command.value.trim();
    if (!text || sendButton.disabled || runLocal(text)) return;
    sendButton.disabled = true;
    window.setVoiceState('thinking');
    commandStatus.textContent = 'Finding the matching dashboard action…';
    try {
      const result = await post('/api/intent', { text });
      if (!openDestination(result.responseCode)) {
        commandStatus.textContent = 'Try one dashboard action, such as “open savings” or “show recent transactions”.';
      }
    } catch (error) {
      commandStatus.textContent = error.message;
    } finally {
      sendButton.disabled = false;
      window.setVoiceState('done');
    }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    microphone.disabled = true;
    microphone.textContent = 'Microphone unavailable';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = document.documentElement.lang || 'en';
  let listening = false;
  let transcript = '';
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) transcript += ' ' + event.results[i][0].transcript;
    }
  };
  recognition.onerror = ({ error }) => {
    if (error !== 'aborted') commandStatus.textContent = `Microphone error: ${error}. You can type a command.`;
  };
  recognition.onend = () => {
    listening = false;
    document.body.classList.remove('voice-listening');
    microphone.textContent = 'Start microphone';
    window.setVoiceState('done');
    if (transcript.trim() && !drawer.inert && !accountDialog.open) {
      command.value = transcript.trim();
      if (!runLocal(command.value)) commandStatus.textContent = 'Transcript ready. Select Send command to continue.';
    }
  };
  microphone.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      transcript = '';
      window.speechSynthesis?.cancel();
      recognition.start();
      listening = true;
      document.body.classList.add('voice-listening');
      microphone.textContent = 'Stop microphone';
      window.setVoiceState('listening');
    } catch {
      commandStatus.textContent = 'Could not start the microphone. You can type a command.';
    }
  });
  function abortVoice() {
    if (listening) recognition.abort();
  }
  byId('closeVoiceDrawer').addEventListener('click', abortVoice);
  byId('voiceAssistantBtn').addEventListener('click', () => { if (drawer.inert) abortVoice(); });
  window.addEventListener('pagehide', abortVoice);
})();
