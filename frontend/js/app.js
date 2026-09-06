// UI Elements - Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// UI Elements - Video
const videoEmpty = document.getElementById('video-empty');
const videoPlayer = document.getElementById('video-player');
const videoActions = document.getElementById('video-actions');
const btnDownload = document.getElementById('btn-download');
const btnPreviewHtml = document.getElementById('btn-preview-html');

// UI Elements - Control & Logs
const promptInput = document.getElementById('prompt-input');
const aspectRatioSelect = document.getElementById('aspect-ratio');
const styleSelect = document.getElementById('video-style');
const btnGenerate = document.getElementById('btn-generate-draft');

const currentJobIdBadge = document.getElementById('current-job-id');
const currentJobStatus = document.getElementById('current-job-status');
const progressFill = document.getElementById('progress-fill');
const logViewer = document.getElementById('log-viewer');

// State
let pollInterval = null;
let activeJobId = null;
let lastLogMessage = '';
let currentSessionPrompt = null; // Guardrail workaround

// --- TAB LOGIC ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

function switchTab(tabId) {
    document.querySelector(`.tab-btn[data-target="${tabId}"]`).click();
}

// --- LOGGING ---
function addLog(msg, type = 'info') {
    if (msg === lastLogMessage && type !== 'error') return; // Prevent spam
    lastLogMessage = msg;
    
    const time = new Date().toLocaleTimeString('vi-VN');
    const el = document.createElement('div');
    el.className = `log-item ${type}`;
    el.textContent = `[${time}] ${msg}`;
    logViewer.appendChild(el);
    logViewer.scrollTop = logViewer.scrollHeight;
}

function updateStatusUI(status, progressVal, msg) {
    currentJobStatus.textContent = `Trạng thái: ${status.toUpperCase()}`;
    if (progressVal !== undefined) progressFill.style.width = `${progressVal}%`;
    if (msg) addLog(msg, 'info');
}

// --- CLEAR STALE DATA (Guardrail #6) ---
function clearWorkspace() {
    // Clear Video
    videoEmpty.style.display = 'block';
    videoPlayer.style.display = 'none';
    videoActions.style.display = 'none';
    videoPlayer.src = '';
    
    // Clear Script
    scriptTab.clear();
    
    // Clear Logs
    logViewer.innerHTML = '';
    progressFill.style.width = '0%';
    currentJobStatus.textContent = 'Trạng thái: N/A';
    currentJobIdBadge.style.display = 'none';
    activeJobId = null;
    
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

// --- APP CONTROLLER ---
window.appController = {
    getCurrentPrompt() { return currentSessionPrompt; },

    // 1. Luồng load dữ liệu từ History
    async loadJob(jobId) {
        currentSessionPrompt = null; // Khi load từ history, ta không có prompt
        clearWorkspace();
        activeJobId = jobId;
        currentJobIdBadge.style.display = 'inline-block';
        currentJobIdBadge.textContent = `ID: ${jobId.substring(0,8)}`;
        
        try {
            const job = await api.getJobDetails(jobId);
            this.handleJobState(job);
            
            // Nếu job đang dở dang (queued, running), tiếp tục poll
            if (['queued', 'running'].includes(job.status)) {
                this.startPolling(jobId);
            }
        } catch (e) {
            addLog(`Lỗi tải Job: ${e.message}`, 'error');
            currentJobStatus.textContent = 'Lỗi tải dữ liệu';
        }
    },

    // Xử lý luồng UI dựa trên trạng thái Job
    handleJobState(job) {
        updateStatusUI(job.status, job.progress?.progress || 0, job.progress?.message);

        if (job.status === 'completed') {
            switchTab('tab-video');
            videoEmpty.style.display = 'none';
            videoPlayer.style.display = 'block';
            videoActions.style.display = 'flex';
            videoPlayer.src = api.getVideoUrl(job.jobId);
            btnDownload.href = api.getDownloadUrl(job.jobId);
            btnPreviewHtml.href = api.getHtmlUrl(job.jobId);
        } 
        else if (job.status === 'draft') {
            switchTab('tab-script');
            scriptTab.loadScript(job.jobId, job.script);
            addLog('Bản nháp đã sẵn sàng. Vui lòng chuyển sang Tab Kịch Bản để duyệt.', 'success');
        }
        else if (job.status === 'failed') {
            addLog(`Job lỗi: ${job.error}`, 'error');
            progressFill.style.width = '0%';
        }
    },

    // 2. Luồng tạo Draft mới (Step 1)
    async createDraft() {
        const prompt = promptInput.value.trim();
        if (prompt.length < 5) return alert('Nhập prompt dài hơn chút nhé!');

        currentSessionPrompt = prompt; // Lưu lại prompt để dùng cho step Render
        btnGenerate.disabled = true;
        clearWorkspace(); // Dọn dẹp dữ liệu cũ
        addLog('Đang yêu cầu AI tạo kịch bản...', 'info');
        
        try {
            const res = await api.createDraft(prompt, aspectRatioSelect.value, styleSelect.value);
            activeJobId = res.jobId;
            currentJobIdBadge.style.display = 'inline-block';
            currentJobIdBadge.textContent = `ID: ${res.jobId.substring(0,8)}`;
            
            // Reload history to show the new queued job
            historyManager.load(); 
            this.startPolling(res.jobId);
            
        } catch (e) {
            addLog(`Tạo Draft lỗi: ${e.message}`, 'error');
        } finally {
            btnGenerate.disabled = false;
        }
    },

    // 3. Luồng gửi Script đã sửa lên để Render (Step 2)
    async startRender(jobId, modifiedScript, originalPrompt) {
        addLog('Đang gửi kịch bản đã duyệt lên server...', 'info');
        try {
            const res = await api.renderPipeline(jobId, modifiedScript, originalPrompt);
            // Bắt đầu Render, switch sang Video tab cho UX tốt
            switchTab('tab-video');
            videoEmpty.style.display = 'block';
            videoEmpty.textContent = 'Đang render video... Vui lòng xem tiến trình ở cột bên phải.';
            
            historyManager.load(); // Cập nhật trạng thái running ở list
            this.startPolling(jobId);
        } catch (e) {
            addLog(`Lỗi khởi tạo Render: ${e.message}`, 'error');
        }
    },

    // Polling trạng thái
    startPolling(jobId) {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
            try {
                // Đảm bảo không poll nếu người dùng đã chuyển job khác
                if (activeJobId !== jobId) {
                    clearInterval(pollInterval);
                    return;
                }
                
                const job = await api.getJobDetails(jobId);
                updateStatusUI(job.status, job.progress?.progress, job.progress?.message);
                
                if (['completed', 'failed', 'draft'].includes(job.status)) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    this.handleJobState(job);
                    historyManager.load(); // Cập nhật trạng thái cuối cùng ở Sidebar
                }
            } catch (e) {
                console.error('Polling error', e);
            }
        }, 1500);
    }
};

// --- EVENTS BINDING ---
btnGenerate.addEventListener('click', () => window.appController.createDraft());

// --- INIT ---
historyManager.load();
