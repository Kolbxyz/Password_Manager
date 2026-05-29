// Flat Multi-User Password Manager SPA Logic
document.addEventListener('DOMContentLoaded', () => {
  // --- STATE ---
  let state = {
    token: sessionStorage.getItem('vault_token') || null,
    username: sessionStorage.getItem('vault_username') || null,
    isRegisterMode: false,
    entries: [],
    selectedId: null,
    currentFilter: 'all', // 'all', 'favorites', 'logins', 'notes', 'generator', 'audit', 'settings', 'folder:<name>'
    searchQuery: '',
    editingEntry: null,
    clipboardTimeoutId: null,
    totpIntervalId: null
  };

  // --- API HELPER ---
  async function apiCall(endpoint, options = {}) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers
      };

      if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
      }

      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }
      return data;
    } catch (err) {
      showToast(err.message, 'danger');
      throw err;
    }
  }

  // --- TOAST SYSTEM (FLAT) ---
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '';
    if (type === 'success') {
      icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'danger') {
      icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }
    
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(5px)';
      toast.style.transition = 'all 0.15s ease';
      setTimeout(() => toast.remove(), 150);
    }, 3000);
  }

  // --- INITIALIZE VIEWS ---
  function initApp() {
    renderScreens();
    if (state.token) {
      document.getElementById('user-display').textContent = state.username;
      fetchEntries();
      startTOTPLoop();
    }
  }

  // --- DATA FETCHING ---
  async function fetchEntries() {
    try {
      const entries = await apiCall('/api/entries');
      state.entries = entries;
      renderEntriesList();
      if (state.selectedId) {
        const found = state.entries.find(e => e.id === state.selectedId);
        if (found) showDetail(found);
        else showWelcome();
      } else {
        showWelcome();
      }
    } catch (e) {
      handleLogoutLocal();
    }
  }

  // --- VIEW RENDERING CONTROLS ---
  function renderScreens() {
    const authScreen = document.getElementById('auth-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    
    if (state.token) {
      authScreen.classList.add('hidden');
      dashboardScreen.classList.remove('hidden');
    } else {
      authScreen.classList.remove('hidden');
      dashboardScreen.classList.add('hidden');
      renderAuthFormState();
    }
  }

  function renderAuthFormState() {
    const authTitle = document.getElementById('auth-title');
    const btnAuthSubmit = document.getElementById('btn-auth-submit');
    const registerConfirmGroup = document.getElementById('register-confirm-group');
    const authConfirmInput = document.getElementById('auth-confirm');
    const authToggleText = document.getElementById('auth-toggle-text');
    const btnAuthToggle = document.getElementById('btn-auth-toggle');

    if (state.isRegisterMode) {
      authTitle.textContent = "Create Local Account";
      btnAuthSubmit.textContent = "Create Account";
      registerConfirmGroup.classList.remove('hidden');
      authConfirmInput.setAttribute('required', 'true');
      authToggleText.textContent = "Already have an account?";
      btnAuthToggle.textContent = "Sign In";
    } else {
      authTitle.textContent = "Sign In to Vault";
      btnAuthSubmit.textContent = "Sign In";
      registerConfirmGroup.classList.add('hidden');
      authConfirmInput.removeAttribute('required');
      authToggleText.textContent = "Don't have a local vault account?";
      btnAuthToggle.textContent = "Create Account";
    }
  }

  function showWelcome() {
    document.getElementById('detail-welcome').classList.remove('hidden');
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('generator-content').classList.add('hidden');
    document.getElementById('settings-content').classList.add('hidden');
    document.getElementById('audit-content').classList.add('hidden');
    state.selectedId = null;
    state.editingEntry = null;

    document.querySelectorAll('.entry-card').forEach(c => c.classList.remove('selected'));
  }

  function showDetail(entry) {
    state.selectedId = entry.id;
    state.editingEntry = entry;

    document.getElementById('detail-welcome').classList.add('hidden');
    document.getElementById('detail-content').classList.remove('hidden');
    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('generator-content').classList.add('hidden');
    document.getElementById('settings-content').classList.add('hidden');
    document.getElementById('audit-content').classList.add('hidden');

    document.getElementById('val-service').textContent = entry.service;
    document.getElementById('val-username').textContent = entry.username;
    document.getElementById('val-folder').textContent = entry.folder || '-';
    
    // Toggle Favorite Star
    const favStarBtn = document.getElementById('btn-toggle-favorite');
    if (entry.favorite) {
      favStarBtn.classList.add('active');
    } else {
      favStarBtn.classList.remove('active');
    }

    // Mask password
    const passVal = document.getElementById('val-password');
    passVal.textContent = '••••••••••••';
    passVal.classList.add('password-masked');
    const passToggleBtn = document.getElementById('btn-toggle-view-pass');
    passToggleBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    passToggleBtn.dataset.visible = "false";

    // TOTP setup
    const totpGroup = document.getElementById('val-totp-group');
    if (entry.totp) {
      totpGroup.classList.remove('hidden');
      document.getElementById('val-totp-code').textContent = 'Generating...';
    } else {
      totpGroup.classList.add('hidden');
    }

    // Link handling
    const websiteVal = document.getElementById('val-website');
    const websiteLink = document.getElementById('link-website');
    if (entry.website) {
      websiteVal.textContent = entry.website;
      websiteLink.href = entry.website;
      websiteLink.classList.remove('hidden');
    } else {
      websiteVal.textContent = '-';
      websiteLink.classList.add('hidden');
    }

    // Notes
    const notesVal = document.getElementById('val-notes');
    if (entry.notes) {
      notesVal.textContent = entry.notes;
      notesVal.classList.remove('text-muted');
    } else {
      notesVal.textContent = 'No notes.';
      notesVal.classList.add('text-muted');
    }

    // Highlight card
    document.querySelectorAll('.entry-card').forEach(c => {
      if (Number(c.dataset.id) === entry.id) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });
  }

  function showForm(isEdit = false) {
    document.getElementById('detail-welcome').classList.add('hidden');
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('form-content').classList.remove('hidden');
    document.getElementById('generator-content').classList.add('hidden');
    document.getElementById('settings-content').classList.add('hidden');
    document.getElementById('audit-content').classList.add('hidden');

    const form = document.getElementById('vault-form');
    form.reset();

    const formTitle = document.getElementById('form-title');
    const formId = document.getElementById('form-id');
    const passwordInput = document.getElementById('form-password');
    passwordInput.type = 'password';
    document.getElementById('btn-form-toggle-pass').innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    if (isEdit && state.editingEntry) {
      formTitle.textContent = "Edit Item";
      formId.value = state.editingEntry.id;
      document.getElementById('form-service').value = state.editingEntry.service;
      document.getElementById('form-username').value = state.editingEntry.username;
      document.getElementById('form-folder').value = state.editingEntry.folder || '';
      document.getElementById('form-totp').value = state.editingEntry.totp || '';
      passwordInput.value = state.editingEntry.password || '';
      document.getElementById('form-website').value = state.editingEntry.website || '';
      document.getElementById('form-notes').value = state.editingEntry.notes || '';
    } else {
      formTitle.textContent = "Add Item";
      formId.value = '';
    }

    document.getElementById('form-service').focus();
  }

  function showGenerator() {
    document.getElementById('detail-welcome').classList.add('hidden');
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('generator-content').classList.remove('hidden');
    document.getElementById('settings-content').classList.add('hidden');
    document.getElementById('audit-content').classList.add('hidden');
    setActiveFilter('generator');
    generatePassword();
  }

  function showSettings() {
    document.getElementById('detail-welcome').classList.add('hidden');
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('generator-content').classList.add('hidden');
    document.getElementById('settings-content').classList.remove('hidden');
    document.getElementById('audit-content').classList.add('hidden');
    setActiveFilter('settings');
    
    document.getElementById('change-password-form').reset();
  }

  function showAudit() {
    document.getElementById('detail-welcome').classList.add('hidden');
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('form-content').classList.add('hidden');
    document.getElementById('generator-content').classList.add('hidden');
    document.getElementById('settings-content').classList.add('hidden');
    document.getElementById('audit-content').classList.remove('hidden');
    setActiveFilter('audit');
    
    calculateSecurityAudit();
  }

  // --- FILTER NAVIGATION ---
  function setActiveFilter(filter) {
    state.currentFilter = filter;
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      const dataFilter = item.dataset.filter;
      const dataFolder = item.dataset.folder;
      
      if (dataFilter === filter) {
        item.classList.add('active');
      } else if (dataFolder && `folder:${dataFolder}` === filter) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    
    if (filter !== 'generator' && filter !== 'settings' && filter !== 'audit') {
      renderEntriesList();
      showWelcome();
    }
  }

  // --- LIST RENDERER ---
  function renderEntriesList() {
    const listContainer = document.getElementById('entries-list');
    listContainer.innerHTML = '';

    let filtered = state.entries;

    if (state.currentFilter === 'logins') {
      filtered = filtered.filter(e => e.password && e.password.trim() !== '');
    } else if (state.currentFilter === 'notes') {
      filtered = filtered.filter(e => (!e.password || e.password.trim() === '') && e.notes && e.notes.trim() !== '');
    } else if (state.currentFilter === 'favorites') {
      filtered = filtered.filter(e => !!e.favorite);
    } else if (state.currentFilter.startsWith('folder:')) {
      const folderName = state.currentFilter.substring(7);
      filtered = filtered.filter(e => e.folder === folderName);
    }

    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.service.toLowerCase().includes(q) || 
        e.username.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <p>${state.searchQuery ? 'No matching items' : 'Your vault is empty'}</p>
        </div>
      `;
      return;
    }

    filtered.forEach(entry => {
      const card = document.createElement('div');
      card.className = `entry-card ${state.selectedId === entry.id ? 'selected' : ''}`;
      card.dataset.id = entry.id;

      const subtitle = entry.username || entry.website || 'No username';

      card.innerHTML = `
        <div class="entry-card-info">
          <div class="entry-card-title">
            ${entry.favorite ? '<svg class="entry-card-star" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' : ''}
            <span>${escapeHtml(entry.service)}</span>
          </div>
          <div class="entry-card-sub">${escapeHtml(subtitle)}</div>
        </div>
        <div class="entry-card-actions">
          <button class="btn-copy-fast" data-type="username" title="Copy username">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          </button>
          <button class="btn-copy-fast" data-type="password" title="Copy password">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-copy-fast')) return;
        showDetail(entry);
      });

      card.querySelector('.btn-copy-fast[data-type="username"]').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(entry.username);
        showToast("Username copied!");
      });

      card.querySelector('.btn-copy-fast[data-type="password"]').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(entry.password || '');
        showToast("Password copied!");
      });

      listContainer.appendChild(card);
    });
  }

  // --- SECURITY AUDIT PANEL CALCULATOR ---
  function calculateSecurityAudit() {
    const totalCount = state.entries.length;
    let weakList = [];
    let reusedMap = new Map(); // password -> array of entries

    state.entries.forEach(entry => {
      const pass = entry.password;
      if (!pass || pass.trim() === '') return;

      // 1. Check for Weak
      if (pass.length < 10) {
        weakList.push(entry);
      } else {
        const commonWords = ['password', '12345678', 'admin123', 'password123', 'qwertyuiop'];
        if (commonWords.includes(pass.toLowerCase())) {
          weakList.push(entry);
        }
      }

      // 2. Check for Reused
      if (!reusedMap.has(pass)) {
        reusedMap.set(pass, []);
      }
      reusedMap.get(pass).push(entry);
    });

    // Filter duplicate groups
    let reusedGroups = [];
    let reusedCount = 0;
    reusedMap.forEach((arr, pass) => {
      if (arr.length > 1) {
        reusedGroups.push({ password: pass, entries: arr });
        reusedCount += arr.length;
      }
    });

    // Calculate score
    let deduction = 0;
    deduction += (weakList.length * 8); // Deduct 8 points per weak password
    deduction += (reusedGroups.length * 12); // Deduct 12 points per duplicate group
    let score = Math.max(10, Math.floor(100 - deduction));
    if (totalCount === 0) score = 100;

    // Render Stats
    document.getElementById('audit-score-value').textContent = `${score}%`;
    document.getElementById('stat-total-items').textContent = totalCount;
    document.getElementById('stat-weak-items').textContent = weakList.length;
    document.getElementById('stat-reused-items').textContent = reusedCount;

    // Set score circle color
    const scoreCircle = document.querySelector('.audit-score-circle');
    if (score >= 80) {
      scoreCircle.style.borderColor = 'var(--color-success)';
    } else if (score >= 50) {
      scoreCircle.style.borderColor = 'var(--color-warning)';
    } else {
      scoreCircle.style.borderColor = 'var(--color-danger)';
    }

    // Render Weak Report
    const weakListContainer = document.getElementById('audit-weak-list');
    weakListContainer.innerHTML = '';
    if (weakList.length === 0) {
      weakListContainer.innerHTML = `<div class="audit-list-empty">No weak passwords found. Nice!</div>`;
    } else {
      weakList.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'audit-item';
        item.innerHTML = `
          <div class="audit-item-info">
            <div class="audit-item-title">${escapeHtml(entry.service)}</div>
            <div class="audit-item-subtitle">${escapeHtml(entry.username)}</div>
          </div>
          <span class="audit-item-badge">Too Short (${entry.password ? entry.password.length : 0} chars)</span>
        `;
        item.addEventListener('click', () => showDetail(entry));
        weakListContainer.appendChild(item);
      });
    }

    // Render Reused Report
    const reusedListContainer = document.getElementById('audit-reused-list');
    reusedListContainer.innerHTML = '';
    if (reusedGroups.length === 0) {
      reusedListContainer.innerHTML = `<div class="audit-list-empty">No duplicate passwords found. Great job!</div>`;
    } else {
      reusedGroups.forEach(group => {
        group.entries.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'audit-item';
          item.innerHTML = `
            <div class="audit-item-info">
              <div class="audit-item-title">${escapeHtml(entry.service)}</div>
              <div class="audit-item-subtitle">${escapeHtml(entry.username)}</div>
            </div>
            <span class="audit-item-badge badge-warning">Shared Password</span>
          `;
          item.addEventListener('click', () => showDetail(entry));
          reusedListContainer.appendChild(item);
        });
      });
    }
  }

  // --- BASE32 & TOTP DECODING LOGIC ---
  function base32ToBuf(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let cleaned = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
      let val = alphabet.indexOf(cleaned[i]);
      if (val === -1) throw new Error("Invalid Base32 character");
      bits += val.toString(2).padStart(5, '0');
    }
    let bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return new Uint8Array(bytes);
  }

  async function getTOTP(secretBase32) {
    try {
      const keyData = base32ToBuf(secretBase32);
      
      // Calculate current time counter (30 second steps)
      const counter = Math.floor(Date.now() / 1000 / 30);
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setUint32(4, counter, false); // Lower 32 bits (fits JS numbers)
      
      // Import key for HMAC-SHA1 using Web Crypto
      const key = await window.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: { name: 'SHA-1' } },
        false,
        ['sign']
      );

      const signature = await window.crypto.subtle.sign(
        'HMAC',
        key,
        new Uint8Array(buffer)
      );

      const hmac = new Uint8Array(signature);
      const offset = hmac[hmac.length - 1] & 0xf;
      
      const code = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);

      const totp = (code % 1000000).toString().padStart(6, '0');
      return totp;
    } catch (e) {
      return '000000';
    }
  }

  function startTOTPLoop() {
    if (state.totpIntervalId) clearInterval(state.totpIntervalId);

    const updateTOTP = async () => {
      const totpGroup = document.getElementById('val-totp-group');
      const isDetailActive = !document.getElementById('detail-content').classList.contains('hidden');

      if (isDetailActive && state.editingEntry && state.editingEntry.totp) {
        totpGroup.classList.remove('hidden');

        // Seconds remaining in current 30s window
        const now = Math.floor(Date.now() / 1000);
        const remaining = 30 - (now % 30);

        document.getElementById('totp-progress-text').textContent = remaining;

        // Calculate and render TOTP code
        const code = await getTOTP(state.editingEntry.totp);
        let formatted = code;
        if (code && code.length === 6) {
          formatted = code.substring(0, 3) + ' ' + code.substring(3, 6);
        }
        document.getElementById('val-totp-code').textContent = formatted;
      } else {
        totpGroup.classList.add('hidden');
      }
    };

    updateTOTP();
    state.totpIntervalId = setInterval(updateTOTP, 1000);
  }

  // --- CRYPTO PASS GENERATOR ---
  function generatePassword() {
    const length = parseInt(document.getElementById('gen-length').value, 10);
    const useUpper = document.getElementById('gen-upper').checked;
    const useLower = document.getElementById('gen-lower').checked;
    const useNumbers = document.getElementById('gen-numbers').checked;
    const useSymbols = document.getElementById('gen-symbols').checked;

    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let pool = '';
    let guaranteed = [];

    if (useUpper) { pool += upper; guaranteed.push(upper[getRandomInt(upper.length)]); }
    if (useLower) { pool += lower; guaranteed.push(lower[getRandomInt(lower.length)]); }
    if (useNumbers) { pool += numbers; guaranteed.push(numbers[getRandomInt(numbers.length)]); }
    if (useSymbols) { pool += symbols; guaranteed.push(symbols[getRandomInt(symbols.length)]); }

    if (pool.length === 0) {
      document.getElementById('gen-result').value = 'Select options';
      return '';
    }

    let password = [...guaranteed];
    for (let i = password.length; i < length; i++) {
      password.push(pool[getRandomInt(pool.length)]);
    }

    for (let i = password.length - 1; i > 0; i--) {
      const j = getRandomInt(i + 1);
      [password[i], password[j]] = [password[j], password[i]];
    }

    const generated = password.join('');
    document.getElementById('gen-result').value = generated;
    return generated;
  }

  function getRandomInt(max) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % max;
  }

  // --- SAFE CLIPBOARD AUTO-CLEAR TIMEOUT ---
  function copyToClipboard(text) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);

    const select = document.getElementById('settings-clipboard-timeout');
    const seconds = parseInt(select.value, 10);
    
    if (state.clipboardTimeoutId) {
      clearTimeout(state.clipboardTimeoutId);
    }
    
    if (seconds > 0) {
      state.clipboardTimeoutId = setTimeout(() => {
        const clearEl = document.createElement('textarea');
        clearEl.value = '';
        document.body.appendChild(clearEl);
        clearEl.select();
        document.execCommand('copy');
        document.body.removeChild(clearEl);
        showToast("Clipboard cleared automatically.", "danger");
      }, seconds * 1000);
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function handleLogoutLocal() {
    sessionStorage.removeItem('vault_token');
    sessionStorage.removeItem('vault_username');
    state.token = null;
    state.username = null;
    state.entries = [];
    if (state.totpIntervalId) clearInterval(state.totpIntervalId);
    showWelcome();
    renderScreens();
  }

  // --- EVENT HANDLERS ---

  // Sign In / Sign Up Form submission
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;

    if (state.isRegisterMode) {
      const confirm = document.getElementById('auth-confirm').value;
      if (password !== confirm) {
        showToast("Passwords do not match.", "danger");
        return;
      }

      try {
        await apiCall('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, masterPassword: password })
        });
        showToast("Vault profile created! Please sign in.");
        state.isRegisterMode = false;
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-confirm').value = '';
        renderScreens();
      } catch (err) {}
    } else {
      try {
        const res = await apiCall('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, masterPassword: password })
        });
        
        state.token = res.token;
        state.username = res.username;
        sessionStorage.setItem('vault_token', res.token);
        sessionStorage.setItem('vault_username', res.username);
        
        document.getElementById('auth-password').value = '';
        document.getElementById('user-display').textContent = res.username;
        
        showToast(`Sign in successful. Welcome, ${res.username}!`);
        renderScreens();
        await fetchEntries();
        startTOTPLoop();
      } catch (err) {}
    }
  });

  // Toggle register vs login
  document.getElementById('btn-auth-toggle').addEventListener('click', () => {
    state.isRegisterMode = !state.isRegisterMode;
    renderAuthFormState();
  });

  let supernovaRadius = 0;

  function playSynthSound(freq, type, duration, decay = true) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      if (decay) {
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      }

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  function runFancyLogoutAnimation(canvas) {
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Simulation states
    const particles = [];
    const foodItems = [];
    const floatingTexts = [];
    
    // Global properties that can be adjusted dynamically in timeline
    const config = {
      vortex: false,
      vortexSpeed: 0.02,
      gravity: 0,
      embers: false,
      supernova: false,
      supernovaProgress: 0,
      flashWhite: false,
      scaryAnglerMode: false,
      rave: false,
      soundIntensity: 1
    };

    // Helper: spawn particles
    function spawnParticles(x, y, count, speedMultiplier = 1, forceColor = null) {
      const colors = forceColor ? [forceColor] : ['#ef4444', '#f59e0b', '#d97706', '#b45309', '#ffffff', '#ec4899', '#38bdf8', '#a855f7', '#22c55e'];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (0.5 + Math.random() * 5) * speedMultiplier;
        particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1 + Math.random() * 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          opacity: 1,
          decay: 0.005 + Math.random() * 0.015,
          gravity: config.gravity,
          wind: (Math.random() - 0.5) * 0.05
        });
      }
    }

    // Helper: spawn food item (with ridiculous additions)
    function spawnFoodItem(x, y, vx, vy, sizeFactor = 1) {
      const types = ['chicken', 'rooster', 'drumstick', 'nugget', 'kfc_bucket', 'ufo', 'cow', 'banana', 'cat', 'poop', 'fire', 'popcorn', 'unicorn'];
      const type = types[Math.floor(Math.random() * types.length)];
      const size = (type === 'kfc_bucket' ? 24 : type === 'nugget' ? 16 : 28) * sizeFactor * (0.8 + Math.random() * 0.4);
      
      foodItems.push({
        x: x,
        y: y,
        vx: vx || (Math.random() - 0.5) * 7,
        vy: vy || (Math.random() - 0.5) * 7 - 2,
        type: type,
        size: size,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.15,
        opacity: 1
      });
    }

    // Helper to draw KFC Bucket
    function drawKFCBucket(ctx, x, y, size, rotation) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-size, -size);
      ctx.lineTo(size, -size);
      ctx.lineTo(size * 0.7, size);
      ctx.lineTo(-size * 0.7, size);
      ctx.closePath();
      ctx.fill();
      
      ctx.shadowColor = 'transparent';

      ctx.fillStyle = '#e11d48';
      
      // Left stripe
      ctx.beginPath();
      ctx.moveTo(-size * 0.65, -size);
      ctx.lineTo(-size * 0.4, -size);
      ctx.lineTo(-size * 0.3, size);
      ctx.lineTo(-size * 0.48, size);
      ctx.closePath();
      ctx.fill();

      // Middle stripe
      ctx.beginPath();
      ctx.moveTo(-size * 0.15, -size);
      ctx.lineTo(size * 0.15, -size);
      ctx.lineTo(size * 0.1, size);
      ctx.lineTo(-size * 0.1, size);
      ctx.closePath();
      ctx.fill();

      // Right stripe
      ctx.beginPath();
      ctx.moveTo(size * 0.4, -size);
      ctx.lineTo(size * 0.65, -size);
      ctx.lineTo(size * 0.48, size);
      ctx.lineTo(size * 0.3, size);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, -size, size, size * 0.18, 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.ellipse(0, size, size * 0.7, size * 0.12, 0, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.font = `bold ${size * 0.5}px 'Arial Black', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KFC', 0, size * 0.05);

      ctx.restore();
    }

    // Helper to draw Nugget
    function drawNugget(ctx, x, y, size, rotation) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#d97706';
      ctx.beginPath();
      const points = 7;
      const seed = (Math.abs(x + y) % 100) / 100;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const lump = 1 + Math.sin(angle * 3 + seed * 5) * 0.12 + Math.cos(angle * 2 + seed * 3) * 0.08;
        const px = Math.cos(angle) * size * lump;
        const py = Math.sin(angle) * size * 0.8 * lump;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      ctx.shadowColor = 'transparent';

      ctx.fillStyle = '#b45309';
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        const cx = Math.sin(seed * 20 + i) * size * 0.25;
        const cy = Math.cos(seed * 12 + i) * size * 0.15;
        ctx.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.ellipse(-size * 0.25, -size * 0.2, size * 0.25, size * 0.12, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Spawn initial entities
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    for (let i = 0; i < 20; i++) {
      spawnFoodItem(
        centerX + (Math.random() - 0.5) * 400,
        centerY + (Math.random() - 0.5) * 400
      );
    }
    spawnParticles(centerX, centerY, 100);

    const draw = () => {
      // Dynamic backgrounds (glitchy rave modes!)
      let bgFill = 'rgba(2, 2, 5, 0.12)';
      if (config.flashWhite) {
        bgFill = 'rgba(255, 255, 255, 0.8)';
      } else if (config.rave) {
        const hue = (Date.now() / 4) % 360;
        bgFill = `hsla(${hue}, 85%, 15%, 0.15)`;
      }
      
      ctx.fillStyle = bgFill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (config.flashWhite) {
        config.flashWhite = false;
      }

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Spawn ambient particles
      if (Math.random() < 0.5) {
        if (config.embers) {
          particles.push({
            x: cx + (Math.random() - 0.5) * 100,
            y: cy + 120 + Math.random() * 20,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -1 - Math.random() * 2,
            size: 2 + Math.random() * 4,
            color: '#f97316',
            opacity: 1,
            decay: 0.005 + Math.random() * 0.01,
            gravity: -0.01,
            wind: (Math.random() - 0.5) * 0.05
          });
        } else {
          spawnParticles(cx, cy, 3);
        }
      }

      // Spawn ambient food items
      if (foodItems.length < 35 && Math.random() < 0.12) {
        if (config.embers) {
          foodItems.push({
            x: cx + (Math.random() - 0.5) * 200,
            y: cy + 180,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -0.5 - Math.random() * 1.5,
            type: ['chicken', 'rooster', 'drumstick', 'nugget', 'kfc_bucket', 'banana', 'cat'][Math.floor(Math.random() * 7)],
            size: 14 + Math.random() * 10,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.05,
            opacity: 1
          });
        } else {
          spawnFoodItem(cx, cy, null, null, 1);
        }
      }

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        
        if (config.vortex) {
          const dx = cx - p.x;
          const dy = cy - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const tx = -dy / dist;
          const ty = dx / dist;
          p.vx += (dx / dist) * 0.18 + tx * config.vortexSpeed * (dist * 0.02 + 1);
          p.vy += (dy / dist) * 0.18 + ty * config.vortexSpeed * (dist * 0.02 + 1);
          p.vx *= 0.94;
          p.vy *= 0.94;
        }

        p.vy += p.gravity || 0;
        p.vx += p.wind || 0;
        p.x += p.vx;
        p.y += p.vy;
        p.opacity -= p.decay;

        if (p.opacity <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      // Update and draw food items
      for (let i = foodItems.length - 1; i >= 0; i--) {
        const item = foodItems[i];

        if (config.vortex) {
          const dx = cx - item.x;
          const dy = cy - item.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const tx = -dy / dist;
          const ty = dx / dist;
          
          item.vx += (dx / dist) * 0.12 + tx * config.vortexSpeed * 3.5;
          item.vy += (dy / dist) * 0.12 + ty * config.vortexSpeed * 3.5;
          item.vx *= 0.95;
          item.vy *= 0.95;
        }

        if (config.embers) {
          item.vx += Math.sin(Date.now() * 0.003 + item.y * 0.01) * 0.06;
        }

        item.x += item.vx;
        item.y += item.vy;
        item.rotation += item.rotationSpeed;

        if (!config.vortex && !config.embers) {
          if (item.x < item.size || item.x > canvas.width - item.size) {
            item.vx *= -0.9;
            item.x = item.x < item.size ? item.size : canvas.width - item.size;
          }
          if (item.y < item.size || item.y > canvas.height - item.size) {
            item.vy *= -0.9;
            item.y = item.y < item.size ? item.size : canvas.height - item.size;
          }
        }

        if (config.supernova && config.supernovaProgress > 0.8) {
          item.opacity -= 0.025;
        }

        if (item.opacity <= 0) {
          foodItems.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = item.opacity;

        if (item.type === 'kfc_bucket') {
          drawKFCBucket(ctx, item.x, item.y, item.size, item.rotation);
        } else if (item.type === 'nugget') {
          drawNugget(ctx, item.x, item.y, item.size, item.rotation);
        } else {
          let emojiStr = '🐔';
          switch (item.type) {
            case 'rooster': emojiStr = '🐓'; break;
            case 'drumstick': emojiStr = '🍗'; break;
            case 'ufo': emojiStr = '🛸'; break;
            case 'cow': emojiStr = '🐄'; break;
            case 'banana': emojiStr = '🍌'; break;
            case 'cat': emojiStr = '🐈'; break;
            case 'poop': emojiStr = '💩'; break;
            case 'fire': emojiStr = '🔥'; break;
            case 'popcorn': emojiStr = '🍿'; break;
            case 'unicorn': emojiStr = '🦄'; break;
          }
          
          if (config.scaryAnglerMode && Math.random() < 0.05) {
            emojiStr = '🦈';
          } else if (config.scaryAnglerMode && (item.type === 'chicken' || item.type === 'cow' || item.type === 'unicorn')) {
            emojiStr = '💀';
          }
          
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(item.rotation);
          ctx.font = `${item.size * 1.5}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emojiStr, 0, 0);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1.0;

      // Update and draw floating boom texts
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.x += ft.vx;
        ft.y += ft.vy;
        ft.rotation += ft.rotationSpeed;
        ft.opacity -= ft.decay;

        if (ft.opacity <= 0) {
          floatingTexts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(ft.x, ft.y);
        ctx.rotate(ft.rotation);
        ctx.font = `bold ${ft.size}px 'Arial Black', Impact, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
        ctx.strokeText(ft.text, 0, 0);
        
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = ft.opacity;
        ctx.fillText(ft.text, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1.0;

      // Supernova circle
      if (config.supernova) {
        const radius = config.supernovaProgress * Math.max(canvas.width, canvas.height) * 1.1;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius || 1);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.2, '#fef08a');
        grad.addColorStop(0.5, '#f97316');
        grad.addColorStop(0.8, '#ef4444');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        if (config.supernovaProgress > 0.95) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(config.supernovaProgress - 0.95) / 0.05})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return {
      stop: () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('resize', resize);
      },
      triggerExplosion: (x, y, count = 50, speed = 1.5, color = null) => {
        const expX = x || canvas.width / 2;
        const expY = y || canvas.height / 2;
        spawnParticles(expX, expY, count, speed, color);
        for (let i = 0; i < Math.min(count / 8, 12); i++) {
          const angle = Math.random() * Math.PI * 2;
          const force = 3 + Math.random() * 9;
          spawnFoodItem(expX, expY, Math.cos(angle) * force, Math.sin(angle) * force, 1.25);
        }
      },
      triggerTextExplosion: (text, color = '#f59e0b') => {
        const words = text.split(' ');
        words.forEach(w => {
          floatingTexts.push({
            text: w.toUpperCase(),
            x: canvas.width / 2 + (Math.random() - 0.5) * 150,
            y: canvas.height / 2 + (Math.random() - 0.5) * 100,
            vx: (Math.random() - 0.5) * 7,
            vy: (Math.random() - 0.5) * 7 - 3,
            size: 32 + Math.random() * 28,
            rotation: (Math.random() - 0.5) * 0.4,
            rotationSpeed: (Math.random() - 0.5) * 0.06,
            color: color,
            opacity: 1,
            decay: 0.01 + Math.random() * 0.01
          });
        });
      },
      setConfig: (key, val) => {
        config[key] = val;
      }
    };
  }

  // Logout Click
  document.getElementById('btn-logout').addEventListener('click', async () => {
    const overlay = document.getElementById('logout-overlay');
    const hudCard = document.getElementById('hud-card');
    const mainStatus = document.getElementById('hud-main-status');
    const subStatus = document.getElementById('hud-sub-status');
    const ringCircle = document.getElementById('hud-progress-ring-bar');
    const miniBar = document.getElementById('hud-progress-bar');
    const percentageText = document.getElementById('hud-percentage');
    const securityBadge = document.getElementById('hud-security-status');

    overlay.classList.remove('hidden');
    overlay.style.backgroundColor = '#020205';
    hudCard.className = 'hud-container'; // Reset animations
    
    mainStatus.textContent = 'INITIATING REVOCATION';
    subStatus.textContent = 'Cryptographic revocation protocol started...';
    
    securityBadge.textContent = 'SECURE LOCKDOWN';
    securityBadge.style.color = '#ef4444';
    securityBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    securityBadge.style.background = 'rgba(239, 68, 68, 0.15)';

    const circumference = 2 * Math.PI * 58;
    ringCircle.style.strokeDasharray = circumference;

    function updateProgress(percent) {
      miniBar.style.width = `${percent}%`;
      const offset = circumference - (percent / 100) * circumference;
      ringCircle.style.strokeDashoffset = offset;
      percentageText.textContent = `${Math.round(percent)}%`;
    }

    function setAccentColor(color) {
      ringCircle.style.stroke = color;
      ringCircle.style.filter = `drop-shadow(0 0 6px ${color})`;
      miniBar.style.background = color;
    }

    function triggerCardEffect(effectClass) {
      hudCard.classList.remove('hud-spin', 'hud-flip', 'hud-glitch', 'shake-screen');
      void hudCard.offsetWidth; // Reflow to reset CSS transition
      hudCard.classList.add(effectClass);
    }

    updateProgress(0);
    setAccentColor('#ef4444');

    const anim = runFancyLogoutAnimation(document.getElementById('logout-canvas'));

    // Dynamic sound engine for rumbles & sirens
    let alarmActive = true;
    const alertInterval = setInterval(() => {
      if (alarmActive) {
        playSynthSound(300 + Math.random() * 200, 'sawtooth', 0.1, true);
      }
    }, 400);

    let supernovaProgressInterval = null;

    // --- ABSURD 30-SECOND OUTER WILDS & SHADOW OF THE COLOSSUS LOGOUT TIMELINE ---

    // 0.0s: Initiation (glitch startup)
    setTimeout(() => { 
      mainStatus.textContent = 'INITIATING REVOCATION';
      subStatus.textContent = 'Initiating cryptographic revocation protocol...'; 
      playSynthSound(880, 'square', 0.15); 
      triggerCardEffect('hud-glitch');
      setTimeout(() => hudCard.classList.remove('hud-glitch'), 500);
    }, 100);

    // 1.2s: Outer Wilds Lift Off
    setTimeout(() => { 
      mainStatus.textContent = 'LAUNCH SEQUENCE';
      subStatus.textContent = 'Timber Hearth: Launch codes retrieved from Hornfels. Launching ship...'; 
      playSynthSound(100, 'sawtooth', 1.0, true); 
      updateProgress(5);
      anim.setConfig('gravity', 0.06);
      anim.triggerExplosion(null, null, 40, 3);
      anim.triggerTextExplosion('LIFT OFF BOOM CHICKEN POWER', '#f59e0b');
      triggerCardEffect('hud-spin');
    }, 1200);

    // 2.5s: Shadow of the Colossus: Dormin
    setTimeout(() => { 
      mainStatus.textContent = 'DORMIN ALIGNMENT';
      subStatus.textContent = 'Dormin: "Thy next foe is... Gaius, the third colossus. A giant canopy dreads its shadow..."'; 
      playSynthSound(180, 'triangle', 0.8, true); 
      updateProgress(10);
      setAccentColor('#eab308');
      anim.triggerTextExplosion('DORMIN AWAKES', '#eab308');
    }, 2500);

    // 4.0s: Outer Wilds: Giant\'s Deep Cyclone (glitchy rave!)
    setTimeout(() => { 
      mainStatus.textContent = 'GRAVITY VORTEX';
      subStatus.textContent = 'Giant\'s Deep: Ship enters atmosphere. Gravity cyclone detected!'; 
      playSynthSound(150, 'sawtooth', 1.2, true);
      updateProgress(15);
      anim.setConfig('vortex', true);
      anim.setConfig('vortexSpeed', 0.04);
      anim.setConfig('rave', true);
      anim.triggerTextExplosion('GRAVITY CYCLONE WARNING NONSENSE RAVE', '#ec4899');
      triggerCardEffect('hud-glitch');
    }, 4000);

    // 5.5s: Shadow of the Colossus: Gaius Sword Jump (3D card flip)
    setTimeout(() => { 
      mainStatus.textContent = 'SWORD JUMP';
      subStatus.textContent = 'Gaius swings stone sword! Wander leaps onto the blade.'; 
      playSynthSound(80, 'sawtooth', 1.5, false);
      updateProgress(20);
      anim.triggerExplosion(null, null, 70, 2);
      anim.triggerTextExplosion('SWORD JUMP MASSIVE BOOM', '#e11d48');
      triggerCardEffect('hud-flip');
    }, 5500);

    // 7.5s: Outer Wilds: Dark Bramble Tension (stop rave/tension silence)
    setTimeout(() => { 
      mainStatus.textContent = 'DARK BRAMBLE';
      subStatus.textContent = 'Dark Bramble: Entering core. Harmonics detected. Dampening thrusters to 0% to avoid Anglerfish...'; 
      alarmActive = false; // Silence for tension!
      updateProgress(28);
      anim.setConfig('vortex', false);
      anim.setConfig('rave', false);
      setAccentColor('#0ea5e9');
      anim.triggerTextExplosion('SILENT BRAIN ANGLERFISH SNEAK', '#0ea5e9');
    }, 7500);

    // 9.5s: Outer Wilds: Anglerfish Attack (intense glitching/shaking & rave back on!)
    setTimeout(() => { 
      mainStatus.textContent = 'ANGLERFISH ATTACK';
      subStatus.textContent = 'ERROR: Accidental thruster trigger! *CHOMP* - Ship consumed by Anglerfish.'; 
      playSynthSound(900, 'square', 1.0, false);
      updateProgress(35);
      anim.setConfig('scaryAnglerMode', true);
      anim.setConfig('rave', true);
      anim.triggerExplosion(null, null, 90, 4.5, '#ef4444');
      anim.triggerTextExplosion('ANGLER CHOMP DANGER DANGER CHICKENS ESCAPING', '#ef4444');
      setAccentColor('#ef4444');
      triggerCardEffect('hud-glitch');
    }, 9500);

    // 11.0s: Outer Wilds: Ash Twin Project Mask Active (time dilation 3D flip)
    setTimeout(() => { 
      mainStatus.textContent = 'LOOP RESET';
      subStatus.textContent = 'Nomai Mask activated. Relaying memory logs... LOOP #9,318,054 CONCLUDED.'; 
      playSynthSound(440, 'sine', 0.5, true);
      updateProgress(42);
      anim.setConfig('scaryAnglerMode', false);
      anim.setConfig('flashWhite', true);
      anim.triggerExplosion(null, null, 110, 2, '#0ea5e9');
      anim.triggerTextExplosion('TIME DILATION LOOP SHIFT', '#0ea5e9');
      setAccentColor('#0ea5e9');
      triggerCardEffect('hud-flip');
    }, 11000);

    // 12.5s: Shadow of the Colossus: Gaius Arm Climb
    setTimeout(() => { 
      mainStatus.textContent = 'ARM BRACE CLIMB';
      subStatus.textContent = 'Loop reset. Running up Gaius\' stone arm brace. Grip stamina: 20%!'; 
      playSynthSound(100, 'triangle', 0.6, true);
      updateProgress(48);
      anim.triggerTextExplosion('CLIMB STAMINA DANGER', '#eab308');
      triggerCardEffect('shake-screen');
    }, 12500);

    // 14.0s: Shadow of the Colossus: First Sigil Struck
    setTimeout(() => { 
      mainStatus.textContent = 'SIGIL STRUCK';
      subStatus.textContent = 'Stabbing first glowing sigil on Gaius\' head! Zero-filling bearer tokens.'; 
      playSynthSound(70, 'sawtooth', 1.5, true);
      updateProgress(55);
      anim.triggerExplosion(null, null, 80, 2.5, '#ef4444');
      anim.triggerTextExplosion('SIGIL SHATTERED WIPING TOKENS BOOM', '#ef4444');
      setAccentColor('#ef4444');
      triggerCardEffect('hud-spin');
    }, 14000);

    // 15.5s: Outer Wilds: Quantum Moon Alignment
    setTimeout(() => { 
      mainStatus.textContent = 'QUANTUM MOON';
      subStatus.textContent = 'Quantum Moon landing successful. Solanum meets Wander at the Sixth Location.'; 
      playSynthSound(523.25, 'sine', 0.6, true);
      updateProgress(62);
      setAccentColor('#a855f7');
      anim.triggerExplosion(null, null, 50, 1.2, '#a855f7');
      anim.triggerTextExplosion('QUANTUM SOLANUM CONVERGENCE', '#a855f7');
    }, 15500);

    // 17.0s: Outer Wilds: Interloper Core
    setTimeout(() => { 
      mainStatus.textContent = 'THE INTERLOPER';
      subStatus.textContent = 'Navigating ice cracks. Pressurized Ghost Matter detected.'; 
      playSynthSound(1200, 'sine', 0.3, true);
      updateProgress(68);
      setAccentColor('#22c55e');
      anim.triggerTextExplosion('ICE DEBRIS RADAR', '#22c55e');
    }, 17000);

    // 18.5s: Outer Wilds: Ghost Matter Rupture (glitchy toxic rave!)
    setTimeout(() => { 
      mainStatus.textContent = 'GHOST MATTER RUPTURE';
      subStatus.textContent = 'Ghost matter core ruptured! Lethal energy vaporizing RAM master keys.'; 
      playSynthSound(800, 'sawtooth', 1.0, true);
      updateProgress(75);
      anim.triggerExplosion(null, null, 110, 2.2, '#22c55e');
      anim.triggerTextExplosion('GHOST MATTER DETONATION RADIATION RAVE', '#22c55e');
      triggerCardEffect('hud-glitch');
    }, 18500);

    // 20.0s: Shadow of the Colossus: Dormin Possession
    setTimeout(() => { 
      mainStatus.textContent = 'SHADOW POSSESSION';
      subStatus.textContent = '16 idols crumbled. Wander possessed by Dormin. Shrine pool pulling Wander in.'; 
      securityBadge.textContent = 'DORMIN ALIGNMENT: 95%';
      playSynthSound(150, 'triangle', 2.0, false);
      updateProgress(82);
      anim.setConfig('vortex', true);
      anim.setConfig('vortexSpeed', -0.02);
      setAccentColor('#64748b');
      anim.triggerTextExplosion('SHADOW CONVOCATION VACUUM', '#64748b');
      triggerCardEffect('hud-flip');
    }, 20000);

    // 21.5s: Outer Wilds: Sun Station Collapse Warning
    setTimeout(() => { 
      mainStatus.textContent = 'CORE COLLAPSE DETECTED';
      subStatus.textContent = 'SUN STATION: Core collapse confirmed. Supernova blast wave in 3 seconds.'; 
      securityBadge.textContent = 'SYSTEM LOCKDOWN: SUPERNOVA';
      alarmActive = true;
      playSynthSound(440, 'square', 0.5, true);
      updateProgress(88);
      setAccentColor('#f97316');
      anim.triggerTextExplosion('SUPERNOVA COUNTDOWN WARNING', '#f97316');
      triggerCardEffect('hud-glitch');
    }, 21500);

    // 23.0s: Shadow of the Colossus: Final Defeat / agro memorial
    setTimeout(() => { 
      mainStatus.textContent = 'VALEDICTORY';
      subStatus.textContent = 'Wander lets go. "Agro..." echoes. Ending SQLite db sync...'; 
      playSynthSound(90, 'sawtooth', 1.5, true);
      updateProgress(92);
      anim.triggerTextExplosion('AGRO ECO MEMORY PURGE', '#f43f5e');
      triggerCardEffect('shake-screen');
    }, 23000);

    // 24.5s: Outer Wilds: Supernova (giant explosion)
    setTimeout(() => { 
      mainStatus.textContent = 'SUPERNOVA DETONATION';
      subStatus.textContent = 'SUN STATION: SUPERNOVA BURST IGNITED. Evaporating local filesystem...'; 
      securityBadge.textContent = 'SYSTEM STATUS: SUPERNOVA';
      overlay.style.backgroundColor = '#020617';
      playSynthSound(100, 'sawtooth', 3.0, false);
      updateProgress(96);
      
      anim.setConfig('supernova', true);
      let startSupernovaTime = Date.now();
      supernovaProgressInterval = setInterval(() => {
        const elapsed = Date.now() - startSupernovaTime;
        const progress = Math.min(1.0, elapsed / 2000);
        anim.setConfig('supernovaProgress', progress);
        if (progress >= 1.0) {
          clearInterval(supernovaProgressInterval);
        }
      }, 16);

      setAccentColor('#ffffff');
      anim.triggerTextExplosion('APOCALYPSE SUPERNOVA KA BOOM NONSENSE OVERLOAD', '#ffffff');
      triggerCardEffect('hud-flip');
    }, 24500);

    // 26.5s: Outer Wilds: Ash Twin project mask receipt (calm campfire)
    setTimeout(() => { 
      mainStatus.textContent = 'LOOP SECURED';
      subStatus.textContent = 'Memories transmitted. Gathering around the campfire. Tuning instruments...'; 
      clearInterval(alertInterval);
      alarmActive = false;
      overlay.style.backgroundColor = '#0c0a09';
      
      securityBadge.style.color = '#22c55e';
      securityBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
      securityBadge.style.background = 'rgba(34, 197, 94, 0.15)';
      securityBadge.textContent = 'LOOP STATUS: SECURED';
      updateProgress(98);
      
      anim.setConfig('supernova', false);
      anim.setConfig('vortex', false);
      anim.setConfig('rave', false);
      anim.setConfig('embers', true);
      setAccentColor('#f97316');
      
      anim.triggerTextExplosion('CAMPFIRE PEACE REST LOOP CLOSED', '#f97316');

      const banjoNotes = [
        { freq: 587.33, delay: 0 },
        { freq: 659.25, delay: 180 },
        { freq: 783.99, delay: 360 },
        { freq: 880.00, delay: 540 },
        { freq: 783.99, delay: 800 },
        { freq: 987.77, delay: 980 },
        { freq: 1174.66, delay: 1160 },
        { freq: 880.00, delay: 1400 }
      ];
      banjoNotes.forEach(note => {
        setTimeout(() => {
          playSynthSound(note.freq, 'sine', 0.5, true);
        }, note.delay);
      });
    }, 26500);

    // 28.5s: Completion
    setTimeout(() => { 
      mainStatus.textContent = 'MEMORIES STORED';
      subStatus.textContent = 'Vault locked. Loop #9,318,055 initialized. Memory cleared safely.'; 
      updateProgress(100);
      setAccentColor('#22c55e');
      anim.triggerTextExplosion('GOODBYE SECURE SAFE', '#22c55e');
    }, 28500);

    // 30.5s: Redirect
    setTimeout(async () => {
      anim.stop();
      if (supernovaProgressInterval) clearInterval(supernovaProgressInterval);
      overlay.classList.add('hidden');
      overlay.style.backgroundColor = '#000';
      
      try {
        await apiCall('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      
      handleLogoutLocal();
      showToast("Loop closed. Memory cleared safely.");
    }, 30500);
  });

  // Sidebar navigations
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const filter = item.dataset.filter;
      const folder = item.dataset.folder;
      
      if (filter === 'generator') {
        showGenerator();
      } else if (filter === 'settings') {
        showSettings();
      } else if (filter === 'audit') {
        showAudit();
      } else if (folder) {
        setActiveFilter(`folder:${folder}`);
      } else {
        setActiveFilter(filter);
      }
    });
  });

  // Add Item Click
  document.getElementById('btn-new-item').addEventListener('click', () => {
    showForm(false);
  });

  // Edit Click
  document.getElementById('btn-edit').addEventListener('click', () => {
    showForm(true);
  });

  // Cancel form
  document.getElementById('btn-cancel').addEventListener('click', () => {
    if (state.selectedId) {
      const found = state.entries.find(e => e.id === state.selectedId);
      if (found) showDetail(found);
      else showWelcome();
    } else {
      showWelcome();
    }
  });

  // Save Item Submission
  document.getElementById('vault-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('form-id').value;
    const service = document.getElementById('form-service').value;
    const username = document.getElementById('form-username').value;
    const password = document.getElementById('form-password').value;
    const folder = document.getElementById('form-folder').value;
    const totp = document.getElementById('form-totp').value.trim().replace(/\s/g, '');
    const website = document.getElementById('form-website').value;
    const notes = document.getElementById('form-notes').value;

    const payload = { service, username, password, folder, totp, website, notes };
    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `/api/entries/${id}` : '/api/entries';

    try {
      const saved = await apiCall(endpoint, {
        method: method,
        body: JSON.stringify(payload)
      });
      showToast(id ? "Item saved successfully." : "Item added to vault.");
      await fetchEntries();
      showDetail(saved);
    } catch (e) {}
  });

  // Toggle Favorite Action (Star Button in Detail Header)
  document.getElementById('btn-toggle-favorite').addEventListener('click', async () => {
    if (!state.editingEntry) return;
    const id = state.editingEntry.id;
    const updatedFav = !state.editingEntry.favorite;

    try {
      const saved = await apiCall(`/api/entries/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...state.editingEntry,
          favorite: updatedFav
        })
      });
      state.editingEntry.favorite = updatedFav;
      
      const starBtn = document.getElementById('btn-toggle-favorite');
      if (updatedFav) starBtn.classList.add('active');
      else starBtn.classList.remove('active');

      showToast(updatedFav ? "Added to Favorites" : "Removed from Favorites");
      await fetchEntries();
    } catch (e) {}
  });

  // Delete Credential Click
  document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!state.selectedId) return;
    if (!confirm("Are you sure you want to delete this vault item?")) return;

    try {
      await apiCall(`/api/entries/${state.selectedId}`, { method: 'DELETE' });
      showToast("Item deleted.");
      state.selectedId = null;
      await fetchEntries();
    } catch (e) {}
  });

  // Search input typing
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderEntriesList();
  });

  // Toggle View Password (Detail panel)
  document.getElementById('btn-toggle-view-pass').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const passVal = document.getElementById('val-password');
    const isVisible = btn.dataset.visible === "true";

    if (isVisible) {
      passVal.textContent = '••••••••••••';
      passVal.classList.add('password-masked');
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      btn.dataset.visible = "false";
      btn.title = "Show password";
    } else {
      passVal.textContent = state.editingEntry ? state.editingEntry.password : '';
      passVal.classList.remove('password-masked');
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      btn.dataset.visible = "true";
      btn.title = "Hide password";
    }
  });

  // Toggle View Password (Form panel)
  document.getElementById('btn-form-toggle-pass').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const input = document.getElementById('form-password');
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    } else {
      input.type = 'password';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    }
  });

  // Detail panel copies
  document.querySelectorAll('.btn-copy[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.copy;
      let text = '';
      if (targetId === 'val-password' && state.editingEntry) {
        text = state.editingEntry.password;
      } else if (targetId === 'val-notes' && state.editingEntry) {
        text = state.editingEntry.notes || '';
      } else if (targetId === 'val-totp-code' && state.editingEntry) {
        // Copy TOTP without the spaces
        const formatted = document.getElementById(targetId).textContent;
        text = formatted.replace(/\s/g, '');
      } else {
        text = document.getElementById(targetId).textContent;
      }
      if (text && text !== '-') {
        copyToClipboard(text);
        showToast("Copied to clipboard!");
      }
    });
  });

  // Generator copies
  document.getElementById('btn-gen-copy').addEventListener('click', () => {
    const val = document.getElementById('gen-result').value;
    if (val && val !== 'Click Generate') {
      copyToClipboard(val);
      showToast("Generated password copied!");
    }
  });

  // Generator change listeners
  document.getElementById('gen-length').addEventListener('input', (e) => {
    document.getElementById('gen-length-val').textContent = e.target.value;
    generatePassword();
  });
  document.querySelectorAll('.generator-options input[type="checkbox"]').forEach(c => {
    c.addEventListener('change', generatePassword);
  });
  document.getElementById('btn-generate-trigger').addEventListener('click', generatePassword);

  // Form password inline generator
  document.getElementById('btn-generate-fill').addEventListener('click', () => {
    const len = 16;
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    const pool = upper + lower + numbers + symbols;
    let password = [
      upper[getRandomInt(upper.length)],
      lower[getRandomInt(lower.length)],
      numbers[getRandomInt(numbers.length)],
      symbols[getRandomInt(symbols.length)]
    ];

    for (let i = password.length; i < len; i++) {
      password.push(pool[getRandomInt(pool.length)]);
    }

    for (let i = password.length - 1; i > 0; i--) {
      const j = getRandomInt(i + 1);
      [password[i], password[j]] = [password[j], password[i]];
    }

    const generated = password.join('');
    const passInput = document.getElementById('form-password');
    passInput.value = generated;
    passInput.type = 'text';
    document.getElementById('btn-form-toggle-pass').innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    showToast("Generated password filled!");
  });

  // Settings Change Password Form submission
  document.getElementById('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('settings-current-pass').value;
    const newPassword = document.getElementById('settings-new-pass').value;
    const confirmPassword = document.getElementById('settings-confirm-pass').value;

    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "danger");
      return;
    }

    try {
      await apiCall('/api/settings/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      showToast("Master Password updated successfully!");
      document.getElementById('change-password-form').reset();
      await fetchEntries(); // Reload cache with new decryption key
    } catch (err) {}
  });

  // Settings Wipe Account Click
  document.getElementById('btn-wipe-account').addEventListener('click', async () => {
    const confirmation = prompt(`THIS ACTION CANNOT BE UNDONE!\nTo confirm, type your username "${state.username}":`);
    if (!confirmation || confirmation.trim().toLowerCase() !== state.username.toLowerCase()) {
      showToast("Account wipe cancelled.", "danger");
      return;
    }

    try {
      await apiCall('/api/settings/wipe', { method: 'POST' });
      showToast("Account deleted successfully.", "success");
      handleLogoutLocal();
    } catch (err) {}
  });

  // --- EXPORT VAULT ACTION ---
  document.getElementById('btn-export-vault').addEventListener('click', () => {
    try {
      if (state.entries.length === 0) {
        showToast("Vault is empty. Nothing to export.", "danger");
        return;
      }

      // Generate standard JSON file format
      const dataStr = JSON.stringify(state.entries, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `bitwarden_local_export_${state.username}.json`;
      document.body.appendChild(link);
      link.click();
      
      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Vault exported successfully!");
    } catch (e) {
      showToast("Failed to export vault data.", "danger");
    }
  });

  // --- IMPORT VAULT ACTIONS ---
  const importFileSelector = document.getElementById('import-file-selector');
  
  document.getElementById('btn-import-vault').addEventListener('click', () => {
    importFileSelector.click();
  });

  importFileSelector.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        
        let entriesArray = [];
        if (Array.isArray(importedData)) {
          entriesArray = importedData;
        } else if (importedData && Array.isArray(importedData.entries)) {
          // Compatibility with other exports
          entriesArray = importedData.entries;
        } else {
          throw new Error("Invalid format. File must contain a JSON array of credentials.");
        }

        let importedCount = 0;
        showToast("Importing entries, please wait...");
        
        for (const item of entriesArray) {
          if (item.service && item.username) {
            await apiCall('/api/entries', {
              method: 'POST',
              body: JSON.stringify({
                service: item.service,
                username: item.username,
                password: item.password || '',
                notes: item.notes || '',
                website: item.website || '',
                totp: item.totp || '',
                favorite: !!item.favorite,
                folder: item.folder || ''
              })
            });
            importedCount++;
          }
        }

        showToast(`Successfully imported ${importedCount} items!`);
        importFileSelector.value = ''; // Reset input
        await fetchEntries();
      } catch (err) {
        showToast(err.message || "Failed to import JSON data.", "danger");
        importFileSelector.value = '';
      }
    };
    reader.readAsText(file);
  });

  // Run App Initialization
  initApp();
});
