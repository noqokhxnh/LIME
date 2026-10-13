// LIME Workspace v2 — Premiere-style 4-workspace editor logic
// Base URL auto-detection
const API_BASE = (window.location.origin && window.location.origin.includes(':3000'))
    ? ''
    : 'http://localhost:3000';

/* ================= AUTH ================= */
const loginOpenBtn = document.getElementById('login-open-btn');
const loginModal = document.getElementById('login-modal');
const loginCloseBtn = document.getElementById('login-close-btn');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginMessage = document.getElementById('login-message');
const wsUsername = document.getElementById('ws-username');
const wsLogoutBtn = document.getElementById('ws-logout-btn');
const wsUserBtn = document.getElementById('ws-user-btn');
const wsUserDropdown = document.getElementById('ws-user-dropdown');
function setWsUser(name, role) {
    if (wsUsername) wsUsername.textContent = name || '';
    const avatar = document.getElementById('ws-user-avatar');
    if (avatar) avatar.textContent = (name || 'U').charAt(0).toUpperCase();
    const adminLink = document.getElementById('ws-admin-link');
    if (adminLink) adminLink.style.display = role === 'admin' ? 'flex' : 'none';
}

if (wsUserBtn && wsUserDropdown) {
    wsUserBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wsUserDropdown.classList.toggle('show');
        wsUserBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
        if (!wsUserBtn.contains(e.target) && !wsUserDropdown.contains(e.target)) {
            wsUserDropdown.classList.remove('show');
            wsUserBtn.setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && wsUserDropdown.classList.contains('show')) {
            wsUserDropdown.classList.remove('show');
            wsUserBtn.setAttribute('aria-expanded', 'false');
            wsUserBtn.focus();
        }
    });
}
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegisterBtn = document.getElementById('show-register-btn');
const showLoginBtn = document.getElementById('show-login-btn');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const registerSubmitBtn = document.getElementById('register-submit-btn');
const registerUsername = document.getElementById('register-username');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerMessage = document.getElementById('register-message');
const googleLoginBtn = document.getElementById('google-login-btn');
const appleLoginBtn = document.getElementById('apple-login-btn');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const authSocialRow = document.getElementById('auth-social-row');
const authDivider = document.getElementById('auth-divider');
const registerTerms = document.getElementById('register-terms');
const forgotForm = document.getElementById('forgot-form');
const forgotUsername = document.getElementById('forgot-username');
const forgotPassword = document.getElementById('forgot-password');
const forgotConfirmPassword = document.getElementById('forgot-confirm-password');
const forgotSubmitBtn = document.getElementById('forgot-submit-btn');
const forgotMessage = document.getElementById('forgot-message');
const showLoginFromForgotBtn = document.getElementById('show-login-from-forgot-btn');

// Helpers for Eye / EyeOff password visibility toggle
function initPasswordToggle(inputId, toggleBtnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(toggleBtnId);
    if (!input || !btn) return;

    const eyeIconSvg = `<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>`;
    const eyeOffIconSvg = `<svg class="eye-off-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>`;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = isPassword ? eyeOffIconSvg : eyeIconSvg;
        btn.setAttribute('aria-label', isPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    });
}
initPasswordToggle('login-password', 'login-password-toggle');
initPasswordToggle('register-password', 'register-password-toggle');
initPasswordToggle('forgot-password', 'forgot-password-toggle');
initPasswordToggle('forgot-confirm-password', 'forgot-confirm-password-toggle');

let isGoogleAuthEnabled = false;

if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
        if (isGoogleAuthEnabled) {
            googleLoginBtn.disabled = true;
            window.location.href = `${API_BASE}/api/auth/google`;
        } else {
            if (loginMessage) {
                loginMessage.textContent = 'Đăng nhập với Google chưa được kích hoạt trên hệ thống.';
                setTimeout(() => {
                    if (loginMessage.textContent === 'Đăng nhập với Google chưa được kích hoạt trên hệ thống.') {
                        loginMessage.textContent = '';
                    }
                }, 3500);
            }
        }
    });
}

if (appleLoginBtn) {
    appleLoginBtn.addEventListener('click', () => {
        if (loginMessage) {
            loginMessage.textContent = 'Đăng nhập với Apple sắp ra mắt';
            setTimeout(() => {
                if (loginMessage.textContent === 'Đăng nhập với Apple sắp ra mắt') {
                    loginMessage.textContent = '';
                }
            }, 3000);
        }
    });
}

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (loginMessage) {
            loginMessage.textContent = 'Vui lòng liên hệ hỗ trợ để đặt lại mật khẩu.';
        }
    });
}

if (loginOpenBtn && loginModal) {
    loginOpenBtn.addEventListener('click', () => {
        if (loginMessage) loginMessage.textContent = '';
        if (registerMessage) registerMessage.textContent = '';
        loginModal.classList.add('show');
    });
}
if (loginCloseBtn && loginModal) {
    loginCloseBtn.addEventListener('click', () => loginModal.classList.remove('show'));
}

// Click ngoài thẻ (backdrop) để đóng modal & phím ESC
if (loginModal) {
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            loginModal.classList.remove('show');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && loginModal.classList.contains('show')) {
            loginModal.classList.remove('show');
        }
    });
}

async function handleLogin() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
        loginMessage.textContent = 'Vui lòng nhập đầy đủ thông tin';
        return;
    }
    try {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Đang xử lý...';
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) {
            loginMessage.textContent = data.error || 'Đăng nhập thất bại';
            return;
        }
        loginMessage.textContent = '';
        loginModal.classList.remove('show');
        setWsUser(data.username);
        log(`Đăng nhập thành công: ${data.username}`, 'success');
    } catch (err) {
        loginMessage.textContent = 'Không thể kết nối tới server';
    } finally {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Đăng nhập';
    }
}

if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener('click', handleLogin);
}
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLogin();
    });
}
[loginUsername, loginPassword].forEach(input => {
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLogin();
        }
    });
});

