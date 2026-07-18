/* ===================== Cortex — AI Chat Studio =====================
   Vanilla JS, localStorage-backed, single AI provider (Mistral API) under the hood.
   ==================================================================== */

/* ---------------- CONFIG -----------------
   Paste a default API key below if you want every user of this deployment
   to skip entering their own key. Leave blank to require each person to
   add their own key in Settings. This never leaves the browser except in
   requests to the AI provider's API.
------------------------------------------- */
const CONFIG = {
  DEFAULT_API_KEY: 'mwTcUoGRfP4B2F0Qz5vr1s21PC9ZiRlq',            // <-- paste your API key here, e.g. 'abcd1234...'
  MODEL_TEXT: 'mistral-large-latest',
  MODEL_VISION: 'pixtral-12b-2409',
  // Paste your Spotify app's Client ID here (from developer.spotify.com/dashboard).
  // No client secret is needed — playback uses the PKCE flow, which is safe to run
  // fully client-side. You must also add the exact URL this page runs at (shown
  // in Settings once you fill this in) as a Redirect URI in that Spotify app.
  SPOTIFY_CLIENT_ID: '82e1fa8a8f034e15b0625a5e2b8abd19',
  // Paste a YouTube Data API v3 key here (free, from console.cloud.google.com —
  // enable "YouTube Data API v3" then create an API key, no OAuth needed since
  // this only searches, it never touches anyone's account). Leave blank and
  // people can still set their own key in Settings. Without any key, "play
  // <video> on youtube" falls back to just opening a YouTube search results
  // page instead of jumping straight to a specific video.
  YOUTUBE_API_KEY: '',
  // Address of the Maximus Desktop Agent — a small local Python program (see
  // maximus_agent.py) that must be running on THIS computer for any real
  // desktop-control commands to work (opening apps, file explorer, task
  // manager, settings, battery %, "go to desktop", creating files, etc).
  // A browser page can never do these things by itself for security reasons —
  // the agent is what actually talks to the operating system.
  AGENT_URL: 'http://127.0.0.1:5055'
};

// Where Spotify sends the user back to after login — always this exact page.
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;

const STORE_KEY = 'cortex_state_v2';

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function defaultState(){
  return {
    user: { name: '', avatarInit: 'U', email: '' },
    settings: { apiKey: CONFIG.DEFAULT_API_KEY || '', youtubeApiKey: CONFIG.YOUTUBE_API_KEY || '', model: CONFIG.MODEL_TEXT, theme: 'dark', voiceLang: 'en-IN' },
    accounts: [],     // {email, password, name} — demo-grade local "database"
    session: null,    // {email} of currently logged in account
    memory: [],       // facts Cortex remembers about the user across sessions
    projects: [],     // {id, name, createdAt, expanded}
    chats: [],        // {id, title, messages:[], projectId, favorite, createdAt, updatedAt}
    contacts: [],     // {id, name, phone} — used for "message <name> on whatsapp" voice commands
    spotify: { accessToken: null, refreshToken: null, expiresAt: 0, deviceId: null },
    activeChatId: null,
    loggedIn: false
  };
}

let state = load();

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const merged = Object.assign(defaultState(), parsed);
    merged.settings = Object.assign(defaultState().settings, parsed.settings || {});
    return merged;
  }catch(e){
    console.warn('Local storage unavailable or corrupted, using in-memory state.', e);
    return defaultState();
  }
}

function save(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }catch(e){
    console.warn('Could not persist to local storage (private browsing / storage disabled). Session will not survive a reload.', e);
    showToast('Could not save to local storage — your session may not persist after reload.');
  }
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function showToast(msg){
  const root = document.getElementById('toastRoot');
  root.innerHTML = `<div class="toast">${escapeHtml(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ root.innerHTML = ''; }, 3200);
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

/* ================= THEME ================= */
function applyTheme(){
  const theme = state.settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if(btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}
applyTheme();

/* ================= AUTH (LOGIN / REGISTER) ================= */
const authScreen = document.getElementById('authScreen');
const mainApp = document.getElementById('mainApp');

function initAuthGate(){
  if(state.loggedIn && state.session && state.session.email){
    enterApp();
    return;
  }
  authScreen.classList.remove('hidden');
  mainApp.classList.add('hidden');
}

/* ---- tab switching ---- */
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

tabLogin.addEventListener('click', ()=>{
  tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden'); registerForm.classList.add('hidden');
});
tabRegister.addEventListener('click', ()=>{
  tabRegister.classList.add('active'); tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden'); loginForm.classList.add('hidden');
});

function findAccount(email){
  const e = (email||'').trim().toLowerCase();
  return state.accounts.find(a=>a.email.toLowerCase()===e);
}

loginForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if(!email || !password){ errEl.textContent = 'Enter your email and password.'; return; }
  const acc = findAccount(email);
  if(!acc || acc.password !== password){
    errEl.textContent = 'Incorrect email or password.';
    return;
  }
  state.session = { email: acc.email };
  state.user.name = acc.name || acc.email.split('@')[0];
  state.user.email = acc.email;
  state.user.avatarInit = (state.user.name[0] || 'U').toUpperCase();
  state.loggedIn = true;
  save();
  enterApp();
});

registerForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const password2 = document.getElementById('registerPassword2').value;
  if(!email || !password){ errEl.textContent = 'Enter an email and password.'; return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ errEl.textContent = 'Enter a valid email address.'; return; }
  if(password.length < 4){ errEl.textContent = 'Password must be at least 4 characters.'; return; }
  if(password !== password2){ errEl.textContent = 'Passwords do not match.'; return; }
  if(findAccount(email)){ errEl.textContent = 'An account with that email already exists — log in instead.'; return; }

  const account = { email, password, name: email.split('@')[0] };
  state.accounts.push(account);
  state.session = { email: account.email };
  state.user.name = account.name;
  state.user.email = account.email;
  state.user.avatarInit = account.name[0].toUpperCase();
  state.loggedIn = true;
  save();
  enterApp();
});

function enterApp(){
  authScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');
  applyTheme();
  if(state.chats.length === 0){
    createChat();
  } else if(!state.activeChatId){
    state.activeChatId = state.chats[state.chats.length-1].id;
  }
  renderAll();
}

function logOut(){
  state.loggedIn = false;
  state.session = null;
  save();
  location.reload();
}

/* ================= CHAT / PROJECT DATA HELPERS ================= */
function createChat(projectId=null){
  const chat = {
    id: uid(), title: 'New chat', messages: [], projectId, favorite: false,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  state.chats.push(chat);
  state.activeChatId = chat.id;
  save();
  return chat;
}

function getChat(id){ return state.chats.find(c=>c.id===id); }
function getActiveChat(){ return getChat(state.activeChatId); }

function deleteChat(id){
  state.chats = state.chats.filter(c=>c.id!==id);
  if(state.activeChatId === id){
    state.activeChatId = state.chats.length ? state.chats[state.chats.length-1].id : null;
    if(!state.activeChatId){ createChat(); }
  }
  save();
  renderAll();
}

function renameChat(id, title){
  const c = getChat(id);
  if(!c) return;
  c.title = title.trim() || 'Untitled chat';
  c.updatedAt = Date.now();
  save();
  renderAll();
}

function toggleFavorite(id){
  const c = getChat(id);
  if(!c) return;
  c.favorite = !c.favorite;
  save();
  renderAll();
}

function moveChatToProject(chatId, projectId){
  const c = getChat(chatId);
  if(!c) return;
  c.projectId = projectId;
  save();
  renderAll();
}

function createProject(name){
  const p = { id: uid(), name: name.trim() || 'Untitled project', createdAt: Date.now(), expanded: true };
  state.projects.push(p);
  save();
  renderAll();
  return p;
}

function deleteProject(id){
  state.projects = state.projects.filter(p=>p.id!==id);
  state.chats.forEach(c=>{ if(c.projectId===id) c.projectId=null; });
  save();
  renderAll();
}

function renameProject(id, name){
  const p = state.projects.find(p=>p.id===id);
  if(!p) return;
  p.name = name.trim() || 'Untitled project';
  save();
  renderAll();
}

/* ================= SIDEBAR RENDERING ================= */
const searchInput = document.getElementById('searchInput');
let searchTerm = '';
searchInput.addEventListener('input', ()=>{ searchTerm = searchInput.value.trim().toLowerCase(); renderSidebar(); });

function matchesSearch(chat){
  if(!searchTerm) return true;
  return chat.title.toLowerCase().includes(searchTerm);
}

function chatItemHtml(chat){
  const active = chat.id === state.activeChatId ? 'active' : '';
  const star = chat.favorite ? '<span class="star">★</span>' : '';
  return `<div class="chat-item ${active}" data-chat-id="${chat.id}">
    <span class="ctitle">${escapeHtml(chat.title)}</span>
    ${star}
    <span class="menu-btn" data-menu-chat="${chat.id}">⋯</span>
  </div>`;
}

function renderSidebar(){
  // Projects
  const projectsList = document.getElementById('projectsList');
  projectsList.innerHTML = state.projects.map(p=>{
    const chats = state.chats.filter(c=>c.projectId===p.id && matchesSearch(c));
    if(searchTerm && chats.length===0) return '';
    const chevClass = p.expanded ? 'open' : '';
    const chatsHtml = p.expanded ? `<div class="project-chats">${chats.map(chatItemHtml).join('') || '<div style="padding:6px 10px;font-size:12px;color:var(--text-faint)">No chats yet</div>'}</div>` : '';
    return `<div class="project-block">
      <div class="project-row" data-project-id="${p.id}">
        <span class="chev ${chevClass}">▶</span>
        <span class="pdot"></span>
        <span class="pname">${escapeHtml(p.name)}</span>
        <span class="menu-btn" data-menu-project="${p.id}" style="opacity:.6">⋯</span>
      </div>
      ${chatsHtml}
    </div>`;
  }).join('');

  // Favorites
  const favList = document.getElementById('favoritesList');
  const favs = state.chats.filter(c=>c.favorite && matchesSearch(c)).sort((a,b)=>b.updatedAt-a.updatedAt);
  document.getElementById('favoritesSection').style.display = favs.length ? '' : 'none';
  favList.innerHTML = favs.map(chatItemHtml).join('');

  // All chats (unassigned to a project)
  const allList = document.getElementById('allChatsList');
  const unassigned = state.chats.filter(c=>!c.projectId && matchesSearch(c)).sort((a,b)=>b.updatedAt-a.updatedAt);
  allList.innerHTML = unassigned.map(chatItemHtml).join('') || '<div style="padding:8px 10px;font-size:12.5px;color:var(--text-faint)">No chats here yet</div>';

  // User footer
  document.getElementById('userAvatar').textContent = state.user.avatarInit || 'U';
  document.getElementById('userName').textContent = state.user.name || 'User';
  document.getElementById('userKeyStatus').textContent = state.settings.apiKey ? (state.user.email || 'API key set') : 'No API key set';

  attachSidebarHandlers();
}

function attachSidebarHandlers(){
  document.querySelectorAll('.chat-item').forEach(el=>{
    el.addEventListener('click', (e)=>{
      if(e.target.closest('.menu-btn')) return;
      state.activeChatId = el.dataset.chatId;
      save();
      renderAll();
    });
  });
  document.querySelectorAll('[data-menu-chat]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      openChatMenu(el.dataset.menuChat, e.clientX, e.clientY);
    });
  });
  document.querySelectorAll('.project-row').forEach(el=>{
    el.addEventListener('click', (e)=>{
      if(e.target.closest('.menu-btn')) return;
      const p = state.projects.find(p=>p.id===el.dataset.projectId);
      p.expanded = !p.expanded;
      save();
      renderSidebar();
    });
  });
  document.querySelectorAll('[data-menu-project]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      openProjectMenu(el.dataset.menuProject, e.clientX, e.clientY);
    });
  });
}

/* ---------------- Context menus ---------------- */
function closeCtxMenu(){
  document.getElementById('modalRoot').querySelectorAll('.ctx-menu').forEach(m=>m.remove());
}
document.addEventListener('click', closeCtxMenu);

function openChatMenu(chatId, x, y){
  closeCtxMenu();
  const chat = getChat(chatId);
  const projectOptions = state.projects.map(p=>
    `<button data-action="move" data-project="${p.id}">📁 ${escapeHtml(p.name)}</button>`
  ).join('');
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = Math.min(x, window.innerWidth-200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight-260) + 'px';
  menu.innerHTML = `
    <button data-action="rename">✏️ Rename</button>
    <button data-action="favorite">${chat.favorite ? '☆ Remove favorite' : '★ Add to favorites'}</button>
    <div class="submenu-label">Move to project</div>
    ${projectOptions || '<div style="padding:4px 10px;font-size:12px;color:var(--text-faint)">No projects yet</div>'}
    <button data-action="new-project-move">＋ New project...</button>
    ${chat.projectId ? '<button data-action="unassign">Remove from project</button>' : ''}
    <hr>
    <button data-action="delete" class="danger">🗑 Delete chat</button>
  `;
  document.getElementById('modalRoot').appendChild(menu);
  menu.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if(action === 'rename') startInlineRename(chatId);
    else if(action === 'favorite') toggleFavorite(chatId);
    else if(action === 'move') moveChatToProject(chatId, btn.dataset.project);
    else if(action === 'unassign') moveChatToProject(chatId, null);
    else if(action === 'new-project-move') openModal('newProjectForMove', {chatId});
    else if(action === 'delete') openModal('confirmDeleteChat', {chatId});
    closeCtxMenu();
  });
}

function openProjectMenu(projectId, x, y){
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = Math.min(x, window.innerWidth-200) + 'px';
  menu.style.top = Math.min(y, window.innerHeight-140) + 'px';
  menu.innerHTML = `
    <button data-action="rename-project">✏️ Rename project</button>
    <hr>
    <button data-action="delete-project" class="danger">🗑 Delete project</button>
  `;
  document.getElementById('modalRoot').appendChild(menu);
  menu.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    e.stopPropagation();
    if(btn.dataset.action === 'rename-project') openModal('renameProject', {projectId});
    else if(btn.dataset.action === 'delete-project') openModal('confirmDeleteProject', {projectId});
    closeCtxMenu();
  });
}

function startInlineRename(chatId){
  const el = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
  if(!el) return;
  const chat = getChat(chatId);
  el.innerHTML = `<input class="rename-input" value="${escapeHtml(chat.title)}">`;
  const input = el.querySelector('input');
  input.focus();
  input.select();
  const commit = ()=> renameChat(chatId, input.value);
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter') commit();
    if(e.key==='Escape') renderSidebar();
  });
  input.addEventListener('blur', commit);
}

/* ---------------- Modals ---------------- */
function openModal(type, ctx={}){
  const root = document.getElementById('modalRoot');
  let inner = '';
  if(type === 'newProject' || type === 'newProjectForMove'){
    inner = `<h3>New project</h3>
      <input id="modalInput" type="text" placeholder="Project name" autofocus>
      <div class="modal-actions">
        <button class="cancel" data-close>Cancel</button>
        <button class="confirm" id="modalConfirm">Create</button>
      </div>`;
  } else if(type === 'renameProject'){
    const p = state.projects.find(p=>p.id===ctx.projectId);
    inner = `<h3>Rename project</h3>
      <input id="modalInput" type="text" value="${escapeHtml(p.name)}" autofocus>
      <div class="modal-actions">
        <button class="cancel" data-close>Cancel</button>
        <button class="confirm" id="modalConfirm">Save</button>
      </div>`;
  } else if(type === 'confirmDeleteChat'){
    inner = `<h3>Delete this chat?</h3>
      <p style="color:var(--text-muted);font-size:13.5px;margin-bottom:18px;">This can't be undone. The conversation will be permanently removed.</p>
      <div class="modal-actions">
        <button class="cancel" data-close>Cancel</button>
        <button class="confirm danger" id="modalConfirm">Delete</button>
      </div>`;
  } else if(type === 'confirmDeleteProject'){
    inner = `<h3>Delete this project?</h3>
      <p style="color:var(--text-muted);font-size:13.5px;margin-bottom:18px;">Chats inside will move back to your main chat list — they won't be deleted.</p>
      <div class="modal-actions">
        <button class="cancel" data-close>Cancel</button>
        <button class="confirm danger" id="modalConfirm">Delete project</button>
      </div>`;
  } else if(type === 'settings'){
    inner = `<h3>Settings</h3>
      <label class="modal-label">Your name</label>
      <input id="modalInputName" type="text" value="${escapeHtml(state.user.name)}" placeholder="Your name">
      <label class="modal-label">AI provider API key</label>
      <input id="modalInputKey" type="password" value="${escapeHtml(state.settings.apiKey)}" placeholder="Paste your API key">
      <div class="field-hint" style="margin-bottom:16px;">You can also set a default key directly in app.js (CONFIG.DEFAULT_API_KEY) so people never have to paste one.</div>
      <label class="modal-label">Spotify</label>
      <div style="margin-bottom:16px;">
        ${!CONFIG.SPOTIFY_CLIENT_ID ? `
          <div class="field-hint">Paste a Client ID into CONFIG.SPOTIFY_CLIENT_ID in app.js first, then add this exact URL as a Redirect URI in your Spotify app's dashboard settings:<br><code>${escapeHtml(SPOTIFY_REDIRECT_URI)}</code></div>
        ` : (state.spotify && state.spotify.accessToken) ? `
          <div class="field-hint" style="margin-bottom:8px;">✅ Connected — try "play &lt;song&gt; on spotify", or use the pause/loop buttons that appear once a song is playing.</div>
          <div class="field-hint" style="margin-bottom:8px;">Note: while a song is playing, Maximus skips its own extra microphone stream (used only for the wave animation) so there's one less thing making Chrome duck (auto-quiet) the music. Chrome's built-in speech recognition still opens its own mic internally though, which the app can't reconfigure — so brief quieting while it's actively listening is a Chrome platform behavior, not a bug here. Wired headphones and a quieter room help it hear you clearly without needing much of that processing.</div>
          <button class="cancel" id="spotifyDisconnectBtn" type="button">Disconnect Spotify</button>
        ` : `
          <div class="field-hint" style="margin-bottom:8px;">Requires Spotify Premium for playback. Redirect URI registered in your Spotify app must exactly match:<br><code>${escapeHtml(SPOTIFY_REDIRECT_URI)}</code></div>
          <button class="confirm" id="spotifyConnectBtn" type="button">🎵 Connect Spotify</button>
        `}
      </div>
      <label class="modal-label">YouTube</label>
      <input id="modalInputYoutubeKey" type="password" value="${escapeHtml(state.settings.youtubeApiKey || '')}" placeholder="Paste a YouTube Data API v3 key">
      <div class="field-hint" style="margin-bottom:16px;">Free from console.cloud.google.com — enable "YouTube Data API v3" then create an API key. With a key set, "play &lt;video&gt; on youtube" jumps straight to the matching video and starts it. Without one, it just opens a YouTube search page instead.</div>
      <label class="modal-label">Voice recognition accent</label>
      <select id="modalInputVoiceLang">
        <option value="en-IN"${(state.settings.voiceLang||'en-IN')==='en-IN'?' selected':''}>English (India)</option>
        <option value="en-US"${state.settings.voiceLang==='en-US'?' selected':''}>English (US)</option>
        <option value="en-GB"${state.settings.voiceLang==='en-GB'?' selected':''}>English (UK)</option>
        <option value="en-AU"${state.settings.voiceLang==='en-AU'?' selected':''}>English (Australia)</option>
        <option value="hi-IN"${state.settings.voiceLang==='hi-IN'?' selected':''}>Hindi (India)</option>
      </select>
      <div class="field-hint" style="margin-bottom:16px;">If Maximus keeps mishearing you, try matching this to your accent. For best accuracy: use a headset mic rather than laptop/phone speakers-and-mic, keep background noise (TV, music, fans) low, and speak at a normal pace in short, complete phrases rather than trailing off — the mic works best when it can hear a clear start and a clear pause at the end of what you say.</div>
      <label class="modal-label">What Maximus remembers about you</label>
      <textarea id="modalInputMemory" rows="4" placeholder="One fact per line, e.g. &quot;Prefers concise answers.&quot;">${escapeHtml((state.memory||[]).join('\n'))}</textarea>
      <div class="modal-actions">
        <button class="cancel danger" id="modalLogout" style="margin-right:auto;">Log out</button>
        <button class="cancel" data-close>Cancel</button>
        <button class="confirm" id="modalConfirm">Save</button>
      </div>
      <div class="modal-footer-link"><button id="modalDeleteAll" type="button">Delete all data on this device</button></div>`;
  } else if(type === 'contacts'){
    inner = `<h3>WhatsApp contacts</h3>
      <p class="field-hint" style="margin-bottom:10px;">Save people here, then just say "message &lt;name&gt; saying ...&quot; and Maximus will open WhatsApp with the chat and message ready to send.</p>
      <div id="contactsList"></div>
      <div class="add-contact-title">Add a contact</div>
      <div class="contact-add-row">
        <input id="contactNameInput" type="text" placeholder="Name (e.g. Friend 1)">
      </div>
      <div class="contact-add-row">
        <div class="phone-input-group">
          <span class="phone-prefix">🇮🇳 +91</span>
          <input id="contactPhoneInput" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number">
        </div>
        <button class="confirm" id="contactAddBtn" type="button">＋ Add contact</button>
      </div>
      <div class="modal-actions">
        <button class="cancel" data-close>Close</button>
      </div>`;
  }
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${inner}</div></div>`;
  const backdrop = document.getElementById('modalBackdrop');
  backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) root.innerHTML=''; });
  root.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', ()=> root.innerHTML=''));
  const input = document.getElementById('modalInput');
  if(input){ setTimeout(()=>input.focus(), 30); input.addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('modalConfirm').click(); }); }

  const confirmBtn = document.getElementById('modalConfirm');
  if(confirmBtn){
    confirmBtn.addEventListener('click', ()=>{
      if(type === 'newProject'){
        createProject(document.getElementById('modalInput').value);
      } else if(type === 'newProjectForMove'){
        const p = createProject(document.getElementById('modalInput').value);
        moveChatToProject(ctx.chatId, p.id);
      } else if(type === 'renameProject'){
        renameProject(ctx.projectId, document.getElementById('modalInput').value);
      } else if(type === 'confirmDeleteChat'){
        deleteChat(ctx.chatId);
      } else if(type === 'confirmDeleteProject'){
        deleteProject(ctx.projectId);
      } else if(type === 'settings'){
        state.user.name = document.getElementById('modalInputName').value.trim() || 'User';
        state.user.avatarInit = state.user.name[0].toUpperCase();
        state.settings.apiKey = document.getElementById('modalInputKey').value.trim();
        state.settings.youtubeApiKey = document.getElementById('modalInputYoutubeKey').value.trim();
        const newVoiceLang = document.getElementById('modalInputVoiceLang').value || 'en-IN';
        const voiceLangChanged = newVoiceLang !== state.settings.voiceLang;
        state.settings.voiceLang = newVoiceLang;
        state.memory = document.getElementById('modalInputMemory').value
          .split('\n').map(s=>s.trim()).filter(Boolean);
        save();
        renderSidebar();
        if(voiceLangChanged) applyVoiceLang();
      }
      root.innerHTML = '';
    });
  }
  if(type === 'contacts'){
    renderContactsList();
    const addBtn = document.getElementById('contactAddBtn');
    addBtn.addEventListener('click', ()=>{
      const name = document.getElementById('contactNameInput').value.trim();
      let phoneDigits = document.getElementById('contactPhoneInput').value.replace(/\D/g, '');
      if(!name){ showToast('Add a name for this contact.'); return; }
      if(phoneDigits.length !== 10){ showToast('Enter a valid 10-digit mobile number.'); return; }
      const phone = '91' + phoneDigits;
      state.contacts = state.contacts || [];
      state.contacts.push({ id: uid(), name, phone });
      save();
      document.getElementById('contactNameInput').value = '';
      document.getElementById('contactPhoneInput').value = '';
      renderContactsList();
      showToast(`${name} added — say "message ${name} saying ..." any time.`);
    });
  }

  const spotifyConnectBtn = document.getElementById('spotifyConnectBtn');
  if(spotifyConnectBtn) spotifyConnectBtn.addEventListener('click', spotifyLogin);
  const spotifyDisconnectBtn = document.getElementById('spotifyDisconnectBtn');
  if(spotifyDisconnectBtn){
    spotifyDisconnectBtn.addEventListener('click', ()=>{
      if(spotifyPlayer){ spotifyPlayer.disconnect(); spotifyPlayer = null; }
      state.spotify = { accessToken: null, refreshToken: null, expiresAt: 0, deviceId: null };
      save();
      showToast('Spotify disconnected.');
      root.innerHTML = '';
      openModal('settings');
    });
  }

  const logoutBtn = document.getElementById('modalLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', logOut);

  const deleteAllBtn = document.getElementById('modalDeleteAll');
  if(deleteAllBtn){
    deleteAllBtn.addEventListener('click', ()=>{
      if(confirm('This clears all accounts, chats, projects and settings from this browser. Continue?')){
        localStorage.removeItem(STORE_KEY);
        location.reload();
      }
    });
  }
}

