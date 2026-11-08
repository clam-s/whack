(() => {
  const { getState, subscribe, navigateTo, toggleHighContrast } = window.appStore;
  const byId = (id) => document.getElementById(id);
  const command = byId('voiceCommand');
  const commandForm = byId('voiceCommandForm');
  const commandStatus = byId('voiceCommandStatus');
  const sendButton = byId('sendVoiceCommand');
  const microphone = byId('voiceMicrophone');
  const voiceActivityLog = byId('voiceActivityLog');
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
  let voiceSession;
  let voicePaymentPending = false;
  let lastPendingConfirmation = false;
  let submittedFromVoice = false;
  let pushToTalkHeld = false;

  function logVoiceActivity(message) {
    if (!voiceActivityLog) return;
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date().toISOString();
    time.className = 'mr-2 font-mono text-slate-500';
    time.textContent = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date());
    item.append(time, document.createTextNode(message));
    voiceActivityLog.prepend(item);
    while (voiceActivityLog.children.length > 8) voiceActivityLog.lastElementChild.remove();
  }

  window.addEventListener('voice-agent-speech', ({ detail }) => {
    const messages = {
      requested: 'Requesting spoken acknowledgement.',
      playing: 'Spoken acknowledgement is playing.',
      fallback: 'Fish speech unavailable; using browser speech instead.',
    };
    if (messages[detail?.status]) logVoiceActivity(messages[detail.status]);
  });

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
    ['merchants', 'Merchant transactions'],
    ['transfer', 'Transfer'], ['send-money', 'Send Money'],
  ]);
  function readCurrentView() {
    const { currentPage: page, accounts, rewards } = getState();
    const title = viewLabels.get(page) ?? byId('viewContainer').querySelector('h1')?.textContent;
    if (!title) return;
    if (page === 'merchants') {
      window.speakText(title + '. ' + (byId('merchantResultCount')?.textContent ?? ''));
      return;
    }
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
  subscribe((state) => {
    renderAccount(state.currentPage);
    if (readAloud && previousPage !== state.currentPage) readCurrentView();
    previousPage = state.currentPage;
    if (voicePaymentPending && lastPendingConfirmation && !state.pendingConfirmation) {
      if (state.notification?.type === 'success') {
        commandStatus.textContent = 'Demo payment complete.';
        void window.speakAgentStatus?.('The demo payment is complete.');
      } else if (state.notification?.type === 'info') {
        commandStatus.textContent = 'Demo payment cancelled.';
        void window.speakAgentStatus?.('The demo payment was cancelled.');
      }
      voicePaymentPending = false;
      window.setVoiceState('done');
    }
    lastPendingConfirmation = Boolean(state.pendingConfirmation);
  });

  const destinations = new Map([
    ['RESPONSE_OPEN_CHECKING', 'checking'], ['RESPONSE_OPEN_SAVINGS', 'savings'],
    ['RESPONSE_OPEN_CREDIT_CARDS', 'credit-cards'], ['RESPONSE_OPEN_LOANS', 'loans'],
    ['RESPONSE_OPEN_TRANSFER', 'transfer'], ['RESPONSE_OPEN_SEND_MONEY', 'send-money'],
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
  function openMerchantFilter(merchant) {
    navigateTo('merchants', { merchant });
    commandStatus.textContent = byId('merchantResultCount').textContent;
    return true;
  }

  function findTransferAccount(name) {
    const label = name.toLowerCase().replace(/^my /, '').replace(/ account$/, '');
    const accounts = Object.values(getState().accounts);
    const account = accounts.find(({ id, name }) => label === id || label === name.toLowerCase());
    if (account) return account.id;
    const matches = accounts.filter(({ type }) => label === type.toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  }

  function openPaymentDraft(page, draft) {
    const { amount, recipient, note } = draft;
    if (page === 'transfer') {
      const from = findTransferAccount(draft.from);
      const to = findTransferAccount(draft.to);
      if (!from || !to || from === to) return false;
      navigateTo(page, { amount, from, to });
      commandStatus.textContent = 'Transfer form filled in. Review the accounts and amount.';
    } else {
      navigateTo(page, { amount, recipient, note });
      commandStatus.textContent = 'Send Money form filled in. Review the recipient and amount.';
    }
    return true;
  }

  function prepareVoicePayment(page, draft) {
    try {
      if (page === 'send-money') {
        window.appStore.requestSendMoney(draft.recipient, draft.amount, draft.note || '', 'checking');
      } else {
        const from = findTransferAccount(draft.from);
        const to = findTransferAccount(draft.to);
        if (!from || !to || from === to) return openPaymentDraft(page, draft);
        window.appStore.requestTransfer(from, to, draft.amount);
      }
      voicePaymentPending = true;
      commandStatus.textContent = 'I prepared the payment for review. Confirm or cancel it in the dialog, or say “confirm payment” or “cancel payment”.';
      window.setVoiceState('confirming');
      // Keep recipient, amount, and memo out of Fish Audio TTS. The accessible confirmation dialog
      // presents the exact details locally; Fish speaks only this generic status prompt.
      void window.speakAgentStatus?.('I prepared the demo payment for review. Please check the details, then say confirm payment or cancel payment.');
    } catch (error) {
      commandStatus.textContent = error.message;
      void window.speakAgentStatus?.('I could not prepare that payment. Please review the message on screen.');
    }
    return true;
  }

  function handleVoicePaymentConfirmation(text, fromVoice) {
    const pending = getState().pendingConfirmation;
    if (!fromVoice || !pending || !['sendMoney', 'transfer'].includes(pending.type)) return false;
    const phrase = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (/^(?:confirm|confirm payment|confirm this payment|yes confirm|yes confirm payment)$/.test(phrase)) {
      voicePaymentPending = true;
      logVoiceActivity('Voice confirmation accepted. Completing the demo payment.');
      window.appStore.confirmPendingAction();
      return true;
    }
    if (/^(?:cancel|cancel payment|cancel this payment|no cancel|no cancel payment)$/.test(phrase)) {
      voicePaymentPending = true;
      logVoiceActivity('Voice cancellation accepted.');
      window.appStore.cancelPendingAction();
      return true;
    }
    commandStatus.textContent = 'The payment is still waiting for confirmation. Say “confirm payment” or “cancel payment”.';
    window.setVoiceState('confirming');
    void window.speakAgentStatus?.('The payment is still waiting. Say confirm payment or cancel payment.');
    return true;
  }

  function openDestination(code, { merchant, draft } = {}) {
    if (code === 'RESPONSE_FILTER_MERCHANTS') {
      return typeof merchant === 'string' && openMerchantFilter(merchant);
    }
    const page = destinations.get(code);
    if (!page) return false;
    if (draft && (page === 'transfer' || page === 'send-money') && openPaymentDraft(page, draft)) return true;
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
    ['transfer', 'RESPONSE_OPEN_TRANSFER'], ['transfer money', 'RESPONSE_OPEN_TRANSFER'],
    ['send money', 'RESPONSE_OPEN_SEND_MONEY'], ['zelle', 'RESPONSE_OPEN_SEND_MONEY'],
    ['rewards', 'RESPONSE_OPEN_REWARDS'], ['rewards and deals', 'RESPONSE_OPEN_REWARDS'],
  ]);
  function availableButtons() {
    const scope = accountDialog.open ? accountDialog :
      getState().pendingConfirmation ? byId('confirmationModal') : document;
    return [...scope.querySelectorAll('button, #brandLogoLink')].filter((button) =>
      !button.matches(':disabled, #voiceMicrophone, #sendVoiceCommand, #confirmActionBtn, [data-voice-ignore]') &&
      !button.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') &&
      button.getClientRects().length && getComputedStyle(button).visibility === 'visible'
    );
  }

  function buttonLabel(button) {
    return button.dataset.voiceLabel || button.innerText.trim() || button.getAttribute('aria-label') || '';
  }

  function describeButton(button) {
    const label = buttonLabel(button);
    const pressed = button.getAttribute('aria-pressed');
    return label && (pressed === null ? label : `${label} (currently ${pressed === 'true' ? 'on' : 'off'})`);
  }

  function activateButton(button) {
    commandStatus.textContent = `Selected ${buttonLabel(button)}.`;
    button.click();
    return true;
  }

  function clickNamedButton(label) {
    const normalize = (value) => value.toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const target = normalize(label);
    const matches = availableButtons().filter((button) => {
      const labels = [button.dataset.voiceLabel, button.getAttribute('aria-label'), button.innerText];
      return target && labels.some((value) => value && normalize(value) === target);
    });
    if (matches.length === 1) return activateButton(matches[0]);
    if (!matches.length) return false;
    commandStatus.textContent = 'More than one button has that label. Try naming the specific item or section.';
    return true;
  }

  function runLocal(text, fromVoice = false) {
    const phrase = text.toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/\s+/g, ' ').trim().replace(/[.!?,]+$/, '').trimEnd()
      .replace(/^(?:(?:can|could|would) you )?(?:please )?/, '').replace(/,? please$/, '');
    const commandPhrase = text.replace(/\s+/g, ' ').trim().replace(/[.!?,]+$/, '').trimEnd()
      .replace(/^(?:(?:can|could|would) you )?(?:please )?/i, '').replace(/,? please$/i, '');
    const button = commandPhrase.match(/^(?:click|press|select) (.+)$/i);
    if (button && clickNamedButton(button[1])) return true;
    const money = commandPhrase.match(/^(transfer|move|send) (?:\$\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?: (?:dollars?|usd))? (.+)$/i);
    if (money) {
      const [, verb, rawAmount, details] = money;
      const amount = rawAmount.replace(/,/g, '');
      if (Number.isFinite(Number(amount)) && Number(amount) > 0) {
        const payment = verb.toLowerCase() === 'send'
          ? details.match(/^to (.+?)(?: (?:for|with (?:a )?(?:note|memo)(?: saying)?) (.+))?$/i)
          : null;
        if (payment) {
          const [, recipient, note] = payment;
          if (!/\b(?:for|from|and|then|tomorrow|today)\b/i.test(recipient)) {
            const draft = { amount, recipient, note };
            return fromVoice ? prepareVoicePayment('send-money', draft) : openPaymentDraft('send-money', draft);
          }
        }
        const route = details.match(/^from (.+?) to (.+)$/i);
        if (route && verb.toLowerCase() !== 'send' &&
            (fromVoice
              ? prepareVoicePayment('transfer', { amount, from: route[1], to: route[2] })
              : openPaymentDraft('transfer', { amount, from: route[1], to: route[2] }))) return true;
      }
    }
    const merchant = commandPhrase.match(
      /^(?:(?:show(?: me)?|list|find|view) (?:my )?(?:transactions|purchases) (?:from|at|for)|filter (?:my )?transactions (?:by(?: merchant)?|for)|filter merchants by|filter (?:by )?merchant) (.+)$/i
    )?.[1].trim();
    if (merchant || /^(?:(?:open|show(?: me)?|view) (?:the )?merchant(?:s| transactions)|clear (?:the )?merchant filter|show all merchant(?:s| transactions))$/.test(phrase)) {
      return openMerchantFilter(merchant ?? '');
    }
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
      if (voiceSession) return;
      command.value = button.dataset.quickCommand;
      runLocal(command.value);
    });
  });
  commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = command.value.trim();
    const fromVoice = submittedFromVoice;
    submittedFromVoice = false;
    if (!text || voiceSession || sendButton.disabled) return;
    if (fromVoice) logVoiceActivity('Transcript received. Checking the dashboard command.');
    if (handleVoicePaymentConfirmation(text, fromVoice)) return;
    if (runLocal(text, fromVoice)) {
      if (fromVoice) logVoiceActivity('Handled by a local dashboard action.');
      if (fromVoice && !voicePaymentPending) void window.speakAgentStatus?.('Done. I completed that dashboard request.');
      return;
    }
    sendButton.disabled = true;
    window.setVoiceState('thinking');
    commandStatus.textContent = 'Finding the matching dashboard action…';
    if (fromVoice) logVoiceActivity('Sending transcript to OpenRouter for interpretation.');
    try {
      const page = getState().currentPage;
      const controls = availableButtons().map((button) => ({ button, label: describeButton(button) }))
        .filter(({ label }) => label && label.length <= 200).slice(0, 100);
      const result = await post('/api/intent', { text, controls: controls.map(({ label }) => label) });
      if (fromVoice) logVoiceActivity(`OpenRouter returned ${result.responseCode || 'a response'}.`);
      if (result.responseCode === 'RESPONSE_CLICK_CONTROL') {
        const selected = Number.isInteger(result.controlIndex) ? controls[result.controlIndex] : undefined;
        if (selected && getState().currentPage === page && availableButtons().includes(selected.button) &&
            describeButton(selected.button) === selected.label) {
          activateButton(selected.button);
          if (fromVoice) logVoiceActivity('Dashboard control selected.');
          void window.speakAgentStatus?.('Done. I selected that control.');
        } else {
          commandStatus.textContent = 'That control is no longer available. Try the command again.';
        }
      } else if (result.responseCode === 'RESPONSE_OPEN_SEND_MONEY' && result.draft) {
        if (fromVoice) logVoiceActivity('Payment request prepared for review; confirmation is still required.');
        prepareVoicePayment('send-money', result.draft);
      } else if (result.responseCode === 'RESPONSE_OPEN_TRANSFER' && result.draft) {
        if (fromVoice) logVoiceActivity('Transfer request prepared for review; confirmation is still required.');
        prepareVoicePayment('transfer', result.draft);
      } else if (!openDestination(result.responseCode, result)) {
        commandStatus.textContent = result.message || 'Try one dashboard action, such as “open savings” or “show recent transactions”.';
        if (fromVoice) logVoiceActivity('No matching dashboard action was found.');
      } else if (!voicePaymentPending) {
        if (fromVoice) logVoiceActivity('Dashboard action completed.');
        void window.speakAgentStatus?.('Done. I completed that dashboard request.');
      }
    } catch (error) {
      commandStatus.textContent = error.message;
      if (fromVoice) logVoiceActivity(`Request failed: ${error.message}`);
    } finally {
      sendButton.disabled = false;
      if (!voicePaymentPending) window.setVoiceState('done');
    }
  });

  function applyTranscript(text) {
    if (drawer.inert || accountDialog.open) return;
    if (!text) {
      commandStatus.textContent = 'No speech was recognized. Try again or type a command.';
      return;
    }
    command.value = text;
    submittedFromVoice = true;
    commandForm.requestSubmit();
    submittedFromVoice = false;
  }

  function beginPushToTalk() {
    logVoiceActivity('Control + Space detected. Requesting microphone access.');
    const Recorder = window.MediaRecorder;
    const media = window.navigator?.mediaDevices;
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((type) => Recorder?.isTypeSupported(type));
    if (!Recorder || !media?.getUserMedia || !mimeType || location.protocol === 'file:') {
      commandStatus.textContent = 'Push-to-talk is unavailable here. Use the microphone button or type a command.';
      return;
    }
    if (voiceSession || sendButton.disabled || accountDialog.open) return;
    if (drawer.inert) byId('voiceAssistantBtn').click();

    const session = { pushToTalk: true, request: new AbortController(), released: false };
    voiceSession = session;
    sendButton.disabled = true;
    microphone.disabled = true;
    microphone.textContent = 'Listening…';
    commandStatus.textContent = 'Listening. Release Control + Space to transcribe and send.';
    window.stopAgentSpeech?.();
    window.speechSynthesis?.cancel();
    document.body.classList.add('voice-listening');
    window.setVoiceState('listening');

    function releaseStream() {
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach((track) => track.stop());
      session.stream = undefined;
      document.body.classList.remove('voice-listening');
    }
    function finish() {
      releaseStream();
      if (voiceSession === session) voiceSession = undefined;
      microphone.disabled = false;
      microphone.textContent = 'Start microphone';
      sendButton.disabled = false;
      window.setVoiceState('done');
    }
    async function upload(chunks, type) {
      if (voiceSession !== session || session.request.signal.aborted) return;
      releaseStream();
      microphone.disabled = true;
      microphone.textContent = 'Transcribing…';
      window.setVoiceState('thinking');
      commandStatus.textContent = 'Transcribing your request…';
      logVoiceActivity('Recording sent for speech transcription.');
      try {
        const audio = new Blob(chunks, { type });
        if (!audio.size) throw new Error('No speech was recorded. Hold the shortcut and try again.');
        const response = await fetch('/api/transcribe', {
          method: 'POST', body: audio, signal: session.request.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message || 'Speech transcription failed.');
        if (voiceSession !== session) return;
        logVoiceActivity('Speech transcription succeeded.');
        finish();
        applyTranscript(data.text.trim());
      } catch (error) {
        if (voiceSession !== session) return;
        finish();
        commandStatus.textContent = error.message;
        logVoiceActivity(`Transcription failed: ${error.message}`);
      }
    }
    void media.getUserMedia({ audio: true }).then((stream) => {
      if (voiceSession !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      logVoiceActivity('Microphone ready. Recording speech.');
      const recorder = new Recorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      session.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onstop = () => void upload(chunks, recorder.mimeType || mimeType);
      recorder.onerror = () => {
        if (voiceSession !== session) return;
        finish();
        commandStatus.textContent = 'Recording failed. Try again or type a command.';
      };
      recorder.start();
      session.timer = setTimeout(() => endPushToTalk(), 15_000);
      microphone.disabled = false;
      if (session.released) endPushToTalk();
    }).catch((error) => {
      if (voiceSession !== session) return;
      finish();
      commandStatus.textContent = error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow access or type a command.'
        : 'Could not record from your microphone. Try again or type a command.';
      logVoiceActivity(`Microphone error: ${commandStatus.textContent}`);
    });
  }

  function endPushToTalk() {
    const session = voiceSession;
    if (!session?.pushToTalk) return;
    session.released = true;
    if (session.recorder?.state === 'recording') {
      microphone.disabled = true;
      session.recorder.stop();
    }
  }

  function cancelPushToTalk() {
    const session = voiceSession;
    if (!session?.pushToTalk) return false;
    session.request.abort();
    if (session.recorder?.state === 'recording') session.recorder.stop();
    session.stream?.getTracks().forEach((track) => track.stop());
    voiceSession = undefined;
    document.body.classList.remove('voice-listening');
    microphone.disabled = false;
    microphone.textContent = 'Start microphone';
    sendButton.disabled = false;
    commandStatus.textContent = 'Push-to-talk cancelled.';
    window.setVoiceState('done');
    return true;
  }

  window.addEventListener('keydown', (event) => {
    const editable = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (event.code !== 'Space' || !event.ctrlKey || event.repeat || editable || pushToTalkHeld) return;
    event.preventDefault();
    pushToTalkHeld = true;
    beginPushToTalk();
  }, true);
  window.addEventListener('keyup', (event) => {
    if (!pushToTalkHeld || (event.code !== 'Space' && event.key !== 'Control')) return;
    if (event.code === 'Space') event.preventDefault();
    pushToTalkHeld = false;
    endPushToTalk();
  });
  window.addEventListener('blur', () => {
    if (pushToTalkHeld) {
      pushToTalkHeld = false;
      endPushToTalk();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancelPushToTalk();
  });
  window.addEventListener('pagehide', () => {
    pushToTalkHeld = false;
    cancelPushToTalk();
  });

  function enableRecorderFallback() {
    const Recorder = window.MediaRecorder;
    const media = window.navigator?.mediaDevices;
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((type) => Recorder?.isTypeSupported(type));
    if (!media?.getUserMedia || !mimeType || location.protocol === 'file:') return false;

    const label = 'Record command';
    microphone.textContent = label;
    commandStatus.textContent = 'Recording uses OpenRouter to transcribe your audio when you stop.';

    function releaseMicrophone(session) {
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach((track) => track.stop());
      session.stream = undefined;
      document.body.classList.remove('voice-listening');
    }

    function finish(session) {
      if (voiceSession !== session) return;
      releaseMicrophone(session);
      voiceSession = undefined;
      microphone.disabled = false;
      microphone.textContent = label;
      sendButton.disabled = false;
      window.setVoiceState('done');
    }

    function cancel() {
      const session = voiceSession;
      if (!session) return;
      session.request.abort();
      if (session.recorder?.state === 'recording') session.recorder.stop();
      finish(session);
      commandStatus.textContent = 'Recording cancelled.';
    }

    async function upload(session, chunks, type) {
      if (voiceSession !== session || session.request.signal.aborted) return;
      releaseMicrophone(session);
      microphone.disabled = true;
      microphone.textContent = 'Transcribing…';
      window.setVoiceState('thinking');
      commandStatus.textContent = 'Transcribing your recording…';
      const audio = new Blob(chunks, { type });
      try {
        if (!audio.size) throw new Error('No audio was recorded. Try again or type a command.');
        const response = await fetch('/api/transcribe', {
          method: 'POST', body: audio, signal: session.request.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Speech transcription failed.');
        if (voiceSession !== session) return;
        finish(session);
        applyTranscript(data.text.trim());
      } catch (error) {
        if (voiceSession !== session) return;
        finish(session);
        commandStatus.textContent = error.message;
      }
    }

    microphone.addEventListener('click', async () => {
      if (voiceSession) {
        if (voiceSession.recorder?.state === 'recording') {
          microphone.disabled = true;
          voiceSession.recorder.stop();
        }
        return;
      }
      if (sendButton.disabled) return;
      const session = { request: new AbortController() };
      voiceSession = session;
      sendButton.disabled = true;
      microphone.disabled = true;
      commandStatus.textContent = 'Waiting for microphone permission…';
      try {
        const stream = await media.getUserMedia({ audio: true });
        if (voiceSession !== session) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        session.stream = stream;
        const recorder = new Recorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
        session.recorder = recorder;
        const chunks = [];
        recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
        recorder.onstop = () => void upload(session, chunks, recorder.mimeType || mimeType);
        recorder.onerror = () => {
          if (voiceSession !== session) return;
          finish(session);
          commandStatus.textContent = 'Recording failed. Try again or type a command.';
        };
        window.stopAgentSpeech?.();
        window.speechSynthesis?.cancel();
        recorder.start();
        document.body.classList.add('voice-listening');
        microphone.disabled = false;
        microphone.textContent = 'Stop and transcribe';
        commandStatus.textContent = 'Recording. Select Stop and transcribe when finished, or wait up to 15 seconds.';
        window.setVoiceState('listening');
        session.timer = setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 15_000);
      } catch (error) {
        if (voiceSession !== session) return;
        finish(session);
        commandStatus.textContent = error.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow access or type a command.'
          : 'Could not record from your microphone. Try again or type a command.';
      }
    });
    byId('closeVoiceDrawer').addEventListener('click', cancel);
    byId('voiceAssistantBtn').addEventListener('click', () => { if (drawer.inert) cancel(); });
    window.addEventListener('pagehide', cancel);
    return true;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (enableRecorderFallback()) return;
    microphone.disabled = true;
    microphone.textContent = 'Microphone unavailable';
    commandStatus.textContent = 'This browser does not support speech recognition. You can type a command.';
    return;
  }
  const transcriptPreview = byId('voiceTranscriptPreview');
  const recognition = new SpeechRecognition();
  recognition.lang = document.documentElement.lang || 'en';
  recognition.interimResults = true;
  recognition.onstart = () => {
    if (!voiceSession || voiceSession.stopping) return;
    commandStatus.textContent = 'Listening. Say a dashboard command.';
    window.setVoiceState('listening');
  };
  recognition.onresult = ({ results }) => {
    if (!voiceSession || voiceSession.cancelled) return;
    const phrases = Array.from(results, (result) => result[0].transcript.trim());
    voiceSession.transcript = phrases.filter((_, index) => results[index].isFinal).join(' ').trim();
    const preview = phrases.join(' ').trim();
    transcriptPreview.textContent = preview ? `Heard so far: ${preview}` : '';
    transcriptPreview.hidden = !preview;
  };
  const recognitionErrors = {
    'not-allowed': 'Microphone permission was denied. Allow access in your browser or type a command.',
    'service-not-allowed': 'Speech recognition is unavailable. You can type a command.',
    'audio-capture': 'No microphone could be used. Check your microphone or type a command.',
    'no-speech': 'No speech was detected. Try again or type a command.',
    network: 'The speech recognition service could not connect. Try again or type a command.',
  };
  recognition.onerror = ({ error }) => {
    if (!voiceSession || voiceSession.cancelled) return;
    voiceSession.cancelled = true;
    commandStatus.textContent = recognitionErrors[error] ?? 'Speech recognition stopped. Try again or type a command.';
  };
  function finishVoice() {
    voiceSession = undefined;
    document.body.classList.remove('voice-listening');
    transcriptPreview.hidden = true;
    transcriptPreview.textContent = '';
    microphone.textContent = 'Start microphone';
    microphone.disabled = false;
    sendButton.disabled = false;
    window.setVoiceState('done');
  }
  recognition.onend = () => {
    const session = voiceSession;
    if (!session) return;
    finishVoice();
    if (!session.cancelled) applyTranscript(session.transcript);
  };
  microphone.addEventListener('click', () => {
    if (voiceSession) {
      if (voiceSession.stopping) return;
      voiceSession.stopping = true;
      microphone.disabled = true;
      commandStatus.textContent = 'Finishing the transcript…';
      recognition.stop();
      return;
    }
    if (sendButton.disabled) return;
    voiceSession = { transcript: '', cancelled: false, stopping: false };
    sendButton.disabled = true;
    document.body.classList.add('voice-listening');
    microphone.textContent = 'Stop microphone';
    commandStatus.textContent = 'Starting microphone…';
    try {
      window.stopAgentSpeech?.();
      window.speechSynthesis?.cancel();
      recognition.start();
    } catch {
      finishVoice();
      commandStatus.textContent = 'Could not start the microphone. You can type a command.';
    }
  });
  function abortVoice() {
    if (!voiceSession || voiceSession.cancelled) return;
    voiceSession.cancelled = true;
    commandStatus.textContent = 'Dictation cancelled.';
    recognition.abort();
  }
  byId('closeVoiceDrawer').addEventListener('click', abortVoice);
  byId('voiceAssistantBtn').addEventListener('click', () => { if (drawer.inert) abortVoice(); });
  window.addEventListener('pagehide', abortVoice);
})();