if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', () => {
        loginForm.style.display = 'none';
        registerForm.style.display = 'flex';
        if (authSocialRow) authSocialRow.style.display = 'none';
        if (authDivider) authDivider.style.display = 'none';
        if (authTitle) authTitle.textContent = 'Tạo tài khoản';
        if (authSubtitle) authSubtitle.textContent = 'Nhập thông tin của bạn để bắt đầu';
        if (loginMessage) loginMessage.textContent = '';
        if (registerMessage) registerMessage.textContent = '';
    });
}
if (showLoginBtn) {
    showLoginBtn.addEventListener('click', () => {
        if (registerForm) registerForm.style.display = 'none';
        if (forgotForm) forgotForm.style.display = 'none';
        loginForm.style.display = 'flex';
        if (authSocialRow) authSocialRow.style.display = 'grid';
        if (authDivider) authDivider.style.display = 'flex';
        if (authTitle) authTitle.textContent = 'Chào mừng trở lại';
        if (authSubtitle) authSubtitle.textContent = 'Nhập thông tin tài khoản của bạn để đăng nhập';
        if (loginMessage) loginMessage.textContent = '';
        if (registerMessage) registerMessage.textContent = '';
        if (forgotMessage) forgotMessage.textContent = '';
    });
}

if (forgotPasswordLink && forgotForm) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'none';
        forgotForm.style.display = 'flex';
        if (authSocialRow) authSocialRow.style.display = 'none';
        if (authDivider) authDivider.style.display = 'none';
        if (authTitle) authTitle.textContent = 'Đặt lại mật khẩu';
        if (authSubtitle) authSubtitle.textContent = 'Nhập tên đăng nhập hoặc email cùng mật khẩu mới';
        if (loginMessage) loginMessage.textContent = '';
        if (forgotMessage) {
            forgotMessage.textContent = '';
            forgotMessage.className = 'auth-status-msg';
        }
        if (loginUsername && forgotUsername && loginUsername.value.trim()) {
            forgotUsername.value = loginUsername.value.trim();
        }
    });
}

if (showLoginFromForgotBtn && forgotForm) {
    showLoginFromForgotBtn.addEventListener('click', () => {
        if (showLoginBtn) showLoginBtn.click();
    });
}

async function handleResetPassword() {
    if (!forgotUsername || !forgotPassword || !forgotConfirmPassword) return;
    const username = forgotUsername.value.trim();
    const password = forgotPassword.value;
    const confirmPassword = forgotConfirmPassword.value;

    if (forgotMessage) {
        forgotMessage.textContent = '';
        forgotMessage.className = 'auth-status-msg';
    }

    if (!username) {
        if (forgotMessage) forgotMessage.textContent = 'Vui lòng nhập tên đăng nhập hoặc email';
        return;
    }
    if (!password) {
        if (forgotMessage) forgotMessage.textContent = 'Vui lòng nhập mật khẩu mới';
        return;
    }
    if (password.length < 6) {
        if (forgotMessage) forgotMessage.textContent = 'Mật khẩu phải có tối thiểu 6 ký tự';
        return;
    }
    if (password !== confirmPassword) {
        if (forgotMessage) forgotMessage.textContent = 'Mật khẩu xác nhận không khớp';
        return;
    }

    try {
        if (forgotSubmitBtn) {
            forgotSubmitBtn.disabled = true;
            forgotSubmitBtn.textContent = 'Đang xử lý...';
        }

        const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, confirmPassword })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Đặt lại mật khẩu thất bại');
        }

        if (forgotMessage) {
            forgotMessage.textContent = data.message || 'Đặt lại mật khẩu thành công! Đang chuyển về đăng nhập...';
            forgotMessage.className = 'auth-status-msg success';
        }

        if (loginUsername && data.username) {
            loginUsername.value = data.username;
        }

        setTimeout(() => {
            if (showLoginBtn) showLoginBtn.click();
            if (loginMessage) {
                loginMessage.textContent = 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập với mật khẩu mới.';
                loginMessage.className = 'auth-status-msg success';
            }
        }, 1200);
    } catch (err) {
        if (forgotMessage) {
            forgotMessage.textContent = err.message;
            forgotMessage.className = 'auth-status-msg error';
        }
    } finally {
        if (forgotSubmitBtn) {
            forgotSubmitBtn.disabled = false;
            forgotSubmitBtn.textContent = 'Đặt lại mật khẩu';
        }
    }
}

if (forgotSubmitBtn) forgotSubmitBtn.addEventListener('click', handleResetPassword);
[forgotUsername, forgotPassword, forgotConfirmPassword].forEach(inp => {
    inp?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleResetPassword();
        }
    });
});

if (registerTerms && registerSubmitBtn) {
    registerTerms.addEventListener('change', () => {
        registerSubmitBtn.disabled = !registerTerms.checked;
    });
}

async function handleRegister() {
    if (registerTerms && !registerTerms.checked) {
        registerMessage.textContent = 'Vui lòng đồng ý với Điều khoản dịch vụ và Chính sách bảo mật';
        return;
    }
    const username = registerUsername.value.trim();
    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    if (!username || !email || !password) {
        registerMessage.textContent = 'Vui lòng nhập đầy đủ thông tin';
        return;
    }
    try {
        registerSubmitBtn.disabled = true;
        registerSubmitBtn.textContent = 'Đang tạo...';
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            registerMessage.textContent = data.error || 'Đăng ký thất bại';
            return;
        }
        registerMessage.textContent = '';
        loginModal.classList.remove('show');
        setWsUser(data.username);
        log(`Đăng ký thành công: ${data.username}`, 'success');
    } catch (err) {
        registerMessage.textContent = 'Không thể kết nối tới server';
    } finally {
        registerSubmitBtn.disabled = false;
        registerSubmitBtn.textContent = 'Tạo tài khoản';
    }
}

