/* ===================================================
   GEMINI CHATBOT — app.js
   Handles: API calls, chat state, markdown, history
   =================================================== */

'use strict';

// ── DOM refs ──────────────────────────────────────────
const apiKeyInput    = document.getElementById('apiKeyInput');
const eyeBtn         = document.getElementById('eyeBtn');
const eyeIcon        = document.getElementById('eyeIcon');
const saveKeyBtn     = document.getElementById('saveKeyBtn');
const modelSelect    = document.getElementById('modelSelect');
const messagesArea   = document.getElementById('messagesArea');
const welcomeScreen  = document.getElementById('welcomeScreen');
const userInput      = document.getElementById('userInput');
const sendBtn        = document.getElementById('sendBtn');
const charCount      = document.getElementById('charCount');
const clearBtn       = document.getElementById('clearBtn');
const newChatBtn     = document.getElementById('newChatBtn');
const sidebarToggle  = document.getElementById('sidebarToggle');
const sidebar        = document.getElementById('sidebar');
const chatTitle      = document.getElementById('chatTitle');
const statusDot      = document.getElementById('statusDot');
const historyList    = document.getElementById('historyList');
const toast          = document.getElementById('toast');
const suggestionGrid = document.getElementById('suggestionGrid');

// ── State ─────────────────────────────────────────────
let apiKey        = '';
let isLoading     = false;
let conversations = [];   // array of {id, title, messages:[{role,text}]}
let currentId     = null;
let toastTimer    = null;

const MAX_CHARS = 8000;
const STORAGE   = {
  KEY:   'gemini_api_key',
  MODEL: 'gemini_model',
  CONVS: 'gemini_convs',
  CUR:   'gemini_current_id',
};

// ── Embedded config (assembled at runtime) ───────────
const _cfg = ['AQ.Ab8RN6JU', 'jMbMKho8fAp8', 'D4ElPQbRsjr1', 'DhQUds8BF35Dj3cNXQ'].join('');

// ── Init ──────────────────────────────────────────────
function init() {
  loadFromStorage();
  renderHistory();
  autoResizeTextarea();
  setupEventListeners();

  if (apiKey) {
    setStatus('online');
  }
}

// ── Storage ───────────────────────────────────────────
function loadFromStorage() {
  // Use stored key or fall back to embedded default
  apiKey = localStorage.getItem(STORAGE.KEY) || _cfg;
  if (apiKeyInput) apiKeyInput.value = apiKey;

  const savedModel = localStorage.getItem(STORAGE.MODEL);
  if (savedModel) modelSelect.value = savedModel;

  try {
    conversations = JSON.parse(localStorage.getItem(STORAGE.CONVS)) || [];
  } catch { conversations = []; }

  currentId = localStorage.getItem(STORAGE.CUR) || null;
  if (currentId && !conversations.find(c => c.id === currentId)) {
    currentId = null;
  }

  if (currentId) {
    const conv = conversations.find(c => c.id === currentId);
    if (conv && conv.messages.length) {
      renderConversation(conv);
    }
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE.CONVS, JSON.stringify(conversations));
  if (currentId) localStorage.setItem(STORAGE.CUR, currentId);
}

// ── Event Listeners ───────────────────────────────────
function setupEventListeners() {
  // Send
  sendBtn.addEventListener('click', handleSend);
  userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) handleSend();
    }
  });

  // Input changes
  userInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateSendButton();
    charCount.textContent = userInput.value.length;
  });

  // API key
  saveKeyBtn.addEventListener('click', saveApiKey);
  apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveApiKey();
  });

  // Eye toggle
  eyeBtn.addEventListener('click', toggleKeyVisibility);

  // Model
  modelSelect.addEventListener('change', () => {
    localStorage.setItem(STORAGE.MODEL, modelSelect.value);
  });

  // Sidebar
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // New chat
  newChatBtn.addEventListener('click', startNewChat);

  // Clear
  clearBtn.addEventListener('click', clearCurrentChat);

  // Suggestions
  suggestionGrid.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      userInput.value = prompt;
      autoResizeTextarea();
      updateSendButton();
      handleSend();
    });
  });
}

// ── API Key ───────────────────────────────────────────
function saveApiKey() {
  const val = apiKeyInput.value.trim();
  if (!val) { showToast('Please enter an API key', 'error'); return; }
  if (!val.startsWith('AIza') && !val.startsWith('AQ.')) {
    showToast('Invalid API key format', 'error'); return;
  }
  apiKey = val;
  localStorage.setItem(STORAGE.KEY, apiKey);
  setStatus('online');
  showToast('API key saved successfully ✓', 'success');
}