document.getElementById('addProjectBtn').addEventListener('click', ()=> openModal('newProject'));
document.getElementById('settingsBtn').addEventListener('click', ()=> openModal('settings'));
document.getElementById('themeToggleBtn').addEventListener('click', ()=>{
  state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
  applyTheme();
  save();
});

/* ================= CHAT MAIN RENDERING ================= */
const messagesInner = document.getElementById('messagesInner');
const messagesWrap = document.getElementById('messagesWrap');
const chatTitleInput = document.getElementById('chatTitleInput');

let codeBlockCounter = 0;

function renderMarkdown(text){
  const escaped = escapeHtml(text || '');
  const codeBlocks = [];
  let working = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code)=>{
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: (lang||'').toLowerCase(), code: code.replace(/\n$/,'') });
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  const lines = working.split('\n');
  let html = '';
  let listType = null;
  function closeList(){ if(listType){ html += listType==='ul' ? '</ul>' : '</ol>'; listType = null; } }

  lines.forEach(line=>{
    if(/^\u0000CODEBLOCK\d+\u0000$/.test(line.trim())){
      closeList();
      html += line.trim();
      return;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+\.\s+(.*)/);
    if(h){
      closeList();
      const tag = `h${Math.min(h[1].length + 2, 6)}`;
      html += `<${tag} class="md-heading">${inlineMd(h[2])}</${tag}>`;
    } else if(ul){
      if(listType!=='ul'){ closeList(); html += '<ul>'; listType='ul'; }
      html += `<li>${inlineMd(ul[1])}</li>`;
    } else if(ol){
      if(listType!=='ol'){ closeList(); html += '<ol>'; listType='ol'; }
      html += `<li>${inlineMd(ol[1])}</li>`;
    } else if(line.trim()===''){
      closeList();
      html += '<br>';
    } else {
      closeList();
      html += inlineMd(line) + '<br>';
    }
  });
  closeList();

  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, idx)=>{
    const { lang, code } = codeBlocks[Number(idx)];
    codeBlockCounter++;
    const langLabel = lang || 'text';
    const langClass = lang ? ` language-${lang}` : '';
    return `<div class="code-block-wrap"><div class="code-block-head"><span>${escapeHtml(langLabel)}</span><button class="copy-code-btn" data-code-copy>Copy</button></div><pre><code class="hljs${langClass}">${code}</code></pre></div>`;
  });

  return html;
}

function inlineMd(str){
  return str
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function stripMarkdownForPdf(text){
  return (text||'')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '');
}

function attachmentHtml(att){
  if(att.type === 'image'){
    return `<img class="attach-img-thumb" src="${att.dataUrl}" alt="${escapeHtml(att.name)}">`;
  }
  const icon = att.type === 'video' ? '🎬' : '📄';
  return `<span class="attach-chip">${icon} ${escapeHtml(att.name)}</span>`;
}

function bubbleInnerHtml(m){
  const atts = (m.attachments && m.attachments.length)
    ? `<div class="msg-attachments">${m.attachments.map(attachmentHtml).join('')}</div>` : '';
  const body = (m.pending && !m.content)
    ? `<div class="typing-dots"><span></span><span></span><span></span></div>`
    : renderMarkdown(m.content || '');
  const isCompleteAssistantMsg = !m.pending && m.role === 'assistant' && m.content;
  const readActions = isCompleteAssistantMsg
    ? `<div class="msg-actions msg-actions-top"><button class="msg-action-btn" data-read-aloud="${m.id}">🔊 Read aloud</button></div>`
    : '';
  const actions = isCompleteAssistantMsg
    ? `<div class="msg-actions"><button class="msg-action-btn" data-pdf-export="${m.id}">⬇ Export as PDF</button></div>`
    : '';
  return atts + readActions + body + actions;
}

function wireMessageInteractive(container){
  if(window.hljs){
    container.querySelectorAll('pre code').forEach(block=>{
      try{ hljs.highlightElement(block); }catch(e){ /* ignore */ }
    });
  }
  container.querySelectorAll('[data-pdf-export]').forEach(btn=>{
    btn.onclick = ()=>{
      const c = getActiveChat();
      const msg = c && c.messages.find(mm=>mm.id===btn.dataset.pdfExport);
      if(msg) exportMessageAsPdf(stripMarkdownForPdf(msg.content), c.title);
    };
  });
  container.querySelectorAll('[data-read-aloud]').forEach(btn=>{
    btn.onclick = ()=>{
      const c = getActiveChat();
      const msg = c && c.messages.find(mm=>mm.id===btn.dataset.readAloud);
      if(msg) readMessageAloud(msg.id, msg.content);
    };
  });
  container.querySelectorAll('[data-code-copy]').forEach(btn=>{
    btn.onclick = ()=>{
      const codeEl = btn.closest('.code-block-wrap').querySelector('code');
      const codeText = codeEl ? codeEl.innerText : '';
      navigator.clipboard.writeText(codeText).then(()=>{
        btn.textContent = 'Copied!';
        setTimeout(()=>{ btn.textContent = 'Copy'; }, 1500);
      }).catch(()=> showToast('Could not copy — clipboard access denied.'));
    };
  });
  syncReadButtons(container);
}

function updateMessageDom(msgId){
  const bubble = messagesInner.querySelector(`.msg-bubble[data-msg-id="${msgId}"]`);
  if(!bubble) return;
  const chat = getActiveChat();
  const m = chat && chat.messages.find(mm=>mm.id===msgId);
  if(!m) return;
  bubble.innerHTML = bubbleInnerHtml(m);
  wireMessageInteractive(bubble);
  messagesWrap.scrollTop = messagesWrap.scrollHeight;
}

function renderMessages(){
  const chat = getActiveChat();
  chatTitleInput.value = chat ? chat.title : '';
  chatTitleInput.disabled = !chat;

  if(!chat || chat.messages.length===0){
    messagesInner.innerHTML = `<div class="empty-state" id="emptyState">
      <div class="mark">C</div>
      <h2>Start a new conversation</h2>
      <p>Ask a question, paste some text, upload a PDF, Word, Excel or PowerPoint file, or tap the mic to speak. Your chats, projects and favorites are all saved locally in this browser.</p>
    </div>`;
    return;
  }

  messagesInner.innerHTML = chat.messages.map(m=>{
    const isUser = m.role === 'user';
    const avatar = isUser ? (state.user.avatarInit||'U') : 'C';
    return `<div class="msg-row ${isUser?'user':'assistant'}">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-bubble" data-msg-id="${m.id}">${bubbleInnerHtml(m)}</div>
    </div>`;
  }).join('');
  messagesWrap.scrollTop = messagesWrap.scrollHeight;
  wireMessageInteractive(messagesInner);
}

chatTitleInput.addEventListener('change', ()=>{
  const chat = getActiveChat();
  if(chat) renameChat(chat.id, chatTitleInput.value);
});

document.getElementById('newChatBtn').addEventListener('click', ()=>{
  createChat();
  renderAll();
});

function renderAll(){
  renderSidebar();
  renderMessages();
}

/* ================= PDF EXPORT (answers -> downloadable PDF) ================= */
function exportMessageAsPdf(text, chatTitle){
  if(!window.jspdf){ showToast('PDF export library failed to load — check your connection.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 44;
  const maxWidth = 507;
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text || '(No content)', maxWidth);
  let y = margin;
  lines.forEach(line=>{
    if(y > pageHeight - margin){ doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += 15;
  });
  const safeName = (chatTitle || 'maximus-answer').replace(/[^a-z0-9\-_ ]/gi, '').trim().slice(0,50) || 'maximus-answer';
  doc.save(`${safeName}.pdf`);
}

/* ================= MEMORY (remembers user facts across sessions) ================= */
function extractMemoryFacts(text){
  if(!text) return [];
  const patterns = [
    { re:/\bmy name is ([a-z][a-z '.-]{1,30})/i, fmt:m=>`User's name is ${m[1].trim()}.` },
    { re:/\bcall me ([a-z][a-z '.-]{1,30})/i, fmt:m=>`User prefers to be called ${m[1].trim()}.` },
    { re:/\bi (?:live in|am from) ([a-z][a-z ,.-]{1,40})/i, fmt:m=>`User is located in ${m[1].trim()}.` },
    { re:/\bi work as (?:an?|the)? ?([a-z][a-z ,.-]{1,40})/i, fmt:m=>`User works as ${m[1].trim()}.` },
    { re:/\bi(?:'m| am) (?:a|an) ([a-z][a-z ,.-]{1,40})/i, fmt:m=>`User is ${m[1].trim()}.` },
    { re:/\bi (?:like|love|enjoy) ([a-z0-9][a-z0-9 ,'.-]{1,50})/i, fmt:m=>`User likes ${m[1].trim()}.` },
    { re:/\bi (?:use|code in|work in|prefer|write)\s+(python|javascript|typescript|java(?!script)|c\+\+|c#|golang|go|rust|php|ruby|swift|kotlin|html|css|sql|react|vue|angular|node(?:\.js)?|django|flask|next\.js)\b/i,
      fmt:m=>`User codes primarily in ${m[1].trim()}.` },
    { re:/\b(?:keep (?:it|your answers?) (?:short|brief|concise)|be more concise|shorter answers?)\b/i,
      fmt:()=>`User prefers short, concise answers.` },
    { re:/\b(?:explain in detail|be more detailed|give detailed explanations|longer explanations?)\b/i,
      fmt:()=>`User prefers detailed, thorough explanations.` },
    { re:/\b(?:add comments|comment (?:your|the) code|explain the code (?:line by line|step by step))\b/i,
      fmt:()=>`User likes code answers with explanatory comments.` },
    { re:/\b(?:no comments|don'?t comment|skip the comments|without comments)\b/i,
      fmt:()=>`User prefers code without extra comments.` },
    { re:/\bremember that (.{4,140})/i, fmt:m=>{ const s=m[1].trim(); return s.endsWith('.')?s:s+'.'; } },
    { re:/\bplease remember ([^.?!]{4,140})/i, fmt:m=>{ const s=m[1].trim(); return s.endsWith('.')?s:s+'.'; } }
  ];
  const found = [];
  patterns.forEach(p=>{
    const m = text.match(p.re);
    if(m) found.push(p.fmt(m));
  });
  return found;
}

function rememberFromMessage(text){
  const facts = extractMemoryFacts(text);
  if(!facts.length) return;
  state.memory = state.memory || [];
  facts.forEach(f=>{
    if(!state.memory.some(existing=>existing.toLowerCase()===f.toLowerCase())){
      state.memory.push(f);
    }
  });
  if(state.memory.length > 40) state.memory = state.memory.slice(-40);
}

/* ================= FILE ATTACHMENTS ================= */
let pendingAttachments = [];
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const pendingAttachmentsEl = document.getElementById('pendingAttachments');

attachBtn.addEventListener('click', ()=> fileInput.click());

fileInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files);
  for(const file of files){
    await handleFile(file);
    renderPendingAttachments();
  }
  fileInput.value = '';
  renderPendingAttachments();
});

function pushTextAttachment(name, content){
  let c = content || '';
  if(c.length > 16000) c = c.slice(0,16000) + '\n...[truncated]';
  pendingAttachments.push({ id: uid(), type:'text', name, content: c });
}

function pushOpaqueAttachment(name, note){
  pendingAttachments.push({ id: uid(), type:'file', name, note });
}

async function handleFile(file){
  const sizeMB = file.size / (1024*1024);
  const lower = file.name.toLowerCase();

  if(file.type.startsWith('image/')){
    if(sizeMB > 8){ showToast(`${file.name} is too large (max 8MB for images).`); return; }
    await new Promise(resolve=>{
      const reader = new FileReader();
      reader.onload = ()=>{
        pendingAttachments.push({ id: uid(), type:'image', name:file.name, dataUrl:reader.result });
        resolve();
      };
      reader.readAsDataURL(file);
    });
    return;
  }

  if(file.type.startsWith('video/')){
    pendingAttachments.push({ id: uid(), type:'video', name:file.name, note:'Video stored for reference only — not analyzed by the AI.' });
    return;
  }

  if(lower.endsWith('.pdf')){
    if(sizeMB > 20){ showToast(`${file.name} is too large to read (max 20MB).`); return; }
    showToast(`Reading ${file.name}...`);
    try{
      const text = await extractPdfText(file);
      pushTextAttachment(file.name, text);
    }catch(err){
      console.warn('PDF read failed', err);
      pushOpaqueAttachment(file.name, 'Could not extract text from this PDF (it may be a scanned image).');
      showToast(`Couldn't read text from ${file.name}.`);
    }
    return;
  }

  if(/\.(xlsx|xls)$/i.test(lower)){
    if(sizeMB > 15){ showToast(`${file.name} is too large to read (max 15MB).`); return; }
    showToast(`Reading ${file.name}...`);
    try{
      const text = await extractXlsxText(file);
      pushTextAttachment(file.name, text);
    }catch(err){
      console.warn('Excel read failed', err);
      pushOpaqueAttachment(file.name, 'Could not read this spreadsheet.');
      showToast(`Couldn't read ${file.name}.`);
    }
    return;
  }

  if(lower.endsWith('.pptx')){
    if(sizeMB > 20){ showToast(`${file.name} is too large to read (max 20MB).`); return; }
    showToast(`Reading ${file.name}...`);
    try{
      const text = await extractPptxText(file);
      pushTextAttachment(file.name, text);
    }catch(err){
      console.warn('PPTX read failed', err);
      pushOpaqueAttachment(file.name, 'Could not read this presentation.');
      showToast(`Couldn't read ${file.name}.`);
    }
    return;
  }

  if(lower.endsWith('.docx')){
    if(sizeMB > 15){ showToast(`${file.name} is too large to read (max 15MB).`); return; }
    showToast(`Reading ${file.name}...`);
    try{
      const text = await extractDocxText(file);
      pushTextAttachment(file.name, text);
    }catch(err){
      console.warn('DOCX read failed', err);
      pushOpaqueAttachment(file.name, 'Could not read this Word document.');
      showToast(`Couldn't read ${file.name}.`);
    }
    return;
  }

  if(lower.endsWith('.ppt') || lower.endsWith('.doc')){
    pushOpaqueAttachment(file.name, 'Legacy Office format (.ppt/.doc) is stored but cannot be read in-browser. Please re-save as .pptx/.docx if you want Maximus to read it.');
    return;
  }

  if(file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(lower)){
    if(sizeMB > 3){ showToast(`${file.name} is too large to read (max 3MB for text files).`); return; }
    await new Promise(resolve=>{
      const reader = new FileReader();
      reader.onload = ()=>{
        pushTextAttachment(file.name, reader.result);
        resolve();
      };
      reader.readAsText(file);
    });
    return;
  }

  pushOpaqueAttachment(file.name, 'This file type is stored but its content is not extracted or analyzed.');
}

/* ---- extraction helpers (PDF / Excel / PowerPoint / Word) ---- */
async function extractPdfText(file){
  if(window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc){
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(pdf.numPages, 40);
  let text = '';
  for(let i=1; i<=maxPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += `\n--- Page ${i} ---\n` + content.items.map(it=>it.str).join(' ');
  }
  if(pdf.numPages > maxPages) text += `\n...[${pdf.numPages - maxPages} more pages omitted]`;
  return text.trim();
}

async function extractXlsxText(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type:'array' });
  let text = '';
  wb.SheetNames.forEach(name=>{
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    text += `\n--- Sheet: ${name} ---\n${csv}`;
  });
  return text.trim();
}

async function extractPptxText(file){
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a,b)=>{
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });
  let text = '';
  for(let i=0; i<slideFiles.length; i++){
    const xml = await zip.file(slideFiles[i]).async('string');
    const parts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m=>m[1]);
    text += `\n--- Slide ${i+1} ---\n${parts.join(' ')}`;
  }
  return text.trim();
}