if (registerSubmitBtn) {
    registerSubmitBtn.addEventListener('click', handleRegister);
}
if (registerForm) {
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleRegister();
    });
}
[registerUsername, registerEmail, registerPassword].forEach(input => {
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleRegister();
        }
    });
});

function handleAuthError() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'open') return;
    if (loginModal) loginModal.classList.add('show');
    const error = params.get('error');
    if (error && loginMessage) loginMessage.textContent = error;
    window.history.replaceState({}, '', window.location.pathname);
}

/* ================= STATE ================= */
let pollInterval = null;
let catalogBlocks = [];
let selectedMotionBlockIds = new Set();
let currentRatio = '16:9';
let voiceEnabled = true;
let activeWs = 'script';
let selectedClipIdx = -1;
const project = { scenes: [], durationSec: 15, topic: '', jobId: null, resolution: '' };

/* ================= ELEMENTS ================= */
const promptInput = document.getElementById('prompt-input');
const promptCharCount = document.getElementById('prompt-char-count');
const styleSelect = document.getElementById('style-select');
const durationInput = document.getElementById('duration-input');
const blueprintSelect = document.getElementById('blueprint-select');
const catalogCategoryFilter = document.getElementById('catalog-category-filter');
const motionLibrary = document.getElementById('motion-library');
const motionBlocksCount = document.getElementById('motion-blocks-count');
const selectedMotionChips = document.getElementById('selected-motion-chips');
const ttsProviderSelect = document.getElementById('tts-provider-select');
const voiceSelect = document.getElementById('voice-select');
const generateBtn = document.getElementById('generate-btn');
const btnSpinner = document.getElementById('btn-spinner');
const btnText = document.getElementById('btn-text');
const logViewer = document.getElementById('log-viewer');
const logDrawer = document.getElementById('log-drawer');
const logToggleBtn = document.getElementById('log-toggle-btn');
const progressFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');
const videoPlayer = document.getElementById('video-player');
const videoEmpty = document.getElementById('video-empty');
const btnDownload = document.getElementById('btn-download');
const btnPreviewHtml = document.getElementById('btn-preview-html');
const summaryMetaLine = document.getElementById('summary-meta-line');
const customStyleInput = document.getElementById('custom-style-input');
const customScriptJson = document.getElementById('custom-script-json');
const programMonitor = document.getElementById('program-monitor');
const monitorBadge = document.getElementById('monitor-badge');
const monitorTc = document.getElementById('monitor-tc');
const transportPlay = document.getElementById('transport-play');
const timelinePanel = document.getElementById('panel-timeline');
const timelineRuler = document.getElementById('timeline-ruler');
const timelineTracks = document.getElementById('timeline-tracks');
const statusState = document.getElementById('status-state');
const statusScenes = document.getElementById('status-scenes');
const statusEta = document.getElementById('status-eta');
const projName = document.getElementById('proj-name');
const sceneList = document.getElementById('scene-list');
const sceneCount = document.getElementById('scene-count');
const voSegments = document.getElementById('vo-segments');
const renderQueue = document.getElementById('render-queue');
const exportRenderBtn = document.getElementById('export-render-btn');
const selectedClipPanel = document.getElementById('selected-clip-panel');
const clipTitle = document.getElementById('clip-title');

/* ================= WORKSPACE SWITCHER ================= */
const wsTabs = document.querySelectorAll('.ws-tab');
const wsMains = document.querySelectorAll('.ws-main');

function switchWorkspace(name) {
    activeWs = name;
    wsTabs.forEach(t => t.classList.toggle('on', t.getAttribute('data-ws') === name));
    wsMains.forEach(m => m.classList.toggle('on', m.id === `ws-main-${name}`));
    // Move the single shared program monitor into the active tab
    const host = document.querySelector(`#ws-main-${name} .monitor-host`);
    if (host && programMonitor && programMonitor.parentElement !== host) {
        host.appendChild(programMonitor);
    }
    // Timeline is hidden on the export tab (matches approved mockup)
    if (timelinePanel) timelinePanel.style.display = (name === 'export') ? 'none' : '';
    renderTimeline();
}
wsTabs.forEach(t => {
    t.addEventListener('click', () => switchWorkspace(t.getAttribute('data-ws')));
});
const topbarExportBtn = document.getElementById('topbar-export-btn');
if (topbarExportBtn) topbarExportBtn.addEventListener('click', () => switchWorkspace('export'));
const gotoAudioLink = document.getElementById('goto-audio-link');
if (gotoAudioLink) gotoAudioLink.addEventListener('click', (e) => { e.preventDefault(); switchWorkspace('audio'); });

