// Cấu hình base URL tự động nhận diện nếu mở trực tiếp hay qua server
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? ((window.location.origin && window.location.origin.includes(':3000')) ? '' : 'http://localhost:3000')
    : '';

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
document.querySelectorAll('.plan-cta').forEach(b => {
    b.addEventListener('click', (e) => {
        const plan = b.getAttribute('data-plan');
        if (plan === 'pro' || plan === 'creator' || b.closest('.plan.hot')) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.openVietQRModal === 'function') {
                window.openVietQRModal({ plan: 'pro' });
            }
            return;
        }
        if (plan === 'max') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof window.openVietQRModal === 'function') {
                window.openVietQRModal({ plan: 'max' });
            }
            return;
        }
        if (plan === 'team') {
            window.open('mailto:contact@lime.vn?subject=Tu%20van%20goi%20Enterprise%20LIME', '_blank');
            return;
        }
        goStudio();
    });
});

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
            const data = await res.json();
            const user = data.user || data;
            loginOpenBtn.textContent = user.username || 'Hồ sơ';

            const profLink = document.getElementById('nav-profile-link');
            const setLink = document.getElementById('nav-setting-link');
            const adminLink = document.getElementById('nav-admin-link');
            if (profLink) profLink.style.display = 'inline-block';
            if (setLink) setLink.style.display = 'inline-block';
            if (adminLink && user.role === 'admin') adminLink.style.display = 'inline-block';
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
    const priceVals = document.querySelectorAll('.price-val');
    spans.forEach(s => s.addEventListener('click', () => {
        spans.forEach(x => x.classList.remove('on'));
        s.classList.add('on');
        const yearly = s.getAttribute('data-period') === 'year';
        priceVals.forEach(pv => {
            const val = yearly ? pv.getAttribute('data-yearly') : pv.getAttribute('data-monthly');
            if (val) pv.textContent = val;
        });
    }));

    // Filter pills trang trí
    document.querySelectorAll('.tpl-head .pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.tpl-head .pill').forEach(x => x.classList.remove('on'));
            p.classList.add('on');
        });
    });

    // Smart Navbar (trượt lên khi lướt xuống, trượt xuống khi lướt lên)
    initSmartNavbar();

    // FlipWords Hero Animation
    initFlipWords();
})();

// =========================================================
// SMART NAVBAR (Ẩn khi lướt xuống, hiện khi lướt lên)
// =========================================================
function initSmartNavbar() {
    const nav = document.querySelector('.lime-nav');
    if (!nav) return;

    let lastScrollY = window.pageYOffset || document.documentElement.scrollTop;
    let ticking = false;
    let isClickScrolling = false;
    let clickTimeout = null;
    const threshold = 6; // Ngưỡng cuộn tối thiểu tránh rung giật

    function updateNav() {
        const currentScrollY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
        const diff = currentScrollY - lastScrollY;

        // Nếu vừa click vào link điều hướng (Trang chủ, Mẫu thiết kế, Bảng giá)
        if (isClickScrolling) {
            lastScrollY = currentScrollY;
            ticking = false;
            return;
        }

        // Khi ở sát đỉnh trang (section 1), thanh nav luôn hiển thị cố định
        if (currentScrollY <= 24) {
            nav.classList.remove('nav-hidden');
            nav.classList.remove('nav-scrolled');
        } else {
            nav.classList.add('nav-scrolled');

            if (Math.abs(diff) >= threshold) {
                if (diff > 0 && currentScrollY > 76) {
                    // Lướt xuống (scroll down): trượt lên và ẩn đi
                    nav.classList.add('nav-hidden');
                } else if (diff < 0) {
                    // Lướt lên (scroll up): trượt xuống hiển thị lại
                    nav.classList.remove('nav-hidden');
                }
            }
        }

        lastScrollY = currentScrollY;
        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(updateNav);
            ticking = true;
        }
    }, { passive: true });

    // Khi người dùng bấm vào các liên kết điều hướng trên thanh nav hoặc dot
    document.querySelectorAll('.nav-links a, .dots a, .brand').forEach(link => {
        link.addEventListener('click', () => {
            nav.classList.remove('nav-hidden');
            isClickScrolling = true;
            if (clickTimeout) clearTimeout(clickTimeout);
            clickTimeout = setTimeout(() => {
                isClickScrolling = false;
                lastScrollY = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
            }, 850);
        });
    });
}

