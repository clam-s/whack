(() => {
  const { getState, subscribe, navigateTo, toggleHighContrast } = window.appStore;
  const byId = (id) => document.getElementById(id);
  const command = byId('voiceCommand');
  const commandForm = byId('voiceCommandForm');
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
  let voiceSession;

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
  subscribe(({ currentPage }) => {
    renderAccount(currentPage);
    if (readAloud && previousPage !== currentPage) readCurrentView();
    previousPage = currentPage;
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
    const { amount, recipient } = draft;
    if (page === 'transfer') {
      const from = findTransferAccount(draft.from);
      const to = findTransferAccount(draft.to);
      if (!from || !to || from === to) return false;
      navigateTo(page, { amount, from, to });
      commandStatus.textContent = 'Transfer form filled in. Review the accounts and amount.';
    } else {
      navigateTo(page, { amount, recipient });
      commandStatus.textContent = 'Send Money form filled in. Review the recipient and amount.';
    }
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
  function runLocal(text) {
    const phrase = text.toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/\s+/g, ' ').trim().replace(/[.!?,]+$/, '').trimEnd()
      .replace(/^(?:(?:can|could|would) you )?(?:please )?/, '').replace(/,? please$/, '');
    const commandPhrase = text.replace(/\s+/g, ' ').trim().replace(/[.!?,]+$/, '').trimEnd()
      .replace(/^(?:(?:can|could|would) you )?(?:please )?/i, '').replace(/,? please$/i, '');
    const money = commandPhrase.match(/^(transfer|move|send) (?:\$\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?: (?:dollars?|usd))? (.+)$/i);
    if (money) {
      const [, verb, rawAmount, details] = money;
      const amount = rawAmount.replace(/,/g, '');
      if (Number.isFinite(Number(amount)) && Number(amount) > 0) {
        const recipient = verb.toLowerCase() === 'send' && details.match(/^to (.+)$/i)?.[1];
        if (recipient && !/\b(?:for|from|and|then|tomorrow|today)\b/i.test(recipient)) {
          return openPaymentDraft('send-money', { amount, recipient });
        }
        const route = details.match(/^from (.+?) to (.+)$/i);
        if (route && verb.toLowerCase() !== 'send' &&
            openPaymentDraft('transfer', { amount, from: route[1], to: route[2] })) return true;
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
    if (!text || voiceSession || sendButton.disabled || runLocal(text)) return;
    sendButton.disabled = true;
    window.setVoiceState('thinking');
    commandStatus.textContent = 'Finding the matching dashboard action…';
    try {
      const result = await post('/api/intent', { text });
      if (!openDestination(result.responseCode, result)) {
        commandStatus.textContent = 'Try one dashboard action, such as “open savings” or “show recent transactions”.';
      }
    } catch (error) {
      commandStatus.textContent = error.message;
    } finally {
      sendButton.disabled = false;
      window.setVoiceState('done');
    }
  });

  function applyTranscript(text) {
    if (drawer.inert || accountDialog.open) return;
    if (!text) {
      commandStatus.textContent = 'No speech was recognized. Try again or type a command.';
      return;
    }
    command.value = text;
    commandForm.requestSubmit();
  }

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
