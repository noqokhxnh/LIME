/**
 * Audit Logs View
 *
 * Nhật ký kiểm toán bảo mật & lịch sử thao tác của Admin.
 * Hỗ trợ tìm kiếm, lọc theo trạng thái/hành động/khoảng thời gian và phân trang.
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, ConfirmModal, Skeleton, EmptyState, Pagination } from './components.js';

/** Trả về email/danh tính người THỰC HIỆN hành động. */
function actorOf(log) {
    if (log.actorEmail) return log.actorEmail;
    const details = log.details || {};
    const byKey = Object.keys(details).find((key) => /By$/.test(key) && typeof details[key] === 'string');
    if (byKey) return details[byKey];
    if (log.adminEmail || log.actor) return log.adminEmail || log.actor;
    // Sự kiện xác thực: chính người dùng là người thực hiện.
    if (typeof log.action === 'string' && log.action.startsWith('auth.')) return log.userEmail || log.userId || 'Hệ thống';
    return 'Hệ thống';
}

/** Trả về đối tượng bị tác động (người dùng/đơn hàng/job...). */
function targetOf(log) {
    const details = log.details || {};
    const explicit = details.targetEmail || details.targetUserId || details.email;
    if (explicit) return explicit;
    if (log.action && !String(log.action).startsWith('auth.')) {
        if (log.userEmail || log.userId) return log.userEmail || log.userId;
    }
    return details.jobId || details.orderId || details.unmatchedId || log.userEmail || log.userId || '—';
}

