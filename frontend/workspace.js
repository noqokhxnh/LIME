// LIME Workspace v2 — Premiere-style 4-workspace editor logic
// Base URL auto-detection
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? ((window.location.origin && window.location.origin.includes(':3000')) ? '' : 'http://localhost:3000')
    : '';

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

// Form 'quên mật khẩu' cho người chưa đăng nhập đã gỡ: chưa có hạ tầng
// gửi email xác thực nên flow này không thể an toàn. Link 'quên mật khẩu'
// hiện chỉ hiển thị thông báo liên hệ hỗ trợ (listener phía trên).

if (showLoginFromForgotBtn && forgotForm) {
    showLoginFromForgotBtn.addEventListener('click', () => {
        if (showLoginBtn) showLoginBtn.click();
    });
}



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
let currentRatio = '16:9';
let selectedClipIdx = -1;
let currentPreviewJobId = null;
let previewPlayer = null;

/**
 * Phong cách hiển thị hiện tại.
 *
 * Trước đây người dùng chọn style bằng card trong Inspector; giờ style do phương
 * án họ chọn quyết định (mỗi phương án gắn một style). Biến này chỉ còn là
 * fallback khi gọi API trực tiếp (và khi nhận style từ trang chủ).
 */
let activeStyle = 'modern';

/**
 * Trạng thái bước duyệt kịch bản (HITL).
 *
 * `stage` đi theo thứ tự: prompt → ask → review. Mỗi lần chỉ hỏi một câu
 * (`askIndex`), câu AI đã chắc thì gom vào `open` khi người dùng muốn sửa.
 * Stage được lưu cùng localStorage để reload không mất câu trả lời và 3 phương án.
 */
const hitl = {
    stage: 'prompt',
    prompt: '',
    questions: [],
    answers: {},
    confidence: {},
    open: new Set(),
    askIndex: 0,
    drafts: [],
    selectedKey: null,
    recommended: null,
    rotation: 0,
    auto: false,
    loading: false,
    error: '',
};
const HITL_STORAGE_KEY = 'lime.hitl.v1';
const HITL_CONFIDENCE_THRESHOLD = 0.8;

const project = { scenes: [], durationSec: 15, topic: '', jobId: null, resolution: '' };

/* ================= ELEMENTS ================= */
const promptInput = document.getElementById('prompt-input');
const promptCharCount = document.getElementById('prompt-char-count');
const durationInput = document.getElementById('duration-input');
const voiceSelect = document.getElementById('voice-select');
const primaryBtn = document.getElementById('btn-primary');
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
const btnLivePreview = document.getElementById('btn-live-preview');
const previewModal = document.getElementById('preview-modal');
const previewModalClose = document.getElementById('preview-modal-close');
const summaryMetaLine = document.getElementById('summary-meta-line');
const customStyleInput = document.getElementById('custom-style-input');
const customScriptJson = document.getElementById('custom-script-json');
/**
 * Kịch bản JSON mẫu điền sẵn trong "Kịch bản tự dựng".
 *
 * Đây là mẫu hợp lệ theo `videoScriptSchema` (2 cảnh + 1 boundary). Để nguyên
 * thì luồng AI chạy bình thường; sửa một ký tự là box được dùng làm kịch bản
 * thật. Nhờ vậy người dùng thấy ngay cấu trúc mà không cần tài liệu riêng.
 */
const SAMPLE_SCRIPT_JSON = `{
  "id": "demo",
  "title": "Video mẫu",
  "description": "Một video mẫu để xem cấu trúc JSON.",
  "globalStyles": "body{margin:0;background:#0B0F0A;color:#F7FEE7;font-family:Inter,sans-serif}",
  "globalSetupJs": "",
  "scenes": [
    {
      "id": "s1",
      "title": "Mở đầu",
      "voiceOverText": "Xin chào, đây là video mẫu.",
      "visualDescription": "Tiêu đề lớn giữa màn hình",
      "htmlCode": "<h1 class=\\"title\\">Xin chào</h1>",
      "cssCode": ".title{font-size:9vw;text-align:center}",
      "jsCode": "",
      "transition": "fade",
      "backgroundColor": "#0B0F0A"
    },
    {
      "id": "s2",
      "title": "Kết",
      "voiceOverText": "Hết.",
      "visualDescription": "Chữ nhỏ dần",
      "htmlCode": "<p class=\\"end\\">Hết</p>",
      "cssCode": ".end{font-size:3vw;text-align:center}",
      "jsCode": "",
      "transition": "fade",
      "backgroundColor": "#0B0F0A"
    }
  ],
  "boundaries": [
    { "id": "b1", "fromScene": "s1", "toScene": "s2", "carry": { "element": "title", "mechanism": "morph" } }
  ],
  "colorPalette": { "primary": "#84CC16", "secondary": "#4D7C0F", "accent": "#FACC15", "background": "#0B0F0A", "text": "#F7FEE7" },
  "fontFamily": "Inter"
}`;

if (customScriptJson) customScriptJson.value = SAMPLE_SCRIPT_JSON;

const leftTitle = document.getElementById('left-title');
const stepDots = document.getElementById('step-dots');
const stepPrompt = document.getElementById('step-prompt');
const stepAsk = document.getElementById('step-ask');
const askCounter = document.getElementById('ask-counter');
const askBarFill = document.getElementById('ask-bar-fill');
const askAutoStrip = document.getElementById('ask-auto-strip');
const askBody = document.getElementById('ask-body');
const btnClarifyRefresh = document.getElementById('btn-clarify-refresh');
const leftFoot = document.getElementById('left-foot');
const autoDecide = document.getElementById('auto-decide');
const autoNote = document.getElementById('auto-note');
const reviewBoard = document.getElementById('review-board');
const rbBack = document.getElementById('rb-back');
const rbAnswersText = document.getElementById('rb-answers-text');
const rbEditAnswers = document.getElementById('rb-edit-answers');
const rbShuffle = document.getElementById('rb-shuffle');
const rbCards = document.getElementById('rb-cards');
const rbEditor = document.getElementById('rb-editor');
const rbFootHint = document.getElementById('rb-foot-hint');
const rbAuto = document.getElementById('rb-auto');
const rbApprove = document.getElementById('rb-approve');
const monitorBadge = document.getElementById('monitor-badge');
const monitorTc = document.getElementById('monitor-tc');
const transportPlay = document.getElementById('transport-play');
const timelineRuler = document.getElementById('timeline-ruler');
const timelineTracks = document.getElementById('timeline-tracks');
const statusState = document.getElementById('status-state');
const statusScenes = document.getElementById('status-scenes');
const statusEta = document.getElementById('status-eta');
const projName = document.getElementById('proj-name');
const sceneList = document.getElementById('scene-list');
const sceneCount = document.getElementById('scene-count');

