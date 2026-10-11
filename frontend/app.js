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
    loginOpenBtn.addEventListener('click', () => loginModal.classList.add('show'));
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
            loginModal.classList.remove('show');
            loginOpenBtn.textContent = data.username;
            loginOpenBtn.disabled = true;
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            log(`Đăng nhập thành công: ${data.username}`, 'success');
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
            loginModal.classList.remove('show');
            loginOpenBtn.textContent = data.username;
            loginOpenBtn.disabled = true;
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            log(`Đăng ký thành công: ${data.username}`, 'success');
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

// Studio Core Form Elements
const promptInput = document.getElementById('prompt-input');
const promptCharCount = document.getElementById('prompt-char-count');
const styleSelect = document.getElementById('style-select');
const durationInput = document.getElementById('duration-input');
const blueprintSelect = document.getElementById('blueprint-select');
const catalogCategoryFilter = document.getElementById('catalog-category-filter');
const motionBlocksList = document.getElementById('motion-blocks-list');
const motionBlocksCount = document.getElementById('motion-blocks-count');
const ttsProviderSelect = document.getElementById('tts-provider-select');
const voiceSelect = document.getElementById('voice-select');
const generateBtn = document.getElementById('generate-btn');
const btnSpinner = document.getElementById('btn-spinner');
const btnText = document.getElementById('btn-text');
const logViewer = document.getElementById('log-viewer');
const progressFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');
const videoPlayer = document.getElementById('video-player');
const videoEmpty = document.getElementById('video-empty');
const btnDownload = document.getElementById('btn-download');
const btnPreviewHtml = document.getElementById('btn-preview-html');
const timelineDurationLabel = document.getElementById('timeline-duration-label');
const summaryMetaLine = document.getElementById('summary-meta-line');
const customStyleInput = document.getElementById('custom-style-input');
const customScriptJson = document.getElementById('custom-script-json');

let pollInterval = null;
let catalogBlocks = [];
let selectedMotionBlockIds = new Set();
let currentRatio = '16:9';
let voiceEnabled = true;

// Tab Navigation
const tabNavBtns = document.querySelectorAll('.tab-nav-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
tabNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        tabNavBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        tabPanels.forEach(p => p.classList.remove('active'));
        const activePanel = document.getElementById(`tab-panel-${tabId}`);
        if (activePanel) activePanel.classList.add('active');
    });
});

// Style Cards Selection
const styleCards = document.querySelectorAll('.style-choice-card');
styleCards.forEach(card => {
    card.addEventListener('click', () => {
        styleCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const st = card.getAttribute('data-style') || 'modern';
        if (styleSelect) {
            styleSelect.value = st;
            styleSelect.dispatchEvent(new Event('change'));
        }
        renderMotionBlocks();
        updateSummaryMeta();
    });
});

// Ratio Buttons Selection
const ratioBtns = document.querySelectorAll('.ratio-btn');
ratioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        ratioBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRatio = btn.getAttribute('data-ratio') || '16:9';
        updateSummaryMeta();
    });
});

// Duration Input Sync
if (durationInput) {
    durationInput.addEventListener('input', () => {
        let val = parseInt(durationInput.value, 10);
        if (Number.isFinite(val)) {
            val = Math.min(300, Math.max(10, val));
            if (timelineDurationLabel) {
                timelineDurationLabel.textContent = `00:${val < 10 ? '0' + val : val}`;
            }
        }
        updateSummaryMeta();
    });
}

// Prompt Counter
if (promptInput && promptCharCount) {
    promptInput.addEventListener('input', () => {
        const len = promptInput.value.length;
        promptCharCount.textContent = `${len}/500 · tối thiểu 10`;
        promptCharCount.classList.toggle('warn', len > 0 && len < 10);
    });
}

// Quick Prompt
function setPrompt(text) {
    if (!promptInput) return;
    promptInput.value = text;
    promptInput.focus();
    if (promptCharCount) {
        promptCharCount.textContent = `${text.length}/500 · tối thiểu 10`;
        promptCharCount.classList.remove('warn');
    }
}