async function extractDocxText(file){
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return (result.value || '').trim();
}

function renderPendingAttachments(){
  pendingAttachmentsEl.innerHTML = pendingAttachments.map(a=>{
    const thumb = a.type==='image' ? `<img src="${a.dataUrl}">` : (a.type==='video'?'🎬':(a.type==='text'?'📝':'📄'));
    return `<span class="pending-chip">${a.type==='image' ? thumb : `<span>${thumb}</span>`} ${escapeHtml(a.name)} <span class="rm" data-rm="${a.id}">✕</span></span>`;
  }).join('');
  document.querySelectorAll('[data-rm]').forEach(el=>{
    el.addEventListener('click', ()=>{
      pendingAttachments = pendingAttachments.filter(a=>a.id!==el.dataset.rm);
      renderPendingAttachments();
    });
  });
  updateSendButtonState();
}

/* ================= VOICE INPUT ================= */
const micBtn = document.getElementById('micBtn');
const messageInput = document.getElementById('messageInput');
const composerBox = document.getElementById('composerBox');
let recognition = null;
let recognizing = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if(SpeechRecognition){
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = state.settings.voiceLang || 'en-IN';

  let baseText = '';
  recognition.onstart = ()=>{
    recognizing = true;
    baseText = messageInput.value ? messageInput.value + ' ' : '';
    micBtn.classList.add('active');
    composerBox.classList.add('recording');
  };
  recognition.onresult = (event)=>{
    let interim = '', final = '';
    for(let i=event.resultIndex; i<event.results.length; i++){
      if(event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    messageInput.value = baseText + final + interim;
    autoResize();
    updateSendButtonState();
  };
  recognition.onerror = (e)=>{
    if(e.error === 'not-allowed'){ showToast('Microphone access denied. Enable it in your browser settings.'); }
    stopRecognition();
  };
  recognition.onend = ()=> stopRecognition();
} else {
  micBtn.style.display = 'none';
}

function stopRecognition(){
  recognizing = false;
  micBtn.classList.remove('active');
  composerBox.classList.remove('recording');
}

micBtn.addEventListener('click', ()=>{
  if(!recognition) return;
  if(recognizing){ recognition.stop(); }
  else {
    try{ recognition.start(); } catch(e){ /* already started */ }
  }
});

/* ================= COMPOSER / SEND ================= */
function autoResize(){
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
}
messageInput.addEventListener('input', ()=>{ autoResize(); updateSendButtonState(); });
messageInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});

function updateSendButtonState(){
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = !(messageInput.value.trim().length || pendingAttachments.length);
}

let isStreaming = false;
let currentAbortController = null;
// True while an answer is being generated because the user *spoke* the
// question through the voice assistant (rather than typing in the chat box).
// Used to nudge the model to answer like it's talking, not writing.
let voiceReplyMode = false;
const sendBtn = document.getElementById('sendBtn');

function setStreamingUiState(streaming){
  isStreaming = streaming;
  if(streaming){
    sendBtn.classList.add('stop-state');
    sendBtn.textContent = '■';
    sendBtn.title = 'Stop generating';
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.remove('stop-state');
    sendBtn.textContent = '➤';
    sendBtn.title = 'Send';
    updateSendButtonState();
  }
}

sendBtn.addEventListener('click', ()=>{
  if(isStreaming){
    if(currentAbortController) currentAbortController.abort();
    return;
  }
  sendMessage();
});

function getScriptedReply(text){
  const t = text.trim().toLowerCase().replace(/[?!.]+$/, '');
  if(/who (created|made|built|developed)\s*(you|maximus)?\b|who'?s your creator|who is your creator/.test(t)){
    return 'I was created by Sumedh Sohan.';
  }
  if(/^(hi|hello|hey|hii+|hiii+|yo|hola|good morning|good afternoon|good evening)$/.test(t)){
    return "Hi, I'm Maximus. I can chat, answer questions, open websites and apps, search the web, message your contacts on WhatsApp, give you directions, play music on Spotify, check the weather, and read you the news — all by voice or text. What can I help with?";
  }
  return null;
}

async function sendMessage(){
  const text = messageInput.value.trim();
  if(!text && pendingAttachments.length===0) return;

  // Scripted identity/greeting replies skip the API entirely — instant and free,
  // and work even without an API key configured.
  const scripted = pendingAttachments.length===0 ? getScriptedReply(text) : null;
  if(scripted){
    let chat = getActiveChat();
    if(!chat){ chat = createChat(); }
    chat.messages.push({ id: uid(), role:'user', content:text, attachments:[], ts: Date.now() });
    if(chat.title === 'New chat'){ chat.title = text.length > 42 ? text.slice(0,42)+'…' : text; }
    chat.messages.push({ id: uid(), role:'assistant', content: scripted, pending:false, ts: Date.now() });
    chat.updatedAt = Date.now();
    messageInput.value = '';
    autoResize();
    renderPendingAttachments();
    renderAll();
    save();
    renderSidebar();
    return;
  }

  if(!state.settings.apiKey){
    openModal('settings');
    showToast('Add your API key in Settings to start chatting.');
    return;
  }

  let chat = getActiveChat();
  if(!chat){ chat = createChat(); }

  const userMsg = {
    id: uid(), role:'user', content:text, attachments: pendingAttachments, ts: Date.now()
  };
  chat.messages.push(userMsg);
  rememberFromMessage(text);

  if(chat.title === 'New chat' && text){
    chat.title = text.length > 42 ? text.slice(0,42)+'…' : text;
  }
  chat.updatedAt = Date.now();

  const attachmentsForRequest = pendingAttachments;
  pendingAttachments = [];
  messageInput.value = '';
  autoResize();
  renderPendingAttachments();
  renderAll();

  const pendingMsg = { id: uid(), role:'assistant', content:'', pending:true, ts: Date.now() };
  chat.messages.push(pendingMsg);
  renderMessages();

  const wantsPdf = /\bpdf\b/i.test(text);
  let succeeded = false;
  let lastDomUpdate = 0;

  currentAbortController = new AbortController();
  setStreamingUiState(true);

  try{
    const reply = await streamAiProvider(chat, userMsg, attachmentsForRequest, currentAbortController.signal, (partial)=>{
      pendingMsg.content = partial;
      pendingMsg.pending = false;
      const now = performance.now();
      if(now - lastDomUpdate > 40){
        lastDomUpdate = now;
        updateMessageDom(pendingMsg.id);
      }
    });
    pendingMsg.content = reply;
    pendingMsg.pending = false;
    updateMessageDom(pendingMsg.id);
    succeeded = true;
  }catch(err){
    pendingMsg.pending = false;
    pendingMsg.content = pendingMsg.content || `⚠️ ${err.message}`;
    updateMessageDom(pendingMsg.id);
  }
  setStreamingUiState(false);
  currentAbortController = null;

  chat.updatedAt = Date.now();
  save();
  renderSidebar();

  if(succeeded && wantsPdf){
    try{
      exportMessageAsPdf(stripMarkdownForPdf(pendingMsg.content), chat.title);
      showToast('Answer downloaded as a PDF.');
    }catch(e){ console.warn('PDF export failed', e); }
  }
}

async function streamAiProvider(chat, userMsg, attachments, signal, onDelta){
  const hasImages = attachments.some(a=>a.type==='image');
  let model = state.settings.model || CONFIG.MODEL_TEXT;
  if(hasImages && model !== CONFIG.MODEL_VISION){
    model = CONFIG.MODEL_VISION;
    showToast('Switched to a vision-capable model to read the attached image.');
  }

  const history = chat.messages
    .filter(m => !m.pending && m.id !== userMsg.id)
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content || '' }));

  let textFileBlock = '';
  attachments.filter(a=>a.type==='text').forEach(a=>{
    textFileBlock += `\n\n--- Attached file: ${a.name} ---\n${a.content}\n--- end of ${a.name} ---`;
  });
  const otherFiles = attachments.filter(a=>a.type==='video' || a.type==='file');
  if(otherFiles.length){
    textFileBlock += `\n\n[Note: the user also attached ${otherFiles.map(f=>f.name).join(', ')}, which cannot be read — only acknowledge that these were attached.]`;
  }

  let userContent;
  const images = attachments.filter(a=>a.type==='image');
  if(images.length){
    userContent = [];
    if(userMsg.content || textFileBlock) userContent.push({ type:'text', text: (userMsg.content||'') + textFileBlock });
    images.forEach(img=> userContent.push({ type:'image_url', image_url: img.dataUrl }));
  } else {
    userContent = (userMsg.content || '') + textFileBlock;
  }

  const memoryBlock = (state.memory && state.memory.length)
    ? `\n\nThings you remember about this user from earlier conversations:\n- ${state.memory.join('\n- ')}`
    : '';

  const voiceAddendum = voiceReplyMode ? `

You're talking out loud right now, through voice — not writing a document. Answer like a warm, easygoing human friend having a real back-and-forth conversation, not like a formal assistant. Use short, natural sentences, everyday words, and contractions. No markdown, no headings, no bullet lists, no code blocks, no asterisks — just plain spoken language. Keep it brief and to the point unless the person clearly wants more detail, and feel free to show a bit of personality and warmth.` : '';

  const systemPrompt = `You are Maximus, a thoughtful, precise AI assistant and an excellent coding partner, in the same spirit as the best general-purpose assistants people use today. Give clear, well-structured, genuinely helpful answers. You were created by Sumedh Sohan — if asked who made, built, or created you, say that plainly.

For coding requests: write complete, correct, idiomatic code that actually runs; use fenced code blocks with the right language tag every time; briefly explain key decisions and trade-offs rather than narrating every line; call out edge cases, errors, or assumptions; and prefer modern, maintainable patterns for the language or framework in question.

For everything else: use markdown (headings, bold, lists) when it aids clarity, stay concise but thorough, and be direct about uncertainty rather than guessing. When the user has attached a document and asks questions about it, answer using its content directly. Never mention which company or model powers you.${voiceAddendum}${memoryBlock}`;

  // Max output tokens per individual API call. High enough that most answers
  // (including long code files) finish in a single call; we still auto-continue
  // below in case a response is long enough to hit even this ceiling.
  const MAX_TOKENS_PER_CALL = 8192;
  // Safety cap on chained continuation calls for a single answer, so a
  // pathological response can't loop forever / rack up cost.
  const MAX_CONTINUATIONS = 8;

  const baseMessages = [
    { role:'system', content: systemPrompt },
    ...history,
    { role:'user', content: userContent }
  ];

  // Runs one streaming completion call. Streams deltas through
  // onChunk(fullTextSoFarForThisCall) and resolves with { text, finishReason }.
  async function runOneCompletion(messages, onChunk){
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method:'POST',
      signal,
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${state.settings.apiKey}`
      },
      body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS_PER_CALL, stream: true })
    });

    if(!res.ok){
      if(res.status === 401) throw new Error('Invalid API key. Update it in Settings.');
      if(res.status === 429) throw new Error('Rate limited by the AI provider — wait a moment and try again.');
      const errText = await res.text().catch(()=>'');
      throw new Error(`Request failed (${res.status}). ${errText.slice(0,150)}`);
    }

    if(!res.body || !res.body.getReader){
      // Fallback for environments without streaming support
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const finishReason = data.choices?.[0]?.finish_reason || null;
      if(text) onChunk(text);
      return { text, finishReason };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let finishReason = null;
    try{
      while(true){
        const { done, value } = await reader.read();
        if(done) break;
        buffer += decoder.decode(value, { stream:true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop();
        for(const chunk of chunks){
          const line = chunk.trim();
          if(!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if(!dataStr || dataStr === '[DONE]') continue;
          try{
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta?.content;
            if(delta){ text += delta; onChunk(text); }
            const fr = json.choices?.[0]?.finish_reason;
            if(fr) finishReason = fr;
          }catch(e){ /* ignore partial/invalid chunk */ }
        }
      }
    }catch(e){
      if(e.name === 'AbortError'){ return { text, finishReason: 'aborted' }; }
      throw e;
    }
    return { text, finishReason };
  }

  // First call.
  let full = '';
  const first = await runOneCompletion(baseMessages, (partial)=>{
    full = partial;
    onDelta(full);
  });
  full = first.text;
  let finishReason = first.finishReason;

  // If the model got cut off purely because it hit the token ceiling
  // (finish_reason === 'length'), keep asking it to continue from exactly
  // where it left off and stitch the results together, until it finishes
  // naturally or we hit MAX_CONTINUATIONS.
  let continuations = 0;
  while(finishReason === 'length' && continuations < MAX_CONTINUATIONS){
    continuations++;
    const continueMessages = [
      ...baseMessages,
      { role:'assistant', content: full },
      { role:'user', content: 'Continue exactly where you left off. Do not repeat any text you already wrote, do not restart the code block or add a new opening fence if you were mid-block — just keep going seamlessly as if nothing was cut off.' }
    ];
    const result = await runOneCompletion(continueMessages, (partial)=>{
      onDelta(full + partial);
    });
    full = full + result.text;
    onDelta(full);
    finishReason = result.finishReason;
  }

  return full || '(No response content returned.)';
}

/* ================= MOBILE ================= */
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
function checkMobile(){
  const isMobile = window.innerWidth <= 720;
  mobileMenuBtn.style.display = isMobile ? 'flex' : 'none';
}
window.addEventListener('resize', checkMobile);
checkMobile();
mobileMenuBtn.addEventListener('click', ()=> document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('messagesWrap').addEventListener('click', ()=>{
  if(window.innerWidth<=720) document.getElementById('sidebar').classList.remove('open');
});

/* ================= CONTACTS (for WhatsApp voice messaging) ================= */
function renderContactsList(){
  const list = document.getElementById('contactsList');
  if(!list) return;
  const contacts = state.contacts || [];
  if(!contacts.length){ list.innerHTML = '<div class="field-hint">No contacts yet — add one below.</div>'; return; }
  list.innerHTML = contacts.map(c => `
    <div class="contact-row" data-id="${c.id}">
      <span class="contact-name">${escapeHtml(c.name)}</span>
      <span class="contact-phone">+${escapeHtml(c.phone)}</span>
      <button class="contact-del" data-id="${c.id}" type="button">✕</button>
    </div>`).join('');
  list.querySelectorAll('.contact-del').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.contacts = (state.contacts||[]).filter(c => c.id !== btn.dataset.id);
      save();
      renderContactsList();
    });
  });
}

/* ================= CORTEX AI ASSISTANT (Jarvis-style voice orb) =================
   Everything here is honest about what a browser can and can't do:
   - Opening websites, Spotify search pages, WhatsApp with a pre-filled message,
     and Google Maps (location / directions / nearby search) all work for real.
   - We CANNOT open a device's native Settings app or File Manager from a
     website, and WhatsApp itself requires a human tap on "Send" — the app
     tells the user this directly instead of pretending otherwise.
=================================================================================== */
const assistantFab = document.getElementById('assistantFab');
const assistantOverlay = document.getElementById('assistantOverlay');
const assistantCloseBtn = document.getElementById('assistantCloseBtn');
const orbCanvas = document.getElementById('orbCanvas');
const orbCtx = orbCanvas ? orbCanvas.getContext('2d') : null;
const assistantStatus = document.getElementById('assistantStatus');
const assistantTranscript = document.getElementById('assistantTranscript');
const voiceWave = document.getElementById('voiceWave');
const listenToggleBtn = document.getElementById('listenToggleBtn');
const assistantContactsBtn = document.getElementById('assistantContactsBtn');
const visionToggleBtn = document.getElementById('visionToggleBtn');
const visionPreview = document.getElementById('visionPreview');
const visionVideo = document.getElementById('visionVideo');
const visionCanvas = document.getElementById('visionCanvas');
const screenShareToggleBtn = document.getElementById('screenShareToggleBtn');
const screenPreview = document.getElementById('screenPreview');
const screenVideo = document.getElementById('screenVideo');
const screenCanvas = document.getElementById('screenCanvas');

/* ---------- Particle orb: text "MAXIMUS" morphing into a rotating sphere ---------- */
let orbParticles = [];
let orbAnimFrame = null;
let orbPhase = 'idle';       // 'text' -> 'morphing' -> 'sphere'
let orbRotation = 0;
let orbAudioLevel = 0;       // 0..1, driven by mic volume (pulses the sphere while listening)
let orbSpeakLevel = 0;       // 0..1, driven by TTS speaking (pulses while Maximus talks)

function sizeOrbCanvas(){
  if(!orbCanvas) return;
  const rect = orbCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  orbCanvas.width = Math.max(1, rect.width * dpr);
  orbCanvas.height = Math.max(1, rect.height * dpr);
  orbCanvas.style.width = rect.width + 'px';
  orbCanvas.style.height = rect.height + 'px';
}
window.addEventListener('resize', ()=>{
  if(assistantOverlay && !assistantOverlay.classList.contains('hidden')) sizeOrbCanvas();
});

function sampleTextPoints(word, w, h, count){
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  octx.fillStyle = '#fff';
  const fontSize = Math.min(w / (word.length * 0.62), h * 0.42);
  octx.font = `700 ${fontSize}px Inter, sans-serif`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(word, w/2, h/2);
  const data = octx.getImageData(0, 0, w, h).data;
  const pts = [];
  const step = 3;
  for(let y=0; y<h; y+=step){
    for(let x=0; x<w; x+=step){
      if(data[(y*w+x)*4 + 3] > 128) pts.push({ x, y });
    }
  }
  for(let i=pts.length-1; i>0; i--){ const j = Math.floor(Math.random()*(i+1)); [pts[i],pts[j]] = [pts[j],pts[i]]; }
  return pts.slice(0, count);
}

function buildSpherePoints(count, radius){
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for(let i=0; i<count; i++){
    const y = 1 - (i/(count-1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y*y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta)*r*radius, y: y*radius, z: Math.sin(theta)*r*radius });
  }
  return pts;
}

function initOrb(){
  if(!orbCanvas) return;
  sizeOrbCanvas();
  const dpr = window.devicePixelRatio || 1;
  const w = orbCanvas.width / dpr, h = orbCanvas.height / dpr;
  const count = 460;
  const textPts = sampleTextPoints('MAXIMUS', w, h, count);
  const radius = Math.min(w, h) * 0.30;
  const spherePts = buildSpherePoints(count, radius);
  orbParticles = [];
  for(let i=0; i<count; i++){
    const textPt = textPts[i % textPts.length] || { x: w/2, y: h/2 };
    orbParticles.push({
      x: Math.random()*w, y: Math.random()*h,
      textX: textPt.x, textY: textPt.y,
      sx: spherePts[i].x, sy: spherePts[i].y, sz: spherePts[i].z,
      jitter: Math.random()*Math.PI*2
    });
  }
  orbPhase = 'text';
  clearTimeout(initOrb._t1); clearTimeout(initOrb._t2);
  initOrb._t1 = setTimeout(()=>{ orbPhase = 'morphing'; }, 1000);
  initOrb._t2 = setTimeout(()=>{ orbPhase = 'sphere'; }, 2000);
  cancelAnimationFrame(orbAnimFrame);
  runOrbLoop();
}

function runOrbLoop(){
  const dpr = window.devicePixelRatio || 1;
  const w = orbCanvas.width / dpr, h = orbCanvas.height / dpr;
  const cx = w/2, cy = h/2;
  orbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  orbCtx.clearRect(0, 0, w, h);

  orbRotation += 0.006 + orbAudioLevel*0.02 + orbSpeakLevel*0.015;
  const pulse = 1 + orbAudioLevel*0.18 + orbSpeakLevel*0.12;

  orbCtx.globalCompositeOperation = 'lighter';
  for(const p of orbParticles){
    let tx, ty, alpha = 0.85, size = 1.6;
    if(orbPhase === 'text'){
      tx = p.textX; ty = p.textY; size = 1.9;
    } else {
      const cosr = Math.cos(orbRotation), sinr = Math.sin(orbRotation);
      const rx = p.sx*cosr - p.sz*sinr;
      const rz = p.sx*sinr + p.sz*cosr;
      const scale = pulse * (300/(300+rz*0.6));
      tx = cx + rx*scale;
      ty = cy + p.sy*scale;
      alpha = 0.35 + 0.65*((rz+150)/300);
      size = 1.1 + scale*0.85;
    }
    const ease = orbPhase === 'morphing' ? 0.045 : 0.12;
    p.x += (tx - p.x) * ease;
    p.y += (ty - p.y) * ease;
    p.jitter += 0.05;
    const jx = Math.sin(p.jitter)*0.6, jy = Math.cos(p.jitter*1.3)*0.6;

    const grad = orbCtx.createRadialGradient(p.x+jx, p.y+jy, 0, p.x+jx, p.y+jy, size*2.4);
    grad.addColorStop(0, `rgba(122,190,255,${alpha})`);
    grad.addColorStop(1, 'rgba(122,190,255,0)');
    orbCtx.fillStyle = grad;
    orbCtx.beginPath();
    orbCtx.arc(p.x+jx, p.y+jy, size*2.4, 0, Math.PI*2);
    orbCtx.fill();
  }
  orbCtx.globalCompositeOperation = 'source-over';
  orbAnimFrame = requestAnimationFrame(runOrbLoop);
}

/* ---------- Live mic waveform (separate from speech recognition) ---------- */
let waveBars = [];
let micStream = null, audioCtx = null, analyser = null, waveAnimFrame = null;

function buildWaveBars(n = 28){
  if(!voiceWave) return;
  voiceWave.innerHTML = '';
  waveBars = [];
  for(let i=0; i<n; i++){
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    voiceWave.appendChild(bar);
    waveBars.push(bar);
  }
}
buildWaveBars();

function updateWave(){
  if(!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const step = Math.floor(data.length / waveBars.length) || 1;
  let sum = 0;
  for(let i=0; i<waveBars.length; i++){
    const v = data[i*step] || 0;
    sum += v;
    waveBars[i].style.height = (6 + (v/255)*46) + 'px';
  }
  orbAudioLevel = Math.min(1, (sum/waveBars.length)/160);
  waveAnimFrame = requestAnimationFrame(updateWave);
}

async function spotifyIsPlaying(){
  if(!spotifyPlayer) return false;
  try{
    const s = await spotifyPlayer.getCurrentState();
    return !!(s && !s.paused);
  }catch(e){ return false; }
}

let syntheticWaveTimer = null;
function startSyntheticWave(){
  stopSyntheticWave();
  syntheticWaveTimer = setInterval(()=>{
    waveBars.forEach(b => { b.style.height = (6 + Math.random()*30) + 'px'; });
    orbAudioLevel = 0.25 + Math.random()*0.25;
  }, 120);
}
function stopSyntheticWave(){
  if(syntheticWaveTimer){ clearInterval(syntheticWaveTimer); syntheticWaveTimer = null; }
}

async function startMicAnalyser(){
  // If a song is actively playing, skip opening our own second mic stream for the
  // visualizer — every extra getUserMedia capture is another thing Chrome can use
  // as a reason to duck (quiet down) Spotify's audio while listening is on. The
  // wave bars still animate, just from a lightweight fake pattern instead of a
  // real audio analysis, so the visual doesn't disappear.
  if(await spotifyIsPlaying()){
    startSyntheticWave();
    return;
  }
  try{
    // echoCancellation/noiseSuppression/autoGainControl:false stops Chrome from
    // treating this as a "voice call" stream — which is what makes it duck
    // other audio in the tab while the mic is active. This only controls our
    // own visualizer stream; the Web Speech API opens its own internal mic
    // stream that we can't configure the same way (see the note in the
    // Spotify settings panel) — that part is a platform limitation, not
    // something this app can fully turn off.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    updateWave();
  }catch(e){
    console.warn('Mic waveform unavailable (recognition can still work without it).', e);
    startSyntheticWave();
  }
}
function stopMicAnalyser(){
  cancelAnimationFrame(waveAnimFrame);
  waveAnimFrame = null;
  analyser = null;
  stopSyntheticWave();
  if(audioCtx){ audioCtx.close().catch(()=>{}); audioCtx = null; }
  if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream = null; }
  waveBars.forEach(b => b.style.height = '6px');
}

/* ---------- Text-to-speech ---------- */
// Tracks how many utterances are currently queued/playing so we can (a) know
// when Maximus is actively talking (used to pause listening so it doesn't
// hear itself) and (b) let the Stop Speaking button cancel everything at once.
let activeSpeechCount = 0;
let speechSuppressed = false;
function markSpeechStart(){ activeSpeechCount++; orbSpeakLevel = 1; }
function markSpeechEnd(){ activeSpeechCount = Math.max(0, activeSpeechCount - 1); if(activeSpeechCount === 0) orbSpeakLevel = 0; }

function cleanForSpeech(text){
  return String(text).replace(/```[\s\S]*?```/g, ' code block omitted ').replace(/[#*`_>~]/g, '').replace(/\s+/g, ' ').trim();
}