export const LogsView = {
    containerEl: null,
    searchDebounceTimer: null,

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        this.fetchAndRender();
    },

    renderStructure() {
        const state = AdminState.getParamsFromUrl();

        this.containerEl.innerHTML = `
            <div class="filter-toolbar">
                <div class="filter-row-top">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="log-search-input" placeholder="Tìm theo hành động, email, IP hoặc nội dung chi tiết..." value="${escapeHtml(state.search)}">
                        <button class="search-clear-btn" id="log-search-clear-btn" style="display: ${state.search ? 'block' : 'none'};">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Trạng thái:</span>
                            <select class="select-custom" id="filter-log-status">
                                <option value="all" ${state.logStatus === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="success" ${state.logStatus === 'success' ? 'selected' : ''}>Thành công</option>
                                <option value="warning" ${state.logStatus === 'warning' ? 'selected' : ''}>Cảnh báo</option>
                                <option value="failure" ${state.logStatus === 'failure' ? 'selected' : ''}>Thất bại</option>
                            </select>
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Hành động:</span>
                            <input type="text" class="select-custom" id="filter-log-action" placeholder="vd: admin.user_update" value="${escapeHtml(state.action)}">
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Từ ngày:</span>
                            <input type="date" class="select-custom" id="filter-log-from" value="${escapeHtml(state.from)}">
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Đến ngày:</span>
                            <input type="date" class="select-custom" id="filter-log-to" value="${escapeHtml(state.to)}">
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-reset-logs">Đặt lại</button>
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
                                <th>IP</th>
                                <th>Đối tượng</th>
                                <th style="width: 110px;">Trạng thái</th>
                                <th style="width: 120px;">Chi tiết</th>
                            </tr>
                        </thead>
                        <tbody id="logs-table-body"></tbody>
                    </table>
                </div>
                <div id="logs-empty-container"></div>
                <div id="logs-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = this.containerEl.querySelector('#log-search-input');
        const clearBtn = this.containerEl.querySelector('#log-search-clear-btn');
        const statusSelect = this.containerEl.querySelector('#filter-log-status');
        const actionInput = this.containerEl.querySelector('#filter-log-action');
        const fromInput = this.containerEl.querySelector('#filter-log-from');
        const toInput = this.containerEl.querySelector('#filter-log-to');

        searchInput.oninput = (e) => {
            const val = e.target.value;
            clearBtn.style.display = val ? 'block' : 'none';
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                AdminState.setParams({ search: val, page: 1 });
                this.fetchAndRender();
            }, 300);
        };

        clearBtn.onclick = () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            AdminState.setParams({ search: '', page: 1 });
            this.fetchAndRender();
        };

        statusSelect.onchange = (e) => {
            AdminState.setParams({ logStatus: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        actionInput.oninput = (e) => {
            clearTimeout(this.actionDebounceTimer);
            this.actionDebounceTimer = setTimeout(() => {
                AdminState.setParams({ action: e.target.value, page: 1 });
                this.fetchAndRender();
            }, 300);
        };

        fromInput.onchange = (e) => {
            AdminState.setParams({ from: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        toInput.onchange = (e) => {
            AdminState.setParams({ to: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        this.containerEl.querySelector('#btn-refresh-logs').onclick = () => this.fetchAndRender();
        this.containerEl.querySelector('#btn-reset-logs').onclick = () => {
            AdminState.setParams({ search: '', action: '', from: '', to: '', logStatus: 'all', page: 1 });
            this.renderStructure();
            this.bindEvents();
            this.fetchAndRender();
        };
        this.containerEl.querySelector('#btn-clear-logs').onclick = () => this.handleClearLogs();
    },

    /** Chuyển bộ lọc trong URL thành tham số gọi API. */
    buildQuery() {
        const params = AdminState.getParamsFromUrl();
        const query = { limit: params.limit, page: params.page };

        if (params.search) query.search = params.search;
        if (params.logStatus && params.logStatus !== 'all') query.status = params.logStatus;
        if (params.action) query.action = params.action;
        if (params.from) {
            const d = new Date(`${params.from}T00:00:00`);
            if (!Number.isNaN(d.getTime())) query.from = d.toISOString();
        }
        if (params.to) {
            const d = new Date(`${params.to}T23:59:59.999`);
            if (!Number.isNaN(d.getTime())) query.to = d.toISOString();
        }
        return query;
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#logs-table-body');
        const emptyContainer = this.containerEl.querySelector('#logs-empty-container');
        const paginationContainer = this.containerEl.querySelector('#logs-pagination-container');
        emptyContainer.innerHTML = '';

        Skeleton.renderTableRows(tbody, 8, 7);

        const params = AdminState.getParamsFromUrl();
        const hasFilter = Boolean(params.search || params.action || params.from || params.to || (params.logStatus && params.logStatus !== 'all'));

        try {
            const res = await AdminApi.getAuditLogs(this.buildQuery());
            const logs = res.logs || [];
            const total = Number(res.total ?? logs.length);

            if (logs.length === 0) {
                tbody.innerHTML = '';
                paginationContainer.innerHTML = '';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không có nhật ký nào',
                        description: hasFilter
                            ? 'Không có bản ghi nào khớp với tiêu chí tìm kiếm và bộ lọc hiện tại.'
                            : 'Hệ thống chưa ghi nhận sự kiện kiểm toán nào.',
                        actionText: hasFilter ? 'Đặt lại bộ lọc' : null,
                        onAction: () => {
                            AdminState.setParams({ search: '', action: '', from: '', to: '', logStatus: 'all', page: 1 });
                            this.renderStructure();
                            this.bindEvents();
                            this.fetchAndRender();
                        }
                    })
                );
                return;
            }

            this.renderTableRows(tbody, logs);

            Pagination.render({
                container: paginationContainer,
                page: params.page,
                limit: params.limit,
                total,
                onPageChange: (newPage) => {
                    AdminState.setParams({ page: newPage });
                    this.fetchAndRender();
                },
                onLimitChange: (newLimit) => {
                    AdminState.setParams({ limit: newLimit, page: 1 });
                    this.fetchAndRender();
                }
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    renderTableRows(tbody, logs) {
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
                <td><div style="font-size: 12px; color: var(--text-main);">${escapeHtml(actorOf(log))}</div></td>
                <td><div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(log.ip || '—')}</div></td>
                <td><div style="font-size: 12px; color: var(--text-muted);" class="audit-break-word">${escapeHtml(targetOf(log))}</div></td>
                <td><span class="badge ${statusBadge}">${escapeHtml(log.status || 'success')}</span></td>
                <td><button class="btn btn-secondary btn-log-details" type="button">Xem chi tiết</button></td>
            `;

            tr.querySelector('.btn-log-details').addEventListener('click', () => this.openLogDrawer(log));
            tbody.appendChild(tr);
        });
    },

    openLogDrawer(log) {
        const timestamp = log.timestamp || log.createdAt;
        const formattedTime = timestamp ? new Date(timestamp).toLocaleString('vi-VN') : 'N/A';
        const rawLog = JSON.stringify(log, null, 2) || '{}';

        Drawer.open({
            title: 'Chi tiết nhật ký',
            subtitle: log.action || 'admin.action',
            contentHtml: `
                <div class="detail-grid">
                    <div class="detail-item"><span class="detail-label">Thời gian</span><span class="detail-value">${escapeHtml(formattedTime)}</span></div>
                    <div class="detail-item"><span class="detail-label">Trạng thái</span><span class="detail-value">${escapeHtml(log.status || 'success')}</span></div>
                    <div class="detail-item"><span class="detail-label">Người thực hiện</span><span class="detail-value">${escapeHtml(actorOf(log))}</span></div>
                    <div class="detail-item"><span class="detail-label">Đối tượng</span><span class="detail-value">${escapeHtml(targetOf(log))}</span></div>
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
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