// TTS Provider Sync
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

// TTS Engine Cards in Tab 3
const ttsEngineCards = document.querySelectorAll('.tts-engine-card');
ttsEngineCards.forEach(card => {
    card.addEventListener('click', () => {
        ttsEngineCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const eng = card.getAttribute('data-engine') || 'vieneu';
        if (ttsProviderSelect) {
            ttsProviderSelect.value = eng;
            ttsProviderSelect.dispatchEvent(new Event('change'));
        }
    });
});

// Voice Toggle Switch
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const voiceStatusText = document.getElementById('voice-status-text');
if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener('click', () => {
        voiceEnabled = !voiceEnabled;
        voiceToggleBtn.classList.toggle('active', voiceEnabled);
        if (voiceStatusText) {
            voiceStatusText.textContent = voiceEnabled ? 'Đang bật' : 'Đang tắt';
        }
    });
}

// Switches in Tab 4 (Queue, Skip Preview)
const switchRows = document.querySelectorAll('.switch-row');
switchRows.forEach(row => {
    const btn = row.querySelector('.clean-toggle-switch');
    if (btn) {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
    }
});

// Update Bottom Summary Line
function updateSummaryMeta() {
    if (!summaryMetaLine) return;
    const dur = durationInput ? durationInput.value : 15;
    const count = selectedMotionBlockIds.size;
    summaryMetaLine.textContent = `${currentRatio} · ${dur}s · ${count} hiệu ứng`;
}

function updateMotionCount() {
    const count = selectedMotionBlockIds.size;
    if (motionBlocksCount) motionBlocksCount.textContent = String(count);
    const dashes = document.querySelectorAll('#motion-dashes .dash-seg');
    dashes.forEach((dash, idx) => {
        dash.classList.toggle('filled', idx < count);
    });
    updateSummaryMeta();
}

function renderCategoryChips(categories) {
    const wrap = document.getElementById('category-chips-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    categories.forEach(cat => {
        const chip = document.createElement('button');
        chip.type = 'button';
        const isCurrent = (catalogCategoryFilter && catalogCategoryFilter.value === (cat === 'Tất cả' ? '' : cat));
        chip.className = 'cat-filter-chip' + (isCurrent ? ' active' : '');
        chip.textContent = cat;
        chip.addEventListener('click', () => {
            if (catalogCategoryFilter) {
                catalogCategoryFilter.value = cat === 'Tất cả' ? '' : cat;
            }
            renderCategoryChips(categories);
            renderMotionBlocks();
        });
        wrap.appendChild(chip);
    });
}