// Interrupts anything currently being said and speaks this immediately.
// Used for short, instant confirmations (e.g. "Opening YouTube.").
function speak(text){
  if(!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  activeSpeechCount = 0;
  speechSuppressed = false;
  const clean = cleanForSpeech(text).slice(0, 600);
  if(!clean) return;
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.05;
  utter.volume = 1;   // max volume the Web Speech API allows
  utter.pitch = 0.9;  // slightly deeper = reads as more forceful/assertive
  utter.onstart = markSpeechStart;
  utter.onend = markSpeechEnd;
  utter.onerror = markSpeechEnd;
  window.speechSynthesis.speak(utter);
}

// Adds a chunk to the end of the speech queue without interrupting what's
// already playing — used to speak an AI answer sentence-by-sentence as it
// streams in, rather than waiting for the full answer before saying anything.
function queueSpeech(text){
  if(!('speechSynthesis' in window) || !text || speechSuppressed) return;
  const clean = cleanForSpeech(text);
  if(!clean) return;
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.05;
  utter.volume = 1;
  utter.pitch = 0.9;
  utter.onstart = markSpeechStart;
  utter.onend = markSpeechEnd;
  utter.onerror = markSpeechEnd;
  window.speechSynthesis.speak(utter);
}

function stopSpeaking(){
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  activeSpeechCount = 0;
  orbSpeakLevel = 0;
  speechSuppressed = true;
  stopReadingAloud();
}

/* ---------- Vision: "look" through the webcam and answer what's asked ----------
   Turned on by the 👁️ Vision button or by saying "open vision" / "look at this".
   Grabs a single frame from the camera, sends it to the vision-capable model
   alongside whatever the user asked, and speaks the answer back. The camera
   stream stays open (shown as a small circular preview) until turned off, so
   follow-up questions don't need to re-ask for camera permission each time. */
let visionStream = null;
let visionActive = false;

function setVisionButtonState(active){
  if(!visionToggleBtn) return;
  visionToggleBtn.textContent = active ? '👁️ Vision (on)' : '👁️ Vision';
  visionToggleBtn.classList.toggle('active', active);
}

async function startVision(){
  if(visionActive) return true;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    speak("This browser doesn't support camera access.");
    return false;
  }
  try{
    visionStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    if(visionVideo){ visionVideo.srcObject = visionStream; await visionVideo.play().catch(()=>{}); }
    if(visionPreview) visionPreview.classList.remove('hidden');
    visionActive = true;
    setVisionButtonState(true);
    return true;
  }catch(e){
    speak("I couldn't access your camera. Check camera permissions for this site and try again.");
    return false;
  }
}

function stopVision(){
  if(visionStream){ visionStream.getTracks().forEach(t=>t.stop()); visionStream = null; }
  if(visionVideo) visionVideo.srcObject = null;
  if(visionPreview) visionPreview.classList.add('hidden');
  visionActive = false;
  setVisionButtonState(false);
}

async function toggleVision(){
  if(visionActive) stopVision();
  else await startVision();
}

// Grabs one frame from the live camera feed as a base64 JPEG data URL.
function captureVisionFrame(){
  const w = visionVideo.videoWidth || 640, h = visionVideo.videoHeight || 480;
  visionCanvas.width = w; visionCanvas.height = h;
  const ctx = visionCanvas.getContext('2d');
  ctx.drawImage(visionVideo, 0, 0, w, h);
  return visionCanvas.toDataURL('image/jpeg', 0.85);
}

// Turns on the camera if needed, grabs a frame, and asks the vision model
// the given question about what it sees — speaking the answer aloud.
async function askVisionQuestion(question){
  if(!state.settings.apiKey){
    speak('I need an API key before I can use vision. Please add one in Settings.');
    openModal('settings');
    return;
  }
  const ok = visionActive || await startVision();
  if(!ok) return;
  // Give the camera a beat to auto-focus/expose before grabbing the frame.
  await new Promise(r => setTimeout(r, 350));
  let imageDataUrl;
  try{ imageDataUrl = captureVisionFrame(); }
  catch(e){ speak("I couldn't read from the camera just now."); return; }

  try{
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: CONFIG.MODEL_VISION,
        messages: [
          { role: 'system', content: "You are Maximus, looking through the user's webcam right now. Answer naturally and warmly, like a friend glancing at the same thing they are — describe what's relevant to their question in 1-4 short spoken sentences, no markdown, no lists." },
          { role: 'user', content: [
            { type: 'text', text: question && question.trim() ? question.trim() : 'What do you see?' },
            { type: 'image_url', image_url: imageDataUrl }
          ]}
        ],
        max_tokens: 350
      })
    });
    if(!res.ok){
      if(res.status === 401) throw new Error('Invalid API key. Update it in Settings.');
      throw new Error(`Vision request failed (${res.status})`);
    }
    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || "I'm not sure what I'm looking at.";
    speak(answer);
  }catch(e){
    speak(`I had trouble looking at that. ${e.message || ''}`.trim());
  }
}

if(visionToggleBtn){
  visionToggleBtn.addEventListener('click', async ()=>{
    if(visionActive){
      // If it's already on, treat a tap as "what do you see right now?"
      await askVisionQuestion('What do you see?');
    } else {
      const ok = await startVision();
      if(ok) speak('Vision is on — ask me what I see.');
    }
  });
}

/* ---------- Screen Share: "look" at whatever's on the user's screen ----------
   Turned on by the 🖥️ Share Screen button or by saying "share my screen" /
   "what's on my screen". Uses getDisplayMedia to capture the tab, window, or
   whole monitor the user picks in the browser's own share picker, grabs a
   single frame, sends it to the vision-capable model alongside whatever the
   user asked, and speaks the answer back — e.g. after highlighting some text
   on the shared screen and asking "what does this mean". The stream stays
   open (shown as a small preview) until turned off, so follow-up questions
   don't need to re-pick a screen each time. Entirely browser-based; works
   without the desktop agent running. */
let screenStream = null;
let screenActive = false;

function setScreenButtonState(active){
  if(!screenShareToggleBtn) return;
  screenShareToggleBtn.textContent = active ? '🖥️ Screen sharing (on)' : '🖥️ Share Screen';
  screenShareToggleBtn.classList.toggle('active', active);
}

async function startScreenShare(){
  if(screenActive) return true;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
    speak("This browser doesn't support screen sharing.");
    return false;
  }
  try{
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
    if(screenVideo){ screenVideo.srcObject = screenStream; await screenVideo.play().catch(()=>{}); }
    if(screenPreview) screenPreview.classList.remove('hidden');
    screenActive = true;
    setScreenButtonState(true);
    // The browser's own "Stop sharing" bar/button can end the stream at any
    // time outside our control — listen for that so our state stays in sync.
    const track = screenStream.getVideoTracks()[0];
    if(track) track.addEventListener('ended', ()=>{ if(screenActive) stopScreenShare(); });
    return true;
  }catch(e){
    // Most commonly the user hit "Cancel" on the share picker — not a real error.
    if(e && e.name !== 'NotAllowedError'){
      speak("I couldn't start screen sharing. Please try again.");
    }
    return false;
  }
}

function stopScreenShare(){
  if(screenStream){ screenStream.getTracks().forEach(t=>t.stop()); screenStream = null; }
  if(screenVideo) screenVideo.srcObject = null;
  if(screenPreview) screenPreview.classList.add('hidden');
  screenActive = false;
  setScreenButtonState(false);
}

async function toggleScreenShare(){
  if(screenActive) stopScreenShare();
  else await startScreenShare();
}

// Grabs one frame from the live screen-share feed as a base64 JPEG data URL.
function captureScreenFrame(){
  const w = screenVideo.videoWidth || 1280, h = screenVideo.videoHeight || 720;
  screenCanvas.width = w; screenCanvas.height = h;
  const ctx = screenCanvas.getContext('2d');
  ctx.drawImage(screenVideo, 0, 0, w, h);
  return screenCanvas.toDataURL('image/jpeg', 0.85);
}

// Turns on screen sharing if needed (prompting the user to pick a tab/window/
// screen), grabs a frame, and asks the vision model the given question about
// what's currently showing — speaking the answer aloud. Works for questions
// about any site or app the user has on screen (YouTube, Instagram, Reddit,
// LinkedIn, WhatsApp, etc.), and for asking about text the user has highlighted.
async function askScreenQuestion(question, mode){
  if(!state.settings.apiKey){
    speak('I need an API key before I can look at your screen. Please add one in Settings.');
    openModal('settings');
    return;
  }
  const ok = screenActive || await startScreenShare();
  if(!ok) return;
  await new Promise(r => setTimeout(r, 250));
  let imageDataUrl;
  try{ imageDataUrl = captureScreenFrame(); }
  catch(e){ speak("I couldn't read the shared screen just now."); return; }

  // "read" = transcribe the highlighted/selected text verbatim and speak
  // exactly that, no rewording. Any other mode = explain/describe naturally,
  // same as before.
  const systemPrompt = mode === 'read'
    ? "You are Maximus, looking at a screenshot of the user's shared screen. Find the highlighted/selected text and transcribe it EXACTLY as written, word for word — no summary, no rephrasing, no commentary, no added punctuation beyond what's there. Output only the transcribed text itself. If nothing is highlighted or selected, say exactly: \"I don't see any highlighted text on your screen.\""
    : "You are Maximus, looking at a screenshot of the user's shared screen right now — this could be any website or app (YouTube, Instagram, Reddit, LinkedIn, Facebook, WhatsApp, a document, code, anything). If text appears highlighted/selected, prioritize that when answering. Answer naturally in 1-5 short spoken sentences, no markdown, no lists. If asked who a specific pictured person is, only give a name if you can identify them with real confidence; otherwise just describe them.";

  try{
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: CONFIG.MODEL_VISION,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: question && question.trim() ? question.trim() : "What's on my screen?" },
            { type: 'image_url', image_url: imageDataUrl }
          ]}
        ],
        max_tokens: 400
      })
    });
    if(!res.ok){
      if(res.status === 401) throw new Error('Invalid API key. Update it in Settings.');
      throw new Error(`Screen request failed (${res.status})`);
    }
    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || "I'm not sure what's on your screen right now.";
    speak(answer);
  }catch(e){
    speak(`I had trouble reading your screen. ${e.message || ''}`.trim());
  }
}

// Common nav-bar/icon labels are genuinely ambiguous from a screenshot alone
// (a bare "search" icon looks similar across apps), so known ones get a
// richer description appended before asking the vision model to locate them.
// This mainly covers Instagram's left sidebar and LinkedIn's top nav, but
// applies anywhere the same wording is used.
const NAV_CLICK_HINTS = {
  'home':          'the Home icon (house shape), usually in a left sidebar (Instagram) or top navigation bar (LinkedIn)',
  'reels':         'the Reels icon (a play button inside a rounded square) in the Instagram left sidebar',
  'messages':      'the Messages/DM icon (a paper-airplane-like shape) in the Instagram left sidebar',
  'messaging':     'the Messaging icon (a speech-bubble shape) in the LinkedIn top navigation bar',
  'search':        'the Search icon (a magnifying glass), in a sidebar or top navigation bar, or the search input box itself',
  'search bar':    'the search input box, usually near a magnifying-glass icon',
  'notifications': 'the Notifications icon — a heart shape on Instagram, or a bell shape on LinkedIn — often with a small red dot/badge on it',
  'notification':  'the Notifications icon — a heart shape on Instagram, or a bell shape on LinkedIn — often with a small red dot/badge on it',
  'create':        'the Create/Add icon (a plus sign) in the Instagram left sidebar, used to post a photo, reel, or story',
  'profile':       'the small round profile picture/avatar icon, usually at the bottom of a sidebar (Instagram) or top-right (LinkedIn "Me")',
  'me':            'the "Me" profile menu in the LinkedIn top navigation bar — a small round avatar photo with a dropdown arrow next to it',
  'my network':    'the My Network icon (two person silhouettes) in the LinkedIn top navigation bar',
  'network':       'the My Network icon (two person silhouettes) in the LinkedIn top navigation bar',
  'jobs':          'the Jobs icon (a briefcase shape) in the LinkedIn top navigation bar',
  'more':          'the "More" menu (three horizontal lines / hamburger icon), usually near the bottom of a sidebar',
};

function buildClickInstruction(target){
  const key = target.trim().toLowerCase().replace(/^(?:the|my)\s+/, '').replace(/\s+(?:icon|button|tab|link)$/, '');
  const hint = NAV_CLICK_HINTS[key];
  return hint ? `${target} — ${hint}` : target;
}