/* ================= HELPERS ================= */
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTc(sec) {
    const s = Math.max(0, sec || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60), ff = Math.floor((s % 1) * 30);
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(ss)}:${p(ff)}`;
}
function fmtRange(i, per, total) {
    const a = i * per, b = (i + 1) * per;
    const f = s => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`.slice(3);
    return `${f(a)}–${f(b)}`;
}
function setStatus(text, busy) {
    if (!statusState) return;
    statusState.textContent = (busy ? '◌ ' : '● ') + text;
    statusState.className = busy ? 'busy' : 'ok';
}
function log(msg, type = 'info') {
    if (!logViewer) return;
    const time = new Date().toLocaleTimeString('vi-VN');
    const el = document.createElement('div');
    el.className = `log-item ${type}`;
    el.textContent = `[${time}] ${msg}`;
    logViewer.appendChild(el);
    logViewer.scrollTop = logViewer.scrollHeight;
}
function setProgress(percent) {
    const pct = Math.min(100, Math.max(0, Math.round(percent)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
}
if (logToggleBtn && logDrawer) {
    logToggleBtn.addEventListener('click', () => {
        const open = logDrawer.style.display !== 'none';
        logDrawer.style.display = open ? 'none' : '';
        logToggleBtn.classList.toggle('on', !open);
    });
}

/* ================= PROJECT / SCENES / TIMELINE ================= */
function applyProject(job, topic) {
    const res = job.result || {};
    project.jobId = job.jobId || null;
    project.scenes = Array.isArray(res.scenes) ? res.scenes : [];
    project.durationSec = res.durationSec || project.durationSec;
    project.resolution = res.resolution || '';
    if (topic) project.topic = topic;
    if (projName && project.topic) projName.textContent = project.topic + ' ▾';
    renderSceneList();
    renderVoSegments();
    renderTimeline();
    if (statusScenes) {
        statusScenes.textContent = project.scenes.length
            ? `${project.scenes.length} phân cảnh · ${Math.round(project.durationSec)}s`
            : 'Chưa có phân cảnh';
    }
}

function renderSceneList() {
    if (!sceneList) return;
    if (sceneCount) sceneCount.textContent = String(project.scenes.length);
    if (!project.scenes.length) {
        sceneList.innerHTML = '<div class="empty-hint">Nhập prompt rồi bấm <b>Tạo lại</b> — AI sẽ chia phân cảnh tại đây.</div>';
        return;
    }
    const per = project.durationSec / project.scenes.length;
    sceneList.innerHTML = '';
    project.scenes.forEach((sc, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scn' + (i === selectedClipIdx ? ' active' : '');
        btn.innerHTML = `<span class="thumb">S${i + 1}</span>
            <span class="meta"><b>${esc(sc.title || `Phân cảnh ${i + 1}`)}</b><span>${fmtRange(i, per, project.durationSec)}</span></span>
            <span class="st"></span>`;
        btn.addEventListener('click', () => selectClip(i));
        sceneList.appendChild(btn);
    });
}

function renderVoSegments() {
    if (!voSegments) return;
    if (!project.scenes.length) {
        voSegments.innerHTML = '<div class="empty-hint">Chưa có voiceover — tạo video trước.</div>';
        return;
    }
    const per = project.durationSec / project.scenes.length;
    voSegments.innerHTML = '';
    project.scenes.forEach((sc, i) => {
        if (!sc.voiceOverText) return;
        const row = document.createElement('div');
        row.className = 'src-row';
        row.innerHTML = `<div class="pl"></div><div><b>S${i + 1} — “${esc((sc.voiceOverText || '').slice(0, 32))}…”</b><span>${fmtRange(i, per, project.durationSec)} · ${esc(voiceSelect ? voiceSelect.value : '')}</span></div>`;
        voSegments.appendChild(row);
    });
}

function waveSvg() {
    return `<svg class="wave" viewBox="0 0 940 28" preserveAspectRatio="none"><path d="M0,14 Q20,4 40,14 T80,14 T120,14 T160,14 T200,14 T240,14 T280,14 T320,14 T360,14 T400,14 T440,14 T480,14 T520,14 T560,14 T600,14 T640,14 T680,14 T720,14 T760,14 T800,14 T840,14 T880,14 T920,14 T940,14" stroke="#7EE787" fill="none" stroke-width="1.5"/></svg>`;
}

function renderTimeline() {
    if (!timelineTracks) return;
    const n = project.scenes.length;
    const dur = project.durationSec || 15;
    const per = n ? dur / n : 0;

    // ruler ticks every ~3s
    if (timelineRuler) {
        let html = '';
        const step = dur > 60 ? 10 : 3;
        for (let t = 0; t <= dur; t += step) {
            const left = (t / dur) * 100;
            const mm = String(Math.floor(t / 60)).padStart(2, '0');
            const ss = String(t % 60).padStart(2, '0');
            html += `<span style="left:${left}%">00:${mm}:${ss}</span>`;
        }
        timelineRuler.innerHTML = html;
    }

    const clipHtml = (i, sc) => {
        const left = (i / Math.max(n, 1)) * 100;
        const w = (1 / Math.max(n, 1)) * 100;
        const sel = i === selectedClipIdx ? ' sel' : '';
        return `<div class="clip v${sel}" data-clip="${i}" style="left:${left}%;width:${w}%">S${i + 1} · ${esc(sc.title || '')}</div>`;
    };
    const emptyLane = `<div class="tl-empty">Chưa có phân cảnh — nhập prompt ở tab Kịch bản và bấm Tạo lại</div>`;
    const voiceClip = n
        ? `<div class="clip a" style="left:0%;width:100%">${waveSvg()}<span style="position:relative">${esc(voiceSelect ? voiceSelect.value : 'Voiceover')} · Voiceover</span></div>`
        : emptyLane;

    let tracks = '';
    if (activeWs === 'audio') {
        tracks = `
        <div class="track"><div class="track-label">A1</div><div class="track-lane">${voiceClip}</div></div>
        <div class="track"><div class="track-label">A2</div><div class="track-lane">${n ? '<div class="clip t" style="left:0%;width:100%"><span style="position:relative">Summer Pop 120BPM · ducking -12dB</span></div>' : emptyLane}</div></div>
        <div class="track"><div class="track-label">A3</div><div class="track-lane">${n ? '<div class="clip v" style="left:22%;width:6%">Pop</div><div class="clip v" style="left:48%;width:6%">Whoosh</div><div class="clip v" style="left:82%;width:6%">Pop</div>' : emptyLane}</div></div>`;
    } else {
        const v1 = n ? project.scenes.map((sc, i) => clipHtml(i, sc)).join('') : emptyLane;
        const v2 = n ? `<div class="clip t" style="left:${(0.62) * 100}%;width:18%">Phụ đề · CTA</div>` : '';
        const trans = (activeWs === 'edit' && n > 1)
            ? project.scenes.slice(0, -1).map((_, i) => `<div class="trans" style="left:${((i + 1) / n) * 100}%"><i>◐</i></div>`).join('')
            : '';
        tracks = `
        <div class="track"><div class="track-label">V2</div><div class="track-lane">${v2}</div></div>
        <div class="track"><div class="track-label">V1</div><div class="track-lane">${v1}${trans}</div></div>
        <div class="track"><div class="track-label">A1</div><div class="track-lane">${voiceClip}</div></div>`;
    }
    tracks += `<div class="playhead" id="tl-playhead" style="left:64px"></div>`;
    timelineTracks.innerHTML = tracks;

    timelineTracks.querySelectorAll('.clip[data-clip]').forEach(el => {
        el.addEventListener('click', () => selectClip(parseInt(el.getAttribute('data-clip'), 10)));
    });
    updatePlayhead();
}

function selectClip(i) {
    selectedClipIdx = i;
    const sc = project.scenes[i];
    if (!sc) return;
    const per = project.durationSec / project.scenes.length;
    if (clipTitle) clipTitle.textContent = `S${i + 1} · ${sc.title || ''}`;
    if (selectedClipPanel) {
        selectedClipPanel.innerHTML = `
            <div class="fld"><span>Thời lượng</span><b class="fd">${per.toFixed(1)}s</b></div>
            <div class="fld"><span>Chuyển cảnh</span><b>${esc(sc.transition || 'fade')}</b></div>
            <div class="fld"><span>Voiceover</span><b style="font-weight:400;font-size:11px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(sc.voiceOverText || '')}">${esc((sc.voiceOverText || '—').slice(0, 40))}</b></div>
            <div class="fld"><span>Màu nền</span><b class="mono">${esc(sc.backgroundColor || '#000000')}</b></div>
            <div class="insp-note">${esc((sc.visualDescription || '').slice(0, 140))}</div>`;
    }
    if (monitorBadge) {
        monitorBadge.style.display = '';
        monitorBadge.textContent = `S${i + 1} · ${(sc.title || '').toUpperCase().slice(0, 24)}`;
    }
    renderSceneList();
    renderTimeline();
}

function updatePlayhead() {
    const ph = document.getElementById('tl-playhead');
    if (!ph || !videoPlayer || !videoPlayer.duration) return;
    const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    ph.style.left = `calc(64px + (100% - 64px) * ${pct / 100})`;
}

/* ================= PROGRAM MONITOR ================= */
function displayVideo(jobId) {
    const videoUrl = `${API_BASE}/api/jobs/${jobId}/video`;
    if (videoEmpty) videoEmpty.style.display = 'none';
    if (videoPlayer) {
        videoPlayer.style.display = 'block';
        videoPlayer.src = videoUrl;
        videoPlayer.load();
        videoPlayer.play().catch(() => { });
    }
    if (monitorBadge) {
        monitorBadge.style.display = '';
        monitorBadge.textContent = project.topic ? project.topic.toUpperCase().slice(0, 28) : 'FINAL';
    }
    if (btnDownload) {
        btnDownload.style.display = 'inline-flex';
        btnDownload.href = `${API_BASE}/api/jobs/${jobId}/download`;
    }
    if (btnPreviewHtml) {
        btnPreviewHtml.style.display = 'inline-flex';
        btnPreviewHtml.href = `${API_BASE}/api/jobs/${jobId}/html`;
    }
}
if (transportPlay && videoPlayer) {
    transportPlay.addEventListener('click', () => {
        if (!videoPlayer.src) return;
        if (videoPlayer.paused) videoPlayer.play().catch(() => { });
        else videoPlayer.pause();
    });
    videoPlayer.addEventListener('play', () => transportPlay.classList.add('pause'));
    videoPlayer.addEventListener('pause', () => transportPlay.classList.remove('pause'));
    videoPlayer.addEventListener('timeupdate', () => {
        if (monitorTc) monitorTc.textContent = fmtTc(videoPlayer.currentTime);
        updatePlayhead();
    });
}

/* ================= STUDIO CONTROLS ================= */
// Style cards
const styleCards = document.querySelectorAll('.style-choice-card');
styleCards.forEach(card => {
    card.addEventListener('click', () => {
        styleCards.forEach(c => c.classList.remove('on'));
        card.classList.add('on');
        const st = card.getAttribute('data-style') || 'modern';
        if (styleSelect) {
            styleSelect.value = st;
            styleSelect.dispatchEvent(new Event('change'));
        }
        renderMotionBlocks();
        updateSummaryMeta();
    });
});

// Ratio buttons (script tab only — export tab uses .opt-btn)
const ratioBtns = document.querySelectorAll('.ratio-btn');
ratioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        ratioBtns.forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        currentRatio = btn.getAttribute('data-ratio') || '16:9';
        updateSummaryMeta();
    });
});

