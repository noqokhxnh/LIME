/**
 * Audit Logs View
 */

import { AdminApi } from './api.js';
import { Toast, Drawer, ConfirmModal, Skeleton, EmptyState } from './components.js';

export const LogsView = {
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
                        <span class="filter-label">Nhật ký kiểm toán bảo mật & lịch sử thao tác của Admin</span>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-logs">Làm mới</button>
                        <button class="btn btn-danger" id="btn-clear-logs">Xóa nhật ký</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Thời gian</th>
                                <th>Hành động (Action)</th>
                                <th>Người thực hiện</th>
                                <th>Mục tiêu (Target)</th>
                                <th>Trạng thái</th>
                                <th>Chi tiết</th>
                            </tr>
                        </thead>
                        <tbody id="logs-table-body"></tbody>
                    </table>
                </div>
                <div id="logs-empty-container"></div>
            </div>
        `;

        this.containerEl.querySelector('#btn-refresh-logs').onclick = () => this.fetchAndRender();
        this.containerEl.querySelector('#btn-clear-logs').onclick = () => this.handleClearLogs();
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#logs-table-body');
        const emptyContainer = this.containerEl.querySelector('#logs-empty-container');
        emptyContainer.innerHTML = '';

        Skeleton.renderTableRows(tbody, 8, 6);

        try {
            const res = await AdminApi.getAuditLogs();
            const logs = res.logs || [];

            if (logs.length === 0) {
                tbody.innerHTML = '';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Chưa có nhật ký nào',
                        description: 'Hệ thống chưa ghi nhận sự kiện kiểm toán nào.',
                        actionText: null
                    })
                );
                return;
            }

            tbody.innerHTML = '';
            logs.forEach((log) => {
                const tr = document.createElement('tr');
                const time = log.timestamp || log.createdAt ? new Date(log.timestamp || log.createdAt).toLocaleString('vi-VN') : 'N/A';
                const isSuccess = log.status === 'success';
                const statusBadge = isSuccess ? 'badge-success' : log.status === 'warning' ? 'badge-warning' : 'badge-danger';

                tr.innerHTML = `
                    <td style="font-size: 12px; color: var(--text-muted); white-space: nowrap;">${time}</td>
                    <td>
                        <span style="font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--primary);">
                            ${escapeHtml(log.action || 'admin.action')}
                        </span>
                    </td>
                    <td>
                        <div style="font-size: 12px; color: var(--text-main);">${escapeHtml(log.actor || log.adminEmail || log.details?.updatedBy || log.details?.deletedBy || 'Admin')}</div>
                    </td>
                    <td>
                        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(log.userEmail || log.target || log.userId || '-')}</div>
                    </td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(log.status || 'success')}</span></td>
                    <td><button class="btn btn-secondary btn-log-details" type="button">Xem chi tiết</button></td>
                `;

                tr.querySelector('.btn-log-details').addEventListener('click', () => this.openLogDrawer(log));
                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    openLogDrawer(log) {
        const timestamp = log.timestamp || log.createdAt;
        const formattedTime = timestamp ? new Date(timestamp).toLocaleString('vi-VN') : 'N/A';
        const actor = log.actor || log.adminEmail || log.details?.updatedBy || log.details?.deletedBy || 'Admin';
        const target = log.userEmail || log.target || log.userId || '—';
        const rawLog = JSON.stringify(log, null, 2) || '{}';

        Drawer.open({
            title: 'Chi tiết nhật ký',
            subtitle: log.action || 'admin.action',
            contentHtml: `
                <div class="detail-grid">
                    <div class="detail-item"><span class="detail-label">Thời gian</span><span class="detail-value">${escapeHtml(formattedTime)}</span></div>
                    <div class="detail-item"><span class="detail-label">Trạng thái</span><span class="detail-value">${escapeHtml(log.status || 'success')}</span></div>
                    <div class="detail-item"><span class="detail-label">Người thực hiện</span><span class="detail-value">${escapeHtml(actor)}</span></div>
                    <div class="detail-item"><span class="detail-label">Đối tượng</span><span class="detail-value">${escapeHtml(target)}</span></div>
                    <div class="detail-item"><span class="detail-label">IP</span><span class="detail-value">${escapeHtml(log.ip || '—')}</span></div>
                    <div class="detail-item"><span class="detail-label">Log ID</span><span class="detail-value">${escapeHtml(log.id || '—')}</span></div>
                </div>
                <section class="drawer-section">
                    <div class="drawer-section-title">Dữ liệu đầy đủ</div>
                    <pre class="audit-log-json">${escapeHtml(rawLog)}</pre>
                </section>
            `,
            footerHtml: '<button class="btn btn-secondary" type="button" data-close-audit-log>Đóng</button>',
            onRender: (_body, footer) => {
                footer.querySelector('[data-close-audit-log]').addEventListener('click', () => Drawer.close());
            }
        });
    },

    handleClearLogs() {
        ConfirmModal.show({
            title: 'Xóa toàn bộ nhật ký kiểm toán',
            message: 'Bạn có chắc chắn muốn xóa toàn bộ lịch sử Audit Logs? Thao tác này không thể hoàn tác.',
            confirmText: 'Xóa toàn bộ',
            isDanger: true,
            onConfirm: async () => {
                try {
                    await AdminApi.clearAuditLogs();
                    Toast.success('Đã xóa sạch nhật ký kiểm toán.');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            }
        });
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