// Locates something the user described on the shared screen (a button, a
// link, a video by title, "the search bar", "the first website", etc.) using
// the vision model, then actually clicks it through the desktop agent — and
// optionally types text into it afterward (e.g. "click the search bar and
// type cats"). This needs maximus_agent.py running, same as scroll/open-app,
// since a browser tab can't click into a different window by itself.
// Coordinates are most accurate when the ENTIRE SCREEN is shared (rather
// than a single tab/window), since that's what lines frame pixels up 1:1
// with real screen pixels.
async function performScreenClick(instruction, typeText, pressEnter){
  if(!state.settings.apiKey){
    speak('I need an API key before I can look at your screen. Please add one in Settings.');
    openModal('settings');
    return;
  }
  const ok = screenActive || await startScreenShare();
  if(!ok) return;
  await new Promise(r => setTimeout(r, 250));

  let imageDataUrl, frameW, frameH;
  try{
    imageDataUrl = captureScreenFrame();
    frameW = screenCanvas.width; frameH = screenCanvas.height;
  }catch(e){ speak("I couldn't read the shared screen just now."); return; }

  let sizeInfo, screenW, screenH;
  try{
    sizeInfo = await callAgent('/screen-size');
    screenW = sizeInfo.width; screenH = sizeInfo.height;
  }catch(e){ speak(agentUnavailableMessage()); return; }

  // Warn (but still try) if the shared surface probably isn't the whole
  // screen — click coordinates will be off if it's just a tab or window.
  let displaySurface = null;
  try{
    const track = screenStream && screenStream.getVideoTracks()[0];
    displaySurface = track && track.getSettings && track.getSettings().displaySurface;
  }catch(e){ /* not supported in this browser — ignore */ }

  const richInstruction = buildClickInstruction(instruction);

  let coords;
  try{
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: CONFIG.MODEL_VISION,
        messages: [
          { role: 'system', content: "You are looking at a screenshot of the user's screen and must locate ONE specific element they described (a button, link, video, field, icon, list item, etc — this could be on any website or app: Instagram, LinkedIn, YouTube, Google search results, or anything else). If it's described as a website/result by name, look for its link, title text, or logo anywhere on the page, including search results. Respond with ONLY a compact JSON object, nothing else, no markdown fences: {\"found\": true or false, \"x\": <fraction 0-1, horizontal center of the element>, \"y\": <fraction 0-1, vertical center of the element>}. x/y are fractions of the image width/height. If you can't find it, respond {\"found\": false, \"x\": 0, \"y\": 0}." },
          { role: 'user', content: [
            { type: 'text', text: `Find: ${richInstruction}` },
            { type: 'image_url', image_url: imageDataUrl }
          ]}
        ],
        max_tokens: 100
      })
    });
    if(!res.ok){
      if(res.status === 401) throw new Error('Invalid API key. Update it in Settings.');
      throw new Error(`Screen request failed (${res.status})`);
    }
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
    coords = JSON.parse(raw);
  }catch(e){
    speak("I had trouble figuring out where that is on your screen.");
    return;
  }

  if(!coords || coords.found === false){
    speak(`I couldn't find ${instruction} on your screen.`);
    return false;
  }

  const clickX = Math.round((coords.x || 0) * screenW);
  const clickY = Math.round((coords.y || 0) * screenH);

  try{
    await callAgent('/click', { method:'POST', body:{ x: clickX, y: clickY } });
  }catch(e){ speak(agentUnavailableMessage()); return false; }

  if(typeText){
    await new Promise(r => setTimeout(r, 200));
    try{ await callAgent('/type', { method:'POST', body:{ text: typeText } }); }
    catch(e){ speak(agentUnavailableMessage()); return true; }
    if(pressEnter){
      await new Promise(r => setTimeout(r, 100));
      try{ await callAgent('/key', { method:'POST', body:{ key: 'enter' } }); }catch(e){ /* not fatal */ }
    }
  }

  if(displaySurface && displaySurface !== 'monitor'){
    speak(`Done — though for the most accurate clicking, try sharing your entire screen instead of just a window or tab.`);
  } else if(!typeText){
    speak(`Done, clicked it.`);
  } else {
    speak(`Done, clicked and typed it in.`);
  }
  return true;
}

// "upload photo" / "upload video" — clicks whatever create/upload/add-media
// control is visible (Instagram's + Create icon, LinkedIn's post/media
// button, or any other site's upload button), which normally pops open
// either an in-page menu or the OS's native "Open file" dialog. If the user
// named a specific file, this then types its path straight into that native
// dialog's filename field and presses Enter — Windows/macOS/Linux file
// pickers all accept a typed path this way even without browsing to it. If
// no file was named, it leaves the dialog open for the user to pick by hand.
async function performScreenUpload(kind, filePathHint){
  const label = kind === 'video' ? 'video' : (kind === 'reel' ? 'reel' : 'photo');
  const clickTarget = `the button used to upload or post a new ${label} — could be a "+" Create icon, a camera icon, an "Add media" button, or similar`;
  const clicked = await performScreenClick(clickTarget, null, false);
  if(!clicked) return;

  if(!filePathHint){
    speak(`I've clicked to start uploading a ${label}. If a menu appeared first, tell me which option to click, or pick your file from the dialog yourself.`);
    return;
  }

  // Give the native file-picker (or in-page menu) a moment to appear.
  await new Promise(r => setTimeout(r, 900));
  try{
    await callAgent('/type', { method:'POST', body:{ text: filePathHint } });
    await new Promise(r => setTimeout(r, 150));
    await callAgent('/key', { method:'POST', body:{ key: 'enter' } });
    speak(`Typed in "${filePathHint}" and opened it. If a menu appeared instead of the file picker, say "click post" or "click reel" first, then try again.`);
  }catch(e){
    speak(agentUnavailableMessage());
  }
}

if(screenShareToggleBtn){
  screenShareToggleBtn.addEventListener('click', async ()=>{
    if(screenActive){
      // Already sharing — treat a tap as "what's on my screen right now?"
      await askScreenQuestion("What's on my screen?");
    } else {
      const ok = await startScreenShare();
      if(ok) speak("I can see your screen now. Highlight anything and ask me about it, or say what's on my screen.");
    }
  });
}

/* ---------- Auto-scroll: continuously scroll whatever window has focus ----------
   Voice-only feature (no button) since it's meant for hands-free browsing —
   say "auto scroll" while looking at YouTube/Instagram/Reddit/LinkedIn/
   Facebook/WhatsApp/anything, and it scrolls that window until you say "stop".
   This has to run through the local desktop agent (maximus_agent.py, see the
   /scroll endpoint) because a browser tab can never simulate input into a
   DIFFERENT window or a native app for security reasons — same restriction
   explained in DESKTOP_AGENT_README.md for opening apps, etc. */
let autoScrollActive = false;

async function startAutoScroll(direction){
  try{
    await callAgent('/scroll', { method:'POST', body:{ action:'start', direction: direction || 'down' } });
    autoScrollActive = true;
    speak(`Auto-scrolling ${direction === 'up' ? 'up' : 'down'}. Say "stop" when you want me to stop.`);
  }catch(e){ speak(agentUnavailableMessage()); }
}

async function stopAutoScroll(){
  const wasActive = autoScrollActive;
  autoScrollActive = false;
  try{
    await callAgent('/scroll', { method:'POST', body:{ action:'stop' } });
    if(wasActive) speak('Stopped scrolling.');
  }catch(e){ if(wasActive) speak(agentUnavailableMessage()); }
}

// A single, one-off nudge — "scroll up" / "scroll down" said on their own —
// as opposed to startAutoScroll(), which scrolls continuously until "stop".
async function stepScroll(direction){
  try{
    await callAgent('/scroll', { method:'POST', body:{ action:'step', direction: direction || 'down' } });
  }catch(e){ speak(agentUnavailableMessage()); }
}

/* ---------- "Read aloud" button on completed AI chat answers ---------- */
let currentReadingMsgId = null;

function syncReadButtons(container){
  const scope = container || document;
  scope.querySelectorAll('[data-read-aloud]').forEach(btn=>{
    const active = btn.dataset.readAloud === currentReadingMsgId;
    btn.textContent = active ? '⏹ Stop reading' : '🔊 Read aloud';
    btn.classList.toggle('active', active);
  });
}

function stopReadingAloud(){
  if(!currentReadingMsgId) return;
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentReadingMsgId = null;
  syncReadButtons();
}

function readMessageAloud(msgId, text){
  if(!('speechSynthesis' in window)){
    showToast('Text-to-speech is not supported in this browser.');
    return;
  }
  // Tapping the button again on the message currently being read stops it.
  if(currentReadingMsgId === msgId){
    stopReadingAloud();
    return;
  }
  window.speechSynthesis.cancel(); // stop whatever else was reading first
  speechSuppressed = false;
  currentReadingMsgId = msgId;
  syncReadButtons();

  const clean = cleanForSpeech(text);
  // Split into sentence-sized chunks and queue them one after another —
  // keeps Stop responsive on long answers instead of one giant utterance
  // that can't be interrupted mid-sentence in some browsers.
  const chunks = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  let i = 0;
  function speakNext(){
    if(currentReadingMsgId !== msgId || i >= chunks.length){
      if(currentReadingMsgId === msgId){ currentReadingMsgId = null; syncReadButtons(); }
      markSpeechEnd();
      return;
    }
    const utter = new SpeechSynthesisUtterance(chunks[i].trim());
    utter.rate = 1.05;
    utter.volume = 1;
    utter.pitch = 0.9;
    utter.onstart = markSpeechStart;
    utter.onend = ()=>{ markSpeechEnd(); i++; speakNext(); };
    utter.onerror = ()=>{ markSpeechEnd(); i++; speakNext(); };
    window.speechSynthesis.speak(utter);
  }
  speakNext();
}

/* ---------- Continuous speech recognition (separate instance from composer mic) ---------- */
let assistantRecognition = null;
let wantContinuousListening = false;
const AssistantSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let lastQuickOpened = null;
// Deliberately turns Spotify down the instant speech is detected, and back up
// after a beat of silence — this is a much more reliable version of "duck the
// music while I'm talking" than depending on Chrome's own (unpredictable,
// Bluetooth-latency-sensitive) audio ducking. Works the same regardless of
// whether output is the laptop speakers or a Bluetooth speaker, since it
// controls Spotify's own volume directly rather than relying on the OS/browser.
let musicDucked = false;
let restoreVolumeTimer = null;
async function duckMusicForCommand(){
  if(!spotifyPlayer) return;
  if(!musicDucked){
    musicDucked = true;
    try{ await spotifyPlayer.setVolume(0.15); }catch(e){}
  }
  clearTimeout(restoreVolumeTimer);
  restoreVolumeTimer = setTimeout(restoreMusicVolume, 1800);
}
async function restoreMusicVolume(){
  if(!spotifyPlayer || !musicDucked) return;
  musicDucked = false;
  try{ await spotifyPlayer.setVolume(1.0); }catch(e){}
}

// Tracks whether the recognition engine is currently actually running, and
// the last time it did something (started, produced a result, heard speech
// start/end). Chrome's Web Speech API has two failure modes this guards
// against: (1) onend fires and calling start() again *immediately* throws
// because the engine hasn't fully released the mic yet — the old code
// swallowed that error and just gave up, leaving the button saying "Stop
// Listening" while the mic was actually dead; (2) on longer sessions the
// engine can silently wedge without ever firing onend at all. Both look the
// same to the user: "it's listening but not taking the command."
let recognitionRunning = false;
let restartTimer = null;
let lastRecognitionActivity = Date.now();

// Chrome's continuous mode "finalizes" a chunk of speech the moment you
// pause for breath or to think — well before a whole sentence like "click
// the search bar and type cats" is actually finished. Reacting to every
// final chunk immediately is what used to make Maximus "answer in the
// middle" of what someone was saying. So finalized speech is buffered here
// and only dispatched once the mic has stayed quiet for a short beat, which
// gives multi-part phrases a chance to finish before anything runs.
let pendingFinalText = '';
let finalizeTimer = null;
const FINALIZE_QUIET_MS = 750;      // normal "wait for a pause" window
const FINALIZE_QUIET_MS_FAST = 150; // short, unambiguous commands fire almost instantly
const FAST_TRACK_RE = /^(?:stop|stop scrolling|stop listening|stop speaking|scroll up|scroll down|auto ?scroll|auto ?scroll up|stop auto ?scroll(?:ing)?)$/;

function dispatchPendingFinal(){
  const text = pendingFinalText.trim();
  pendingFinalText = '';
  if(assistantTranscript) assistantTranscript.textContent = '';
  if(text) handleVoiceInput(text);
}

// Drops any speech buffered so far without acting on it — used whenever
// listening is explicitly stopped or interrupted, so a half-heard phrase
// from a moment ago can't fire late.
function clearPendingVoiceBuffer(){
  clearTimeout(finalizeTimer);
  pendingFinalText = '';
  if(assistantTranscript) assistantTranscript.textContent = '';
}

function scheduleRecognitionRestart(delay){
  clearTimeout(restartTimer);
  restartTimer = setTimeout(()=>{
    if(!wantContinuousListening || recognitionRunning) return;
    try{
      assistantRecognition.start();
    }catch(e){
      // Engine still tearing down from the previous session — back off and
      // try again rather than giving up silently.
      scheduleRecognitionRestart(400);
    }
  }, delay);
}

if(AssistantSpeechRecognition){
  assistantRecognition = new AssistantSpeechRecognition();
  assistantRecognition.continuous = true;
  assistantRecognition.interimResults = true;
  // Ask the engine for several guesses per phrase, not just its single best
  // guess. When one guess doesn't match anything Maximus recognizes, trying
  // the runner-up guesses against known command phrasing (see
  // pickBestTranscript below) catches a lot of the "it heard something
  // completely different" misfires without needing a repeat.
  assistantRecognition.maxAlternatives = 5;
  assistantRecognition.lang = state.settings.voiceLang || 'en-IN';

  assistantRecognition.onstart = ()=>{
    recognitionRunning = true;
    lastRecognitionActivity = Date.now();
  };
  assistantRecognition.onspeechstart = ()=>{
    lastRecognitionActivity = Date.now();
    if(assistantStatus && activeSpeechCount === 0) assistantStatus.textContent = 'Hearing you…';
  };
  assistantRecognition.onspeechend = ()=>{
    lastRecognitionActivity = Date.now();
    if(assistantStatus && wantContinuousListening && activeSpeechCount === 0) assistantStatus.textContent = 'Listening…';
  };
  // Picks the best of several candidate transcripts for one recognized
  // phrase. Chrome's #1-ranked guess is sometimes NOT what was actually
  // said ("it heard something completely different") — but a lower-ranked
  // alternative often is, especially for short command words. If any
  // alternative clearly contains a recognizable command keyword, prefer
  // that one; otherwise fall back to the top-confidence guess (normal
  // questions/chit-chat don't need this correction).
  const COMMAND_KEYWORD_HINTS = /\b(scroll|scrolling|click|tap|press|select|stop|open|close|play|pause|volume|brightness|mute|unmute|screenshot|desktop|task manager|file explorer|recycle bin|vision|screen|message|whatsapp|navigate|location|near me|restart|shut down|sleep computer)\b/;
  function pickBestTranscript(result){
    for(let i=0; i<result.length; i++){
      const t = result[i].transcript;
      if(COMMAND_KEYWORD_HINTS.test(t.toLowerCase())) return t;
    }
    return result[0].transcript;
  }

  assistantRecognition.onresult = (event)=>{
    lastRecognitionActivity = Date.now();
    let quickFinal = '', quickInterim = '';
    for(let i=event.resultIndex; i<event.results.length; i++){
      const t = pickBestTranscript(event.results[i]);
      if(event.results[i].isFinal) quickFinal += (quickFinal ? ' ' : '') + t;
      else quickInterim += t;
    }

    if((quickFinal || quickInterim).trim()) duckMusicForCommand();

    // Saying "stop" / "stop speaking" / "stop talking" always works, even
    // mid-answer, so you can interrupt Maximus without touching a button.
    if(activeSpeechCount > 0){
      const stopPhrase = /\b(stop|stop speaking|stop talking|be quiet|shut up)\b/.test((quickFinal + quickInterim).trim().toLowerCase());
      if(stopPhrase) stopSpeaking();
      // While actively talking, ignore everything else — otherwise Maximus's
      // own voice coming through the speakers can get picked back up as input.
      return;
    }

    if(assistantTranscript) assistantTranscript.textContent = (pendingFinalText + ' ' + quickFinal + ' ' + quickInterim).trim();

    // "open <site>" is unambiguous even mid-utterance, so fire it the instant it
    // shows up in the interim transcript instead of waiting for finalization —
    // makes basic browsing commands feel instant rather than laggy. Skipped
    // once something is already buffered, so it can't fire mid-way through a
    // longer, unrelated phrase that merely contains "open" as a later word.
    if(!quickFinal && quickInterim && !pendingFinalText){
      const quick = normalizeSitePhrase(quickInterim.trim().toLowerCase()).match(/^open ([a-z]+)(?:\.com)?(?: website)?$/);
      if(quick && ASSISTANT_SITES[quick[1]] && quick[1] !== lastQuickOpened){
        lastQuickOpened = quick[1];
        window.open(ASSISTANT_SITES[quick[1]], '_blank');
        speak(`Opening ${quick[1]}.`);
      }
    }

    if(quickFinal.trim()){
      // If we already opened the site instantly from the interim guess above,
      // don't run the command a second time now that the phrase finalized.
      const finalQuick = normalizeSitePhrase(quickFinal.trim().toLowerCase()).match(/^open ([a-z]+)(?:\.com)?(?: website)?$/);
      const alreadyHandled = finalQuick && finalQuick[1] === lastQuickOpened && !pendingFinalText;
      lastQuickOpened = null;
      if(!alreadyHandled) pendingFinalText = (pendingFinalText + ' ' + quickFinal.trim()).trim();
    }

    // Every new result (final or interim) means the person is still talking,
    // so push the "they've gone quiet" timer back out. Short, unambiguous
    // commands still fire almost instantly so scrolling/stopping never feels
    // laggy; anything else waits for a real pause before Maximus reacts.
    clearTimeout(finalizeTimer);
    if(pendingFinalText){
      const isFastTrack = FAST_TRACK_RE.test(pendingFinalText.toLowerCase());
      finalizeTimer = setTimeout(dispatchPendingFinal, isFastTrack ? FINALIZE_QUIET_MS_FAST : FINALIZE_QUIET_MS);
    }
  };
  assistantRecognition.onerror = (e)=>{
    if(e.error === 'no-speech' || e.error === 'aborted'){
      // Normal — the engine times itself out after silence. onend will fire
      // right after this and trigger the restart below.
      return;
    }
    console.warn('Assistant recognition error:', e.error);
    if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      showToast('Microphone access was blocked — allow it in your browser to use voice.');
      wantContinuousListening = false;
      recognitionRunning = false;
      clearPendingVoiceBuffer();
      setListenButtonState(false);
      return;
    }
    // network / audio-capture / other transient errors: let onend (which
    // always fires after onerror) handle the restart, just with a slightly
    // longer backoff so we don't hammer a genuinely broken mic.
    if(e.error === 'network' || e.error === 'audio-capture'){
      lastRecognitionActivity = Date.now() - 15000; // makes the watchdog check it sooner
    }
  };
  assistantRecognition.onend = ()=>{
    recognitionRunning = false;
    // Recognition auto-stops after silence (or an error); restart it to stay
    // "continuously listening" until the user explicitly clicks Stop
    // Listening. A short delay avoids the "start() called before the engine
    // finished tearing down" failure that used to leave listening silently
    // dead — see scheduleRecognitionRestart's comment above.
    if(wantContinuousListening) scheduleRecognitionRestart(250);
  };
}

// Applies a newly chosen accent (Settings → Voice recognition accent) to
// both recognition engines. SpeechRecognition only reads .lang when start()
// is called, so a change made mid-session needs the engine restarted to
// actually take effect.
function applyVoiceLang(){
  const lang = state.settings.voiceLang || 'en-IN';
  if(recognition) recognition.lang = lang;
  if(assistantRecognition){
    assistantRecognition.lang = lang;
    if(wantContinuousListening){
      try{ assistantRecognition.stop(); }catch(e){}
      recognitionRunning = false;
      scheduleRecognitionRestart(300);
    }
  }
  showToast(`Voice recognition set to ${lang}.`);
}

// Watchdog: if we're supposed to be listening but nothing has happened
// (no start/result/speech event) for 15s, the engine has likely wedged
// without firing onend at all — a known Chrome long-session bug. Force a
// stop+restart rather than leaving the user stuck with a dead mic.
setInterval(()=>{
  if(!wantContinuousListening || !assistantRecognition) return;
  if(Date.now() - lastRecognitionActivity > 15000){
    lastRecognitionActivity = Date.now();
    try{ assistantRecognition.stop(); }catch(e){}
    recognitionRunning = false;
    scheduleRecognitionRestart(300);
  }
}, 5000);

function setListenButtonState(listening){
  if(!listenToggleBtn) return;
  listenToggleBtn.textContent = listening ? '⏹ Stop Listening' : '🎙️ Start Listening';
  listenToggleBtn.classList.toggle('active', listening);
  if(assistantStatus) assistantStatus.textContent = listening ? 'Listening…' : 'Tap "Start Listening" and speak';
}

