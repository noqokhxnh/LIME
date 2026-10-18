/**
 * Video Jobs Management View
 */

import { AdminApi } from './api.js';
import { Toast, Drawer, ConfirmModal, Skeleton, EmptyState, AlertBanner } from './components.js';

export const JobsView = {
    containerEl: null,

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.fetchAndRender();
    },

    renderStructure() {
        this.containerEl.innerHTML = `
            <div class="filter-toolbar">
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Trạng thái Job:</span>
                            <select class="select-custom" id="filter-job-status">
                                <option value="all">Tất cả</option>
                                <option value="running">Đang chạy (Running)</option>
                                <option value="queued">Trong hàng đợi (Queued)</option>
                                <option value="completed">Hoàn thành (Completed)</option>
                                <option value="failed">Thất bại (Failed)</option>
                                <option value="qa_failed">Lỗi kiểm định QA (QA Failed)</option>
                                <option value="cancelled">Đã hủy (Cancelled)</option>
                            </select>
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-jobs">Làm mới</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Job ID</th>
                                <th>Người dùng</th>
                                <th>Chủ đề / Kịch bản</th>
                                <th>Thời gian tạo</th>
                                <th>Tiến độ</th>
                                <th>Trạng thái</th>
                                <th style="text-align: center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="jobs-table-body"></tbody>
                    </table>
                </div>
                <div id="jobs-empty-container"></div>
            </div>
        `;

        this.containerEl.querySelector('#filter-job-status').onchange = () => this.fetchAndRender();
        this.containerEl.querySelector('#btn-refresh-jobs').onclick = () => {
            this.fetchAndRender();
            Toast.info('Đang cập nhật danh sách video jobs...');
        };
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#jobs-table-body');
        const emptyContainer = this.containerEl.querySelector('#jobs-empty-container');
        emptyContainer.innerHTML = '';

        Skeleton.renderTableRows(tbody, 6, 7);

        const statusFilter = this.containerEl.querySelector('#filter-job-status').value;

        try {
            const res = await AdminApi.getJobs({ status: statusFilter });
            const jobs = res.jobs || [];

            if (jobs.length === 0) {
                tbody.innerHTML = '';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không có video job nào',
                        description: 'Không tìm thấy job phù hợp với bộ lọc.',
                        actionText: statusFilter !== 'all' ? 'Xem tất cả' : null,
                        onAction: () => {
                            this.containerEl.querySelector('#filter-job-status').value = 'all';
                            this.fetchAndRender();
                        }
                    })
                );
                return;
            }

            tbody.innerHTML = '';
            jobs.forEach((j) => {
                const tr = document.createElement('tr');
                const isFailed = j.status === 'failed' || j.status === 'qa_failed';
                const isCancelled = j.status === 'cancelled';
                const isRunning = j.status === 'running' || j.status === 'queued';
                const isCompleted = j.status === 'completed';
                const jobId = j.id || j.jobId || '';
                const shortId = jobId ? jobId.slice(0, 8) + '...' : 'N/A';

                const statusBadge = isCompleted ? 'badge-success' : isFailed ? 'badge-danger' : isCancelled ? 'badge-subtle' : isRunning ? 'badge-warning' : 'badge-subtle';

                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(shortId)}</td>
                    <td>
                        <div style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(j.userEmail || j.userId || 'Guest')}</div>
                    </td>
                    <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(j.prompt || j.topic || 'Video generation')}
                    </td>
                    <td style="font-size: 12px; color: var(--text-muted);">${j.createdAt ? new Date(j.createdAt).toLocaleString('vi-VN') : 'N/A'}</td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 11px; font-family: var(--font-mono); font-weight: 600;">${getProgressPercent(j.progress)}%</span>
                        </div>
                    </td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(j.status)}</span>${j.degraded ? ' <span class="badge badge-warning" title="QA thất bại nhưng vẫn render để có video — cần duyệt lại">suy giảm</span>' : ''}</td>
                    <td style="text-align: center;">
                        <div style="display: inline-flex; gap: 6px;">
                            <button class="btn btn-secondary btn-sm view-job-btn" style="padding: 4px 8px; font-size: 11px;">Chi tiết</button>
                            ${isRunning ? `<button class="btn btn-danger btn-sm cancel-job-btn" style="padding: 4px 8px; font-size: 11px;">Hủy</button>` : ''}
                            ${(isFailed || isCancelled) ? `<button class="btn btn-secondary btn-sm retry-job-btn" style="padding: 4px 8px; font-size: 11px;">Thử lại</button>` : ''}
                        </div>
                    </td>
                `;

                tr.querySelector('.view-job-btn').onclick = () => this.openJobDrawer(j);
                const cancelBtn = tr.querySelector('.cancel-job-btn');
                if (cancelBtn) {
                    cancelBtn.onclick = () => this.handleCancelJob(jobId);
                }
                const retryBtn = tr.querySelector('.retry-job-btn');
                if (retryBtn) {
                    retryBtn.onclick = () => this.handleRetryJob(jobId);
                }

                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = AlertBanner.rowHtml(7, {
                title: 'Không tải được danh sách video jobs',
                message: err.message
            });
            AlertBanner.bindRetry(tbody, () => this.fetchAndRender());
        }
    },

    async openJobDrawer(job) {
        const jobId = job.id || job.jobId || '';
        const shortId = jobId ? jobId.slice(0, 8) + '...' : 'N/A';
        const panel = Drawer.open({
            title: `Job ${shortId}`,
            subtitle: 'Đang tải thông tin chi tiết…',
            contentHtml: '<div class="drawer-section">Đang lấy trạng thái pipeline và hàng đợi.</div>',
            footerHtml: '<button class="btn btn-secondary" type="button" data-close-job-drawer>Đóng</button>',
            onRender: (_bodyEl, footerEl) => footerEl.querySelector('[data-close-job-drawer]').onclick = () => Drawer.close()
        });
        panel.dataset.jobId = jobId;
        try {
            const detail = await AdminApi.getJobDetails(jobId);
            if (!panel.classList.contains('is-open') || panel.dataset.jobId !== jobId) return;
            const progressPercent = getProgressPercent(detail.progress);
            const progressPhase = typeof detail.progress === 'object' ? detail.progress?.phase : '';
            const progressMessage = typeof detail.progress === 'object' ? detail.progress?.message : '';
            const queue = detail.queue || {};
            const request = detail.request || {};
            const script = detail.script || null;
            const result = detail.result || {};
            const status = detail.status || job.status || 'unknown';
            const canRetry = status === 'failed' || status === 'qa_failed' || status === 'cancelled';
            const body = panel.querySelector('#lime-drawer-body');
            const footer = panel.querySelector('#lime-drawer-footer');
            panel.querySelector('#lime-drawer-subtitle').textContent = `Trạng thái: ${status} · ${progressPercent}%`;
            body.innerHTML = `
                <div class="detail-grid">
                    <div class="detail-item"><span class="detail-label">Job ID</span><span class="detail-value audit-break-word">${escapeHtml(detail.jobId || jobId)}</span></div>
                    <div class="detail-item"><span class="detail-label">Người tạo</span><span class="detail-value">${escapeHtml(detail.userEmail || job.userEmail || detail.userId || 'Guest')}</span></div>
                    <div class="detail-item"><span class="detail-label">Trạng thái</span><span class="detail-value">${escapeHtml(status)}</span></div>
                    <div class="detail-item"><span class="detail-label">Tiến độ</span><span class="detail-value">${progressPercent}%${progressPhase ? ` · ${escapeHtml(progressPhase)}` : ''}</span></div>
                    <div class="detail-item"><span class="detail-label">Tạo lúc</span><span class="detail-value">${detail.createdAt ? new Date(detail.createdAt).toLocaleString('vi-VN') : 'N/A'}</span></div>
                    <div class="detail-item"><span class="detail-label">Cập nhật lần cuối</span><span class="detail-value">${detail.updatedAt ? new Date(detail.updatedAt).toLocaleString('vi-VN') : 'N/A'}</span></div>
                    <div class="detail-item"><span class="detail-label">Thời lượng</span><span class="detail-value">${result.durationSec || request.targetDurationSec || 'Auto'} giây</span></div>
                    <div class="detail-item"><span class="detail-label">Hàng đợi</span><span class="detail-value">${escapeHtml(queue.state || 'Không có dữ liệu')}</span></div>
                </div>
                ${progressMessage ? `<section class="drawer-section"><div class="drawer-section-title">Thông báo tiến độ gần nhất</div><div>${escapeHtml(progressMessage)}</div></section>` : ''}
                <section class="drawer-section"><div class="drawer-section-title">Yêu cầu tạo video</div>
                    <div class="detail-grid">
                        <div class="detail-item"><span class="detail-label">Tỷ lệ khung hình</span><span class="detail-value">${escapeHtml(request.aspectRatio || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Phong cách</span><span class="detail-value">${escapeHtml(request.style || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">Giọng đọc</span><span class="detail-value">${escapeHtml(request.voice || 'N/A')}</span></div>
                        <div class="detail-item"><span class="detail-label">TTS Provider</span><span class="detail-value">${escapeHtml(request.ttsProvider || 'N/A')}</span></div>
                    </div>
                    <div class="job-detail-prompt">${escapeHtml(request.prompt || job.prompt || job.topic || 'Không lưu prompt')}</div>
                </section>
                <section class="drawer-section job-edit-section">
                    <div class="drawer-section-title">Sửa trước khi chạy lại</div>
                    <label class="form-group"><span class="form-label">Thời lượng mục tiêu (giây)</span>
                        <input class="form-input" type="number" min="10" max="300" step="1" data-job-edit-duration value="${escapeHtml(String(request.targetDurationSec || script?.targetDurationSec || 15))}">
                    </label>
                    ${script?.scenes?.length ? `<div class="job-edit-scenes"><div class="form-label">Lời đọc từng cảnh</div>${script.scenes.map((scene, index) => `
                        <label class="form-group"><span class="form-label">Cảnh ${index + 1}: ${escapeHtml(scene.title || '')}</span>
                            <textarea class="form-input job-edit-scene" data-scene-index="${index}" rows="4">${escapeHtml(scene.voiceOverText || '')}</textarea>
                        </label>`).join('')}</div>` : '<div class="job-edit-note">Kịch bản chưa được lưu. Bạn vẫn có thể sửa thời lượng; Studio sẽ cho phép chỉnh kịch bản nếu dữ liệu đó có sẵn.</div>'}
                    <button class="btn btn-secondary" type="button" data-save-job-edits>Lưu chỉnh sửa</button>
                </section>
                <section class="drawer-section"><div class="drawer-section-title">Kết quả</div><div class="job-detail-summary">Video: ${result.hasVideo ? 'Có' : 'Chưa có'} · HTML: ${result.hasHtml ? 'Có' : 'Chưa có'}${detail.degraded ? ' · <strong>Bản suy giảm chất lượng</strong> (QA thất bại nhưng vẫn render; nên duyệt lại trước khi dùng)' : ''}</div></section>
                ${status === 'queued' && ['failed', 'completed'].includes(queue.state) ? '<section class="drawer-section job-detail-error"><div class="drawer-section-title">Trạng thái không đồng nhất</div><div>Job store đang ghi queued nhưng bản ghi hàng đợi mới nhất đã kết thúc. Có thể job chưa được cập nhật trạng thái sau khi worker dừng.</div></section>' : ''}
                ${detail.error || queue.failedReason ? `<section class="drawer-section job-detail-error"><div class="drawer-section-title">Chi tiết lỗi</div><pre>${escapeHtml(detail.error || queue.failedReason)}</pre></section>` : ''}
                ${status === 'failed' && !detail.error && !queue.failedReason ? '<section class="drawer-section job-detail-error"><div class="drawer-section-title">Chưa có thông báo lỗi</div><div>Job đã được đánh dấu thất bại nhưng job store và hàng đợi không lưu thông báo lỗi. Kiểm tra log của server/worker tại thời điểm cập nhật lần cuối.</div></section>' : ''}
                ${queue.stacktrace?.length ? `<section class="drawer-section"><div class="drawer-section-title">Stack trace hàng đợi</div><pre class="job-detail-stack">${escapeHtml(queue.stacktrace.join('\n'))}</pre></section>` : ''}
                ${queue.processedOn ? `<div class="job-detail-summary">Worker bắt đầu: ${new Date(queue.processedOn).toLocaleString('vi-VN')}</div>` : ''}
                ${queue.finishedOn ? `<div class="job-detail-summary">Worker kết thúc: ${new Date(queue.finishedOn).toLocaleString('vi-VN')}</div>` : ''}
                ${queue.attemptsMade !== undefined ? `<div class="job-detail-summary">Số lần thử: ${queue.attemptsMade}</div>` : ''}
            `;
            footer.innerHTML = `
                <button class="btn btn-secondary" type="button" data-close-job-drawer>Đóng</button>
                ${canRetry ? '<button class="btn btn-primary" type="button" data-retry-job>Thử lại Job</button>' : ''}
            `;
            footer.querySelector('[data-close-job-drawer]').onclick = () => Drawer.close();
            footer.querySelector('[data-retry-job]')?.addEventListener('click', () => {
                this.handleRetryJob(jobId);
                Drawer.close();
            });
            body.querySelector('[data-save-job-edits]')?.addEventListener('click', async (event) => {
                const button = event.currentTarget;
                const duration = Number(body.querySelector('[data-job-edit-duration]')?.value);
                if (!Number.isInteger(duration) || duration < 10 || duration > 300) {
                    Toast.error('Thời lượng phải từ 10 đến 300 giây.');
                    return;
                }
                const updatedScript = script ? JSON.parse(JSON.stringify(script)) : null;
                if (updatedScript) {
                    body.querySelectorAll('[data-scene-index]').forEach((input) => {
                        const index = Number(input.dataset.sceneIndex);
                        if (updatedScript.scenes[index]) updatedScript.scenes[index].voiceOverText = input.value;
                    });
                    updatedScript.targetDurationSec = duration;
                }
                button.disabled = true;
                try {
                    await AdminApi.updateJob(jobId, { targetDurationSec: duration, ...(updatedScript ? { script: updatedScript } : {}) });
                    Toast.success('Đã lưu chỉnh sửa. Có thể thử lại job.');
                    await this.openJobDrawer({ ...job, id: jobId });
                } catch (err) {
                    Toast.error(`Không thể lưu: ${err.message}`);
                    button.disabled = false;
                }
            });
        } catch (err) {
            if (!panel.classList.contains('is-open') || panel.dataset.jobId !== jobId) return;
            panel.querySelector('#lime-drawer-subtitle').textContent = 'Không thể tải thông tin đầy đủ';
            panel.querySelector('#lime-drawer-body').innerHTML = `<section class="drawer-section job-detail-error"><pre>${escapeHtml(err.message)}</pre></section>`;
        }
    },

    handleCancelJob(jobId) {
        const shortId = (jobId || '').slice(0, 8);
        ConfirmModal.show({
            title: 'Xác nhận hủy Job',
            message: `Bạn có chắc muốn hủy tiến trình tạo video của Job <strong>${shortId}</strong>?`,
            confirmText: 'Hủy Job',
            isDanger: true,
            onConfirm: async () => {
                try {
                    await AdminApi.cancelJob(jobId);
                    Toast.success('Đã gửi yêu cầu hủy Job.');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            }
        });
    },

    handleRetryJob(jobId) {
        const shortId = (jobId || '').slice(0, 8);
        ConfirmModal.show({
            title: 'Chạy lại Job',
            message: `Tiến hành chạy lại Job <strong>${shortId}</strong>?`,
            confirmText: 'Chạy lại',
            onConfirm: async () => {
                try {
                    await AdminApi.retryJob(jobId);
                    Toast.success('Đã đưa Job vào hàng đợi chạy lại.');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            }
        });
    }
};

function getProgressPercent(progress) {
    const value = typeof progress === 'number' ? progress : Number(progress?.progress);
    return Number.isFinite(value) ? Math.round(value) : 0;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
