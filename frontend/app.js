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
        if (isLoggedIn) window.location.href = '/workspace';
        else {
            if (loginMessage) loginMessage.textContent = '';
            if (registerMessage) registerMessage.textContent = '';
            loginModal.classList.add('show');
        }
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
        window.location.href = '/workspace';
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
        if (authTitle) authTitle.textContent = 'Quên mật khẩu';
        if (authSubtitle) authSubtitle.textContent = 'Vui lòng nhập mật khẩu bạn quên và xác nhận';
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
        if (forgotMessage) forgotMessage.textContent = 'Vui lòng nhập mật khẩu bạn quên / mật khẩu mới';
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
            forgotSubmitBtn.textContent = 'Đang xác nhận...';
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
            forgotMessage.textContent = data.message || 'Đổi mật khẩu thành công! Đang chuyển về đăng nhập...';
            forgotMessage.className = 'auth-status-msg success';
        }

        if (loginUsername && data.username) {
            loginUsername.value = data.username;
        }

        setTimeout(() => {
            if (showLoginBtn) showLoginBtn.click();
            if (loginMessage) {
                loginMessage.textContent = 'Đổi mật khẩu thành công! Vui lòng đăng nhập với mật khẩu mới.';
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
            forgotSubmitBtn.textContent = 'Xác nhận đổi mật khẩu';
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
        window.location.href = '/workspace';
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
            isGoogleAuthEnabled = Boolean(data.googleAuthEnabled);
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