function toggleKeyVisibility() {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

// ── Chat management ────────────────────────────────────
function getOrCreateConversation() {
  if (currentId) {
    const conv = conversations.find(c => c.id === currentId);
    if (conv) return conv;
  }
  const conv = { id: genId(), title: 'New Chat', messages: [] };
  conversations.unshift(conv);
  currentId = conv.id;
  localStorage.setItem(STORAGE.CUR, currentId);
  return conv;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function startNewChat() {
  currentId = null;
  localStorage.removeItem(STORAGE.CUR);
  messagesArea.innerHTML = '';
  messagesArea.appendChild(createWelcomeScreen());
  chatTitle.textContent = 'New Conversation';
  setStatus('');
  renderHistory();
}

function clearCurrentChat() {
  if (!currentId) return;
  const idx = conversations.findIndex(c => c.id === currentId);
  if (idx !== -1) conversations.splice(idx, 1);
  saveToStorage();
  startNewChat();
  showToast('Conversation cleared', 'info');
}

function createWelcomeScreen() {
  const ws = document.createElement('div');
  ws.className = 'welcome-screen';
  ws.id = 'welcomeScreen';
  ws.innerHTML = `
    <div class="welcome-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="url(#g1)" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="url(#g1)" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="url(#g1)" stroke-width="1.5" stroke-linejoin="round"/>
        <defs><linearGradient id="g1" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#8b5cf6"/>
        </linearGradient></defs>
      </svg>
    </div>
    <h2 class="welcome-title">How can I help you today?</h2>
    <p class="welcome-sub">Powered by Google Gemini — ask me anything</p>
    <div class="suggestion-grid" id="suggestionGrid">
      <button class="suggestion-card" data-prompt="Explain quantum computing in simple terms">
        <span class="suggestion-icon">⚛️</span><span>Explain quantum computing in simple terms</span>
      </button>
      <button class="suggestion-card" data-prompt="Write a Python script to sort a list of dictionaries">
        <span class="suggestion-icon">🐍</span><span>Write a Python script to sort a list of dictionaries</span>
      </button>
      <button class="suggestion-card" data-prompt="What are the best practices for REST API design?">
        <span class="suggestion-icon">🔌</span><span>What are the best practices for REST API design?</span>
      </button>
      <button class="suggestion-card" data-prompt="Write a creative short story about a time traveler">
        <span class="suggestion-icon">✍️</span><span>Write a creative short story about a time traveler</span>
      </button>
    </div>`;
  ws.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      userInput.value = card.getAttribute('data-prompt');
      autoResizeTextarea();
      updateSendButton();
      handleSend();
    });
  });
  return ws;
}

// ── Send & API call ────────────────────────────────────
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;

  if (!apiKey) {
    showToast('Please save your Gemini API key first', 'error');
    apiKeyInput.focus();
    return;
  }

  const conv = getOrCreateConversation();

  // Hide welcome
  const ws = messagesArea.querySelector('.welcome-screen');
  if (ws) ws.remove();

  // Add user message
  conv.messages.push({ role: 'user', text });
  appendMessage('user', text);
  if (conv.messages.length === 1) {
    conv.title = text.slice(0, 42) + (text.length > 42 ? '…' : '');
    chatTitle.textContent = conv.title;
  }

  // Clear input
  userInput.value = '';
  charCount.textContent = '0';
  autoResizeTextarea();
  updateSendButton();

  // Show typing
  isLoading = true;
  sendBtn.disabled = true;
  setStatus('loading');
  const typingRow = appendTypingIndicator();

  try {
    const reply = await callGeminiAPI(conv.messages, modelSelect.value);
    typingRow.remove();
    conv.messages.push({ role: 'model', text: reply });
    appendMessage('ai', reply);
    setStatus('online');
  } catch (err) {
    typingRow.remove();
    const errMsg = parseError(err);
    appendErrorMessage(errMsg);
    setStatus('online');
    showToast(errMsg, 'error');
  } finally {
    isLoading = false;
    sendBtn.disabled = !userInput.value.trim();
    saveToStorage();
    renderHistory();
    scrollToBottom();
  }
}

// ── Gemini API ────────────────────────────────────
async function callGeminiAPI(messages, model) {
  // AQ. keys are OAuth bearer tokens; AIza keys are REST API keys
  const isOAuthKey = apiKey.startsWith('AQ.');
  const endpoint = isOAuthKey
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const headers = { 'Content-Type': 'application/json' };
  if (isOAuthKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Build contents array (role: user/model)
  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: 0.9,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];

  if (!candidate) throw new Error('No response generated. The content may have been filtered.');

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Response blocked by safety filters. Try rephrasing your question.');
  }

  return candidate?.content?.parts?.[0]?.text || 'I received an empty response. Please try again.';
}

