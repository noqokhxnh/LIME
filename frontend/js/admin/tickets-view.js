/**
 * Helpdesk / Ticketing View
 * Xem và phản hồi các yêu cầu hỗ trợ (báo lỗi…) của người dùng ngay trong trang Admin.
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, Pagination, Skeleton, EmptyState, AlertBanner } from './components.js';

const STATUS_OPTIONS = [
    { value: 'open', label: 'Mới' },
    { value: 'in_progress', label: 'Đang xử lý' },
    { value: 'waiting_user', label: 'Chờ người dùng' },
    { value: 'resolved', label: 'Đã giải quyết' },
    { value: 'closed', label: 'Đã đóng' },
];

const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_BADGE = {
    open: 'badge-info',
    in_progress: 'badge-warning',
    waiting_user: 'badge-warning',
    resolved: 'badge-success',
    closed: 'badge',
};

const CATEGORY_OPTIONS = [
    { value: 'bug', label: 'Báo lỗi' },
    { value: 'feature_request', label: 'Đề xuất tính năng' },
    { value: 'billing', label: 'Thanh toán & gói cước' },
    { value: 'account', label: 'Tài khoản' },
    { value: 'render', label: 'Trình dựng video' },
    { value: 'other', label: 'Khác' },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label]));

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Thấp' },
    { value: 'normal', label: 'Trung bình' },
    { value: 'high', label: 'Cao' },
    { value: 'urgent', label: 'Khẩn cấp' },
];

const PRIORITY_LABELS = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]));
const PRIORITY_BADGE = {
    low: 'badge',
    normal: 'badge-info',
    high: 'badge-warning',
    urgent: 'badge-danger',
};

const SENDER_LABELS = {
    user: 'Người dùng',
    admin: 'Quản trị',
    system: 'Hệ thống',
};

export const TicketsView = {
    containerEl: null,
    searchDebounceTimer: null,
    popstateBound: false,

    async init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        await this.fetchAndRender();

        if (!this.popstateBound) {
            window.addEventListener('popstate', async () => {
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'tickets') {
                    clearTimeout(this.searchDebounceTimer);
                    this.renderStructure();
                    this.bindEvents();
                    await this.fetchAndRender();
                }
            });
            this.popstateBound = true;
        }
    },

    renderStructure() {
        const state = AdminState.getParamsFromUrl();

        const statusOptions = ['<option value="all">Mọi trạng thái</option>']
            .concat(STATUS_OPTIONS.map((s) => `<option value="${s.value}" ${state.status === s.value ? 'selected' : ''}>${s.label}</option>`))
            .join('');
        const categoryOptions = ['<option value="all">Mọi danh mục</option>']
            .concat(CATEGORY_OPTIONS.map((c) => `<option value="${c.value}" ${state.category === c.value ? 'selected' : ''}>${c.label}</option>`))
            .join('');
        const priorityOptions = ['<option value="all">Mọi mức ưu tiên</option>']
            .concat(PRIORITY_OPTIONS.map((p) => `<option value="${p.value}" ${state.priority === p.value ? 'selected' : ''}>${p.label}</option>`))
            .join('');

        this.containerEl.innerHTML = `
            <div class="views-kpi-grid">
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Mới</span></div>
                    <div class="views-kpi-value" id="kpi-tk-open">-</div>
                    <div class="views-kpi-sub">Yêu cầu chưa xử lý</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Đang xử lý</span></div>
                    <div class="views-kpi-value" id="kpi-tk-in_progress">-</div>
                    <div class="views-kpi-sub">Admin đã phản hồi</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Chờ người dùng</span></div>
                    <div class="views-kpi-value" id="kpi-tk-waiting_user">-</div>
                    <div class="views-kpi-sub">Cần người dùng xác nhận</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Hoàn tất</span></div>
                    <div class="views-kpi-value" id="kpi-tk-done">-</div>
                    <div class="views-kpi-sub">Đã giải quyết + đã đóng</div>
                </div>
            </div>

            <div class="filter-toolbar" style="margin-top: 20px;">
                <div class="filter-row-top" style="flex-wrap: wrap;">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="tk-search-input" placeholder="Tìm theo mã, tiêu đề hoặc email..." value="${escapeHtml(state.search || '')}">
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="tk-status-filter">${statusOptions}</select>
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="tk-category-filter">${categoryOptions}</select>
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="tk-priority-filter">${priorityOptions}</select>
                    </div>

                    <div style="margin-left: auto; display: flex; gap: 8px;">
                        <button class="btn btn-secondary" id="btn-tk-refresh" type="button">Làm mới</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Mã</th>
                                <th>Tiêu đề</th>
                                <th>Người gửi</th>
                                <th>Danh mục</th>
                                <th style="text-align:center;">Ưu tiên</th>
                                <th>Trạng thái</th>
                                <th>Cập nhật</th>
                                <th style="text-align:center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="tk-table-body"></tbody>
                    </table>
                </div>
                <div class="table-footer" id="tk-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = document.getElementById('tk-search-input');
        const statusFilter = document.getElementById('tk-status-filter');
        const categoryFilter = document.getElementById('tk-category-filter');
        const priorityFilter = document.getElementById('tk-priority-filter');
        const refreshBtn = document.getElementById('btn-tk-refresh');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    AdminState.setParams({ search: val, page: 1 });
                    this.fetchAndRender();
                }, 300);
            });
        }
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                AdminState.setParams({ status: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                AdminState.setParams({ category: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }
        if (priorityFilter) {
            priorityFilter.addEventListener('change', (e) => {
                AdminState.setParams({ priority: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.fetchAndRender();
                Toast.info('Đã làm mới danh sách yêu cầu.');
            });
        }
    },

    async fetchAndRender() {
        const tbody = document.getElementById('tk-table-body');
        if (!tbody) return;

        Skeleton.renderTableRows(tbody, 6, 7);

        const state = AdminState.getParamsFromUrl();
        const page = parseInt(state.page, 10) || 1;
        const limit = parseInt(state.limit, 10) || 25;

        try {
            const res = await AdminApi.getTickets({
                page,
                limit,
                search: state.search || '',
                status: state.status || 'all',
                category: state.category || 'all',
                priority: state.priority || 'all',
            });
            if (!res.success) throw new Error(res.error || 'Lỗi tải danh sách yêu cầu hỗ trợ.');

            this.renderStats(res.stats || {});
            this.renderTable(res.items || []);
            this.renderPagination(res.page, res.totalPages, res.total);
        } catch (err) {
            tbody.innerHTML = AlertBanner.rowHtml(8, {
                title: 'Không tải được danh sách yêu cầu hỗ trợ',
                message: err.message
            });
            AlertBanner.bindRetry(tbody, () => this.fetchAndRender());
        }
    },

    renderStats(stats) {
        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = Number(value || 0).toLocaleString();
        };
        set('kpi-tk-open', stats.open);
        set('kpi-tk-in_progress', stats.in_progress);
        set('kpi-tk-waiting_user', stats.waiting_user);
        set('kpi-tk-done', Number(stats.resolved || 0) + Number(stats.closed || 0));

        const navTag = document.getElementById('nav-tag-tickets');
        if (navTag) navTag.textContent = Number(stats.open || 0).toLocaleString();
    },

    renderTable(items) {
        const tbody = document.getElementById('tk-table-body');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = EmptyState.rowHtml(8, {
                title: 'Chưa có yêu cầu hỗ trợ nào',
                description: 'Các yêu cầu người dùng gửi từ widget "Hỗ trợ" sẽ xuất hiện tại đây.',
            });
            return;
        }

        tbody.innerHTML = items
            .map((item) => {
                const statusBadge = STATUS_BADGE[item.status] || 'badge';
                const priorityBadge = PRIORITY_BADGE[item.priority] || 'badge';
                return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size: 12.5px;">${escapeHtml(item.code)}</td>
                    <td style="max-width: 340px;">
                        <div style="font-weight: 600; font-size: 13px;">${escapeHtml(item.subject)}</div>
                    </td>
                    <td style="font-size: 12px; color: #64748b;">${escapeHtml(item.userEmail || '—')}</td>
                    <td style="font-size: 12px; color: #64748b;">${escapeHtml(CATEGORY_LABELS[item.category] || item.category)}</td>
                    <td style="text-align:center;"><span class="badge ${priorityBadge}">${escapeHtml(PRIORITY_LABELS[item.priority] || item.priority)}</span></td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
                    <td style="font-size: 12px; color: #64748b; white-space: nowrap;">${escapeHtml(formatDateTime(item.lastMessageAt))}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm btn-tk-open" data-id="${escapeHtml(item.id)}">Xem hội thoại</button>
                    </td>
                </tr>
            `;
            })
            .join('');

        tbody.querySelectorAll('.btn-tk-open').forEach((btn) =>
            btn.addEventListener('click', () => this.openDetail(btn.dataset.id))
        );
    },

    renderPagination(currentPage, totalPages, totalItems) {
        const container = document.getElementById('tk-pagination-container');
        if (!container) return;
        const state = AdminState.getParamsFromUrl();

        Pagination.render({
            container,
            page: currentPage,
            total: totalItems,
            limit: parseInt(state.limit, 10) || 25,
            onPageChange: (newPage) => {
                AdminState.setParams({ page: newPage });
                this.fetchAndRender();
            },
            onLimitChange: (newLimit) => {
                AdminState.setParams({ limit: newLimit, page: 1 });
                this.fetchAndRender();
            },
        });
    },

    async openDetail(id) {
        let ticket;
        try {
            const res = await AdminApi.getTicket(id);
            if (!res.success) throw new Error(res.error || 'Không tải được yêu cầu hỗ trợ.');
            ticket = res.ticket;
        } catch (err) {
            Toast.error(err.message);
            return;
        }

        const statusOptions = STATUS_OPTIONS
            .map((s) => `<option value="${s.value}" ${ticket.status === s.value ? 'selected' : ''}>${s.label}</option>`)
            .join('');
        const priorityOptions = PRIORITY_OPTIONS
            .map((p) => `<option value="${p.value}" ${ticket.priority === p.value ? 'selected' : ''}>${p.label}</option>`)
            .join('');

        Drawer.open({
            title: `Yêu cầu hỗ trợ ${ticket.code}`,
            subtitle: `${escapeHtml(ticket.subject)} — ${escapeHtml(ticket.userEmail || '')}`,
            contentHtml: `
                <div class="tk-detail-meta">
                    <span class="badge ${statusBadge(ticket.status)}">${escapeHtml(STATUS_LABELS[ticket.status] || ticket.status)}</span>
                    <span class="badge ${PRIORITY_BADGE[ticket.priority] || 'badge'}">${escapeHtml(PRIORITY_LABELS[ticket.priority] || ticket.priority)}</span>
                    <span class="badge">${escapeHtml(CATEGORY_LABELS[ticket.category] || ticket.category)}</span>
                    <span style="font-size: 12px; color: #64748b;">Tạo: ${escapeHtml(formatDateTime(ticket.createdAt))}</span>
                </div>
                <div class="tk-thread" id="tk-thread">${this.renderMessages(ticket)}</div>
                <div class="form-group">
                    <label class="form-label">Cập nhật yêu cầu</label>
                    <div class="tk-controls-row">
                        <select class="select-custom" id="tk-f-status">${statusOptions}</select>
                        <select class="select-custom" id="tk-f-priority">${priorityOptions}</select>
                        <button class="btn btn-secondary" id="btn-tk-apply" type="button">Cập nhật</button>
                    </div>
                </div>
            `,
            footerHtml: `
                <div class="tk-reply-box">
                    <textarea class="form-input" id="tk-reply-input" rows="3" maxlength="5000" placeholder="Phản hồi của bạn cho người dùng..."></textarea>
                    <div class="tk-reply-actions">
                        <label class="tk-internal-note">
                            <input type="checkbox" id="tk-internal-note"> Ghi chú nội bộ
                        </label>
                        <span style="flex: 1;"></span>
                        <button class="btn btn-primary" id="btn-tk-reply" type="button">Gửi phản hồi</button>
                    </div>
                </div>
            `,
            onRender: (_body, footer) => {
                const replyInput = document.getElementById('tk-reply-input');
                const replyBtn = document.getElementById('btn-tk-reply');
                const internalNote = document.getElementById('tk-internal-note');
                const applyBtn = document.getElementById('btn-tk-apply');

                if (replyBtn) {
                    replyBtn.addEventListener('click', async () => {
                        const text = replyInput?.value.trim() || '';
                        if (!text) return Toast.error('Vui lòng nhập nội dung phản hồi.');

                        replyBtn.disabled = true;
                        try {
                            const res = await AdminApi.replyTicket(ticket.id, {
                                body: text,
                                isInternal: Boolean(internalNote?.checked),
                            });
                            if (res.success) {
                                Toast.success(internalNote?.checked ? 'Đã thêm ghi chú nội bộ.' : 'Đã gửi phản hồi.');
                                Drawer.close();
                                this.openDetail(ticket.id);
                            } else {
                                throw new Error(res.error || 'Không gửi được phản hồi.');
                            }
                        } catch (err) {
                            Toast.error(err.message || 'Không gửi được phản hồi.');
                            replyBtn.disabled = false;
                        }
                    });
                }

                if (applyBtn) {
                    applyBtn.addEventListener('click', async () => {
                        const status = document.getElementById('tk-f-status')?.value;
                        const priority = document.getElementById('tk-f-priority')?.value;
                        applyBtn.disabled = true;
                        try {
                            const res = await AdminApi.updateTicket(ticket.id, { status, priority });
                            if (res.success) {
                                Toast.success('Đã cập nhật yêu cầu hỗ trợ.');
                                Drawer.close();
                                this.fetchAndRender();
                            } else {
                                throw new Error(res.error || 'Không cập nhật được yêu cầu.');
                            }
                        } catch (err) {
                            Toast.error(err.message || 'Không cập nhật được yêu cầu.');
                            applyBtn.disabled = false;
                        }
                    });
                }
            },
        });
    },

    renderMessages(ticket) {
        return (ticket.messages || [])
            .map((m) => {
                const cls = m.senderType === 'user' ? 'tk-bubble--user' : (m.senderType === 'system' ? 'tk-bubble--system' : 'tk-bubble--admin');
                const attachments = (m.attachments || [])
                    .map((a) => `<img src="${escapeHtml(a.url)}" alt="Ảnh đính kèm" style="max-width: 160px; border-radius: 8px; cursor: pointer;" onclick="window.open(this.src, '_blank')">`)
                    .join('');
                return `
                    <div class="tk-msg ${m.senderType === 'user' ? 'tk-msg--user' : ''}">
                        <div class="tk-msg-meta">${escapeHtml(SENDER_LABELS[m.senderType] || m.senderType)}${m.senderEmail ? ' · ' + escapeHtml(m.senderEmail) : ''} · ${escapeHtml(formatDateTime(m.createdAt))}</div>
                        <div class="tk-bubble ${cls}" style="white-space: pre-wrap;">${escapeHtml(m.body)}</div>
                        ${attachments ? `<div class="tk-msg-attachments">${attachments}</div>` : ''}
                        ${m.isInternal ? '<div class="badge badge-warning" style="margin-top: 4px;">Ghi chú nội bộ — người dùng không thấy</div>' : ''}
                    </div>
                `;
            })
            .join('');
    },
};

function statusBadge(status) {
    return STATUS_BADGE[status] || 'badge';
}

function formatDateTime(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
        return iso;
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