/* ================= WORKSPACE ================= */
// Workspace rút gọn còn một không gian duy nhất: "Kịch bản" (tạo video trọn gói).
const wsTabs = document.querySelectorAll('.ws-tab');
wsTabs.forEach(t => {
    t.classList.add('on');
});
const topbarExportBtn = document.getElementById('topbar-export-btn');

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
    if (projName) setProjectName(project.topic);
    renderSceneList();
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
        sceneList.innerHTML = '<div class="empty-hint">Nhập prompt rồi bấm <b>Tiếp tục</b> — AI sẽ chia phân cảnh tại đây.</div>';
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
    const emptyLane = `<div class="tl-empty">Chưa có phân cảnh — nhập prompt ở panel trái và bấm Tiếp tục</div>`;
    const voiceClip = n
        ? `<div class="clip a" style="left:0%;width:100%">${waveSvg()}<span style="position:relative">${esc(voiceSelect ? voiceSelect.value : 'Voiceover')} · Voiceover</span></div>`
        : emptyLane;

    const v1 = n ? project.scenes.map((sc, i) => clipHtml(i, sc)).join('') : emptyLane;
    const v2 = n ? `<div class="clip t" style="left:${(0.62) * 100}%;width:18%">Phụ đề · CTA</div>` : '';
    const trans = n > 1
        ? project.scenes.slice(0, -1).map((_, i) => `<div class="trans" style="left:${((i + 1) / n) * 100}%"><i>◐</i></div>`).join('')
        : '';

    let tracks = `
        <div class="track"><div class="track-label">V2</div><div class="track-lane">${v2}</div></div>
        <div class="track"><div class="track-label">V1</div><div class="track-lane">${v1}${trans}</div></div>
        <div class="track"><div class="track-label">A1</div><div class="track-lane">${voiceClip}</div></div>`;
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
    if (btnLivePreview) {
        btnLivePreview.style.display = 'inline-flex';
        currentPreviewJobId = jobId;
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
// Style không còn chọn ở Inspector: mỗi phương án kịch bản đã gắn sẵn một style.
// Card phong cách cũ bị bỏ để tránh mâu thuẫn "chọn Editorial nhưng lại duyệt
// phương án Dữ liệu".

// Ratio buttons
const ratioBtns = document.querySelectorAll('.ratio-btn');
ratioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        ratioBtns.forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        currentRatio = btn.getAttribute('data-ratio') || '16:9';
        updateSummaryMeta();
    });
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

// Engine TTS suy ra từ giọng đã chọn: giọng Edge có tiền tố "vi-VN-…", còn lại là VieNeu.
// Nhờ vậy không còn khả năng lệch engine/giọng như khi chọn engine ở tab riêng.
function providerForVoice(voice) {
    return /^vi-VN-/i.test(String(voice || '')) ? 'edge' : 'vieneu';
}

function updateSummaryMeta() {
    const dur = durationInput ? (durationInput.value || 15) : 15;
    if (summaryMetaLine) summaryMetaLine.textContent = `${currentRatio} · ${dur}s`;
    if (statusEta) statusEta.textContent = `~${Math.max(1, Math.round(dur / 8))} phút render`;
}

/* ================= JOBS ================= */
// Danh sách job gần đây — dùng để khôi phục video hoàn tất gần nhất khi mở workspace.
async function fetchJobs() {
    try {
        const res = await fetch(`${API_BASE}/api/jobs`);
        if (!res.ok) throw new Error('Không tải được danh sách job');
        const jobs = await res.json();
        return Array.isArray(jobs) ? jobs : [];
    } catch (e) {
        log(`Hàng đợi: ${e.message}`, 'error');
        return [];
    }
}

/** Mốc thời gian của job để xếp mới nhất trước (server có thể trả theo thứ tự chèn). */
function jobTime(job) {
    const t = Date.parse(job && (job.updatedAt || job.createdAt) || '');
    return Number.isFinite(t) ? t : 0;
}

/** Tên dự án trên topbar; bấm vào là tạo dự án mới. */
function setProjectName(topic) {
    if (!projName) return;
    const text = String(topic || '').trim();
    projName.textContent = text || 'Dự án mới';
    projName.classList.toggle('is-empty', !text);
    projName.title = text ? `${text} — bấm để tạo dự án mới` : 'Bắt đầu dự án mới';
}

/**
 * Xoá sạch trạng thái của dự án hiện tại để bắt đầu video mới.
 *
 * Không đụng tới cấu hình Inspector (khung hình, thời lượng, giọng đọc) vì đó là
 * lựa chọn mặc định của người dùng, không phải dữ liệu của dự án.
 */