// Export option groups (visual only)
document.querySelectorAll('.opt-group').forEach(group => {
    const btns = group.querySelectorAll('.opt-btn');
    btns.forEach(b => b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('on'));
        b.classList.add('on');
    }));
});

// Duration input
if (durationInput) {
    durationInput.addEventListener('input', () => {
        updateSummaryMeta();
    });
}

// Prompt counter
if (promptInput && promptCharCount) {
    promptInput.addEventListener('input', () => {
        const len = promptInput.value.length;
        promptCharCount.textContent = `${len}/500 · tối thiểu 10`;
        promptCharCount.classList.toggle('warn', len > 0 && len < 10);
    });
}
function setPrompt(text) {
    if (!promptInput) return;
    promptInput.value = text;
    promptInput.focus();
    if (promptCharCount) {
        promptCharCount.textContent = `${text.length}/500 · tối thiểu 10`;
        promptCharCount.classList.remove('warn');
    }
}

// TTS provider sync
if (ttsProviderSelect && voiceSelect) {
    ttsProviderSelect.addEventListener('change', () => {
        const prov = ttsProviderSelect.value;
        if (prov === 'vieneu') {
            const isVieNeu = ['Minh Quân', 'Mai Anh', 'Adam', 'Ái Hân', 'Mỹ Duyên', 'Đức Trí', 'Hữu Quân', 'Xuân Tiên', 'Trúc Ly', 'Anh Khôi', 'Mạnh Dũng'].includes(voiceSelect.value);
            if (!isVieNeu) voiceSelect.value = 'Minh Quân';
        } else if (prov === 'edge') {
            voiceSelect.value = 'vi-VN-HoaiMyNeural';
        }
    });
}