// =========================================================
// HERO FLIP WORDS (Aceternity UI style)
// =========================================================
function initFlipWords() {
    const container = document.getElementById('flip-words');
    if (!container) return;

    const words = [
        'chuyển động',
        'thước phim',
        'hình ảnh',
        'câu chuyện',
        'thực tế',
        'khung hình',
        'độc quyền'
    ];

    let currentIndex = 0;
    const duration = 2800;

    function createWordElement(text, isIncoming = true) {
        const box = document.createElement('span');
        box.className = 'flip-word-box' + (isIncoming ? ' incoming' : '');

        const parts = text.split(' ');
        parts.forEach((word, wIdx) => {
            const wordSpan = document.createElement('span');
            wordSpan.style.whiteSpace = 'nowrap';
            wordSpan.style.display = 'inline-block';

            for (let i = 0; i < word.length; i++) {
                const letter = document.createElement('span');
                letter.className = 'flip-letter';
                letter.textContent = word[i];
                const delay = (wIdx * 0.1 + i * 0.035).toFixed(3);
                letter.style.setProperty('--letter-delay', `${delay}s`);
                wordSpan.appendChild(letter);
            }
            box.appendChild(wordSpan);

            if (wIdx < parts.length - 1) {
                const space = document.createElement('span');
                space.className = 'flip-space';
                space.innerHTML = '&nbsp;';
                box.appendChild(space);
            }
        });

        return box;
    }

    container.innerHTML = '';
    const initialBox = createWordElement(words[0], false);
    container.appendChild(initialBox);

    function syncWidth() {
        const activeBox = container.querySelector('.flip-word-box:not(.outgoing)');
        if (activeBox) {
            const w = activeBox.offsetWidth;
            if (w > 0) container.style.width = `${w}px`;
        }
    }

    setTimeout(syncWidth, 60);

    function nextFlip() {
        const nextIndex = (currentIndex + 1) % words.length;
        const nextText = words[nextIndex];

        const oldBox = container.querySelector('.flip-word-box:not(.outgoing)');
        if (oldBox) {
            oldBox.classList.add('outgoing');
        }

        const newBox = createWordElement(nextText, true);
        container.appendChild(newBox);
        const targetWidth = newBox.offsetWidth;

        if (targetWidth > 0) {
            container.style.width = `${targetWidth}px`;
        }

        if (oldBox) {
            setTimeout(() => {
                if (oldBox && oldBox.parentElement === container) {
                    oldBox.remove();
                }
            }, 420);
        }

        currentIndex = nextIndex;
    }

    let timer = setInterval(nextFlip, duration);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(timer);
        } else {
            clearInterval(timer);
            timer = setInterval(nextFlip, duration);
        }
    });

    window.addEventListener('resize', syncWidth);
}