if(listenToggleBtn){
  listenToggleBtn.addEventListener('click', async ()=>{
    if(!assistantRecognition){
      showToast('Voice recognition is not supported in this browser.');
      return;
    }
    if(wantContinuousListening){
      wantContinuousListening = false;
      clearTimeout(restartTimer);
      clearPendingVoiceBuffer();
      try{ assistantRecognition.stop(); }catch(e){}
      stopMicAnalyser();
      setListenButtonState(false);
    } else {
      wantContinuousListening = true;
      lastRecognitionActivity = Date.now();
      clearPendingVoiceBuffer();
      try{ assistantRecognition.start(); recognitionRunning = true; }catch(e){ scheduleRecognitionRestart(300); }
      await startMicAnalyser();
      setListenButtonState(true);
    }
  });
}

/* ================= SPOTIFY (PKCE login + Web Playback SDK) =================
   No client secret involved anywhere — the PKCE flow is designed to run
   entirely in the browser. Requires Spotify Premium for in-app playback
   (Spotify's own restriction, not something this app can work around);
   without Premium, commands fall back to opening the track on open.spotify.com. */

function generateRandomString(length){
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  const values = crypto.getRandomValues(new Uint8Array(length));
  values.forEach(v => text += possible[v % possible.length]);
  return text;
}
async function sha256(plain){
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}
function base64UrlEncode(buffer){
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function pkceChallengeFromVerifier(verifier){
  return base64UrlEncode(await sha256(verifier));
}

async function spotifyLogin(){
  if(!CONFIG.SPOTIFY_CLIENT_ID){
    showToast('Add your Spotify Client ID in app.js (CONFIG.SPOTIFY_CLIENT_ID) first.');
    return;
  }
  const verifier = generateRandomString(64);
  localStorage.setItem('spotify_verifier', verifier);
  const challenge = await pkceChallengeFromVerifier(verifier);
  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  const params = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleSpotifyRedirect(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const err = params.get('error');
  if(!code && !err) return;
  window.history.replaceState({}, document.title, window.location.pathname);
  if(err){ showToast('Spotify login was cancelled.'); return; }
  const verifier = localStorage.getItem('spotify_verifier');
  if(!verifier) return;
  try{
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: CONFIG.SPOTIFY_CLIENT_ID,
      code_verifier: verifier
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();
    if(data.access_token){
      state.spotify.accessToken = data.access_token;
      state.spotify.refreshToken = data.refresh_token || state.spotify.refreshToken;
      state.spotify.expiresAt = Date.now() + (data.expires_in * 1000);
      save();
      showToast('Spotify connected — try "play <song> on spotify".');
      initSpotifyPlayer();
    } else {
      showToast('Spotify connection failed: ' + (data.error_description || data.error || 'unknown error'));
    }
  }catch(e){
    console.warn('Spotify token exchange failed', e);
    showToast('Spotify connection failed.');
  }
}

async function ensureSpotifyToken(){
  const sp = state.spotify;
  if(!sp || !sp.accessToken) return null;
  if(Date.now() < sp.expiresAt - 60000) return sp.accessToken;
  if(!sp.refreshToken) return null;
  try{
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: sp.refreshToken,
      client_id: CONFIG.SPOTIFY_CLIENT_ID
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();
    if(data.access_token){
      sp.accessToken = data.access_token;
      if(data.refresh_token) sp.refreshToken = data.refresh_token;
      sp.expiresAt = Date.now() + (data.expires_in * 1000);
      save();
      return sp.accessToken;
    }
  }catch(e){ console.warn('Spotify token refresh failed', e); }
  return null;
}

let spotifyPlayer = null;
let spotifyPlayerReady = false;
window.onSpotifyWebPlaybackSDKReady = () => {
  spotifyPlayerReady = true;
  if(state.spotify && state.spotify.accessToken) initSpotifyPlayer();
};

async function initSpotifyPlayer(){
  const token = await ensureSpotifyToken();
  if(!token || !spotifyPlayerReady || !window.Spotify || spotifyPlayer) return;
  spotifyPlayer = new Spotify.Player({
    name: 'Maximus Web Player',
    getOAuthToken: cb => { ensureSpotifyToken().then(t => cb(t)); },
    volume: 1.0
  });
  spotifyPlayer.addListener('ready', ({ device_id }) => {
    state.spotify.deviceId = device_id;
    save();
  });
  spotifyPlayer.addListener('not_ready', () => { state.spotify.deviceId = null; });
  spotifyPlayer.addListener('player_state_changed', (s) => {
    updateNowPlayingUI();
    syncListeningWithMusic(s);
  });
  spotifyPlayer.addListener('initialization_error', e => console.warn('Spotify init error', e));
  spotifyPlayer.addListener('authentication_error', e => {
    console.warn('Spotify auth error', e);
    showToast('Your Spotify session expired — reconnect it in Settings.');
  });
  spotifyPlayer.addListener('account_error', e => {
    console.warn('Spotify account error', e);
    showToast('In-app Spotify playback needs a Premium account.');
  });
  spotifyPlayer.connect();
}

// Pulls the top 5 matches (not just 1) and scores them against the spoken
// query by word overlap, so a noisy/partial transcription still lands on the
// track whose title actually matches what was said, instead of blindly
// trusting whatever Spotify's raw #1 result happens to be.
function trackMatchScore(query, trackName){
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const qWords = new Set(norm(query));
  const tWords = norm(trackName);
  if(!qWords.size || !tWords.length) return 0;
  let overlap = 0;
  tWords.forEach(w => { if(qWords.has(w)) overlap++; });
  const exact = norm(query).join(' ') === tWords.join(' ') ? 2 : 0;
  return overlap / Math.max(qWords.size, tWords.length) + exact;
}

async function spotifySearchTrack(query){
  const token = await ensureSpotifyToken();
  if(!token) return null;
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const items = (data.tracks && data.tracks.items) || [];
  if(!items.length) return null;
  let best = items[0], bestScore = trackMatchScore(query, items[0].name);
  for(let i=1;i<items.length;i++){
    const score = trackMatchScore(query, items[i].name);
    if(score > bestScore){ best = items[i]; bestScore = score; }
  }
  return { uri: best.uri, name: best.name, artist: best.artists.map(a => a.name).join(', ') };
}

async function spotifyPlayTrack(query){
  const token = await ensureSpotifyToken();
  if(!token){
    window.open(buildSearchUrl('spotify', query), '_blank');
    speak(`I'm not connected to Spotify yet, so here's ${query} on the Spotify website. Connect Spotify in Settings so I can play it directly.`);
    return;
  }
  if(!state.spotify.deviceId){
    await initSpotifyPlayer();
    await new Promise(r => setTimeout(r, 1200));
  }
  const track = await spotifySearchTrack(query);
  if(!track){
    speak(`I couldn't find ${query} on Spotify.`);
    return;
  }
  if(!state.spotify.deviceId){
    speak("Spotify hasn't finished connecting yet — give it a second and try again.");
    return;
  }
  try{
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.spotify.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [track.uri] })
    });
    if(res.ok || res.status === 204){
      speak(`Now playing ${track.name} by ${track.artist}.`);
    } else if(res.status === 403){
      speak('In-app Spotify playback needs a Premium account.');
    } else if(res.status === 404){
      speak("I couldn't find an active Spotify device — keep this tab open and try again.");
    } else {
      speak('Something went wrong starting playback on Spotify.');
    }
  }catch(e){
    console.warn('Spotify play failed', e);
    speak('Something went wrong starting playback on Spotify.');
  }
  updateNowPlayingUI();
}

/* ================= YOUTUBE (Data API v3 search + direct-play) =================
   Uses a plain API key (no OAuth — this only searches, it never touches anyone's
   account), so it works the moment a key is pasted into Settings. There's no
   "remote device" concept like Spotify Connect — playing a video just means
   opening its watch page directly instead of a generic search results page,
   which starts playback immediately since it's a real navigation the user
   asked for, not a background autoplay. */
async function youtubeSearchVideo(query){
  const key = state.settings.youtubeApiKey;
  if(!key) return { error: 'no-key' };
  try{
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if(data.error){
      console.warn('YouTube API error', data.error);
      const reason = (data.error.errors && data.error.errors[0] && data.error.errors[0].reason) || data.error.status || '';
      if(reason === 'quotaExceeded') return { error: 'quota' };
      if(res.status === 403 || reason.toLowerCase().includes('accessnotconfigured') || reason.toLowerCase().includes('forbidden')) return { error: 'not-enabled' };
      if(res.status === 400 || reason.toLowerCase().includes('keyinvalid') || reason.toLowerCase().includes('badrequest')) return { error: 'bad-key' };
      return { error: 'api', message: data.error.message };
    }
    const items = data.items || [];
    if(!items.length) return null;
    let best = items[0], bestScore = trackMatchScore(query, items[0].snippet.title);
    for(let i=1;i<items.length;i++){
      const score = trackMatchScore(query, items[i].snippet.title);
      if(score > bestScore){ best = items[i]; bestScore = score; }
    }
    return { videoId: best.id.videoId, title: best.snippet.title, channel: best.snippet.channelTitle };
  }catch(e){
    console.warn('YouTube search failed', e);
    return { error: 'network' };
  }
}

async function youtubePlayVideo(query){
  if(!state.settings.youtubeApiKey){
    window.open(buildSearchUrl('youtube', query), '_blank');
    speak(`I'm not set up to jump straight to a video yet, so here's a YouTube search for ${query}. Add a YouTube API key in Settings so I can play it directly.`);
    return;
  }
  const video = await youtubeSearchVideo(query);
  if(video && video.error){
    window.open(buildSearchUrl('youtube', query), '_blank');
    const messages = {
      'not-enabled': "Your YouTube API key can't reach YouTube Data API v3 — make sure that API is enabled on your Google Cloud project and that the key's restrictions include it.",
      'bad-key': "Your YouTube API key looks invalid or malformed — double check you copied the whole key into Settings.",
      'quota': "Your YouTube API key has hit its daily quota — it resets at midnight Pacific time, or you can create a new key.",
      'network': "I couldn't reach YouTube's search service just now.",
      'api': `YouTube's search API returned an error: ${video.message || 'unknown error'}.`
    };
    speak((messages[video.error] || "Something went wrong searching YouTube.") + " Opening a search page instead.");
    return;
  }
  if(!video){
    window.open(buildSearchUrl('youtube', query), '_blank');
    speak(`I couldn't find a specific match for ${query}, so here's a search on YouTube instead.`);
    return;
  }
  window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank');
  speak(`Now playing ${video.title} on YouTube.`);
}


async function spotifyPause(){
  if(!spotifyPlayer){ speak("Spotify isn't connected."); return; }
  await spotifyPlayer.pause();
  speak('Paused.');
}
async function spotifyResume(){
  if(!spotifyPlayer){ speak("Spotify isn't connected."); return; }
  await spotifyPlayer.resume();
  speak('Resuming.');
}
async function spotifyNext(){
  if(!spotifyPlayer){ speak("Spotify isn't connected."); return; }
  await spotifyPlayer.nextTrack();
  speak('Skipping ahead.');
}
async function spotifyPrev(){
  if(!spotifyPlayer){ speak("Spotify isn't connected."); return; }
  await spotifyPlayer.previousTrack();
  speak('Going back.');
}

// Spotify's repeat mode is a player-level setting, not per-track, so this is
// the closest available thing to "loop this song": repeat mode "track".
async function spotifySetLoop(on){
  const token = await ensureSpotifyToken();
  if(!token || !state.spotify.deviceId){ speak("Spotify isn't connected."); return; }
  try{
    await fetch(`https://api.spotify.com/v1/me/player/repeat?state=${on ? 'track' : 'off'}&device_id=${state.spotify.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    speak(on ? 'Looping this song.' : 'Loop turned off.');
    setTimeout(updateNowPlayingUI, 300);
  }catch(e){
    console.warn('Spotify repeat toggle failed', e);
    speak('Could not change the loop setting.');
  }
}

let npControlsWired = false;
function wireNowPlayingControls(){
  if(npControlsWired) return;
  npControlsWired = true;
  const playPauseBtn = document.getElementById('npPlayPauseBtn');
  const prevBtn = document.getElementById('npPrevBtn');
  const nextBtn = document.getElementById('npNextBtn');
  const loopBtn = document.getElementById('npLoopBtn');
  if(playPauseBtn) playPauseBtn.addEventListener('click', async ()=>{
    if(!spotifyPlayer) return;
    const s = await spotifyPlayer.getCurrentState();
    if(s && !s.paused) await spotifyPause(); else await spotifyResume();
  });
  if(prevBtn) prevBtn.addEventListener('click', spotifyPrev);
  if(nextBtn) nextBtn.addEventListener('click', spotifyNext);
  if(loopBtn) loopBtn.addEventListener('click', async ()=>{
    const s = spotifyPlayer && await spotifyPlayer.getCurrentState();
    const loopingNow = s && s.repeat_mode === 2;
    await spotifySetLoop(!loopingNow);
  });
}

function updateNowPlayingUI(){
  const bar = document.getElementById('spotifyNowPlaying');
  if(!bar || !spotifyPlayer) return;
  wireNowPlayingControls();
  spotifyPlayer.getCurrentState().then(s => {
    if(!s || !s.track_window || !s.track_window.current_track){
      bar.classList.add('hidden');
      return;
    }
    const t = s.track_window.current_track;
    bar.classList.remove('hidden');
    const trackEl = document.getElementById('nowPlayingTrack');
    if(trackEl) trackEl.textContent = `${t.name} — ${t.artists.map(a => a.name).join(', ')}`;
    const playPauseBtn = document.getElementById('npPlayPauseBtn');
    if(playPauseBtn) playPauseBtn.textContent = s.paused ? '▶' : '⏸';
    const loopBtn = document.getElementById('npLoopBtn');
    if(loopBtn) loopBtn.classList.toggle('active', s.repeat_mode === 2);
  }).catch(()=>{});
}

/* ================= WEATHER (Open-Meteo — free, no API key, no request limit) ================= */
const WMO_CODES = {
  0:'clear sky', 1:'mainly clear', 2:'partly cloudy', 3:'overcast',
  45:'fog', 48:'depositing rime fog',
  51:'light drizzle', 53:'moderate drizzle', 55:'dense drizzle',
  56:'light freezing drizzle', 57:'dense freezing drizzle',
  61:'slight rain', 63:'moderate rain', 65:'heavy rain',
  66:'light freezing rain', 67:'heavy freezing rain',
  71:'slight snow', 73:'moderate snow', 75:'heavy snow', 77:'snow grains',
  80:'slight rain showers', 81:'moderate rain showers', 82:'violent rain showers',
  85:'slight snow showers', 86:'heavy snow showers',
  95:'a thunderstorm', 96:'a thunderstorm with slight hail', 99:'a thunderstorm with heavy hail'
};

async function geocodeCity(name){
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  const data = await res.json();
  const r = data.results && data.results[0];
  if(!r) return null;
  return { lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1, r.country].filter(Boolean).join(', ') };
}

async function getWeatherReport(locationName){
  let lat, lon, label;
  if(locationName){
    const g = await geocodeCity(locationName);
    if(!g){ speak(`I couldn't find a place called ${locationName}.`); return; }
    lat = g.lat; lon = g.lon; label = g.label;
  } else if(navigator.geolocation){
    const pos = await new Promise(res => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 8000 }));
    if(pos){ lat = pos.coords.latitude; lon = pos.coords.longitude; label = 'your location'; }
  }
  if(lat === undefined){
    speak("I need a location for that — try \"weather in Hyderabad\", or allow location access.");
    return;
  }
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const desc = WMO_CODES[c.weather_code] || 'unusual conditions';
    const where = label === 'your location' ? 'your location' : label;
    const text = `It's currently ${Math.round(c.temperature_2m)}°C in ${where}, with ${desc}. Feels like ${Math.round(c.apparent_temperature)}°C, humidity ${c.relative_humidity_2m} percent, wind ${Math.round(c.wind_speed_10m)} kilometers per hour.`;
    speak(text);
    if(assistantTranscript) assistantTranscript.textContent = text;
  }catch(e){
    console.warn('Weather fetch failed', e);
    speak("I couldn't reach the weather service right now.");
  }
}

/* ================= NEWS (Google News RSS via a public CORS proxy — free, no key) =================
   No news API is genuinely free *and* unlimited *and* browser-callable in production, so this
   reads Google News' public RSS feed through allorigins.win (a free, keyless CORS proxy) instead
   of a rate-limited API. If allorigins is ever slow/down, swap PROXY_URL for another CORS proxy. */
function newsProxyUrl(feedUrl){
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
}

async function getNewsReport(topic){
  const feedUrl = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`
    : `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`;
  try{
    const res = await fetch(newsProxyUrl(feedUrl));
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0, 5);
    if(!items.length){ speak("I couldn't find any news right now."); return; }
    const headlines = items.map(it => {
      let title = it.querySelector('title')?.textContent || '';
      return title.replace(/\s*-\s*[^-]+$/, '').trim(); // drop trailing " - Source Name"
    }).filter(Boolean);
    const spoken = headlines.map((h, i) => `${i + 1}. ${h}.`).join(' ');
    speak(`${topic ? `Here's the latest on ${topic}.` : "Here are today's top headlines."} ${spoken}`);
    if(assistantTranscript) assistantTranscript.textContent = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
  }catch(e){
    console.warn('News fetch failed', e);
    speak("I couldn't reach the news service right now.");
  }
}

/* ---------- Voice command engine ---------- */
const ASSISTANT_SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  chatgpt: 'https://chatgpt.com',
  instagram: 'https://www.instagram.com',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  reddit: 'https://www.reddit.com',
  whatsapp: 'https://web.whatsapp.com',
  spotify: 'https://open.spotify.com',
  maps: 'https://www.google.com/maps',
  gmail: 'https://mail.google.com/mail/u/0/#inbox',
  linkedin: 'https://www.linkedin.com/feed/',
  netflix: 'https://www.netflix.com',
  // Disney+ isn't sold standalone in India — it's merged into Hotstar there.
  disneyplus: 'https://www.hotstar.com',
  primevideo: 'https://www.primevideo.com',
  twitch: 'https://www.twitch.tv',
  facebook: 'https://www.facebook.com',
  discord: 'https://discord.com/app',
  telegram: 'https://web.telegram.org',
  outlook: 'https://outlook.live.com/mail/',
  myntra: 'https://www.myntra.com',
  meesho: 'https://www.meesho.com',
  ajio: 'https://www.ajio.com',
  ebay: 'https://www.ebay.com',
  aliexpress: 'https://www.aliexpress.com',
  yahoomail: 'https://mail.yahoo.com',
  github: 'https://github.com',

  // Google workspace apps
  googledrive: 'https://drive.google.com',
  googledocs: 'https://docs.google.com',
  googlesheets: 'https://sheets.google.com',
  googleslides: 'https://slides.google.com',
  googlecalendar: 'https://calendar.google.com',
  googletranslate: 'https://translate.google.com',
  googlephotos: 'https://photos.google.com',
  googlemeet: 'https://meet.google.com',
  googlekeep: 'https://keep.google.com',

  // Microsoft
  onedrive: 'https://onedrive.live.com',
  microsoftteams: 'https://teams.microsoft.com',
  microsoft365: 'https://www.office.com',
  bing: 'https://www.bing.com',
  copilot: 'https://copilot.microsoft.com',

  // Streaming / news
  crunchyroll: 'https://www.crunchyroll.com',
  bbc: 'https://www.bbc.com',
  cnn: 'https://www.cnn.com',
  reuters: 'https://www.reuters.com',
  ndtv: 'https://www.ndtv.com',
  timesofindia: 'https://timesofindia.indiatimes.com',
  thehindu: 'https://www.thehindu.com',
  cricbuzz: 'https://www.cricbuzz.com',
  espn: 'https://www.espn.com',

  // Finance / markets
  tradingview: 'https://www.tradingview.com',
  yahoofinance: 'https://finance.yahoo.com',
  coinmarketcap: 'https://coinmarketcap.com',
  coingecko: 'https://www.coingecko.com',
  zerodha: 'https://kite.zerodha.com',
  groww: 'https://groww.in',
  upstox: 'https://upstox.com'
};

function buildSearchUrl(site, query){
  const q = encodeURIComponent(query.trim());
  switch(site){
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    case 'google': return `https://www.google.com/search?q=${q}`;
    case 'chatgpt': return `https://chatgpt.com/?q=${q}`;
    case 'instagram': return `https://www.instagram.com/explore/search/keyword/?q=${q}`;
    case 'amazon': return `https://www.amazon.in/s?k=${q}`;
    case 'flipkart': return `https://www.flipkart.com/search?q=${q}`;
    case 'reddit': return `https://www.reddit.com/search/?q=${q}`;
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    case 'spotify': return `https://open.spotify.com/search/${q}`;
    case 'gmail': return `https://mail.google.com/mail/u/0/#search/${q}`;
    case 'linkedin': return `https://www.linkedin.com/search/results/all/?keywords=${q}`;
    case 'bing': return `https://www.bing.com/search?q=${q}`;
    case 'github': return `https://github.com/search?q=${q}`;
    default: return null;
  }
}