// TTS engine cards (audio tab)
const ttsEngineCards = document.querySelectorAll('.tts-engine-card');
ttsEngineCards.forEach(card => {
    card.addEventListener('click', () => {
        ttsEngineCards.forEach(c => c.classList.remove('on'));
        card.classList.add('on');
        const eng = card.getAttribute('data-engine') || 'vieneu';
        if (ttsProviderSelect) {
            ttsProviderSelect.value = eng;
            ttsProviderSelect.dispatchEvent(new Event('change'));
        }
    });
});

// Voice toggle (audio tab)
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const voiceStatusText = document.getElementById('voice-status-text');
if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener('click', () => {
        voiceEnabled = !voiceEnabled;
        voiceToggleBtn.classList.toggle('on', voiceEnabled);
        if (voiceStatusText) voiceStatusText.textContent = voiceEnabled ? 'Đang bật' : 'Đang tắt';
    });
}

// Toggle switches (ducking/normalize/async/skip-preview)
document.querySelectorAll('.switch-row').forEach(row => {
    const btn = row.querySelector('.clean-toggle-switch');
    if (btn) btn.addEventListener('click', () => btn.classList.toggle('on'));
});

// Voice speed / pitch sliders (visual)
const voiceSpeed = document.getElementById('voice-speed');
const voiceSpeedVal = document.getElementById('voice-speed-val');
if (voiceSpeed && voiceSpeedVal) {
    voiceSpeed.addEventListener('input', () => { voiceSpeedVal.textContent = (voiceSpeed.value / 100).toFixed(1) + '×'; });
}
const voicePitch = document.getElementById('voice-pitch');
const voicePitchVal = document.getElementById('voice-pitch-val');
if (voicePitch && voicePitchVal) {
    voicePitch.addEventListener('input', () => {
        const v = parseInt(voicePitch.value, 10);
        voicePitchVal.textContent = (v > 0 ? '+' : '') + v + ' st';
    });
}

// Motion search (edit tab library)
const motionSearch = document.getElementById('motion-search');
if (motionSearch) motionSearch.addEventListener('input', renderMotionBlocks);

function updateSummaryMeta() {
    const dur = durationInput ? (durationInput.value || 15) : 15;
    if (summaryMetaLine) summaryMetaLine.textContent = `${currentRatio} · ${dur}s`;
    if (statusEta) statusEta.textContent = `⏱ ~${Math.max(1, Math.round(dur / 8))} phút render`;
}

/* ================= MOTION CATALOG ================= */
function updateMotionCount() {
    const count = selectedMotionBlockIds.size;
    if (motionBlocksCount) motionBlocksCount.textContent = String(count);
    renderSelectedChips();
}

function renderSelectedChips() {
    if (!selectedMotionChips) return;
    if (!selectedMotionBlockIds.size) {
        selectedMotionChips.innerHTML = '<span class="insp-note">Chưa chọn block nào.</span>';
        return;
    }
    selectedMotionChips.innerHTML = '';
    catalogBlocks.filter(b => selectedMotionBlockIds.has(b.id)).forEach(block => {
        const chip = document.createElement('span');
        chip.className = 'mchip on';
        chip.innerHTML = `${esc(block.name)}<button type="button" aria-label="Bỏ chọn">×</button>`;
        chip.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            selectedMotionBlockIds.delete(block.id);
            renderMotionBlocks();
            updateMotionCount();
        });
        selectedMotionChips.appendChild(chip);
    });
}

function renderCategoryChips(categories) {
    const wrap = document.getElementById('category-chips-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    categories.forEach(cat => {
        const chip = document.createElement('button');
        chip.type = 'button';
        const isCurrent = (catalogCategoryFilter && catalogCategoryFilter.value === (cat === 'Tất cả' ? '' : cat));
        chip.className = 'cat-filter-chip' + (isCurrent ? ' on' : '');
        chip.textContent = cat;
        chip.addEventListener('click', () => {
            if (catalogCategoryFilter) catalogCategoryFilter.value = cat === 'Tất cả' ? '' : cat;
            renderCategoryChips(categories);
            renderMotionBlocks();
        });
        wrap.appendChild(chip);
    });
}

function renderMotionBlocks() {
    if (!motionLibrary) return;
    const category = catalogCategoryFilter ? catalogCategoryFilter.value : '';
    const style = styleSelect ? styleSelect.value : 'modern';
    const q = motionSearch ? motionSearch.value.trim().toLowerCase() : '';
    const filtered = catalogBlocks.filter((b) => {
        const styleOk = !b.styleAffinity || b.styleAffinity.includes('any') || b.styleAffinity.includes(style);
        const catOk = !category || b.category === category;
        const qOk = !q || (b.name || '').toLowerCase().includes(q) || (b.category || '').toLowerCase().includes(q);
        return styleOk && catOk && qOk;
    });

    const visibleIds = new Set(filtered.map((b) => b.id));
    for (const id of [...selectedMotionBlockIds]) {
        if (!visibleIds.has(id)) selectedMotionBlockIds.delete(id);
    }

    motionLibrary.innerHTML = '';
    if (!filtered.length) {
        motionLibrary.innerHTML = '<div class="empty-hint">Không tìm thấy block phù hợp.</div>';
    }
    filtered.forEach((block) => {
        const isSelected = selectedMotionBlockIds.has(block.id);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'lib-card' + (isSelected ? ' selected' : '');
        card.innerHTML = `<span class="th">${isSelected ? '✓' : esc((block.name || 'M')[0].toUpperCase())}</span>
            <span class="nm">${esc(block.name)}${block.runtime ? ' ·core' : ''}</span>
            <span class="du">${esc(block.category || '')}</span>`;
        card.addEventListener('click', () => {
            if (selectedMotionBlockIds.has(block.id)) {
                selectedMotionBlockIds.delete(block.id);
            } else {
                if (selectedMotionBlockIds.size >= 8) {
                    log('Chỉ chọn tối đa 8 motion blocks', 'error');
                    return;
                }
                selectedMotionBlockIds.add(block.id);
            }
            renderMotionBlocks();
            updateMotionCount();
        });
        motionLibrary.appendChild(card);
    });
    updateMotionCount();
}