function renderMotionBlocks() {
    if (!motionBlocksList) return;
    const category = catalogCategoryFilter ? catalogCategoryFilter.value : '';
    const style = styleSelect ? styleSelect.value : 'modern';
    const filtered = catalogBlocks.filter((b) => {
        const styleOk = !b.styleAffinity || b.styleAffinity.includes('any') || b.styleAffinity.includes(style);
        const catOk = !category || b.category === category;
        return styleOk && catOk;
    });

    // Prune hidden blocks
    const visibleIds = new Set(filtered.map((b) => b.id));
    for (const id of [...selectedMotionBlockIds]) {
        if (!visibleIds.has(id)) {
            selectedMotionBlockIds.delete(id);
        }
    }

    motionBlocksList.innerHTML = '';
    filtered.forEach((block) => {
        const isSelected = selectedMotionBlockIds.has(block.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'motion-item-btn' + (isSelected ? ' selected' : '');
        btn.innerHTML = `
            <span class="motion-icon-mark">${isSelected ? '✓' : '+'}</span>
            <span class="motion-text-col">
                <span class="motion-name-text">${block.name}${block.runtime ? ' <span class="mb-runtime" style="font-size: 8px; background: #dcfce7; color: #15803d; padding: 1px 4px; border-radius: 99px;">core</span>' : ''}</span>
                <span class="motion-cat-text">${block.category || ''}</span>
            </span>`;

        btn.addEventListener('click', () => {
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

        motionBlocksList.appendChild(btn);
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
    }
}

if (styleSelect) styleSelect.addEventListener('change', renderMotionBlocks);

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

function displayVideo(jobId) {
    const videoUrl = `${API_BASE}/api/jobs/${jobId}/video`;
    if (videoEmpty) videoEmpty.style.display = 'none';
    if (videoPlayer) {
        videoPlayer.style.display = 'block';
        videoPlayer.src = videoUrl;
        videoPlayer.load();
        videoPlayer.play().catch(() => { });
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

// Generate Video Click Handler
if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        const prompt = promptInput ? promptInput.value.trim() : '';
        if (prompt.length < 10) {
            alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
            if (promptInput) promptInput.focus();
            return;
        }

        generateBtn.disabled = true;
        if (btnSpinner) btnSpinner.style.display = 'inline-block';
        if (btnText) btnText.textContent = 'Đang tạo...';
        setProgress(5);
        log(`Bắt đầu tạo video: "${prompt}"`, 'info');

        try {
            let selectedStyle = styleSelect ? styleSelect.value : 'modern';
            if (
                selectedStyle === 'modern' &&
                /(?:^|[^\p{L}\p{N}_])(người\s*que|stickman)(?=[^\p{L}\p{N}_]|$)/iu.test(prompt)
            ) {
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
            const isAsync = asyncSwitch ? asyncSwitch.classList.contains('active') : true;
            const skipPrev = skipPreviewSwitch ? skipPreviewSwitch.classList.contains('active') : false;

            const payload = {
                prompt: prompt,
                aspectRatio: currentRatio,
                targetDurationSec,
                language: 'vi',
                style: selectedStyle,
                ttsProvider: voiceEnabled ? prov : undefined,
                voice: voiceEnabled ? v : undefined,
                async: isAsync
            };

            if (blueprintId) payload.blueprintId = blueprintId;
            if (motionBlockIds.length) payload.motionBlockIds = motionBlockIds;
            if (skipPrev) payload.skipPreview = true;

            if (customStyleInput && customStyleInput.value.trim()) {
                payload.customStyle = customStyleInput.value.trim();
            }

            if (customScriptJson && customScriptJson.value.trim()) {
                try {
                    payload.script = JSON.parse(customScriptJson.value.trim());
                } catch (e) {
                    log('Lỗi phân tích cú pháp JSON kịch bản tự dựng', 'error');
                }
            }

            const res = await fetch(`${API_BASE}/api/pipeline`, {
                method: 'POST',
                credentials: 'include',
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
                        log('🎉 Hoàn tất render video!', 'success');

                        generateBtn.disabled = false;
                        if (btnSpinner) btnSpinner.style.display = 'none';
                        if (btnText) btnText.textContent = 'Tạo video';

                        displayVideo(jobId);
                    } else if (job.status === 'failed') {
                        clearInterval(pollInterval);
                        setProgress(0);
                        log(`❌ Thất bại: ${job.error || 'Lỗi không xác định'}`, 'error');

                        generateBtn.disabled = false;
                        if (btnSpinner) btnSpinner.style.display = 'none';
                        if (btnText) btnText.textContent = 'Thử lại';
                    }
                } catch (pollErr) {
                    console.error(pollErr);
                }
            }, 1000);

        } catch (err) {
            log(`Lỗi: ${err.message}`, 'error');
            generateBtn.disabled = false;
            if (btnSpinner) btnSpinner.style.display = 'none';
            if (btnText) btnText.textContent = 'Tạo video';
            setProgress(0);
        }
    });
}

// Initializer
(async function init() {
    handleAuthError();
    await checkAuthConfig();
    await checkCurrentUser();
    await loadCatalog();
    updateSummaryMeta();

    try {
        const res = await fetch(`${API_BASE}/api/jobs`);
        if (res.ok) {
            const jobs = await res.json();
            const completedJob = jobs.find(j => j.status === 'completed');
            if (completedJob) {
                log(`Đã tìm thấy video trước đó: ${completedJob.topic || completedJob.jobId}`, 'info');
                displayVideo(completedJob.jobId);
            }
        }
    } catch (e) { }
})();

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

async function checkCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
            method: 'GET',
            credentials: 'include'
        });
        if (!res.ok) {
            if (loginOpenBtn) {
                loginOpenBtn.textContent = 'Đăng nhập';
                loginOpenBtn.disabled = false;
            }
            if (logoutBtn) logoutBtn.style.display = 'none';
            return;
        }
        const user = await res.json();
        if (loginOpenBtn) {
            loginOpenBtn.textContent = user.username;
            loginOpenBtn.disabled = true;
        }
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
    } catch (err) {
        console.error(err);
    }
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) return;
            if (loginOpenBtn) {
                loginOpenBtn.textContent = 'Đăng nhập';
                loginOpenBtn.disabled = false;
            }
            logoutBtn.style.display = 'none';
            log('Đã đăng xuất', 'info');
        } catch (err) {
            console.error(err);
        }
    });
}

