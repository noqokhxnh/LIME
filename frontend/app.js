// Cấu hình base URL tự động nhận diện nếu mở trực tiếp hay qua server
const API_BASE = (window.location.origin && window.location.origin.includes(':3000'))
    ? ''
    : 'http://localhost:3000';

// Auth Elements
const loginOpenBtn = document.getElementById('login-open-btn');
const loginModal = document.getElementById('login-modal');
const loginCloseBtn = document.getElementById('login-close-btn');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginMessage = document.getElementById('login-message');
const logoutBtn = document.getElementById('logout-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegisterBtn = document.getElementById('show-register-btn');
const showLoginBtn = document.getElementById('show-login-btn');
const authTitle = document.getElementById('auth-title');
const registerSubmitBtn = document.getElementById('register-submit-btn');
const registerUsername = document.getElementById('register-username');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerMessage = document.getElementById('register-message');
const googleLoginBtn = document.getElementById('google-login-btn');

if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
        googleLoginBtn.disabled = true;
        const textSpan = googleLoginBtn.querySelector('span');
        if (textSpan) textSpan.textContent = 'Đang chuyển hướng...';
        window.location.href = `${API_BASE}/api/auth/google`;
    });
}

if (loginOpenBtn && loginModal) {
    loginOpenBtn.addEventListener('click', () => {
        if (isLoggedIn) window.location.href = '/workspace';
        else loginModal.classList.add('show');
    });
}
if (loginCloseBtn && loginModal) {
    loginCloseBtn.addEventListener('click', () => loginModal.classList.remove('show'));
}

if (loginSubmitBtn) {
    loginSubmitBtn.addEventListener('click', async () => {
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        if (!username || !password) {
            loginMessage.textContent = 'Vui lòng nhập đầy đủ thông tin';
            return;
        }
        try {
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
            window.location.href = '/workspace';
        } catch (err) {
            loginMessage.textContent = 'Không thể kết nối tới server';
        }
    });
}

if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', () => {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        showRegisterBtn.style.display = 'none';
        authTitle.textContent = 'Đăng ký';
    });
}

if (showLoginBtn) {
    showLoginBtn.addEventListener('click', () => {
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        showRegisterBtn.style.display = 'block';
        authTitle.textContent = 'Đăng nhập';
    });
}

if (registerSubmitBtn) {
    registerSubmitBtn.addEventListener('click', async () => {
        const username = registerUsername.value.trim();
        const email = registerEmail.value.trim();
        const password = registerPassword.value;
        if (!username || !email || !password) {
            registerMessage.textContent = 'Vui lòng nhập đầy đủ thông tin';
            return;
        }
        try {
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
            window.location.href = '/workspace';
        } catch (err) {
            registerMessage.textContent = 'Không thể kết nối tới server';
        }
    });
}

function handleAuthError() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'open') return;
    if (loginModal) loginModal.classList.add('show');
    const error = params.get('error');
    if (error && loginMessage) loginMessage.textContent = error;
    window.history.replaceState({}, '', window.location.pathname);
}

// --- Trang chủ: trạng thái đăng nhập & điều hướng ---
let isLoggedIn = false;

function openLogin() {
    if (loginModal) loginModal.classList.add('show');
}
function goStudio() {
    if (isLoggedIn) window.location.href = '/workspace';
    else openLogin();
}
function stashPrompt(data) {
    try { sessionStorage.setItem('lime-pending-prompt', JSON.stringify(data)); } catch (e) {}
}

document.getElementById('cta-create-btn')?.addEventListener('click', goStudio);
document.querySelectorAll('.plan-cta').forEach(b => b.addEventListener('click', goStudio));

// Promptbar trang chủ: lưu prompt rồi đi tiếp theo trạng thái đăng nhập
(function initHomePrompt() {
    const input = document.getElementById('home-prompt-input');
    const btn = document.getElementById('home-prompt-btn');
    if (!input || !btn) return;
    const go = () => {
        const v = input.value.trim();
        if (v) stashPrompt({ prompt: v });
        goStudio();
    };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
})();

// Nút "Dùng mẫu": lưu mẫu rồi đi tiếp
document.querySelectorAll('.btn-use-template').forEach(btn => {
    btn.addEventListener('click', () => {
        stashPrompt({
            prompt: btn.getAttribute('data-prompt') || '',
            style: btn.getAttribute('data-style') || '',
            ratio: btn.getAttribute('data-ratio') || ''
        });
        goStudio();
    });
});

async function checkCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
        isLoggedIn = res.ok;
        if (isLoggedIn && loginOpenBtn) {
            const user = await res.json();
            loginOpenBtn.textContent = user.username || 'Tài khoản';
        }
    } catch (err) { /* chưa đăng nhập */ }
}

async function checkAuthConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/auth/config`);
        if (res.ok) {
            const data = await res.json();
            if (googleLoginBtn) {
                googleLoginBtn.style.display = data.googleAuthEnabled ? 'flex' : 'none';
            }
        }
    } catch (e) { }
}

(function initHome() {
    handleAuthError();
    checkAuthConfig();
    checkCurrentUser();

    // Dots + nav active theo section
    const dots = document.querySelectorAll('.dots a');
    const navLinks = document.querySelectorAll('.nav-links a[data-nav]');
    const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                const id = e.target.id;
                dots.forEach(d => d.classList.toggle('on', d.getAttribute('href') === '#' + id));
                navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('data-nav') === id));
            }
        });
    }, { threshold: 0.55 });
    ['home', 'templates', 'pricing'].forEach(id => {
        const el = document.getElementById(id);
        if (el) io.observe(el);
    });

    // Billing toggle tháng/năm
    const spans = document.querySelectorAll('.bill-toggle span[data-period]');
    const priceVal = document.querySelector('.price-val');
    spans.forEach(s => s.addEventListener('click', () => {
        spans.forEach(x => x.classList.remove('on'));
        s.classList.add('on');
        if (priceVal) {
            const yearly = s.getAttribute('data-period') === 'year';
            priceVal.textContent = yearly ? priceVal.getAttribute('data-yearly') : priceVal.getAttribute('data-monthly');
        }
    }));

    // Filter pills trang trí
    document.querySelectorAll('.tpl-head .pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.tpl-head .pill').forEach(x => x.classList.remove('on'));
            p.classList.add('on');
        });
    });
})();