async function loadCatalog() {
    try {
        const res = await fetch(`${API_BASE}/api/catalog`);
        if (!res.ok) throw new Error('Không tải được catalog');
        const data = await res.json();
        catalogBlocks = data.blocks || [];
        if (blueprintSelect) {
            const current = blueprintSelect.value;
            blueprintSelect.innerHTML = '<option value="">(Mặc định — 5-beat spine)</option>';
            (data.blueprints || []).forEach((bp) => {
                const opt = document.createElement('option');
                opt.value = bp.id;
                opt.textContent = bp.name;
                blueprintSelect.appendChild(opt);
            });
            if (current) blueprintSelect.value = current;
        }
        const cats = ['Tất cả', ...new Set(catalogBlocks.map((b) => b.category).filter(Boolean))].sort();
        renderCategoryChips(cats);
        renderMotionBlocks();
        log(`Đã tải catalog: ${catalogBlocks.length} blocks, ${(data.blueprints || []).length} blueprints`, 'info');
    } catch (err) {
        log(`Catalog: ${err.message}`, 'error');
        if (motionLibrary) motionLibrary.innerHTML = '<div class="empty-hint">Không tải được thư viện.</div>';
    }
}
if (styleSelect) styleSelect.addEventListener('change', renderMotionBlocks);

/* ================= RENDER QUEUE ================= */
async function loadRenderQueue() {
    if (!renderQueue) return;
    try {
        const res = await fetch(`${API_BASE}/api/jobs`);
        if (!res.ok) throw new Error('no jobs');
        const jobs = await res.json();
        if (!jobs.length) {
            renderQueue.innerHTML = '<div class="empty-hint">Chưa có job nào.</div>';
            return;
        }
        renderQueue.innerHTML = '';
        jobs.slice(0, 8).forEach(j => {
            const el = document.createElement('div');
            el.className = 'job';
            const pct = j.status === 'completed' ? 100 : (j.status === 'failed' ? 0 : 12);
            const pill = j.status === 'completed' ? '<span class="st-pill done">Xong</span>'
                : j.status === 'failed' ? '<span class="st-pill fail">Lỗi</span>'
                    : '<span class="st-pill run">Đang chạy</span>';
            el.innerHTML = `<div class="th">${j.status === 'completed' ? '▶' : '◌'}</div>
                <div class="inf"><b>${esc(j.topic || j.jobId)}</b>
                <span>${j.durationSec ? Math.round(j.durationSec) + 's · ' : ''}${esc(j.status)}</span>
                ${j.status !== 'completed' && j.status !== 'failed' ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}</div>
                ${pill}
                ${j.status === 'completed' ? `<a class="dl" href="${API_BASE}/api/jobs/${j.jobId}/download" download>Tải ↓</a>` : ''}`;
            renderQueue.appendChild(el);
        });
        return jobs;
    } catch (e) {
        renderQueue.innerHTML = '<div class="empty-hint">Không tải được hàng đợi.</div>';
        return [];
    }
}

/* ================= GENERATE ================= */
async function fetchJobDetail(jobId) {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
    if (!res.ok) return null;
    return res.json();
}

function startGenerate() {
    if (generateBtn) generateBtn.click();
}
if (exportRenderBtn) {
    exportRenderBtn.addEventListener('click', () => {
        switchWorkspace('script');
        setTimeout(startGenerate, 60);
    });
}

