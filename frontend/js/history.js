const historyList = document.getElementById('history-list');
const btnRefresh = document.getElementById('btn-refresh-history');

const historyManager = {
    async load() {
        historyList.innerHTML = '<div class="empty-state">Đang tải...</div>';
        try {
            const jobs = await api.getJobs();
            this.render(jobs);
        } catch (e) {
            historyList.innerHTML = `<div class="empty-state" style="color:var(--danger)">Lỗi: ${e.message}</div>`;
        }
    },
    
    render(jobs) {
        if (!jobs || jobs.length === 0) {
            historyList.innerHTML = '<div class="empty-state">Chưa có dự án nào.</div>';
            return;
        }
        
        // Sort newest first
        jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        historyList.innerHTML = '';
        jobs.forEach(job => {
            const el = document.createElement('div');
            el.className = 'history-item';
            el.dataset.id = job.jobId;
            
            const title = job.topic || 'Dự án không tên';
            const dateStr = new Date(job.createdAt).toLocaleString('vi-VN');
            
            el.innerHTML = `
                <div class="title">${title}</div>
                <div class="meta">
                    <span class="status-pill ${job.status}">${job.status}</span>
                    <span>${dateStr}</span>
                </div>
            `;
            
            el.addEventListener('click', () => {
                document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
                el.classList.add('active');
                if (window.appController) window.appController.loadJob(job.jobId);
            });
            
            historyList.appendChild(el);
        });
    }
};

btnRefresh.addEventListener('click', () => historyManager.load());