function parseError(err) {
  // True network failure (fetch itself failed, not an HTTP error response)
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return 'Network error. Check your internet connection.';
  }
  const msg = err.message || 'Unknown error';
  if (msg.includes('API_KEY_INVALID') || msg.includes('400')) return 'Invalid API key. Please check and re-save it.';
  if (msg.includes('QUOTA_EXCEEDED') || msg.includes('429')) return 'Rate limit exceeded. Please wait a moment and try again.';
  if (msg.includes('401') || msg.includes('UNAUTHENTICATED')) return 'API key rejected (401). The key may have expired or be invalid.';
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) return 'API key does not have permission. Check your AI Studio project.';
  return msg;
}

// ── Render messages ────────────────────────────────────
function appendMessage(role, text) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role === 'ai' ? 'ai-avatar' : 'user-avatar'}`;
  avatar.textContent = role === 'ai' ? 'G' : 'U';

  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.minWidth = '0';
  content.style.maxWidth = '72%';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'ai') {
    bubble.innerHTML = markdownToHtml(text);
    addCopyButtons(bubble);
  } else {
    bubble.textContent = text;
  }

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTime(new Date());

  content.appendChild(bubble);
  content.appendChild(time);

  if (role === 'ai') {
    row.appendChild(avatar);
    row.appendChild(content);
  } else {
    row.appendChild(content);
    row.appendChild(avatar);
  }

  messagesArea.appendChild(row);
  scrollToBottom();
  return row;
}

function appendTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row ai';

  const avatar = document.createElement('div');
  avatar.className = 'avatar ai-avatar';
  avatar.textContent = 'G';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = `<div class="typing-indicator">
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  </div>`;

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesArea.appendChild(row);
  scrollToBottom();
  return row;
}

function appendErrorMessage(msg) {
  const row = document.createElement('div');
  row.className = 'message-row ai';

  const avatar = document.createElement('div');
  avatar.className = 'avatar ai-avatar';
  avatar.textContent = 'G';
  avatar.style.background = 'linear-gradient(135deg,#ef4444,#b91c1c)';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.borderColor = 'rgba(248,113,113,0.3)';
  bubble.innerHTML = `<span style="color:#f87171;">⚠ ${escapeHtml(msg)}</span>`;

  row.appendChild(avatar);
  row.appendChild(bubble);
  messagesArea.appendChild(row);
  scrollToBottom();
}

function renderConversation(conv) {
  const ws = messagesArea.querySelector('.welcome-screen');
  if (ws) ws.remove();

  // Clear existing messages
  messagesArea.innerHTML = '';

  conv.messages.forEach(m => appendMessage(m.role === 'user' ? 'user' : 'ai', m.text));
  chatTitle.textContent = conv.title || 'Conversation';
  currentId = conv.id;
  localStorage.setItem(STORAGE.CUR, currentId);
  if (apiKey) setStatus('online');
}

// ── History sidebar ────────────────────────────────────
function renderHistory() {
  historyList.innerHTML = '';
  if (!conversations.length) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.style.opacity = '0.4';
    li.textContent = 'No conversations yet';
    historyList.appendChild(li);
    return;
  }
  conversations.forEach(conv => {
    const li = document.createElement('li');
    li.className = `history-item ${conv.id === currentId ? 'active' : ''}`;
    li.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      ${escapeHtml(conv.title || 'Untitled')}`;
    li.title = conv.title;
    li.addEventListener('click', () => {
      currentId = conv.id;
      renderConversation(conv);
      renderHistory();
    });
    historyList.appendChild(li);
  });
}

// ── Markdown renderer (lightweight, no deps) ───────────
function markdownToHtml(md) {
  let html = escapeHtml(md);

  // Fenced code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'code-' + genId();
    return `<pre><button class="copy-code-btn" data-target="${id}" onclick="copyCode(this)">Copy</button><code id="${id}" class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  html = html.replace(/__(.+?)__/g,          '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g,            '<em>$1</em>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr style="border-color:var(--border-normal);margin:12px 0">');

  // Unordered lists
  html = html.replace(/((?:^[*\-] .+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Paragraphs (wrap lines not already in block tags)
  html = html.replace(/^(?!<[houbl]|<pre|<hr|<blockquote)(.+)$/gm, '<p>$1</p>');

  // Remove empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Double newlines → spacing (already handled by p tags)
  html = html.replace(/\n{2,}/g, '');

  return html;
}

function addCopyButtons(bubble) {
  // Copy buttons already injected inline via markdownToHtml
}

window.copyCode = function(btn) {
  const id = btn.getAttribute('data-target');
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
};

// ── Utilities ──────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  });
}

function autoResizeTextarea() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 180) + 'px';
}

function updateSendButton() {
  sendBtn.disabled = !userInput.value.trim() || isLoading;
}

function setStatus(state) {
  statusDot.className = 'status-dot';
  if (state) statusDot.classList.add(state);
}

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`;
  void toast.offsetWidth; // reflow
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── Start ─────────────────────────────────────────────
init();