/* ---------------- Maximus Desktop Agent client -----------------
   Talks to the local Python agent (maximus_agent.py) that must be running
   on this same computer. That program is the only thing actually allowed
   to touch the operating system — this browser page just asks it politely
   over localhost HTTP. If it's not running, every call below throws and
   the caller falls back to a friendly spoken explanation. */
async function callAgent(path, options={}){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 5000);
  try{
    const res = await fetch((CONFIG.AGENT_URL || 'http://127.0.0.1:5055') + path, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    if(!res.ok){
      let detail = '';
      try{ detail = (await res.json()).error || ''; }catch(e){}
      throw new Error(detail || `Agent error ${res.status}`);
    }
    return await res.json().catch(()=>({}));
  } finally {
    clearTimeout(timer);
  }
}

function agentUnavailableMessage(){
  return "I can't reach the Maximus Desktop Agent on this computer. Start it first — run \"python maximus_agent.py\" in a terminal on this machine — then try that again.";
}

function findContact(name){
  const n = name.trim().toLowerCase();
  const contacts = state.contacts || [];
  return contacts.find(c => c.name.toLowerCase() === n)
      || contacts.find(c => c.name.toLowerCase().startsWith(n))
      || contacts.find(c => c.name.toLowerCase().includes(n));
}

function normalizeSitePhrase(s){
  return s
    .replace(/\byou\s*tube\b/g, 'youtube')
    .replace(/\bwhat'?s\s*app\b/g, 'whatsapp')
    .replace(/\bwhat\s*app\b/g, 'whatsapp')
    .replace(/\bchat\s*g\.?p\.?t\.?\b/g, 'chatgpt')
    .replace(/\binsta\b/g, 'instagram')
    .replace(/\bflip\s*kart\b/g, 'flipkart')
    .replace(/\bred\s*it\b/g, 'reddit')
    .replace(/\blinked\s*in\b/g, 'linkedin')
    .replace(/\bg\s*mail\b/g, 'gmail')
    .replace(/\bdisney\s*(\+|plus)?\b/g, 'disneyplus')
    .replace(/\b(amazon\s*)?prime\s*video\b/g, 'primevideo')
    .replace(/\bface\s*book\b/g, 'facebook')
    .replace(/\byahoo\s*mail\b/g, 'yahoomail')
    .replace(/\bali\s*express\b/g, 'aliexpress')
    .replace(/\bgit\s*hub\b/g, 'github')
    .replace(/\be\s*bay\b/g, 'ebay')
    // Google workspace apps — must come before any bare "google" handling
    .replace(/\bgoogle\s*drive\b/g, 'googledrive')
    .replace(/\bgoogle\s*docs?\b/g, 'googledocs')
    .replace(/\bgoogle\s*sheets?\b/g, 'googlesheets')
    .replace(/\bgoogle\s*slides?\b/g, 'googleslides')
    .replace(/\bgoogle\s*calendar\b/g, 'googlecalendar')
    .replace(/\bgoogle\s*translate\b/g, 'googletranslate')
    .replace(/\bgoogle\s*photos?\b/g, 'googlephotos')
    .replace(/\bgoogle\s*meet\b/g, 'googlemeet')
    .replace(/\bgoogle\s*keep\b/g, 'googlekeep')
    .replace(/\bgoogle\s*maps?\b/g, 'maps')
    // Microsoft
    .replace(/\bone\s*drive\b/g, 'onedrive')
    .replace(/\b(microsoft|ms)\s*teams\b/g, 'microsoftteams')
    .replace(/\b(microsoft|office)\s*365\b/g, 'microsoft365')
    // Streaming / news
    .replace(/\bcrunchy\s*roll\b/g, 'crunchyroll')
    .replace(/\btimes\s*of\s*india\b/g, 'timesofindia')
    .replace(/\bthe\s*hindu\b/g, 'thehindu')
    .replace(/\bcric\s*buzz\b/g, 'cricbuzz')
    // Finance / markets
    .replace(/\btrading\s*view\b/g, 'tradingview')
    .replace(/\byahoo\s*finance\b/g, 'yahoofinance')
    .replace(/\bcoin\s*market\s*cap\b/g, 'coinmarketcap')
    .replace(/\bcoin\s*gecko\b/g, 'coingecko')
    .replace(/\bzerodha(\s*kite)?\b/g, 'zerodha');
}

// A handful of very common speech-recognition mishears around Maximus's own
// command words — fixed up before matching so "star scroll", "odo scroll",
// "clique the button", etc. still land on the right command instead of
// falling through to the AI chat pipeline as gibberish.
function correctMishears(s){
  return s
    .replace(/\bscrawl(ing)?\b/g, 'scroll$1')
    .replace(/\bscrole(ing)?\b/g, 'scroll$1')
    .replace(/\b(star|stir)\b(?=\s+(?:auto ?)?scroll)/g, 'start')
    .replace(/\b(odo|otto|oto)\b(?=\s+scroll)/g, 'auto')
    .replace(/\bcliq(ue)?\b/g, 'click')
    .replace(/\bklick\b/g, 'click')
    .replace(/\btop scroll(ing)?\b/g, 'stop scroll$1')
    .replace(/\btab\b(?=\s+(?:on|the))/g, 'tap');
}

// Strips harmless leading filler ("please", "can you", "hey maximus", etc.)
// that people naturally add before a command but that would otherwise stop
// the exact-match regexes below from firing, sending the phrase to the
// slower AI-based fallback for no reason.
function stripVoiceFiller(s){
  return s.replace(/^(?:hey |ok |okay )?maximus[,]?\s*/i, '')
          .replace(/^(?:please|could you|can you|would you|will you)\s+/i, '')
          .replace(/^(?:please|now)\s+/i, '');
}

// Returns true if the phrase was recognized and handled as a command;
// false means it should fall through to the normal AI chat pipeline.
async function executeVoiceCommand(raw){
  const rawTrimmed = stripVoiceFiller(raw.trim().replace(/[.!?]+$/, ''));
  const lower = correctMishears(normalizeSitePhrase(rawTrimmed.toLowerCase()));
  let m;

  // "play <video> on youtube" — searches YouTube and opens the matching video's
  // watch page directly (so it actually starts playing), instead of just
  // opening a generic search results page you'd have to click into yourself.
  // Checked before the Spotify fallback below so "on youtube" always wins.
  m = lower.match(/^(?:play|watch) (.+?) (?:video )?on youtube$/);
  if(m){
    await youtubePlayVideo(m[1].trim());
    return true;
  }

  // "play <song> on spotify" — plays in-app via the Web Playback SDK if connected
  // (requires Premium), otherwise falls back to opening the Spotify website.
  // Also accepts plain "play <song>" / "play me <song>" / "put on <song>" with
  // no trailing "on spotify" — previously those silently fell through to the
  // general AI chat instead of playing anything, which made it look like the
  // wrong song played on the next (differently mistranscribed) retry.
  m = lower.match(/^play (.+?) (?:song )?on spotify$/)
   || lower.match(/^(?:play|put on)(?: me)? (?:the song |the track )?(.+?)(?: song)?$/);
  if(m){
    await spotifyPlayTrack(m[1].trim());
    return true;
  }

  // Spotify transport controls
  if(/^pause (?:the )?(?:music|spotify|song)$/.test(lower)){ await spotifyPause(); return true; }
  if(/^(?:resume|unpause) (?:the )?(?:music|spotify|song|playback)$/.test(lower)){ await spotifyResume(); return true; }
  if(/^(?:skip|next)(?: song| track)?$/.test(lower)){ await spotifyNext(); return true; }
  if(/^(?:previous|last|go back)(?: song| track)?$/.test(lower)){ await spotifyPrev(); return true; }
  if(/^(?:loop|repeat) (?:this )?(?:song|track)$/.test(lower)){ await spotifySetLoop(true); return true; }
  if(/^(?:stop|turn off|disable) (?:loop|looping|repeat)(?:ing)?$/.test(lower)){ await spotifySetLoop(false); return true; }

  // Weather: "weather", "weather in <city>", "what's the weather like (in <city>)"
  m = lower.match(/^(?:what'?s|what is|how'?s) the weather(?: like)?(?: in (.+))?\??$/)
   || lower.match(/^weather(?:\s+forecast)?(?: in (.+))?\??$/);
  if(m){
    await getWeatherReport(m[1] ? m[1].trim() : null);
    return true;
  }

  // News: "news", "today's news", "news about <topic>", "headlines"
  m = lower.match(/^(?:what'?s|give me|read me|tell me) (?:the |my )?(?:daily |latest |today'?s )?news(?: about (.+))?\??$/)
   || lower.match(/^(?:daily )?news(?: about (.+))?$/)
   || lower.match(/^headlines(?: about (.+))?$/);
  if(m){
    await getNewsReport(m[1] ? m[1].trim() : null);
    return true;
  }

  // Any phrasing of "search <query> on/for <site>" — query can be anything, not just known keywords.
  let site, query;
  m = lower.match(/^search (.+) on ([a-z]+)$/);
  if(m && ASSISTANT_SITES[m[2]]){ query = m[1]; site = m[2]; }
  if(!site){
    m = lower.match(/^search ([a-z]+) for (.+)$/);
    if(m && ASSISTANT_SITES[m[1]]){ site = m[1]; query = m[2]; }
  }
  if(!site){
    m = lower.match(/^search for (.+) on ([a-z]+)$/);
    if(m && ASSISTANT_SITES[m[2]]){ query = m[1]; site = m[2]; }
  }
  if(!site){
    m = lower.match(/^([a-z]+) search (?:for )?(.+)$/);
    if(m && ASSISTANT_SITES[m[1]]){ site = m[1]; query = m[2]; }
  }
  if(site && query){
    const url = buildSearchUrl(site, query);
    if(url){
      window.open(url, '_blank');
      speak(`Searching ${site} for ${query}.`);
      return true;
    }
  }

  // ---- Real desktop control, via the local Maximus Desktop Agent ----
  // (a Python program that must be running on this computer — see maximus_agent.py)

  // Battery percentage
  if(/^(?:what'?s|what is|check|tell me) (?:my )?battery(?: percentage| level)?\??$/.test(lower)
   || /^battery(?: percentage| level| status)?\??$/.test(lower)){
    try{
      const data = await callAgent('/battery');
      if(data && typeof data.percent === 'number'){
        speak(`Your battery is at ${Math.round(data.percent)} percent${data.charging ? ', and it is currently charging' : ''}.`);
      } else {
        speak("This computer doesn't seem to report a battery level — it might be a desktop with no battery.");
      }
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "go to desktop" / "show desktop" / "minimize everything"
  if(/^(?:go to|show|switch to)(?: the)? desktop$/.test(lower) || /^minimize (?:all|everything)$/.test(lower)){
    try{ await callAgent('/show-desktop', { method:'POST' }); speak('Going to the desktop.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // Open file explorer
  if(/^open (?:the |my )?(?:file explorer|file manager|explorer|files)$/.test(lower)){
    try{ await callAgent('/open-explorer', { method:'POST', body:{ path:'desktop' } }); speak('Opening the file explorer.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // Open task manager
  if(/^open (?:the )?task manager$/.test(lower)){
    try{ await callAgent('/open-task-manager', { method:'POST' }); speak('Opening Task Manager.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // Open device/system settings (kept separate from "open <app's own> settings",
  // which is handled elsewhere by the gear icon in the sidebar)
  if(/^open (?:my |the )?(?:computer|system|device|windows|pc) settings$/.test(lower)){
    try{ await callAgent('/open-settings', { method:'POST' }); speak('Opening settings.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // Open VS Code specifically
  if(/^open (?:vs\s*code|visual studio code)$/.test(lower)){
    try{ await callAgent('/open-app', { method:'POST', body:{ name:'vscode' } }); speak('Opening Visual Studio Code.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "create a file on desktop named notes.txt" (optionally "... and open it in vscode")
  // Accepts "named" / "name" / "called" since people say it different ways.
  // If no extension is given, the agent defaults it to .txt on its own.
  m = lower.match(/^(?:create|make) a (?:new )?file(?: on (?:the )?desktop)? (?:named|name|called) ([a-z0-9 ._-]+?)(?: and open (?:it )?in (?:vs\s*code|visual studio code))?$/);
  if(m){
    const wantsVscode = /and open (?:it )?in/.test(lower);
    const fileName = m[1].trim();
    try{
      await callAgent('/create-file', { method:'POST', body:{ location:'desktop', name: fileName } });
      speak(`Created ${fileName} on your desktop.`);
      if(wantsVscode){
        try{ await callAgent('/open-app', { method:'POST', body:{ name:'vscode', openPath: `desktop/${fileName}` } }); speak('Opening it in Visual Studio Code.'); }
        catch(e){ /* file was still created even if VS Code launch fails */ }
      }
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "create a folder on desktop named photos" — same phrasing options, no extension logic.
  m = lower.match(/^(?:create|make) a (?:new )?folder(?: on (?:the )?desktop)? (?:named|name|called) ([a-z0-9 ._-]+?)$/);
  if(m){
    const folderName = m[1].trim();
    try{
      await callAgent('/create-folder', { method:'POST', body:{ location:'desktop', name: folderName } });
      speak(`Created the ${folderName} folder on your desktop.`);
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "empty recycle bin" / "delete all the files in recycle bin" / "clear the recycle bin", etc.
  // Opens it first (so you can see it happen) and then empties it.
  if(/recycle\s*bin/.test(lower) && /(delete|empty|clear)/.test(lower)){
    try{
      try{ await callAgent('/open-app', { method:'POST', body:{ name:'recycle bin' } }); } catch(e){ /* still try to empty even if opening the window fails */ }
      await callAgent('/empty-recycle-bin', { method:'POST' });
      speak('Recycle bin emptied.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "take a screenshot" / "take screenshot" / "capture the screen"
  if(/^(?:take (?:a )?screenshot|capture (?:the )?screen|screenshot)$/.test(lower)){
    try{
      const data = await callAgent('/take-screenshot', { method:'POST' });
      speak(`Screenshot saved${data && data.filename ? `, ${data.filename}` : ''}.`);
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "show screenshots" / "show my screenshots" / "open screenshots" / "open screenshots folder"
  if(/^(?:show|open)(?: my)? screenshots(?: folder)?$/.test(lower)){
    try{ await callAgent('/open-explorer', { method:'POST', body:{ path:'screenshots' } }); speak('Here are your screenshots.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "open the latest screenshot" / "open latest screenshot taken" / "show the latest screenshot" / "open my last screenshot"
  if(/^(?:open|show)(?: the| my)? (?:latest|last) screenshot(?: taken)?$/.test(lower)){
    try{ await callAgent('/open-latest-screenshot', { method:'POST' }); speak('Opening your latest screenshot.'); }
    catch(e){
      if(e && /No screenshots found/.test(e.message || '')) speak(e.message);
      else speak(agentUnavailableMessage());
    }
    return true;
  }

  // ---- Brightness control ----
  m = lower.match(/^(?:increase|turn up|raise|brighten)(?: the)? brightness(?: by (\d{1,3})\s*(?:%|percent)?)?$/)
   || lower.match(/^brightness up(?: by (\d{1,3})\s*(?:%|percent)?)?$/);
  if(m){
    const amount = m[1] ? parseInt(m[1], 10) : 10;
    try{
      const data = await callAgent('/brightness', { method:'POST', body:{ action:'up', amount } });
      speak(typeof data?.percent === 'number' ? `Brightness is now at ${data.percent} percent.` : 'Brightness increased.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  m = lower.match(/^(?:decrease|turn down|lower|dim)(?: the)? brightness(?: by (\d{1,3})\s*(?:%|percent)?)?$/)
   || lower.match(/^brightness down(?: by (\d{1,3})\s*(?:%|percent)?)?$/);
  if(m){
    const amount = m[1] ? parseInt(m[1], 10) : 10;
    try{
      const data = await callAgent('/brightness', { method:'POST', body:{ action:'down', amount } });
      speak(typeof data?.percent === 'number' ? `Brightness is now at ${data.percent} percent.` : 'Brightness decreased.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  m = lower.match(/^set(?: the)? brightness to (\d{1,3})\s*(?:%|percent)?$/);
  if(m){
    const amount = Math.max(0, Math.min(100, parseInt(m[1], 10)));
    try{ await callAgent('/brightness', { method:'POST', body:{ action:'set', amount } }); speak(`Brightness set to ${amount} percent.`); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^(?:what'?s|what is|check) (?:my |the )?brightness(?: level)?\??$/.test(lower)){
    try{
      const data = await callAgent('/brightness');
      speak(typeof data?.percent === 'number' ? `Brightness is at ${Math.round(data.percent)} percent.` : "I couldn't read the brightness level.");
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // ---- Volume control ----
  m = lower.match(/^(?:increase|turn up|raise)(?: the)? volume(?: by (\d{1,3})\s*(?:%|percent)?)?$/)
   || lower.match(/^volume up(?: by (\d{1,3})\s*(?:%|percent)?)?$/);
  if(m){
    const amount = m[1] ? parseInt(m[1], 10) : 10;
    try{
      const data = await callAgent('/volume', { method:'POST', body:{ action:'up', amount } });
      speak(typeof data?.percent === 'number' ? `Volume is now at ${data.percent} percent.` : 'Volume increased.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  m = lower.match(/^(?:decrease|turn down|lower)(?: the)? volume(?: by (\d{1,3})\s*(?:%|percent)?)?$/)
   || lower.match(/^volume down(?: by (\d{1,3})\s*(?:%|percent)?)?$/);
  if(m){
    const amount = m[1] ? parseInt(m[1], 10) : 10;
    try{
      const data = await callAgent('/volume', { method:'POST', body:{ action:'down', amount } });
      speak(typeof data?.percent === 'number' ? `Volume is now at ${data.percent} percent.` : 'Volume decreased.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  m = lower.match(/^set(?: the)? volume to (\d{1,3})\s*(?:%|percent)?$/);
  if(m){
    const amount = Math.max(0, Math.min(100, parseInt(m[1], 10)));
    try{ await callAgent('/volume', { method:'POST', body:{ action:'set', amount } }); speak(`Volume set to ${amount} percent.`); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^mute(?: the)? volume$|^mute(?: my)? computer$|^mute$/.test(lower)){
    try{ await callAgent('/volume', { method:'POST', body:{ action:'mute' } }); speak('Muted.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^unmute(?: the)? volume$|^unmute(?: my)? computer$|^unmute$/.test(lower)){
    try{ await callAgent('/volume', { method:'POST', body:{ action:'unmute' } }); speak('Unmuted.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^(?:what'?s|what is|check) (?:my |the )?volume(?: level)?\??$/.test(lower)){
    try{
      const data = await callAgent('/volume');
      speak(typeof data?.percent === 'number' ? `Volume is at ${Math.round(data.percent)} percent${data.muted ? ', and muted' : ''}.` : "I couldn't read the exact volume level.");
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // ---- Vision: "open vision" / "close vision" / "what do you see" ----
  if(/^(?:open|start|turn on|enable) vision$/.test(lower)){
    const ok = await startVision();
    if(ok) speak('Vision is on. Ask me what I see, or say "close vision" to turn it off.');
    return true;
  }
  if(/^(?:close|stop|turn off|disable) vision$/.test(lower)){
    stopVision();
    speak('Vision is off.');
    return true;
  }
  // "who is this/that" — if the screen is being shared, this almost always
  // means "who's this person shown on my screen", not the webcam. Route to
  // screen share when it's active (or when vision isn't), otherwise fall
  // through to vision's webcam view below.
  if(/^who(?:'?s| is) (?:this|that|he|she|they)\??$/.test(lower) && (screenActive || !visionActive)){
    await askScreenQuestion('Who is the person shown on my screen right now? If you recognize them by name, say so; otherwise describe them.');
    return true;
  }
  m = lower.match(/^(?:what (?:do|can) you see|look(?: at (?:this|that))?|what'?s (?:this|that)|who(?:'?s| is) (?:this|that|he|she|they)|describe (?:what you see|this|that)|take a look(?: at (?:this|that))?)\s*(.*)$/);
  if(m){
    await askVisionQuestion(m[1] ? m[1].trim() : 'What do you see?');
    return true;
  }

  // ---- Auto-scroll: "auto scroll" / "scroll down" / "scroll up" / "stop" ----
  // Checked early so a bare "stop" while scrolling stops the scroll, rather
  // than falling through unmatched to general chat.
  if(autoScrollActive && /^(?:stop|stop scrolling|stop the scrolling|stop auto ?scroll(?:ing)?|stop the scroll(?:ing)?|end scroll(?:ing)?)$/.test(lower)){
    await stopAutoScroll();
    return true;
  }
  if(/^(?:auto ?scroll(?: down)?|start (?:auto ?scroll(?:ing)?|scrolling)(?: down)?|start (?:the )?scroll(?: down)?|keep scrolling(?: down)?|scroll down continuously|continue scrolling(?: down)?)(?: the page)?$/.test(lower)){
    await startAutoScroll('down');
    return true;
  }
  if(/^(?:auto ?scroll up|start (?:auto ?scroll(?:ing)?|scrolling) up|start (?:the )?scroll up|keep scrolling up|continue scrolling up)(?: the page)?$/.test(lower)){
    await startAutoScroll('up');
    return true;
  }
  // Bare "scroll down" / "scroll up" — a single nudge, not continuous scrolling.
  if(/^scroll(?: it)? down(?: a bit| a little)?(?: the page)?$/.test(lower)){
    await stepScroll('down');
    return true;
  }
  if(/^scroll(?: it)? up(?: a bit| a little)?(?: the page)?$/.test(lower)){
    await stepScroll('up');
    return true;
  }

  // ---- Screen share: "share my screen" / "close screen share" / "what's on my screen" ----
  if(/^(?:share|open|start) (?:my )?screen(?: share)?$/.test(lower)){
    const ok = await startScreenShare();
    if(ok) speak('I can see your screen now. Highlight anything and ask me about it, or say "stop sharing my screen" to turn it off.');
    return true;
  }
  if(/^(?:close|stop|turn off|end) (?:sharing (?:my )?screen|screen share(?:ing)?|(?:my )?screen)$/.test(lower)){
    stopScreenShare();
    speak('Screen sharing is off.');
    return true;
  }
  // "read the highlighted text" — transcribe it verbatim and speak exactly
  // that. Checked before "explain", which describes/paraphrases instead.
  if(/^read (?:the )?(?:highlighted|selected)(?: text)?$|^read (?:this|that|it)$|^read what(?:'?s| is) highlighted$/.test(lower)){
    await askScreenQuestion('Read the highlighted text on my screen.', 'read');
    return true;
  }
  // "explain the highlighted text" — explain the meaning, don't read it aloud verbatim.
  if(/^explain (?:the )?(?:highlighted|selected)(?: text)?$|^explain (?:this|that|it)$|^explain what(?:'?s| is) highlighted$/.test(lower)){
    await askScreenQuestion('Explain what the highlighted text on my screen means, without just reading it back word for word.');
    return true;
  }
  m = lower.match(/^(?:what'?s|what is) on my screen\??\s*(.*)$/)
   || lower.match(/^(?:what (?:do|can) you see on my screen|describe my screen|look at my screen|check my screen)\s*(.*)$/)
   || lower.match(/^what (?:does this|is this|is highlighted|did i highlight) (?:mean|say)\??$/);
  if(m){
    await askScreenQuestion(m[1] ? m[1].trim() : "What's on my screen?");
    return true;
  }
  // "read my screen" — reads aloud whatever text is currently visible/highlighted, verbatim.
  if(/^read my screen\s*(.*)$/.test(lower)){
    await askScreenQuestion('Read aloud the highlighted text if any, otherwise the main visible text on my screen.', 'read');
    return true;
  }

  // ---- Upload a photo/video (Instagram, LinkedIn, or any other site) ----
  // "upload a photo", "upload video", "upload the photo named vacation.jpg",
  // "upload video from C:\Users\me\Desktop\clip.mp4" — clicks the create/
  // upload control, then (if a file was named) types its path into the
  // native file-picker dialog that pops open and presses Enter.
  m = lower.match(/^(?:upload|post|share)(?: a| the)? (photo|picture|image|video|reel)(?:\s+(?:named|called|from|at)\s+(.+))?$/);
  if(m){
    if(!screenActive){
      const started = await startScreenShare();
      if(!started) return true;
      speak("I can see your screen now.");
    }
    const kindRaw = m[1];
    const kind = /video|reel/.test(kindRaw) ? (kindRaw === 'reel' ? 'reel' : 'video') : 'photo';
    await performScreenUpload(kind, m[2] ? m[2].trim() : null);
    return true;
  }

  // ---- Click things on the shared screen ----
  // Covers "click the follow button", "click the video titled X", "click
  // the search bar and type X", "click the first website", "click X" for
  // any named button/link/icon, on any site or app currently on screen.
  m = lower.match(/^(?:click|tap|press|select) (?:on )?(?:the )?(.+?)(?:\s+and\s+(type|search(?: for)?|enter)\s+(.+))?$/);
  if(m){
    const target = m[1].trim();
    const verb = m[2] || '';
    const typeText = m[3] ? m[3].trim() : null;
    const pressEnter = typeText != null && /^search/.test(verb);
    if(!screenActive){
      const started = await startScreenShare();
      if(!started) return true;
      speak("I can see your screen now.");
    }
    await performScreenClick(target, typeText, pressEnter);
    return true;
  }

  // ---- Power control: restart / shut down / sleep ----
  if(/^(?:restart|reboot)(?: the| my)? (?:computer|pc|laptop|system)$/.test(lower) || lower === 'restart' || lower === 'reboot'){
    try{ await callAgent('/power', { method:'POST', body:{ action:'restart' } }); speak('Restarting the computer now.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^(?:shut ?down|power off|turn off)(?: the| my)? (?:computer|pc|laptop|system)$/.test(lower) || lower === 'shutdown' || lower === 'shut down'){
    try{ await callAgent('/power', { method:'POST', body:{ action:'shutdown' } }); speak('Shutting down the computer now.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }
  if(/^(?:sleep|go to sleep|sleep mode|put(?: the| my)? computer to sleep)$/.test(lower)){
    try{ await callAgent('/power', { method:'POST', body:{ action:'sleep' } }); speak('Putting the computer to sleep.'); }
    catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // ---- Closing applications ----
  // "close all applications" / "close everything except the browser and vs code" — worded either
  // way, this always protects the browser, VS Code, and core system processes.
  if(/^close (?:all|every)(?:thing| applications| apps| open apps| open applications| windows)?(?:\s+.*)?$/.test(lower)){
    try{
      const data = await callAgent('/close-all-apps', { method:'POST' });
      const n = data && typeof data.closed_count === 'number' ? data.closed_count : null;
      speak(n !== null ? `Closed ${n} application${n===1?'':'s'}, keeping the browser and VS Code open.` : 'Closing everything else.');
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  // "close settings" / "close file explorer" / "close notepad" / "close excel" / "close recycle bin", etc.
  m = lower.match(/^close (?:the |my )?([a-z0-9 +]+?)(?: app| application| program| window)?$/);
  if(m){
    const appName = m[1].trim();
    try{
      await callAgent('/close-app', { method:'POST', body:{ name: appName } });
      speak(`Closed ${appName}.`);
    } catch(e){
      if(e && /doesn't look like it's running/.test(e.message || '')) speak(e.message);
      else speak(agentUnavailableMessage());
    }
    return true;
  }

  // "open <site>" / "open <site> website" / "open <site>.com"
  m = lower.match(/^open ([a-z]+)(?:\.com)?(?: website)?$/);
  if(m && ASSISTANT_SITES[m[1]]){
    window.open(ASSISTANT_SITES[m[1]], '_blank');
    speak(`Opening ${m[1]}.`);
    return true;
  }

  // WhatsApp message: "message <name> saying <text>" / "send whatsapp message to <name> saying <text>" / "whatsapp <name> saying <text>" / "text <name> saying <text>"
  // Matched against the original-case text (not `lower`) so the message itself keeps its casing.
  m = rawTrimmed.match(/^(?:send whatsapp message to|message|whatsapp|text)\s+([a-zA-Z0-9][a-zA-Z0-9 '.-]*?)\s+(?:saying|that says|:)\s+(.+)$/i);
  if(m){
    const contact = findContact(m[1]);
    if(contact){
      // api.whatsapp.com pre-fills the text box far more reliably than wa.me —
      // wa.me often opens the right chat but silently drops the ?text= param
      // when WhatsApp Web is already logged in / already open in another tab.
      const cleanPhone = contact.phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
      const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(m[2])}`;
      // A unique window name (rather than a shared "_blank") forces a real
      // fresh navigation instead of possibly reusing an already-open
      // WhatsApp tab that won't re-read the new URL's query params.
      window.open(url, `maximus_wa_${Date.now()}`);
      speak(`Opening WhatsApp with your message to ${contact.name}. Tap send to deliver it — I can't send it for you.`);
    } else {
      speak(`I don't have a contact named ${m[1]}. Add them in Contacts first.`);
      openModal('contacts');
    }
    return true;
  }

  // Location
  if(/^(show my location|where am i)$/.test(lower)){
    if(navigator.geolocation){
      speak('Getting your current location.');
      navigator.geolocation.getCurrentPosition(
        pos => window.open(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`, '_blank'),
        () => speak("I couldn't get your location — check location permissions for this site.")
      );
    } else {
      speak("Location isn't available in this browser.");
    }
    return true;
  }

  // Navigation / directions
  m = lower.match(/^(?:navigate to|directions to|take me to) (.+)$/);
  if(m){
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(m[1])}`, '_blank');
    speak(`Starting directions to ${m[1]}.`);
    return true;
  }

  // Nearby places — support several word orders people naturally say
  m = lower.match(/^(?:find|show|search for)?\s*nearby (.+)$/)
   || lower.match(/^(?:find|show) (.+) near(?:by)? ?me$/)
   || lower.match(/^(.+) nearby$/)
   || lower.match(/^(.+) near me$/);
  if(m){
    const place = m[1].trim();
    speak(`Looking for ${place} near you.`);
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos => window.open(`https://www.google.com/maps/search/${encodeURIComponent(place)}/@${pos.coords.latitude},${pos.coords.longitude},15z`, '_blank'),
        () => window.open(`https://www.google.com/maps/search/${encodeURIComponent(place)}`, '_blank')
      );
    } else {
      window.open(`https://www.google.com/maps/search/${encodeURIComponent(place)}`, '_blank');
    }
    return true;
  }

  // Generic "open <desktop app>" fallback — for real installed applications
  // (Notepad, Calculator, Chrome, Word, Excel, the Spotify desktop app, etc)
  // rather than websites. Only reached if nothing above matched, so known
  // websites from ASSISTANT_SITES are still opened as a browser tab, not
  // launched as a desktop app.
  m = lower.match(/^open (?:the |my )?([a-z0-9 +]+?)(?: app| application| program)?$/);
  if(m && !ASSISTANT_SITES[m[1].replace(/\s+/g, '')]){
    const appName = m[1].trim();
    try{
      await callAgent('/open-app', { method:'POST', body:{ name: appName } });
      speak(`Opening ${appName}.`);
    } catch(e){ speak(agentUnavailableMessage()); }
    return true;
  }

  return false;
}

// The exact phrasing patterns executeVoiceCommand() understands, written as
// a short grammar for the LLM to translate loose spoken phrasing into. Kept
// in one place so it's easy to extend alongside the regexes above.
const VOICE_COMMAND_GRAMMAR = `
- play <video> on youtube
- play <song>
- pause the music / resume the music / skip / previous
- loop this song / stop looping
- weather / weather in <city>
- news / news about <topic>
- search <query> on <site>
- battery percentage
- go to desktop
- open file explorer
- open task manager
- open computer settings
- open vscode
- create a file on desktop named <name>
- create a folder on desktop named <name>
- empty the recycle bin
- take a screenshot
- show screenshots
- open the latest screenshot
- increase brightness by <amount> / decrease brightness by <amount> / set brightness to <amount>
- increase volume by <amount> / decrease volume by <amount> / set volume to <amount> / mute / unmute
- what's my volume / what's my brightness
- close <app name>
- close all applications
- restart the computer
- shut down the computer
- sleep the computer
- open vision
- close vision
- what do you see
- share my screen
- stop sharing my screen
- what's on my screen
- auto scroll / scroll down / scroll up
- stop scrolling
- open <site or app name>  (e.g. gmail, github, spotify, notepad, calculator, chrome, word, excel)
- message <contact name> saying <text>
- show my location
- navigate to <place>
- find <place> near me
`.trim();

// When the fast regex matcher above doesn't recognize a phrase, ask the model
// to translate it into one of the canonical forms it DOES recognize (so
// "could you open youtube for me" or "yo pump the volume up a bit" still
// work, not just exact scripted phrasings), or reply NONE if it's really
// just a question/conversation. Fails silently (returns null) on any error
// so callers can just fall through to normal chat.
async function classifyAndNormalizeCommand(text){
  if(!state.settings.apiKey) return null;
  try{
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
      body: JSON.stringify({
        model: CONFIG.MODEL_TEXT,
        messages: [
          { role: 'system', content: `You translate a spoken instruction into ONE canonical command from this exact list of patterns (fill in the <bracketed> parts with the user's real words, keep everything else word-for-word):\n${VOICE_COMMAND_GRAMMAR}\n\nRules:\n- Reply with ONLY the canonical command text, nothing else — no quotes, no explanation.\n- If the instruction is really a question, chit-chat, or anything that doesn't clearly match one of these actions, reply with exactly: NONE\n- Never invent a pattern that isn't in the list.` },
          { role: 'user', content: text }
        ],
        max_tokens: 60,
        temperature: 0
      })
    });
    if(!res.ok) return null;
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    if(!out || out.toUpperCase() === 'NONE') return null;
    return out;
  }catch(e){
    return null;
  }
}

/* Ask Maximus a general question by voice — reuses the existing chat pipeline
   so the answer lands in the current chat too, and speaks the reply as it's
   being generated (sentence by sentence) instead of waiting for the full
   answer to finish before saying anything. */
async function askCortexByVoice(text){
  if(!state.settings.apiKey){
    speak('I need an API key before I can answer questions. Please add one in Settings.');
    openModal('settings');
    return;
  }
  messageInput.value = text;
  updateSendButtonState();

  let spokenUpTo = 0;
  const speakNewSentences = ()=>{
    const chat = getActiveChat();
    const last = chat && [...chat.messages].reverse().find(m => m.role === 'assistant');
    if(!last || !last.content) return;
    const clean = cleanForSpeech(last.content);
    if(clean.length <= spokenUpTo) return;
    const rest = clean.slice(spokenUpTo);
    // Only speak complete sentences so far; leave any trailing partial
    // sentence for the next tick (or the final flush below) so words aren't cut mid-way.
    const complete = rest.match(/^[\s\S]*[.!?](?=\s|$)/);
    if(complete){
      queueSpeech(complete[0]);
      spokenUpTo += complete[0].length;
    }
  };

  const pollId = setInterval(speakNewSentences, 300);
  voiceReplyMode = true;
  await sendMessage();
  voiceReplyMode = false;
  clearInterval(pollId);

  // Flush whatever's left, including a final fragment with no trailing punctuation.
  const chat = getActiveChat();
  const last = chat && [...chat.messages].reverse().find(m => m.role === 'assistant');
  if(last && last.content){
    const clean = cleanForSpeech(last.content);
    const remainder = clean.slice(spokenUpTo).trim();
    if(remainder) queueSpeech(remainder);
  }
}

// Keeps continuous listening on for everything (open sites, messages, weather,
// news, etc.) — it only pauses listening while a Spotify track is actually
// playing, and automatically resumes it the moment that track is paused or
// stops, so the mic isn't fighting the music but normal use isn't interrupted.
let listeningAutoPausedForMusic = false;
function syncListeningWithMusic(spotifyState){
  if(!assistantRecognition) return;
  const isPlaying = !!(spotifyState && spotifyState.track_window && spotifyState.track_window.current_track && !spotifyState.paused);
  if(isPlaying){
    if(wantContinuousListening){
      listeningAutoPausedForMusic = true;
      wantContinuousListening = false;
      clearTimeout(restartTimer);
      clearPendingVoiceBuffer();
      try{ assistantRecognition.stop(); }catch(e){}
      stopMicAnalyser();
      setListenButtonState(false);
      if(assistantStatus) assistantStatus.textContent = 'Paused listening while the song plays';
    }
  } else if(listeningAutoPausedForMusic){
    listeningAutoPausedForMusic = false;
    wantContinuousListening = true;
    lastRecognitionActivity = Date.now();
    clearPendingVoiceBuffer();
    try{ assistantRecognition.start(); recognitionRunning = true; }catch(e){ scheduleRecognitionRestart(300); }
    startMicAnalyser();
    setListenButtonState(true);
  }
}

async function handleVoiceInput(text){
  speechSuppressed = false; // a new thing to say is starting — allow speech again
  if(assistantStatus) assistantStatus.textContent = 'Thinking…';
  let handled = await executeVoiceCommand(text);
  if(!handled){
    // Didn't match a scripted phrasing exactly — ask the model whether this
    // was actually meant as one of the known actions, just worded loosely
    // ("could you pull up youtube", "turn the volume down a touch", etc.),
    // and run the normalized version through the same command handler.
    const canonical = await classifyAndNormalizeCommand(text);
    if(canonical) handled = await executeVoiceCommand(canonical);
  }
  if(!handled) await askCortexByVoice(text);
  if(assistantStatus) assistantStatus.textContent = wantContinuousListening ? 'Listening…' : 'Tap "Start Listening" and speak';
}

/* ---------- Overlay open/close ---------- */
if(assistantFab){
  assistantFab.addEventListener('click', ()=>{
    assistantOverlay.classList.remove('hidden');
    initOrb();
    updateNowPlayingUI();
  });
}
if(assistantCloseBtn){
  assistantCloseBtn.addEventListener('click', ()=>{
    assistantOverlay.classList.add('hidden');
    cancelAnimationFrame(orbAnimFrame);
    if(wantContinuousListening) listenToggleBtn.click();
    stopSpeaking();
    stopVision();
    stopScreenShare();
    stopAutoScroll();
  });
}
if(assistantContactsBtn){
  assistantContactsBtn.addEventListener('click', ()=> openModal('contacts'));
}
const stopSpeakingBtn = document.getElementById('stopSpeakingBtn');
if(stopSpeakingBtn){
  stopSpeakingBtn.addEventListener('click', ()=>{
    stopSpeaking();
    if(assistantStatus) assistantStatus.textContent = wantContinuousListening ? 'Listening…' : 'Tap "Start Listening" and speak';
  });
}

/* ================= INIT ================= */
initAuthGate();
handleSpotifyRedirect();
if(state.spotify && state.spotify.accessToken) initSpotifyPlayer();