// =========================================================
// TEMPLATES PLAYER (Concept 4) — chuyển mẫu, phân cảnh, phát thử
// =========================================================
(function initTemplatePlayer() {
    const listEl = document.getElementById('tplp-list');
    if (!listEl) return;

    const TEMPLATES = [
        {
            cat: 'SaaS · Tech', ratio: '16:9', style: 'modern', durLabel: '25–40s', totalSec: 30,
            prompt: 'Giới thiệu nền tảng AI SaaS đột phá: tự động phân tích dữ liệu, giao diện trực quan, biểu đồ tăng trưởng 300% và nút kêu gọi dùng thử miễn phí.',
            active: 2,
            scenes: [
                { label: 'Mở đầu', art: 'win' },
                { label: 'Vấn đề', art: 'lines' },
                { label: 'Biểu đồ', art: 'num', text: '+300%' },
                { label: 'Tính năng', art: 'bars' },
                { label: 'CTA', art: 'cta', text: 'Dùng thử miễn phí' }
            ]
        },
        {
            cat: 'Lập trình', ratio: '16:9', style: 'modern', durLabel: '20–30s', totalSec: 25,
            prompt: 'Kể câu chuyện lập trình viên thức trắng đêm trước ngày ra mắt, gõ lệnh git trong terminal, dòng code chạy liên tục, khoảnh khắc build thành công và con số tăng vọt ăn mừng chiến thắng.',
            active: 1,
            scenes: [
                { label: 'Mở đầu', art: 'term', text: '02:14<br>đêm trước ra mắt' },
                { label: 'Gõ lệnh', art: 'term', text: '$ git commit<br>$ npm run build' },
                { label: 'Build thành công', art: 'check' },
                { label: 'Kết thúc · diff', art: 'diff' }
            ]
        },
        {
            cat: 'Người que', ratio: '9:16', style: 'stickman', durLabel: '30–45s', totalSec: 40,
            prompt: 'Video người que hoạt hình: một nhân vật que màu vàng tươi tò mò đặt câu hỏi, suy luận logic qua các biểu tượng vẽ tay đơn giản và thốt lên đầy hào hứng khi đã hiểu ra vấn đề.',
            active: 2,
            scenes: [
                { label: 'Xuất hiện', art: 'stick' },
                { label: 'Đặt câu hỏi', art: 'bubble', text: 'Sao lại vậy?' },
                { label: 'Giải thích', art: 'bubble', text: 'À, ra là vậy!' },
                { label: 'Ví dụ thực tế', art: 'stick' },
                { label: 'Chốt ý', art: 'lines' },
                { label: 'CTA', art: 'cta', text: 'Xem tiếp trên Shorts' }
            ]
        },
        {
            cat: 'Quảng cáo', ratio: '9:16', style: 'modern', durLabel: '15s', totalSec: 15,
            prompt: 'Quảng cáo dọc điện thoại giảm giá bùng nổ, chữ SALE khổng lồ chớp nháy bắt mắt trên nền chuyển màu rực rỡ, con số phần trăm giảm giá đập mạnh thị giác và nút mua ngay nổi bật ở cuối.',
            active: 0,
            scenes: [
                { label: 'Hook', art: 'sale', text: 'FLASH SALE' },
                { label: 'Sản phẩm', art: 'phone' },
                { label: 'CTA cuối video', art: 'cta', text: 'Mua ngay' }
            ]
        },
        {
            cat: 'Giáo dục', ratio: '16:9', style: 'minimal', durLabel: '60s', totalSec: 60,
            prompt: 'Tạo một bài giảng kiến thức chuẩn chỉnh về chủ đề khoa học tự nhiên, bố cục thông tin mạch lạc khoa học, có biểu đồ so sánh trực quan, các bước thực hiện đánh số thứ tự rõ ràng.',
            active: 0,
            scenes: [
                { label: 'Tiêu đề bài', art: 'slide' },
                { label: 'Khái niệm', art: 'lines' },
                { label: 'Nội dung chính', art: 'slide' },
                { label: 'Ví dụ minh hoạ', art: 'slide' },
                { label: 'Bài tập', art: 'lines' },
                { label: 'Thực hành', art: 'slide' },
                { label: 'Tóm tắt', art: 'slide' },
                { label: 'Kết thúc', art: 'cta', text: 'Hẹn gặp bài sau' }
            ]
        },
        {
            cat: 'SaaS · Tech', ratio: '16:9', style: 'modern', durLabel: '40s', totalSec: 40,
            prompt: 'Biến bộ slide thuyết trình gọi vốn khô khan thành một video pitch deck chuyển động mượt mà, biểu đồ cột doanh thu tăng trưởng theo quý, dòng tiền dự phóng và lời kêu gọi đầu tư đầy tự tin.',
            active: 2,
            scenes: [
                { label: 'Vấn đề', art: 'lines' },
                { label: 'Giải pháp', art: 'win' },
                { label: 'Số liệu', art: 'bars' },
                { label: 'Thị trường', art: 'num', text: '+180%' },
                { label: 'Kêu gọi vốn', art: 'cta', text: 'Kêu gọi Series A' }
            ]
        }
    ];

    const START_FRAC = 0.4;
    const arts = document.querySelectorAll('.tplp-art');
    const items = listEl.querySelectorAll('.tplp-item');
    const scenesEl = document.getElementById('tplp-scenes');
    const scenesMeta = document.getElementById('tplp-scenes-meta');
    const chipEl = document.getElementById('tplp-chip');
    const promptEl = document.getElementById('tplp-prompt-text');
    const ctaEl = document.getElementById('tplp-cta');
    const tcEl = document.getElementById('tplp-tc');
    const qEl = document.getElementById('tplp-q');
    const fillEl = document.getElementById('tplp-fill');
    const knobEl = document.getElementById('tplp-knob');
    const playBtn = document.getElementById('tplp-play');
    const icPlay = playBtn.querySelector('.tplp-ic-play');
    const icPause = playBtn.querySelector('.tplp-ic-pause');
    const nowEl = listEl.querySelector('.tplp-now');

    let cur = 0;
    let frac = START_FRAC;
    let playing = false;
    let rafId = null;
    let lastTs = null;

    function fmt(sec) {
        sec = Math.max(0, Math.round(sec));
        return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    }

    function artHTML(sc) {
        switch (sc.art) {
            case 'win': return '<div class="tplp-m-win"><i></i><i></i><i></i></div>';
            case 'lines': return '<div class="tplp-m-lines"><i></i><i></i><i></i></div>';
            case 'num': return '<div class="tplp-m-num">' + sc.text + '</div>';
            case 'bars': return '<div class="tplp-m-bars"><i></i><i></i><i></i><i></i><i></i></div>';
            case 'cta': return '<div class="tplp-m-cta"><span>' + sc.text + '</span></div>';
            case 'term': return '<div class="tplp-m-term">' + sc.text + '</div>';
            case 'check': return '<div class="tplp-m-check">✓</div>';
            case 'diff': return '<div class="tplp-m-diff"><span class="tplp-plus">+ 124 additions</span><span class="tplp-minus">− 12 deletions</span></div>';
            case 'stick': return '<div class="tplp-m-stick"></div>';
            case 'bubble': return '<div class="tplp-m-bubble"><span>' + sc.text + '</span></div>';
            case 'sale': return '<div class="tplp-m-sale">' + sc.text + '</div>';
            case 'phone': return '<div class="tplp-m-phone"></div>';
            case 'slide': return '<div class="tplp-m-slide"><i></i><i></i><i></i></div>';
            default: return '';
        }
    }

    function activeSceneIdx() {
        const n = TEMPLATES[cur].scenes.length;
        return Math.min(n - 1, Math.floor(frac * n));
    }

    function renderScenes() {
        const t = TEMPLATES[cur];
        scenesEl.style.setProperty('--tplp-cols', t.scenes.length);
        scenesEl.innerHTML = t.scenes.map((sc, i) =>
            '<button type="button" class="tplp-sc" data-sc="' + i + '">' +
            '<span class="tplp-sc-art">' + artHTML(sc) + '</span>' +
            '<span class="tplp-sc-lab"><span class="tplp-sc-no">SC ' + (i + 1) + '</span><span>' + sc.label + '</span></span>' +
            '</button>').join('');
        scenesEl.querySelectorAll('.tplp-sc').forEach(btn => {
            btn.addEventListener('click', () => {
                stopPlay();
                const i = Number(btn.getAttribute('data-sc'));
                frac = (i + 0.5) / TEMPLATES[cur].scenes.length;
                renderProgress();
            });
        });
    }

    function renderProgress() {
        const t = TEMPLATES[cur];
        const pct = (frac * 100).toFixed(1) + '%';
        fillEl.style.width = pct;
        knobEl.style.left = pct;
        tcEl.textContent = fmt(frac * t.totalSec) + ' / ' + fmt(t.totalSec);
        const ai = activeSceneIdx();
        scenesEl.querySelectorAll('.tplp-sc').forEach((el, i) => el.classList.toggle('is-on', i === ai));
    }

    function stopPlay() {
        playing = false;
        lastTs = null;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        icPlay.style.display = '';
        icPause.style.display = 'none';
    }

    function tick(ts) {
        if (!playing) return;
        if (lastTs == null) lastTs = ts;
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;
        frac += dt / 5; // phát thử: chạy hết mẫu trong ~5 giây
        if (frac >= 1) {
            frac = 1;
            renderProgress();
            setTimeout(() => { stopPlay(); frac = START_FRAC; renderProgress(); }, 550);
            return;
        }
        renderProgress();
        rafId = requestAnimationFrame(tick);
    }

    playBtn.addEventListener('click', () => {
        if (playing) { stopPlay(); return; }
        if (frac >= 1) frac = START_FRAC;
        playing = true;
        icPlay.style.display = 'none';
        icPause.style.display = '';
        rafId = requestAnimationFrame(tick);
    });

    function select(i, keepFrac) {
        stopPlay();
        cur = i;
        if (!keepFrac) frac = START_FRAC;
        const t = TEMPLATES[cur];
        arts.forEach(a => a.classList.toggle('is-on', Number(a.getAttribute('data-art')) === cur));
        items.forEach((it, j) => it.classList.toggle('is-on', j === cur));
        const onInfo = items[cur].querySelector('.tplp-info');
        if (nowEl && onInfo && nowEl.parentElement !== onInfo) onInfo.appendChild(nowEl);
        chipEl.textContent = t.cat;
        promptEl.textContent = '“' + t.prompt + '”';
        ctaEl.setAttribute('data-prompt', t.prompt);
        ctaEl.setAttribute('data-style', t.style);
        ctaEl.setAttribute('data-ratio', t.ratio);
        qEl.textContent = '1080p · ' + t.ratio + ' · Có giọng đọc AI';
        scenesMeta.textContent = t.scenes.length + ' phân cảnh · tổng ' + t.durLabel;
        renderScenes();
        renderProgress();
    }

    items.forEach((it, i) => it.addEventListener('click', () => select(i)));
    select(0);
})();