// Navigation Active Scroll Highlight
window.addEventListener('scroll', () => {
    const navLinks = document.querySelectorAll('.nav-links-pill .nav-link-btn');
    const sections = ['home', 'workspace', 'templates', 'services'];
    let current = 'home';
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const top = el.offsetTop - 140;
            if (window.scrollY >= top) current = id;
        }
    });
    navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
});

// --- 3D Stacking Cards Carousel Controller (Trang chủ) ---
(function initHero3DCarousel() {
    const track = document.getElementById('hero-carousel');
    const cards = document.querySelectorAll('.carousel-3d-card');
    const dots = document.querySelectorAll('.indicator-dot');
    if (!track || !cards.length) return;

    let currentIndex = 0;
    const totalCards = cards.length;
    let autoRotateTimer = null;

    function updateCarousel() {
        const isMobile = window.innerWidth <= 640;
        cards.forEach((card, index) => {
            const rel = (index - currentIndex + totalCards) % totalCards;
            let xOffset = 0;
            let zOffset = 0;
            let scale = 1;
            let opacity = 0;
            let zIndex = 0;
            let pointerEvents = 'none';

            if (rel === 0) {
                // Front Active Card
                xOffset = 0;
                zOffset = 0;
                scale = 1;
                opacity = 1;
                zIndex = 12;
                pointerEvents = 'auto';
            } else if (rel === 1) {
                // Second Card (Lùi nhẹ ra sau và lệch sang trái)
                xOffset = isMobile ? -36 : -130;
                zOffset = isMobile ? -70 : -140;
                scale = 0.92;
                opacity = 0.72;
                zIndex = 8;
                pointerEvents = 'auto';
            } else if (rel === 2) {
                // Third Card (Lùi sâu hơn)
                xOffset = isMobile ? -72 : -250;
                zOffset = isMobile ? -140 : -280;
                scale = 0.84;
                opacity = 0.38;
                zIndex = 4;
                pointerEvents = 'auto';
            } else {
                // Off-stage Card (chuẩn bị vòng lại)
                xOffset = isMobile ? -100 : -350;
                zOffset = isMobile ? -200 : -400;
                scale = 0.76;
                opacity = 0;
                zIndex = 1;
                pointerEvents = 'none';
            }

            const baseTransform = isMobile ? 'translateX(-50%) ' : '';
            card.style.transform = `${baseTransform}translate3d(${xOffset}px, 0px, ${zOffset}px) scale(${scale})`;
            card.style.opacity = String(opacity);
            card.style.zIndex = String(zIndex);
            card.style.pointerEvents = pointerEvents;
        });

        // Cập nhật dots chỉ báo
        dots.forEach((dot, dotIdx) => {
            dot.classList.toggle('active', dotIdx === currentIndex);
        });
    }

    function nextSlide() {
        currentIndex = (currentIndex + 1) % totalCards;
        updateCarousel();
    }

    function startAutoRotate() {
        stopAutoRotate();
        autoRotateTimer = setInterval(nextSlide, 3800);
    }

    function stopAutoRotate() {
        if (autoRotateTimer) {
            clearInterval(autoRotateTimer);
            autoRotateTimer = null;
        }
    }

    // Sự kiện tương tác trực tiếp lên từng thẻ
    cards.forEach((card, index) => {
        card.addEventListener('click', () => {
            if (currentIndex !== index) {
                currentIndex = index;
                updateCarousel();
                startAutoRotate();
            }
        });
    });

    // Sự kiện chọn indicator dots
    dots.forEach((dot, dotIdx) => {
        dot.addEventListener('click', () => {
            currentIndex = dotIdx;
            updateCarousel();
            startAutoRotate();
        });
    });

    // Tạm dừng khi rê chuột / chạm vào carousel
    track.addEventListener('mouseenter', stopAutoRotate);
    track.addEventListener('mouseleave', startAutoRotate);
    track.addEventListener('touchstart', stopAutoRotate, { passive: true });
    track.addEventListener('touchend', startAutoRotate, { passive: true });

    window.addEventListener('resize', () => {
        updateCarousel();
    });

    // Khởi tạo trạng thái ban đầu
    updateCarousel();
    startAutoRotate();
})();

