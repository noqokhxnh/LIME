const API_BASE = (window.location.origin && window.location.origin.includes(':3000'))
    ? ''
    : 'http://localhost:3000';

const api = {
    async getJobs() {
        const res = await fetch(`${API_BASE}/api/jobs`);
        if (!res.ok) throw new Error('Cannot fetch jobs');
        return res.json();
    },
    
    async getJobDetails(jobId) {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
        if (!res.ok) throw new Error('Cannot fetch job details');
        return res.json();
    },
    
    async createDraft(prompt, aspectRatio, style) {
        const res = await fetch(`${API_BASE}/api/script/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                promt: prompt,
                aspectRatio,
                targetDurationSec: 60, // default
                language: 'vi',
                style
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to create draft');
        }
        return res.json();
    },
    
    async renderPipeline(jobId, modifiedScript, originalPrompt) {
        // Sẽ gọi lại pipeline, lúc này truyền jobId cũ để ghi đè hoặc tiếp tục tiến trình
        const res = await fetch(`${API_BASE}/api/pipeline`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: jobId,
                promt: originalPrompt, // Bắt buộc phải có do Backend yêu cầu
                script: modifiedScript,
                async: true
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to start render pipeline');
        }
        return res.json();
    },

    getVideoUrl(jobId) { return `${API_BASE}/api/jobs/${jobId}/video`; },
    getDownloadUrl(jobId) { return `${API_BASE}/api/jobs/${jobId}/download`; },
    getHtmlUrl(jobId) { return `${API_BASE}/api/jobs/${jobId}/html`; }
};
