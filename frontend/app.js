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
const promptInput = document.getElementById('prompt-input');
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

let pollInterval = null;

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
        let selectedStyle = 'modern';
        if (/người que|stickman|que/i.test(prompt)) {
            selectedStyle = 'stickman';
        }

        const prov = ttsProviderSelect ? ttsProviderSelect.value : 'vieneu';
        const v = voiceSelect ? voiceSelect.value : 'Minh Quân';

        const res = await fetch(`${API_BASE}/api/pipeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                aspectRatio: '16:9',
                targetDurationSec: 15,
                language: 'vi',
                style: selectedStyle,
                ttsProvider: prov,
                voice: v,
                async: true
            })
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
    await checkCurrentUser();
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
            return;}
        const user = await res.json();
        loginOpenBtn.textContent = user.username;
        loginOpenBtn.disabled = true;
        logoutBtn.style.display = 'inline-block';}
        catch(err) {
            console.error(err);
        }}
logoutBtn.addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include'});
        if (!res.ok) {
            return;
        }
        loginOpenBtn.textContent = 'Đăng nhập';
        loginOpenBtn.disabled = false;
        logoutBtn.style.display = 'none';
        log('Đã đăng xuất', 'info');
    } catch (err) {
        console.error(err);
    }
});