function resetProject() {
    if (hitlPersistTimer) {
        clearTimeout(hitlPersistTimer);
        hitlPersistTimer = null;
    }
    if (pollInterval) {
        const proceed = window.confirm('Video đang render. Tạo dự án mới sẽ bỏ theo dõi job này (video vẫn chạy trên server). Tiếp tục?');
        if (!proceed) return;
        clearInterval(pollInterval);
        pollInterval = null;
    }

    hitl.prompt = '';
    hitl.questions = [];
    hitl.answers = {};
    hitl.confidence = {};
    hitl.open.clear();
    hitl.askIndex = 0;
    hitl.drafts = [];
    hitl.selectedKey = null;
    hitl.recommended = null;
    hitl.rotation = 0;
    hitl.error = '';
    closeBoard();
    setStage('prompt');
    if (askBody) askBody.innerHTML = '';
    if (askAutoStrip) {
        askAutoStrip.hidden = true;
        askAutoStrip.innerHTML = '';
    }
    try { localStorage.removeItem(HITL_STORAGE_KEY); } catch (e) { }

    if (promptInput) {
        promptInput.value = '';
        promptInput.focus();
    }
    if (promptCharCount) {
        promptCharCount.textContent = '0/500 · tối thiểu 10';
        promptCharCount.classList.remove('warn');
    }
    if (customScriptJson) customScriptJson.value = SAMPLE_SCRIPT_JSON;

    project.scenes = [];
    project.topic = '';
    project.jobId = null;
    project.resolution = '';
    selectedClipIdx = -1;
    setProjectName('');

    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
        videoPlayer.style.display = 'none';
    }
    if (videoEmpty) videoEmpty.style.display = '';
    if (monitorBadge) monitorBadge.style.display = 'none';
    if (monitorTc) monitorTc.textContent = '00:00:00:00';
    if (btnDownload) {
        btnDownload.style.display = 'none';
        btnDownload.removeAttribute('href');
    }
    if (btnPreviewHtml) {
        btnPreviewHtml.style.display = 'none';
        btnPreviewHtml.removeAttribute('href');
    }
    if (btnLivePreview) btnLivePreview.style.display = 'none';
    currentPreviewJobId = null;

    renderSceneList();
    renderTimeline();
    updateSummaryMeta();
    setProgress(0);
    setStatus('Sẵn sàng', false);
    if (statusScenes) statusScenes.textContent = 'Chưa có phân cảnh';
    log('Đã tạo dự án mới.', 'info');
}


/* ================= GENERATE ================= */
async function fetchJobDetail(jobId) {
    const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
    if (!res.ok) return null;
    return res.json();
}

function currentPrompt() {
    return promptInput ? promptInput.value.trim() : '';
}

function countWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Payload chung cho cả 3 bước: hỏi, sinh phương án, render. */
function buildBasePayload(prompt) {
    const voice = voiceSelect ? voiceSelect.value : 'Minh Quân';

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

    const payload = {
        prompt,
        aspectRatio: currentRatio,
        targetDurationSec,
        language: 'vi',
        style: activeStyle,
        ttsProvider: providerForVoice(voice),
        voice,
    };
    if (customStyleInput && customStyleInput.value.trim()) payload.customStyle = customStyleInput.value.trim();
    return payload;
}

function setBusy(busy, label) {
    hitl.loading = !!busy;
    if (primaryBtn) primaryBtn.disabled = busy;
    if (btnSpinner) btnSpinner.style.display = busy ? 'inline-block' : 'none';
    if (btnText) {
        if (busy && label) btnText.textContent = label;
        else renderFooter();
    }
    if (btnClarifyRefresh) btnClarifyRefresh.disabled = busy;
}

/* ================= HITL: prompt → câu hỏi → duyệt ================= */

/** Câu AI chưa chắc (hoặc người dùng chủ động mở) mới thành màn hỏi. */
function visibleQuestions() {
    const all = hitl.questions || [];
    return all.filter(q => (hitl.confidence[q.id] ?? q.confidence ?? 0) < HITL_CONFIDENCE_THRESHOLD
        || hitl.open.has(q.id));
}

function answerLabel(question) {
    const id = hitl.answers[question.id] ?? question.selected;
    const opt = (question.options || []).find(o => o.id === id);
    return opt ? opt.label : String(id || '');
}

function answerSummary() {
    return (hitl.questions || []).map(q => answerLabel(q)).filter(Boolean).join(' · ');
}

function targetDuration() {
    const n = parseInt(durationInput && durationInput.value, 10);
    return Number.isFinite(n) ? Math.min(300, Math.max(10, n)) : 15;
}

function setStage(stage) {
    hitl.stage = stage;
    if (stepPrompt) stepPrompt.hidden = stage !== 'prompt';
    if (stepAsk) stepAsk.hidden = stage !== 'ask';
    if (leftTitle) {
        leftTitle.textContent = stage === 'ask' ? 'Hướng làm'
            : stage === 'review' ? 'Phương án' : 'Kịch bản AI';
    }
    renderStepDots();
    renderFooter();
}

function renderStepDots() {
    if (!stepDots) return;
    const reached = { prompt: true, ask: (hitl.questions || []).length > 0, review: (hitl.drafts || []).length > 0 };
    stepDots.querySelectorAll('button').forEach(btn => {
        const s = btn.dataset.step;
        btn.classList.toggle('on', s === hitl.stage);
        btn.classList.toggle('done', reached[s] && s !== hitl.stage);
        btn.disabled = !reached[s] || s === hitl.stage;
    });
}

function renderFooter() {
    if (!leftFoot) return;
    if (autoDecide) autoDecide.setAttribute('aria-checked', hitl.auto ? 'true' : 'false');
    leftFoot.classList.toggle('auto-on', hitl.auto);

    if (autoNote) {
        const qs = visibleQuestions();
        const answered = qs.filter(q => hitl.answers[q.id]).length;
        autoNote.textContent = hitl.auto && qs.length && answered < qs.length
            ? `Đã có ${answered}/${qs.length} câu — AI quyết định phần còn lại rồi render thẳng.`
            : 'AI tự trả lời 3 câu, tự chọn phương án và render thẳng ra video.';
    }

    if (!btnText || hitl.loading) return;
    let label = 'Tiếp tục';
    if (hitl.auto) label = 'Tạo video ngay';
    else if (hitl.stage === 'review') label = 'Xem 3 phương án';
    else if (hitl.stage === 'ask') {
        label = hitl.askIndex >= visibleQuestions().length ? 'Xem 3 phương án' : 'Tiếp tục';
    }
    btnText.textContent = label;
}