// --- Templates Filter Logic ---
const tplFilterBtns = document.querySelectorAll('.tpl-filter-btn');
const tplCards = document.querySelectorAll('.template-item-card');

tplFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tplFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.getAttribute('data-category') || 'all';

        tplCards.forEach(card => {
            const cardCat = card.getAttribute('data-category');
            if (cat === 'all' || cardCat === cat) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    });
});

// --- Use Template Button Click ---
const useTemplateBtns = document.querySelectorAll('.btn-use-template');
useTemplateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        const style = btn.getAttribute('data-style');
        const ratio = btn.getAttribute('data-ratio');

        if (prompt && promptInput) {
            promptInput.value = prompt;
            if (promptCharCount) {
                promptCharCount.textContent = `${prompt.length}/500 · tối thiểu 10`;
                promptCharCount.classList.remove('warn');
            }
        }

        if (style && styleSelect) {
            styleSelect.value = style;
            styleSelect.dispatchEvent(new Event('change'));
            const styleCards = document.querySelectorAll('.style-card');
            styleCards.forEach(c => c.classList.toggle('active', c.getAttribute('data-style') === style));
        }

        if (ratio) {
            const ratioBtns = document.querySelectorAll('.ratio-btn');
            ratioBtns.forEach(r => {
                const match = r.getAttribute('data-ratio') === ratio;
                r.classList.toggle('active', match);
                if (match) currentRatio = ratio;
            });
        }

        updateSummaryMeta();

        // Cuộn mượt đến Studio & focus ô prompt
        const workspaceEl = document.getElementById('workspace');
        if (workspaceEl) {
            workspaceEl.scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => {
                if (promptInput) promptInput.focus();
            }, 600);
        }
        log('Đã nạp mẫu thiết kế vào Studio thành công!', 'info');
    });
});

// --- Billing Period Toggle ---
const monthlyBtn = document.getElementById('billing-monthly-btn');
const yearlyBtn = document.getElementById('billing-yearly-btn');
const priceVals = document.querySelectorAll('.price-val');

if (monthlyBtn && yearlyBtn) {
    monthlyBtn.addEventListener('click', () => {
        monthlyBtn.classList.add('active');
        yearlyBtn.classList.remove('active');
        priceVals.forEach(el => {
            const val = el.getAttribute('data-monthly');
            if (val) el.textContent = val;
        });
    });

    yearlyBtn.addEventListener('click', () => {
        yearlyBtn.classList.add('active');
        monthlyBtn.classList.remove('active');
        priceVals.forEach(el => {
            const val = el.getAttribute('data-yearly');
            if (val) el.textContent = val;
        });
    });
}