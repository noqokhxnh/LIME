// Cấu hình base URL tự động nhận diện nếu mở trực tiếp hay qua server
const API_BASE = (window.location.origin && window.location.origin.includes(':3000'))
    ? ''
    : 'http://localhost:3000';

//test login ui

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
loginOpenBtn.addEventListener('click', () => {
    loginModal.classList.add('show');
});
loginCloseBtn.addEventListener('click', () => {
    loginModal.classList.remove('show');
});
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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                password
            })
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
        logoutBtn.style.display = 'inline-block';
        if (saveBrandKitBtn) saveBrandKitBtn.style.display = 'inline-block';
        await loadUserBrandKit();
        log(`Đăng nhập thành công: ${data.username}`, 'success');
    } catch (err) {
        loginMessage.textContent = 'Không thể kết nối tới server';
    }
});
showRegisterBtn.addEventListener('click', () => {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    showRegisterBtn.style.display = 'none';
    authTitle.textContent = 'Đăng ký';
});
showLoginBtn.addEventListener('click', () => {
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
    showRegisterBtn.style.display = 'block';
    authTitle.textContent = 'Đăng nhập';
});
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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                email,
                password
            })
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
        logoutBtn.style.display = 'inline-block';
        if (saveBrandKitBtn) saveBrandKitBtn.style.display = 'inline-block';
        await loadUserBrandKit();

        log(`Đăng ký thành công: ${data.username}`, 'success');
    } catch (err) {
        registerMessage.textContent = 'Không thể kết nối tới server';
    }
});
function handleAuthError() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'open') {
        return;
    }
    loginModal.classList.add('show');
    const error = params.get('error');
    if (error) {
        loginMessage.textContent = error;
    }
    window.history.replaceState(
        {},
        '',
        window.location.pathname
    );
}
const promptInput = document.getElementById('prompt-input');
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

// Các phần tử điều khiển Brand Kit & Logo Watermark
const logoFileInput = document.getElementById('logo-file-input');
const logoUploadBtn = document.getElementById('logo-upload-btn');
const logoFilename = document.getElementById('logo-filename');
const logoRemoveBtn = document.getElementById('logo-remove-btn');
const posButtons = document.querySelectorAll('.pos-btn');
const watermarkScale = document.getElementById('watermark-scale');
const watermarkScaleVal = document.getElementById('watermark-scale-val');
const watermarkOpacity = document.getElementById('watermark-opacity');
const watermarkOpacityVal = document.getElementById('watermark-opacity-val');
const saveBrandKitBtn = document.getElementById('save-brand-kit-btn');
const watermarkPreviewOverlay = document.getElementById('watermark-preview-overlay');

// Trạng thái cấu hình watermark hiện tại
const watermarkState = {
    logoPath: null,       // Đường dẫn file thực tế trên server
    logoUrl: null,        // URL hoặc Data URL để xem thử trên trình duyệt
    position: 'bottom-right',
    scalePercent: 15,
    opacity: 0.8,
};

// Cập nhật lớp xem trước (Live Preview Overlay) logo trên khung video
function updateWatermarkPreview() {
    if (!watermarkPreviewOverlay) return;
    if (!watermarkState.logoUrl) {
        watermarkPreviewOverlay.style.display = 'none';
        watermarkPreviewOverlay.src = '';
        return;
    }

    watermarkPreviewOverlay.src = watermarkState.logoUrl;
    watermarkPreviewOverlay.style.display = 'block';
    watermarkPreviewOverlay.style.width = `${watermarkState.scalePercent}%`;
    watermarkPreviewOverlay.style.opacity = String(watermarkState.opacity);

    // Gán class vị trí tương ứng (pos-top-left, pos-top-right, pos-bottom-left, pos-bottom-right)
    watermarkPreviewOverlay.className = `watermark-preview-overlay pos-${watermarkState.position}`;
}