function renderAsk() {
    if (!askBody) return;
    const qs = visibleQuestions();
    const total = qs.length;
    const done = Math.min(hitl.askIndex, total);

    if (askCounter) askCounter.textContent = total && done < total ? `Câu ${done + 1}/${total}` : 'Đã đủ hướng';
    if (askBarFill) askBarFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';

    renderAutoStrip(qs);

    askBody.innerHTML = '';
    if (hitl.error) {
        const err = document.createElement('p');
        err.className = 'ask-error';
        err.textContent = hitl.error;
        askBody.appendChild(err);
    }

    const question = qs[hitl.askIndex];
    if (!question) {
        askBody.appendChild(buildAskSummary());
        return;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const head = document.createElement('p');
    head.className = 'ask-q';
    head.textContent = question.label;
    const sub = document.createElement('p');
    sub.className = 'ask-sub';
    sub.textContent = 'Chọn một — AI dùng để viết cả 3 phương án.';
    wrap.append(head, sub);

    const list = document.createElement('div');
    list.className = 'ask-opts';
    const current = hitl.answers[question.id] ?? question.selected;
    (question.options || []).forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ask-opt' + (option.id === current ? ' on' : '');
        btn.innerHTML = `<span class="rd"></span><span><b>${esc(option.label)}</b><small>${esc(option.hint || '')}</small></span>`;
        btn.addEventListener('click', () => chooseAnswer(question, option.id));
        list.appendChild(btn);
    });
    wrap.appendChild(list);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ask-back';
    back.textContent = '← Quay lại';
    back.addEventListener('click', () => {
        if (hitl.askIndex > 0) {
            hitl.askIndex -= 1;
            renderAsk();
            renderFooter();
            persistHitl();
        } else {
            setStage('prompt');
        }
    });
    wrap.appendChild(back);
    askBody.appendChild(wrap);
}

/** Chọn xong thì tự sang câu kế tiếp sau một nhịp ngắn để kịp thấy dấu chọn. */
function chooseAnswer(question, optionId) {
    hitl.answers[question.id] = optionId;
    hitl.open.add(question.id);
    hitl.error = '';
    persistHitl();
    renderAsk();
    renderFooter();

    setTimeout(() => {
        if (hitl.answers[question.id] !== optionId) return;
        if (hitl.askIndex < visibleQuestions().length) {
            hitl.askIndex += 1;
            renderAsk();
            renderFooter();
            persistHitl();
        }
    }, 240);
}