if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        const prompt = promptInput ? promptInput.value.trim() : '';
        if (prompt.length < 10) {
            alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
            if (promptInput) promptInput.focus();
            return;
        }
        generateBtn.disabled = true;
        if (exportRenderBtn) exportRenderBtn.disabled = true;
        if (btnSpinner) btnSpinner.style.display = 'inline-block';
        if (btnText) btnText.textContent = 'Đang tạo...';
        setProgress(5);
        setStatus('Đang tạo video', true);
        if (projName) projName.textContent = prompt.slice(0, 32) + ' ▾';
        project.topic = prompt.slice(0, 60);
        log(`Bắt đầu tạo video: "${prompt}"`, 'info');

        try {
            let selectedStyle = styleSelect ? styleSelect.value : 'modern';
            if (selectedStyle === 'modern' &&
                /(?:^|[^\p{L}\p{N}_])(người\s*que|stickman)(?=[^\p{L}\p{N}_]|$)/iu.test(prompt)) {
                selectedStyle = 'stickman';
            }
            const prov = ttsProviderSelect ? ttsProviderSelect.value : 'vieneu';
            const v = voiceSelect ? voiceSelect.value : 'Minh Quân';
            const blueprintId = blueprintSelect && blueprintSelect.value ? blueprintSelect.value : undefined;
            const motionBlockIds = [...selectedMotionBlockIds].slice(0, 8);

            let targetDurationSec = 15;
            if (durationInput) {
                const parsed = parseInt(durationInput.value, 10);
                if (Number.isFinite(parsed)) {
                    targetDurationSec = Math.min(300, Math.max(10, parsed));
                    durationInput.value = String(targetDurationSec);
                } else {
                    durationInput.value = '15';
                }
            }

            const asyncSwitch = document.querySelector('#async-queue-switch .clean-toggle-switch');
            const skipPreviewSwitch = document.querySelector('#skip-preview-switch .clean-toggle-switch');
            const isAsync = asyncSwitch ? asyncSwitch.classList.contains('on') : true;
            const skipPrev = skipPreviewSwitch ? skipPreviewSwitch.classList.contains('on') : false;

            const payload = {
                prompt, aspectRatio: currentRatio, targetDurationSec,
                language: 'vi', style: selectedStyle,
                ttsProvider: voiceEnabled ? prov : undefined,
                voice: voiceEnabled ? v : undefined,
                async: isAsync
            };
            if (blueprintId) payload.blueprintId = blueprintId;
            if (motionBlockIds.length) payload.motionBlockIds = motionBlockIds;
            if (skipPrev) payload.skipPreview = true;
            if (customStyleInput && customStyleInput.value.trim()) payload.customStyle = customStyleInput.value.trim();
            if (customScriptJson && customScriptJson.value.trim()) {
                try { payload.script = JSON.parse(customScriptJson.value.trim()); }
                catch (e) { log('Lỗi phân tích cú pháp JSON kịch bản tự dựng', 'error'); }
            }

            const res = await fetch(`${API_BASE}/api/pipeline`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Khởi tạo thất bại');
            }
            const data = await res.json();
            const jobId = data.jobId;
            log(`Đã khởi tạo công việc: ${jobId}`, 'info');
            loadRenderQueue();

            let lastMessage = '';
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${API_BASE}/api/jobs/${jobId}`);
                    if (!statusRes.ok) return;
                    const job = await statusRes.json();
                    if (job.progress) {
                        setProgress(job.progress.progress || 10);
                        if (job.progress.message && job.progress.message !== lastMessage) {
                            lastMessage = job.progress.message;
                            log(job.progress.message, 'info');
                        }
                    }
                    if (job.status === 'completed') {
                        clearInterval(pollInterval);
                        setProgress(100);
                        setStatus('Sẵn sàng', false);
                        log('Hoàn tất render video!', 'success');
                        generateBtn.disabled = false;
                        if (exportRenderBtn) exportRenderBtn.disabled = false;
                        if (btnSpinner) btnSpinner.style.display = 'none';
                        if (btnText) btnText.textContent = 'Tạo lại ⟳';
                        const full = await fetchJobDetail(jobId);
                        if (full) applyProject(full, project.topic);
                        displayVideo(jobId);
                        loadRenderQueue();
                    } else if (job.status === 'failed') {
                        clearInterval(pollInterval);
                        setProgress(0);
                        setStatus('Sẵn sàng', false);
                        log(`Thất bại: ${job.error || 'Lỗi không xác định'}`, 'error');
                        generateBtn.disabled = false;
                        if (exportRenderBtn) exportRenderBtn.disabled = false;
                        if (btnSpinner) btnSpinner.style.display = 'none';
                        if (btnText) btnText.textContent = 'Thử lại';
                        loadRenderQueue();
                    }
                } catch (pollErr) { console.error(pollErr); }
            }, 1000);
        } catch (err) {
            log(`Lỗi: ${err.message}`, 'error');
            setStatus('Sẵn sàng', false);
            generateBtn.disabled = false;
            if (exportRenderBtn) exportRenderBtn.disabled = false;
            if (btnSpinner) btnSpinner.style.display = 'none';
            if (btnText) btnText.textContent = 'Tạo lại ⟳';
            setProgress(0);
        }
    });
}

/* ================= INIT ================= */
(async function init() {
    handleAuthError();
    await checkAuthConfig();
    await checkCurrentUser();
    await loadCatalog();
    updateSummaryMeta();
    restorePendingPrompt();
    switchWorkspace('script');

    const jobs = await loadRenderQueue();
    const completedJob = (jobs || []).find(j => j.status === 'completed');
    if (completedJob) {
        log(`Đã tìm thấy video trước đó: ${completedJob.topic || completedJob.jobId}`, 'info');
        const full = await fetchJobDetail(completedJob.jobId);
        if (full) applyProject(full, completedJob.topic);
        displayVideo(completedJob.jobId);
    }
})();

async function checkAuthConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/auth/config`);
        if (res.ok) {
            const data = await res.json();
            isGoogleAuthEnabled = Boolean(data.googleAuthEnabled);
        }
    } catch (e) { }
}

async function checkCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { method: 'GET', credentials: 'include' });
        if (!res.ok) { window.location.href = '/?auth=open'; return; }
        const data = await res.json();
        const user = data.user || data;
        setWsUser(user.username, user.role);
    } catch (err) { window.location.href = '/?auth=open'; }
}

if (wsLogoutBtn) {
    wsLogoutBtn.addEventListener('click', async () => {
        try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch (err) { }
        window.location.href = '/';
    });
}

// Nhận prompt/mẫu từ trang chủ gửi sang
function restorePendingPrompt() {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem('lime-pending-prompt') || 'null'); } catch (e) { }
    if (!data) return;
    try { sessionStorage.removeItem('lime-pending-prompt'); } catch (e) { }
    if (data.prompt && promptInput) {
        promptInput.value = data.prompt;
        if (promptCharCount) {
            promptCharCount.textContent = `${data.prompt.length}/500 · tối thiểu 10`;
            promptCharCount.classList.remove('warn');
        }
    }
    if (data.style && styleSelect) {
        styleSelect.value = data.style;
        styleSelect.dispatchEvent(new Event('change'));
        document.querySelectorAll('.style-choice-card').forEach(c =>
            c.classList.toggle('on', c.getAttribute('data-style') === data.style));
    }
    if (data.ratio) {
        document.querySelectorAll('.ratio-btn').forEach(r => {
            const match = r.getAttribute('data-ratio') === data.ratio;
            r.classList.toggle('on', match);
            if (match) currentRatio = data.ratio;
        });
    }
    updateSummaryMeta();
    log('Đã nhận nội dung từ trang chủ.', 'info');
}