// Khởi tạo các sự kiện cho giao diện Brand Kit
function initBrandKitUI() {
    if (logoUploadBtn && logoFileInput) {
        logoUploadBtn.addEventListener('click', () => logoFileInput.click());
    }

    if (logoFileInput) {
        logoFileInput.addEventListener('change', async () => {
            const file = logoFileInput.files && logoFileInput.files[0];
            if (!file) return;

            // Kiểm tra dung lượng tối đa 5MB phía client
            if (file.size > 5 * 1024 * 1024) {
                alert('Dung lượng ảnh vượt quá 5MB. Vui lòng chọn ảnh nhẹ hơn.');
                logoFileInput.value = '';
                return;
            }

            // Hiển thị tạm thời bằng Object URL để phản hồi tức thì
            const tempUrl = URL.createObjectURL(file);
            watermarkState.logoUrl = tempUrl;
            if (logoFilename) logoFilename.textContent = file.name;
            if (logoRemoveBtn) logoRemoveBtn.style.display = 'inline-block';
            updateWatermarkPreview();

            // Tiến hành upload lên server qua POST /api/brand-kit/upload
            const formData = new FormData();
            formData.append('logo', file);

            try {
                log(`Đang tải ảnh logo "${file.name}" lên máy chủ...`, 'info');
                const res = await fetch(`${API_BASE}/api/brand-kit/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData,
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Tải logo lên thất bại');
                }

                // Lưu URL logo do server trả về (không dùng đường dẫn tuyệt đối
                // trên server để tránh lộ cấu trúc thư mục)
                watermarkState.logoPath = data.logoUrl;
                watermarkState.logoUrl = data.logoUrl.startsWith('http') ? data.logoUrl : `${API_BASE}${data.logoUrl}`;
                updateWatermarkPreview();
                log(`Tải logo thành công: ${file.name}`, 'success');
            } catch (err) {
                log(`Lỗi tải logo: ${err.message}`, 'error');
                watermarkState.logoPath = null;
                watermarkState.logoUrl = null;
                logoFileInput.value = '';
                if (logoFilename) logoFilename.textContent = 'Chưa chọn logo';
                if (logoRemoveBtn) logoRemoveBtn.style.display = 'none';
                updateWatermarkPreview();
            }
        });
    }

    if (logoRemoveBtn) {
        logoRemoveBtn.addEventListener('click', () => {
            watermarkState.logoPath = null;
            watermarkState.logoUrl = null;
            if (logoFileInput) logoFileInput.value = '';
            if (logoFilename) logoFilename.textContent = 'Chưa chọn logo';
            logoRemoveBtn.style.display = 'none';
            updateWatermarkPreview();
            log('Đã gỡ bỏ logo thương hiệu', 'info');
        });
    }

    // Sự kiện 4 nút chọn góc
    posButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const pos = btn.dataset.pos;
            if (!pos) return;
            watermarkState.position = pos;
            posButtons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            updateWatermarkPreview();
        });
    });

    // Sự kiện thanh trượt kích thước Scale (5% - 40%)
    if (watermarkScale && watermarkScaleVal) {
        watermarkScale.addEventListener('input', () => {
            const val = parseInt(watermarkScale.value, 10);
            watermarkState.scalePercent = val;
            watermarkScaleVal.textContent = `${val}%`;
            updateWatermarkPreview();
        });
    }

    // Sự kiện thanh trượt độ mờ Opacity (10% - 100%)
    if (watermarkOpacity && watermarkOpacityVal) {
        watermarkOpacity.addEventListener('input', () => {
            const val = parseInt(watermarkOpacity.value, 10);
            watermarkState.opacity = val / 100;
            watermarkOpacityVal.textContent = `${val}%`;
            updateWatermarkPreview();
        });
    }

    // Sự kiện lưu cấu hình vào tài khoản qua PUT /api/user/brand-kit
    if (saveBrandKitBtn) {
        saveBrandKitBtn.addEventListener('click', async () => {
            if (!watermarkState.logoPath) {
                alert('Vui lòng chọn hoặc tải logo lên trước khi lưu cài đặt.');
                return;
            }
            try {
                const res = await fetch(`${API_BASE}/api/user/brand-kit`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        logoUrl: watermarkState.logoPath,
                        position: watermarkState.position,
                        scalePct: watermarkState.scalePercent,
                        opacity: watermarkState.opacity,
                    }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Không thể lưu cài đặt.');
                }
                log('Đã lưu cấu hình logo vào tài khoản thành công!', 'success');
            } catch (err) {
                log(`Lỗi lưu cài đặt thương hiệu: ${err.message}`, 'error');
            }
        });
    }
}

// Nạp cài đặt Brand Kit từ tài khoản đã đăng nhập
async function loadUserBrandKit() {
    try {
        const res = await fetch(`${API_BASE}/api/user/brand-kit`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.brandKit) {
            const bk = data.brandKit;
            const logoPath = bk.logo_url || bk.logoUrl;
            if (!logoPath) return;

            watermarkState.logoPath = logoPath;
            watermarkState.logoUrl = logoPath.startsWith('http') ? logoPath : `${API_BASE}${logoPath}`;
            watermarkState.position = bk.position || 'bottom-right';
            watermarkState.scalePercent = bk.scale_pct || bk.scalePct || 15;
            watermarkState.opacity = typeof bk.opacity === 'number' ? bk.opacity : parseFloat(bk.opacity) || 0.8;

            if (logoFilename) {
                const parts = logoPath.split(/[\\/]/);
                logoFilename.textContent = parts[parts.length - 1] || 'logo';
            }
            if (logoRemoveBtn) logoRemoveBtn.style.display = 'inline-block';
            if (watermarkScale) watermarkScale.value = String(watermarkState.scalePercent);
            if (watermarkScaleVal) watermarkScaleVal.textContent = `${watermarkState.scalePercent}%`;
            if (watermarkOpacity) watermarkOpacity.value = String(Math.round(watermarkState.opacity * 100));
            if (watermarkOpacityVal) watermarkOpacityVal.textContent = `${Math.round(watermarkState.opacity * 100)}%`;

            posButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.pos === watermarkState.position);
            });

            updateWatermarkPreview();
            log('Đã nạp cài đặt logo thương hiệu từ tài khoản.', 'info');
        }
    } catch (e) {
        console.error('Lỗi khi nạp cài đặt brand kit:', e);
    }
}

let pollInterval = null;
let catalogBlocks = [];
let selectedMotionBlockIds = new Set();

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

// Hàm gán prompt mẫu nhanh
function setPrompt(text) {
    promptInput.value = text;
    promptInput.focus();
}

function updateMotionCount() {
    if (motionBlocksCount) motionBlocksCount.textContent = String(selectedMotionBlockIds.size);
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

    // Drop selections that are no longer visible under current filters
    // so hidden chips cannot consume the max-8 budget.
    const visibleIds = new Set(filtered.map((b) => b.id));
    let pruned = 0;
    for (const id of [...selectedMotionBlockIds]) {
        if (!visibleIds.has(id)) {
            selectedMotionBlockIds.delete(id);
            pruned++;
        }
    }
    if (pruned > 0) {
        log(`Đã bỏ ${pruned} block bị ẩn bởi bộ lọc hiện tại`, 'info');
    }

    motionBlocksList.innerHTML = '';
    filtered.forEach((block) => {
        const label = document.createElement('label');
        label.className = 'motion-block-chip' + (selectedMotionBlockIds.has(block.id) ? ' selected' : '');
        const checked = selectedMotionBlockIds.has(block.id) ? 'checked' : '';
        label.innerHTML = `
            <input type="checkbox" value="${block.id}" ${checked}>
            <span>
                <span class="mb-name">${block.name}${block.runtime ? '<span class="mb-runtime">runtime</span>' : ''}</span>
                ${block.description || ''}
            </span>`;
        const input = label.querySelector('input');
        input.addEventListener('change', () => {
            if (input.checked) {
                if (selectedMotionBlockIds.size >= 8) {
                    input.checked = false;
                    log('Chỉ chọn tối đa 8 motion blocks', 'error');
                    return;
                }
                selectedMotionBlockIds.add(block.id);
                label.classList.add('selected');
            } else {
                selectedMotionBlockIds.delete(block.id);
                label.classList.remove('selected');
            }
            updateMotionCount();
        });
        motionBlocksList.appendChild(label);
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

        if (catalogCategoryFilter) {
            const cats = [...new Set(catalogBlocks.map((b) => b.category).filter(Boolean))].sort();
            const prev = catalogCategoryFilter.value;
            catalogCategoryFilter.innerHTML = '<option value="">Tất cả</option>';
            cats.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                catalogCategoryFilter.appendChild(opt);
            });
            if (prev) catalogCategoryFilter.value = prev;
        }

        renderMotionBlocks();
        log(`Đã tải catalog: ${catalogBlocks.length} blocks, ${(data.blueprints || []).length} blueprints`, 'info');
    } catch (err) {
        log(`Catalog: ${err.message}`, 'error');
    }
}

if (styleSelect) styleSelect.addEventListener('change', renderMotionBlocks);
if (catalogCategoryFilter) catalogCategoryFilter.addEventListener('change', renderMotionBlocks);

// Hàm ghi log vào khung hiển thị
function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const el = document.createElement('div');
    el.className = `log-item ${type}`;
    el.textContent = `[${time}] ${msg}`;
    logViewer.appendChild(el);
    logViewer.scrollTop = logViewer.scrollHeight;
}

// Cập nhật thanh tiến trình
function setProgress(percent) {
    const pct = Math.min(100, Math.max(0, Math.round(percent)));
    progressFill.style.width = `${pct}%`;
    progressPercent.textContent = `${pct}%`;
}

// Nạp và phát video
function displayVideo(jobId) {
    const videoUrl = `${API_BASE}/api/jobs/${jobId}/video`;
    videoEmpty.style.display = 'none';
    videoPlayer.style.display = 'block';
    videoPlayer.src = videoUrl;
    videoPlayer.load();
    videoPlayer.play().catch(() => { });

    // Video đã được render hoàn chỉnh có logo dán trực tiếp từ FFmpeg,
    // tạm ẩn lớp overlay mô phỏng để không bị hiển thị đè lên hai lần.
    if (watermarkPreviewOverlay) {
        watermarkPreviewOverlay.style.display = 'none';
    }

    btnDownload.style.display = 'inline-block';
    btnDownload.href = `${API_BASE}/api/jobs/${jobId}/download`;

    btnPreviewHtml.style.display = 'inline-block';
    btnPreviewHtml.href = `${API_BASE}/api/jobs/${jobId}/html`;
}

// Bắt đầu tạo video
generateBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (prompt.length < 10) {
        alert('Vui lòng nhập prompt ít nhất 10 ký tự!');
        promptInput.focus();
        return;
    }

    generateBtn.disabled = true;
    btnSpinner.style.display = 'inline-block';
    btnText.textContent = 'Đang xử lý...';
    setProgress(5);
    log(`Bắt đầu tạo video: "${prompt}"`, 'info');

    try {
        // Only auto-detect stickman when user left style at default "modern".
        // Do NOT match bare "que" (false positives: technique, unique, thói quen…).
        // Do NOT mutate styleSelect.value — that locked later runs onto stickman.
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

        // Thời lượng mục tiêu do người dùng chọn (10–300s, mặc định 15s).
        // Backend dùng giá trị này để sinh kịch bản vừa khung và kiểm tra estimated duration.
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
            prompt: prompt,
            aspectRatio: '16:9',
            targetDurationSec,
            language: 'vi',
            style: selectedStyle,
            ttsProvider: prov,
            voice: v,
            async: true
        };
        if (blueprintId) payload.blueprintId = blueprintId;
        if (motionBlockIds.length) payload.motionBlockIds = motionBlockIds;

        // Nếu người dùng đã chọn hoặc tải logo lên, truyền kèm cấu hình watermark
        if (watermarkState.logoPath) {
            payload.watermark = {
                logoPath: watermarkState.logoPath,
                position: watermarkState.position,
                scalePercent: watermarkState.scalePercent,
                opacity: watermarkState.opacity,
            };
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

        // Bắt đầu polling trạng thái
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
                    btnSpinner.style.display = 'none';
                    btnText.textContent = 'Tạo Video';

                    displayVideo(jobId);
                } else if (job.status === 'failed') {
                    clearInterval(pollInterval);
                    setProgress(0);
                    log(`❌ Thất bại: ${job.error || 'Lỗi không xác định'}`, 'error');

                    generateBtn.disabled = false;
                    btnSpinner.style.display = 'none';
                    btnText.textContent = 'Thử Lại';
                }
            } catch (pollErr) {
                console.error(pollErr);
            }
        }, 1000);

    } catch (err) {
        log(`Lỗi: ${err.message}`, 'error');
        generateBtn.disabled = false;
        btnSpinner.style.display = 'none';
        btnText.textContent = 'Tạo Video';
        setProgress(0);
    }
});

// Khi vừa vào trang, kiểm tra nếu có video cũ thì cho phép xem ngay
(async function init() {
    handleAuthError();
    initBrandKitUI();
    await checkAuthConfig();
    await checkCurrentUser();
    await loadCatalog();
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
            loginOpenBtn.textContent = 'Đăng nhập';
            loginOpenBtn.disabled = false;
            logoutBtn.style.display = 'none';
            if (saveBrandKitBtn) saveBrandKitBtn.style.display = 'none';
            return;
        }
        const user = await res.json();
        loginOpenBtn.textContent = user.username;
        loginOpenBtn.disabled = true;
        logoutBtn.style.display = 'inline-block';
        if (saveBrandKitBtn) saveBrandKitBtn.style.display = 'inline-block';
        await loadUserBrandKit();
    } catch(err) {
        console.error(err);
    }
}
logoutBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) {
            return;
        }
        loginOpenBtn.textContent = 'Đăng nhập';
        loginOpenBtn.disabled = false;
        logoutBtn.style.display = 'none';
        if (saveBrandKitBtn) saveBrandKitBtn.style.display = 'none';
        log('Đã đăng xuất', 'info');
    } catch (err) {
        console.error(err);
    }
});