/** Những câu AI đã tự quyết: gom thành dải mảnh, vẫn sửa được. */
function renderAutoStrip(visible) {
    if (!askAutoStrip) return;
    const auto = (hitl.questions || []).filter(q => !visible.includes(q));
    if (!auto.length) {
        askAutoStrip.hidden = true;
        askAutoStrip.innerHTML = '';
        return;
    }
    askAutoStrip.hidden = false;
    askAutoStrip.innerHTML = '';
    auto.forEach(question => {
        const row = document.createElement('div');
        row.className = 'aa';
        row.innerHTML = `<span class="tick">✓</span><span>${esc(question.label)} <b>${esc(answerLabel(question))}</b></span>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Đổi';
        btn.addEventListener('click', () => {
            hitl.open.add(question.id);
            const idx = visibleQuestions().indexOf(question);
            hitl.askIndex = idx >= 0 ? idx : 0;
            renderAsk();
            renderFooter();
            persistHitl();
        });
        row.appendChild(btn);
        askAutoStrip.appendChild(row);
    });
}

function buildAskSummary() {
    const box = document.createElement('div');
    box.className = 'ask-done';

    const title = document.createElement('div');
    title.className = 'ask-done-title';
    title.textContent = 'Đã đủ hướng làm';
    box.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'ask-chips';
    (hitl.questions || []).forEach(question => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ask-chip';
        chip.innerHTML = `<span>${esc(String(question.label || '').replace(/\?$/, ''))}</span><b>${esc(answerLabel(question))}</b>`;
        chip.addEventListener('click', () => {
            hitl.open.add(question.id);
            const idx = visibleQuestions().indexOf(question);
            hitl.askIndex = idx >= 0 ? idx : 0;
            renderAsk();
            renderFooter();
            persistHitl();
        });
        chips.appendChild(chip);
    });
    box.appendChild(chips);

    const hint = document.createElement('p');
    hint.className = 'ask-sub';
    hint.textContent = 'AI sẽ viết 3 phương án khác nhau hoàn toàn từ hướng này — bạn chọn một trước khi render.';
    box.appendChild(hint);
    return box;
}

let hitlPersistTimer = null;
function persistHitlDebounced() {
    if (hitlPersistTimer) clearTimeout(hitlPersistTimer);
    hitlPersistTimer = setTimeout(persistHitl, 400);
}

/**
 * Lưu bước duyệt vào localStorage.
 *
 * Kịch bản nháp có thể vài trăm KB (HTML từng cảnh), nên nếu vượt quota thì bỏ
 * phần `script` và giữ phần điều hướng — mất kịch bản còn hơn mất câu trả lời.
 */
function persistHitl() {
    const payload = {
        stage: hitl.stage,
        prompt: hitl.prompt,
        answers: hitl.answers,
        confidence: hitl.confidence,
        questions: hitl.questions,
        open: [...hitl.open],
        askIndex: hitl.askIndex,
        auto: hitl.auto,
        drafts: hitl.drafts,
        selectedKey: hitl.selectedKey,
        recommended: hitl.recommended,
        rotation: hitl.rotation,
        savedAt: Date.now(),
    };
    try {
        localStorage.setItem(HITL_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        try {
            const slim = {
                ...payload,
                drafts: hitl.drafts.map(d => ({
                    key: d.key, label: d.label, hook: d.hook, style: d.style,
                    blueprintId: d.blueprintId, score: d.score, reason: d.reason,
                    estimated: d.estimated,
                })),
            };
            localStorage.setItem(HITL_STORAGE_KEY, JSON.stringify(slim));
        } catch (e2) {
            console.warn('Không lưu được trạng thái duyệt kịch bản', e2);
        }
    }
}

function restoreHitl() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(HITL_STORAGE_KEY) || 'null'); } catch (e) { }
    if (!data || !data.prompt) return false;

    // Prompt khác (ví dụ vừa nhận prompt mới từ trang chủ) thì bỏ trạng thái cũ.
    const onScreen = currentPrompt();
    if (onScreen && onScreen !== data.prompt) return false;

    if (!onScreen && promptInput) {
        promptInput.value = data.prompt;
        if (promptCharCount) promptCharCount.textContent = `${data.prompt.length}/500 · tối thiểu 10`;
    }

    hitl.prompt = data.prompt;
    hitl.answers = data.answers || {};
    hitl.confidence = data.confidence || {};
    hitl.questions = Array.isArray(data.questions) ? data.questions : [];
    hitl.open = new Set(Array.isArray(data.open) ? data.open : []);
    hitl.askIndex = Number(data.askIndex) || 0;
    hitl.auto = !!data.auto;
    hitl.recommended = data.recommended || null;
    hitl.rotation = Number(data.rotation) || 0;

    const draftsUsable = Array.isArray(data.drafts)
        && data.drafts.length > 0
        && data.drafts.every(d => d && d.script && Array.isArray(d.script.scenes));

    if ((data.stage === 'drafts' || data.stage === 'review') && draftsUsable) {
        hitl.drafts = data.drafts;
        hitl.selectedKey = data.selectedKey || data.drafts[0].key;
        activeStyle = selectedDraft()?.style || activeStyle;
        setStage('review');
        openBoard(false);
        log('Đã khôi phục bộ phương án đang duyệt.', 'info');
        return true;
    }

    if (hitl.questions.length) {
        setStage('ask');
        renderAsk();
        log('Đã khôi phục câu trả lời đang làm dở.', 'info');
        return true;
    }

    setStage('prompt');
    return false;
}

/** Prompt đổi thì mọi thứ đã sinh cho prompt cũ không còn giá trị. */
function syncHitlWithPrompt() {
    const prompt = currentPrompt();
    if (prompt === hitl.prompt) return false;
    hitl.prompt = prompt;
    hitl.questions = [];
    hitl.answers = {};
    hitl.confidence = {};
    hitl.open.clear();
    hitl.askIndex = 0;
    hitl.drafts = [];
    hitl.selectedKey = null;
    hitl.recommended = null;
    hitl.rotation = 0;
    hitl.error = '';
    if (askBody) askBody.innerHTML = '';
    if (askAutoStrip) {
        askAutoStrip.hidden = true;
        askAutoStrip.innerHTML = '';
    }
    closeBoard();
    setStage('prompt');
    persistHitl();
    return true;
}

/* ---------- Bước 2: hỏi ---------- */
async function requestClarify() {
    const prompt = currentPrompt();
    if (prompt.length < 10) {
        alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
        if (promptInput) promptInput.focus();
        return;
    }

    setBusy(true, 'Đang đọc yêu cầu…');
    hitl.error = '';
    try {
        const res = await fetch(`${API_BASE}/api/script/clarify`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Không phân loại được yêu cầu');

        hitl.prompt = prompt;
        hitl.questions = Array.isArray(data.questions) ? data.questions : [];
        hitl.answers = {};
        hitl.confidence = {};
        hitl.open.clear();
        hitl.askIndex = 0;
        hitl.drafts = [];
        hitl.selectedKey = null;
        hitl.recommended = null;
        hitl.rotation = 0;
        hitl.questions.forEach(question => {
            hitl.answers[question.id] = question.selected;
            hitl.confidence[question.id] = question.confidence;
        });

        setStage('ask');
        renderAsk();
        persistHitl();
        log(data.source === 'llm'
            ? 'AI đã điền sẵn hướng làm — trả lời từng câu rồi bấm "Xem 3 phương án".'
            : 'Không gọi được AI phân loại — mời bạn chọn hướng làm.',
            data.source === 'llm' ? 'info' : 'error');
    } catch (err) {
        hitl.error = `Không phân tích được prompt: ${err.message}`;
        renderAsk();
        log(`Lỗi: ${err.message}`, 'error');
    } finally {
        setBusy(false);
    }
}

/* ---------- Bước 3: duyệt 3 phương án ---------- */
function selectedDraft() {
    return hitl.drafts.find(d => d.key === hitl.selectedKey) || hitl.drafts[0] || null;
}

function firstNarration(draft) {
    const scenes = (draft.script && draft.script.scenes) || [];
    const text = scenes.map(s => s.voiceOverText).filter(Boolean)[0] || draft.hook || '';
    return text.length > 150 ? `${text.slice(0, 147)}…` : text;
}

/**
 * Khung xem trước 16:9 dựng bằng CSS từ palette + font của phương án.
 *
 * Không render HTML thật của cảnh (việc đó cần GSAP + assembler); mục đích ở đây
 * là để ba phương án *trông* khác nhau ngay từ cái liếc đầu tiên.
 */
function miniFrame(draft) {
    const s = draft.script || {};
    const p = s.colorPalette || {};
    const bg = p.background || '#0F1115';
    const fg = p.text || '#F8FAFC';
    const accent = p.accent || '#84CC16';
    const primary = p.primary || accent;
    const font = String(s.fontFamily || 'Inter').replace(/["'<>]/g, '');
    const label = esc(String(draft.label || '').toUpperCase());
    const base = `position:absolute;inset:0;background:${bg};color:${fg};font-family:'${font}',sans-serif;overflow:hidden`;
    let art = '';

    if (draft.key === 'data') {
        art = `<div style="position:absolute;left:11%;top:13%;font-size:7.5px;letter-spacing:.22em;text-transform:uppercase;opacity:.5">${label}</div>
            <div style="position:absolute;right:9%;top:10%;font-size:30px;font-weight:800;letter-spacing:-.04em;color:${accent};line-height:1">68<span style="font-size:14px">%</span></div>
            <div style="position:absolute;left:11%;bottom:15%;display:flex;align-items:flex-end;gap:7%;width:46%;height:44%">
                <i style="flex:1;height:34%;background:${primary};border-radius:2px 2px 0 0"></i>
                <i style="flex:1;height:62%;background:${accent};border-radius:2px 2px 0 0"></i>
                <i style="flex:1;height:96%;background:${primary};border-radius:2px 2px 0 0"></i>
            </div>
            <div style="position:absolute;right:9%;bottom:21%;width:26%;height:1px;background:${fg};opacity:.28"></div>
            <div style="position:absolute;right:9%;bottom:16%;width:18%;height:1px;background:${fg};opacity:.2"></div>`;
    } else if (draft.key === 'comic') {
        art = `<div style="position:absolute;left:12%;top:17%;width:26px;height:26px;border:2px solid ${accent};border-radius:50%"></div>
            <div style="position:absolute;left:25%;top:35%;width:17px;height:17px;border:2px solid ${primary};border-radius:50%"></div>
            <div style="position:absolute;right:11%;top:18%;width:44%;padding:7px 9px;background:${fg};color:${bg};border-radius:8px;font-size:7.5px;font-weight:800;line-height:1.3">BÓNG MA<br>KHÔNG CÓ<br>KHỐI LƯỢNG</div>
            <div style="position:absolute;right:24%;top:60%;width:0;height:0;border-left:7px solid ${fg};border-top:7px solid transparent;transform:rotate(16deg)"></div>`;
    } else if (draft.key === 'swiss') {
        art = `<div style="position:absolute;left:12%;top:7%;font-size:42px;font-weight:800;letter-spacing:-.05em;line-height:.95;color:${fg}">Aa</div>
            <div style="position:absolute;left:12%;bottom:25%;width:50%;height:1.5px;background:${accent}"></div>
            <div style="position:absolute;left:12%;bottom:15%;font-size:6.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">${label}</div>
            <div style="position:absolute;right:12%;top:15%;width:1px;height:58%;background:${fg};opacity:.18"></div>`;
    } else {
        art = `<div style="position:absolute;left:12%;top:15%;font-size:7px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">${label}</div>
            <div style="position:absolute;left:12%;top:31%;width:62%;height:3px;background:${fg};opacity:.85"></div>
            <div style="position:absolute;left:12%;top:40%;width:54%;height:2px;background:${fg};opacity:.5"></div>
            <div style="position:absolute;left:12%;top:48%;width:60%;height:2px;background:${fg};opacity:.32"></div>
            <div style="position:absolute;left:12%;bottom:20%;width:5px;height:5px;border-radius:50%;background:${accent}"></div>
            <div style="position:absolute;left:19%;bottom:21.5%;width:34%;height:1px;background:${fg};opacity:.3"></div>`;
    }
    return `<div class="mini" style="${base}">${art}</div>`;
}

function openBoard(loading) {
    if (!reviewBoard) return;
    reviewBoard.hidden = false;
    document.body.classList.add('board-open');
    if (rbAnswersText) rbAnswersText.textContent = answerSummary();
    if (loading) {
        if (rbCards) rbCards.innerHTML = '<div class="rb-skel"></div>'.repeat(3);
        if (rbEditor) rbEditor.innerHTML = '';
        if (rbApprove) rbApprove.disabled = true;
        if (rbShuffle) rbShuffle.disabled = true;
        if (rbAuto) rbAuto.disabled = true;
        if (rbFootHint) rbFootHint.textContent = 'Đang viết 3 phương án khác nhau…';
        return;
    }
    renderBoard();
}

function closeBoard() {
    if (!reviewBoard) return;
    reviewBoard.hidden = true;
    document.body.classList.remove('board-open');
}

function buildCard(draft) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rb-card' + (draft.key === hitl.selectedKey ? ' on' : '');

    const est = draft.estimated || {};
    const dur = Number(est.totalDurationSec) || 0;
    const target = targetDuration();
    // Lệch ±25% vẫn coi là khớp; lệch nhiều hơn thì cảnh báo để người dùng cân nhắc.
    const off = dur ? Math.abs(dur / target - 1) : 1;
    const fit = Math.max(0, Math.min(1, 1 - off));
    const fitClass = off <= 0.25 ? '' : off <= 0.5 ? ' warn' : ' bad';

    const name = document.createElement('div');
    name.className = 'rb-name';
    name.innerHTML = `${esc(draft.label || draft.key)}${draft.key === hitl.recommended ? '<span class="rb-badge">gợi ý</span>' : ''}`;

    const body = document.createElement('div');
    body.className = 'rb-card-body';
    body.appendChild(name);

    const hook = document.createElement('div');
    hook.className = 'rb-hook';
    hook.textContent = draft.hook || '';
    body.appendChild(hook);

    const metrics = document.createElement('div');
    metrics.className = 'rb-metrics';
    metrics.innerHTML = `<span>${dur ? dur.toFixed(1) : '?'}s/${target}s</span>`
        + `<span class="rb-fit${fitClass}"><i style="width:${Math.round(fit * 100)}%"></i></span>`
        + `<span>${est.words || '?'} từ</span>`;
    body.appendChild(metrics);

    const quote = document.createElement('p');
    quote.className = 'rb-quote';
    quote.textContent = firstNarration(draft);
    body.appendChild(quote);

    const thumb = document.createElement('div');
    thumb.className = 'rb-thumb';
    thumb.innerHTML = miniFrame(draft);

    card.append(thumb, body);
    card.addEventListener('click', () => selectDraft(draft.key));
    return card;
}

function selectDraft(key) {
    hitl.selectedKey = key;
    const draft = selectedDraft();
    if (draft) activeStyle = draft.style || activeStyle;
    renderBoard();
    persistHitl();
}

function renderBoard() {
    if (!rbCards) return;
    if (rbShuffle) rbShuffle.disabled = false;
    if (rbAuto) rbAuto.disabled = !hitl.drafts.length;

    rbCards.innerHTML = '';
    hitl.drafts.forEach(draft => rbCards.appendChild(buildCard(draft)));

    const draft = selectedDraft();
    if (rbApprove) rbApprove.disabled = !draft;
    if (rbFootHint) {
        rbFootHint.textContent = draft
            ? `Đang chọn: ${draft.label || draft.key} · ${draft.estimated ? Number(draft.estimated.totalDurationSec).toFixed(1) : '?'}s`
            : 'Chọn một phương án để duyệt';
    }
    renderBoardEditor();
}

function autoGrow(el) {
    if (!el || !el.offsetParent) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

/**
 * Sửa lời thoại ngay trên phương án đã chọn.
 *
 * Chỉ cho sửa `voiceOverText`: tiêu đề và HTML đã được dựng theo style của
 * phương án; sửa tay phần đó sẽ phá layout mà không ai kiểm được.
 */
function renderBoardEditor() {
    if (!rbEditor) return;
    const draft = selectedDraft();
    const scenes = (draft && draft.script && draft.script.scenes) || [];
    rbEditor.innerHTML = '';
    if (!scenes.length) return;

    const head = document.createElement('div');
    head.className = 'rb-editor-head';
    const totalWords = () => scenes.reduce((n, s) => n + countWords(s.voiceOverText), 0);
    const totalSpan = document.createElement('span');
    const renderTotal = () => {
        const est = draft.estimated ? ` · ${Number(draft.estimated.totalDurationSec).toFixed(1)}s` : '';
        totalSpan.textContent = `${totalWords()} từ${est}`;
    };
    renderTotal();
    head.append(document.createTextNode('Sửa lời thoại'), totalSpan);
    rbEditor.appendChild(head);

    scenes.forEach((scene, index) => {
        const row = document.createElement('div');
        row.className = 'rb-scene';

        const sceneHead = document.createElement('div');
        sceneHead.className = 'rb-scene-head';
        sceneHead.innerHTML = `<b>S${index + 1} · ${esc(scene.title || 'Cảnh')}</b><span>${countWords(scene.voiceOverText)} từ</span>`;
        const counter = sceneHead.querySelector('span');

        const textarea = document.createElement('textarea');
        textarea.value = scene.voiceOverText || '';
        textarea.rows = 2;
        textarea.addEventListener('input', () => {
            scene.voiceOverText = textarea.value;
            autoGrow(textarea);
            counter.textContent = `${countWords(textarea.value)} từ`;
            renderTotal();
            persistHitlDebounced();
        });

        row.append(sceneHead, textarea);
        rbEditor.appendChild(row);
        requestAnimationFrame(() => autoGrow(textarea));
    });
}

async function requestDrafts(nextRotation) {
    const prompt = currentPrompt();
    if (prompt.length < 10) {
        alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
        if (promptInput) promptInput.focus();
        return;
    }
    if (typeof nextRotation === 'number') hitl.rotation = nextRotation;

    hitl.error = '';
    openBoard(true);
    setBusy(true, 'Đang viết 3 phương án…');
    setStatus('Đang tạo kịch bản', true);
    setProgress(10);
    if (projName) setProjectName(prompt.slice(0, 40));
    project.topic = prompt.slice(0, 60);
    log(`Đang sinh 3 phương án cho: "${prompt}"`, 'info');

    try {
        const payload = {
            ...buildBasePayload(prompt),
            variantCount: 3,
            variantRotation: hitl.rotation,
            answers: hitl.answers,
        };
        const res = await fetch(`${API_BASE}/api/script/draft`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || data.details || 'Không tạo được phương án');

        hitl.prompt = prompt;
        hitl.drafts = Array.isArray(data.drafts) ? data.drafts : [];
        hitl.recommended = data.recommended || hitl.drafts[0]?.key || null;
        hitl.selectedKey = hitl.recommended;
        hitl.answers = data.answers || hitl.answers;
        activeStyle = selectedDraft()?.style || activeStyle;

        setStage('review');
        renderBoard();
        persistHitl();
        setProgress(100);
        log(`Đã có ${hitl.drafts.length} phương án. Chọn một, sửa lời thoại nếu cần rồi bấm "Duyệt & Render".`, 'success');
    } catch (err) {
        hitl.error = `Không tạo được phương án: ${err.message}`;
        closeBoard();
        renderAsk();
        log(`Lỗi: ${err.message}`, 'error');
        setProgress(0);
    } finally {
        setStatus('Sẵn sàng', false);
        setBusy(false);
    }
}

async function startAutoDirect() {
    const prompt = currentPrompt();
    if (prompt.length < 10) {
        alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
        if (promptInput) promptInput.focus();
        return;
    }

    const samePrompt = prompt === hitl.prompt;
    const payload = {
        ...buildBasePayload(prompt),
        async: true,
        mode: 'auto',
    };
    if (samePrompt && hitl.answers) payload.answers = hitl.answers;
    if (samePrompt) payload.variantRotation = hitl.rotation;

    log('Để AI quyết định: tự chọn hướng, tự viết 3 phương án, tự chọn rồi render.', 'info');
    await enqueueJob(payload, prompt);
}

/**
 * Đẩy một job render lên server rồi theo dõi tiến độ.
 *
 * Tách khỏi handler nút để cả đường "duyệt" và "để AI quyết định" dùng chung một
 * vòng poll — trước đây khối poll nằm lẫn trong handler nên không tái sử dụng được.
 */
async function enqueueJob(payload, prompt) {
    setBusy(true, 'Đang khởi tạo…');
    setStatus('Đang khởi tạo', true);
    setProgress(3);
    project.topic = (prompt || payload.prompt || '').slice(0, 60);
    try {
        const res = await fetch(`${API_BASE}/api/pipeline`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.details || err.error || 'Khởi tạo thất bại');
        }
        const data = await res.json();
        log(`Đã khởi tạo công việc: ${data.jobId}`, 'info');
        closeBoard();
        trackJob(data.jobId);
    } catch (err) {
        log(`Lỗi: ${err.message}`, 'error');
        setStatus('Sẵn sàng', false);
        setProgress(0);
    } finally {
        setBusy(false);
    }
}

function trackJob(jobId) {
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
                pollInterval = null;
                setProgress(100);
                setStatus('Sẵn sàng', false);
                log('Hoàn tất render video!', 'success');
                const full = await fetchJobDetail(jobId);
                if (full) applyProject(full, project.topic);
                displayVideo(jobId);
                setBusy(false);
            } else if (job.status === 'failed') {
                clearInterval(pollInterval);
                pollInterval = null;
                setProgress(0);
                setStatus('Sẵn sàng', false);
                log(`Thất bại: ${job.error || 'Lỗi không xác định'}`, 'error');
                setBusy(false);
            }
        } catch (pollErr) { console.error(pollErr); }
    }, 1000);
}

async function approveAndRender() {
    const draft = selectedDraft();
    if (!draft || !draft.script) {
        log('Chưa chọn phương án nào để render.', 'error');
        return;
    }
    const prompt = hitl.prompt || currentPrompt();
    const payload = {
        ...buildBasePayload(prompt),
        // Phương án đã chọn quyết định style + blueprint — Inspector không còn
        // chỗ chọn hai thứ này nên không thể ghi đè.
        style: draft.style || activeStyle,
        blueprintId: draft.blueprintId,
        script: draft.script,
        async: true,
    };
    log(`Duyệt phương án "${draft.label}" — bắt đầu render.`, 'success');
    await enqueueJob(payload, prompt);
}

if (primaryBtn) {
    primaryBtn.addEventListener('click', async () => {
        const prompt = currentPrompt();
        if (prompt.length < 10) {
            alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
            if (promptInput) promptInput.focus();
            return;
        }
        if (pollInterval) {
            log('Đang render — chờ video xong rồi tạo tiếp nhé.', 'info');
            return;
        }
        syncHitlWithPrompt();

        // Escape hatch: JSON tự dựng thì render thẳng, bỏ qua HITL. Box có sẵn
        // kịch bản mẫu nên chỉ coi là "tự dựng" khi người dùng đã sửa hoặc thay nó.
        const rawScriptJson = customScriptJson ? customScriptJson.value.trim() : '';
        if (rawScriptJson && rawScriptJson !== SAMPLE_SCRIPT_JSON.trim()) {
            let script;
            try {
                script = JSON.parse(rawScriptJson);
            } catch (e) {
                log('JSON kịch bản tự dựng không hợp lệ.', 'error');
                return;
            }
            await enqueueJob({ ...buildBasePayload(prompt), script, async: true }, prompt);
            return;
        }

        if (hitl.auto) {
            await startAutoDirect();
            return;
        }

        if (hitl.stage === 'prompt') {
            await requestClarify();
            return;
        }
        if (hitl.stage === 'ask') {
            if (hitl.askIndex < visibleQuestions().length) {
                hitl.askIndex += 1;
                renderAsk();
                renderFooter();
                persistHitl();
            } else {
                await requestDrafts();
            }
            return;
        }
        openBoard(false);
    });
}

if (autoDecide) {
    autoDecide.addEventListener('click', () => {
        hitl.auto = !hitl.auto;
        renderFooter();
        persistHitl();
    });
}

if (stepDots) {
    stepDots.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = btn.dataset.step;
            if (step === 'review' && !hitl.drafts.length) return;
            if (step === 'ask' && !hitl.questions.length) return;
            if (step === 'review') openBoard(false);
            else closeBoard();
            setStage(step);
            if (step === 'ask') renderAsk();
        });
    });
}

if (btnClarifyRefresh) {
    btnClarifyRefresh.addEventListener('click', requestClarify);
}

if (rbBack) {
    rbBack.addEventListener('click', () => {
        closeBoard();
        setStage(hitl.questions.length ? 'ask' : 'prompt');
        if (hitl.stage === 'ask') renderAsk();
    });
}

if (rbEditAnswers) {
    rbEditAnswers.addEventListener('click', () => {
        closeBoard();
        setStage('ask');
        renderAsk();
    });
}

if (rbShuffle) {
    rbShuffle.addEventListener('click', () => requestDrafts(hitl.rotation + 1));
}

if (rbAuto) {
    rbAuto.addEventListener('click', async () => {
        const draft = hitl.drafts.find(d => d.key === hitl.recommended) || selectedDraft();
        if (!draft) return;
        hitl.selectedKey = draft.key;
        renderBoard();
        await approveAndRender();
    });
}

if (rbApprove) {
    rbApprove.addEventListener('click', approveAndRender);
}

if (promptInput) {
    let hitlPromptTimer = null;
    promptInput.addEventListener('input', () => {
        if (hitlPromptTimer) clearTimeout(hitlPromptTimer);
        hitlPromptTimer = setTimeout(syncHitlWithPrompt, 300);
    });
}

function startGenerate() {
    if (primaryBtn) primaryBtn.click();
}
// Nút "Xuất bản" trên topbar = tạo/render video (không còn tab xuất bản riêng).
if (topbarExportBtn) topbarExportBtn.addEventListener('click', startGenerate);
// Tên dự án trên topbar = bắt đầu dự án mới (trước đây chỉ là nhãn, bấm không có gì).
if (projName) projName.addEventListener('click', resetProject);

/* ================= INIT ================= */
(async function init() {
    handleAuthError();
    await checkAuthConfig();
    await checkCurrentUser();
    updateSummaryMeta();
    restorePendingPrompt();
    restoreHitl();
    renderTimeline();

    const jobs = await fetchJobs();
    // Server có thể trả theo thứ tự chèn (memory queue) — luôn lấy video mới nhất.
    const completedJob = (jobs || [])
        .filter(j => j && j.status === 'completed')
        .sort((a, b) => jobTime(b) - jobTime(a))[0];
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
    if (data.style) activeStyle = data.style;
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

// Issue #36: Live Preview Player modal
if (btnLivePreview && previewModal) {
    btnLivePreview.addEventListener('click', async () => {
        if (!currentPreviewJobId) return;
        previewModal.style.display = 'flex';
        try {
            if (!previewPlayer && window.PreviewPlayer) {
                previewPlayer = new window.PreviewPlayer('preview-player-container');
            }
            if (previewPlayer) {
                await previewPlayer.load(currentPreviewJobId);
            }
        } catch (err) {
            console.error('Preview load failed:', err);
            alert('Không tải được preview: ' + err.message);
        }
    });
}

if (previewModalClose && previewModal) {
    previewModalClose.addEventListener('click', () => {
        previewModal.style.display = 'none';
        if (previewPlayer) {
            previewPlayer.pause();
        }
    });

    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            previewModal.style.display = 'none';
            if (previewPlayer) {
                previewPlayer.pause();
            }
        }
    });
}
