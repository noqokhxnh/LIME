/**
 * System Broadcast Banner Management View
 * Tạo và quản lý thông báo hiển thị cho toàn bộ người dùng (bảo trì, ra mắt tính năng…)
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, ConfirmModal, Pagination, Skeleton, EmptyState, AlertBanner } from './components.js';

const KIND_OPTIONS = [
    { value: 'info', label: 'Thông báo chung' },
    { value: 'feature', label: 'Ra mắt tính năng mới' },
    { value: 'warning', label: 'Cảnh báo' },
    { value: 'maintenance', label: 'Bảo trì' },
];

const KIND_LABELS = {
    info: 'Thông báo',
    feature: 'Tính năng mới',
    warning: 'Cảnh báo',
    maintenance: 'Bảo trì',
};

const KIND_BADGE = {
    info: 'badge-info',
    feature: 'badge-success',
    warning: 'badge-warning',
    maintenance: 'badge-danger',
};

const STATUS_LABELS = {
    active: 'Đang hiển thị',
    scheduled: 'Đã lên lịch',
    expired: 'Hết hạn',
    draft: 'Đã tắt',
};

const STATUS_BADGE = {
    active: 'badge-success',
    scheduled: 'badge-info',
    expired: 'badge',
    draft: 'badge-warning',
};

const AUDIENCE_LABELS = {
    all: 'Tất cả',
    users: 'Người dùng đã đăng nhập',
    guests: 'Khách chưa đăng nhập',
};

export const AnnouncementsView = {
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
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'announcements') {
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
        const kindOptions = ['<option value="all">Tất cả loại</option>']
            .concat(KIND_OPTIONS.map((k) => `<option value="${k.value}" ${state.kind === k.value ? 'selected' : ''}>${k.label}</option>`))
            .join('');

        this.containerEl.innerHTML = `
            <div class="views-kpi-grid">
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Đang hiển thị</span></div>
                    <div class="views-kpi-value" id="kpi-ann-active">-</div>
                    <div class="views-kpi-sub">Banner đang tới người dùng</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Đã lên lịch</span></div>
                    <div class="views-kpi-value" id="kpi-ann-scheduled">-</div>
                    <div class="views-kpi-sub">Chờ tới thời điểm bắt đầu</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Hết hạn</span></div>
                    <div class="views-kpi-value" id="kpi-ann-expired">-</div>
                    <div class="views-kpi-sub">Đã qua thời điểm kết thúc</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Tổng thông báo</span></div>
                    <div class="views-kpi-value" id="kpi-ann-total">-</div>
                    <div class="views-kpi-sub">Bao gồm cả bản đã tắt</div>
                </div>
            </div>

            <div class="filter-toolbar" style="margin-top: 20px;">
                <div class="filter-row-top" style="flex-wrap: wrap;">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="ann-search-input" placeholder="Tìm theo tiêu đề hoặc nội dung..." value="${escapeHtml(state.search || '')}">
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="ann-status-filter">
                            <option value="all" ${state.status === 'all' ? 'selected' : ''}>Mọi trạng thái</option>
                            <option value="active" ${state.status === 'active' ? 'selected' : ''}>Đang hiển thị</option>
                            <option value="scheduled" ${state.status === 'scheduled' ? 'selected' : ''}>Đã lên lịch</option>
                            <option value="expired" ${state.status === 'expired' ? 'selected' : ''}>Hết hạn</option>
                            <option value="draft" ${state.status === 'draft' ? 'selected' : ''}>Đã tắt</option>
                        </select>
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="ann-kind-filter">${kindOptions}</select>
                    </div>

                    <div style="margin-left: auto; display: flex; gap: 8px;">
                        <button class="btn btn-secondary" id="btn-ann-refresh" type="button">Làm mới</button>
                        <button class="btn btn-primary" id="btn-ann-create" type="button">+ Tạo thông báo</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Thông báo</th>
                                <th>Loại</th>
                                <th>Đối tượng</th>
                                <th>Lịch chạy</th>
                                <th style="text-align:center;">Ưu tiên</th>
                                <th>Trạng thái</th>
                                <th style="text-align:center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="ann-table-body"></tbody>
                    </table>
                </div>
                <div class="table-footer" id="ann-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = document.getElementById('ann-search-input');
        const statusFilter = document.getElementById('ann-status-filter');
        const kindFilter = document.getElementById('ann-kind-filter');
        const refreshBtn = document.getElementById('btn-ann-refresh');
        const createBtn = document.getElementById('btn-ann-create');

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

        if (kindFilter) {
            kindFilter.addEventListener('change', (e) => {
                AdminState.setParams({ kind: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.fetchAndRender();
                Toast.info('Đã làm mới danh sách thông báo.');
            });
        }

        if (createBtn) {
            createBtn.addEventListener('click', () => this.openForm(null));
        }
    },

    async fetchAndRender() {
        const tbody = document.getElementById('ann-table-body');
        if (!tbody) return;

        Skeleton.renderTableRows(tbody, 6, 6);

        const state = AdminState.getParamsFromUrl();
        const page = parseInt(state.page, 10) || 1;
        const limit = parseInt(state.limit, 10) || 25;

        try {
            const res = await AdminApi.getAnnouncements({
                page,
                limit,
                search: state.search || '',
                status: state.status || 'all',
                kind: state.kind || 'all',
            });
            if (!res.success) throw new Error(res.error || 'Lỗi tải danh sách thông báo.');

            this.renderStats(res.stats || {});
            this.renderTable(res.items || []);
            this.renderPagination(res.page, res.totalPages, res.total);
        } catch (err) {
            tbody.innerHTML = AlertBanner.rowHtml(7, {
                title: 'Không tải được danh sách thông báo',
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
        set('kpi-ann-active', stats.active);
        set('kpi-ann-scheduled', stats.scheduled);
        set('kpi-ann-expired', stats.expired);
        set('kpi-ann-total', stats.total);

        const navTag = document.getElementById('nav-tag-announcements');
        if (navTag) navTag.textContent = Number(stats.active || 0).toLocaleString();
    },

    renderTable(items) {
        const tbody = document.getElementById('ann-table-body');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = EmptyState.rowHtml(7, {
                title: 'Chưa có thông báo nào',
                description: 'Tạo thông báo đầu tiên để hiển thị banner tới toàn bộ người dùng.',
                actionText: 'Tạo thông báo',
            });
            EmptyState.bindAction(tbody, () => this.openForm(null));
            return;
        }

        tbody.innerHTML = items
            .map((item) => {
                const kindBadge = KIND_BADGE[item.kind] || 'badge-info';
                const statusBadge = STATUS_BADGE[item.status] || 'badge';
                return `
                <tr>
                    <td style="max-width: 320px;">
                        <div style="font-weight: 600; font-size: 13px;">${escapeHtml(item.title)}</div>
                        <div style="font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.body)}">${escapeHtml(item.body)}</div>
                    </td>
                    <td><span class="badge ${kindBadge}">${escapeHtml(KIND_LABELS[item.kind] || item.kind)}</span></td>
                    <td style="font-size: 12px; color: #64748b;">${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</td>
                    <td style="font-size: 12px;">
                        <div>Bắt đầu: ${escapeHtml(formatDateTime(item.startsAt) || 'Ngay')}</div>
                        <div style="color: #94a3b8;">Kết thúc: ${escapeHtml(formatDateTime(item.endsAt) || 'Không')}</div>
                    </td>
                    <td style="text-align:center; font-family: var(--font-mono); font-size: 13px;">${Number(item.priority) || 0}</td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span></td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm btn-ann-edit" data-id="${escapeHtml(item.id)}">Sửa</button>
                        <button class="btn btn-secondary btn-sm btn-ann-toggle" data-id="${escapeHtml(item.id)}">${item.isActive ? 'Tắt' : 'Bật'}</button>
                        <button class="btn btn-danger btn-sm btn-ann-delete" data-id="${escapeHtml(item.id)}">Xóa</button>
                    </td>
                </tr>
            `;
            })
            .join('');

        tbody.querySelectorAll('.btn-ann-edit').forEach((btn) =>
            btn.addEventListener('click', () => {
                const found = items.find((x) => x.id === btn.dataset.id);
                if (found) this.openForm(found);
            })
        );

        tbody.querySelectorAll('.btn-ann-toggle').forEach((btn) =>
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const res = await AdminApi.toggleAnnouncement(btn.dataset.id);
                    Toast.success(res.announcement?.isActive ? 'Đã bật thông báo.' : 'Đã tắt thông báo.');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(err.message || 'Không đổi được trạng thái thông báo.');
                    btn.disabled = false;
                }
            })
        );

        tbody.querySelectorAll('.btn-ann-delete').forEach((btn) =>
            btn.addEventListener('click', () => {
                const found = items.find((x) => x.id === btn.dataset.id);
                ConfirmModal.show({
                    title: 'Xóa thông báo?',
                    message: `Bạn có chắc muốn xóa thông báo "${escapeHtml(found?.title || '')}"? Thao tác này không thể hoàn tác.`,
                    confirmText: 'Xác nhận xóa',
                    isDanger: true,
                    onConfirm: async () => {
                        try {
                            await AdminApi.deleteAnnouncement(btn.dataset.id);
                            Toast.success('Đã xóa thông báo.');
                            this.fetchAndRender();
                        } catch (err) {
                            Toast.error(err.message || 'Không xóa được thông báo.');
                        }
                    },
                });
            })
        );
    },

    renderPagination(currentPage, totalPages, totalItems) {
        const container = document.getElementById('ann-pagination-container');
        if (!container) return;

        Pagination.render({
            container,
            currentPage,
            totalPages,
            totalItems,
            onPageChange: (newPage) => {
                AdminState.setParams({ page: newPage });
                this.fetchAndRender();
            },
        });
    },

    openForm(item) {
        const isEdit = Boolean(item);
        const value = {
            title: item?.title || '',
            body: item?.body || '',
            kind: item?.kind || 'info',
            audience: item?.audience || 'all',
            priority: item?.priority ?? 0,
            isActive: item ? item.isActive : true,
            dismissible: item ? item.dismissible : true,
            startsAt: toLocalInput(item?.startsAt),
            endsAt: toLocalInput(item?.endsAt),
            linkUrl: item?.linkUrl || '',
            linkLabel: item?.linkLabel || '',
        };

        const kindOptions = KIND_OPTIONS.map(
            (k) => `<option value="${k.value}" ${value.kind === k.value ? 'selected' : ''}>${k.label}</option>`
        ).join('');

        Drawer.open({
            title: isEdit ? 'Chỉnh sửa thông báo' : 'Tạo thông báo mới',
            subtitle: 'Banner hiển thị trực tiếp trên màn hình toàn bộ người dùng.',
            contentHtml: `
                <div class="ann-form">
                    <div class="form-group">
                        <label class="form-label" for="ann-f-title">Tiêu đề</label>
                        <input type="text" class="form-input" id="ann-f-title" maxlength="160" value="${escapeHtml(value.title)}" placeholder="Ví dụ: Bảo trì hệ thống định kỳ">
                    </div>

                    <div class="ann-form-grid">
                        <div class="form-group">
                            <label class="form-label" for="ann-f-kind">Loại thông báo</label>
                            <select class="select-custom" id="ann-f-kind">${kindOptions}</select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="ann-f-audience">Đối tượng hiển thị</label>
                            <select class="select-custom" id="ann-f-audience">
                                <option value="all" ${value.audience === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="users" ${value.audience === 'users' ? 'selected' : ''}>Người dùng đã đăng nhập</option>
                                <option value="guests" ${value.audience === 'guests' ? 'selected' : ''}>Khách chưa đăng nhập</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="ann-f-body">Nội dung</label>
                        <textarea class="form-input" id="ann-f-body" rows="4" maxlength="2000" placeholder="Nội dung ngắn gọn hiển thị cho người dùng...">${escapeHtml(value.body)}</textarea>
                    </div>

                    <div class="ann-form-grid">
                        <div class="form-group">
                            <label class="form-label" for="ann-f-start">Bắt đầu hiệu lực</label>
                            <input type="datetime-local" class="form-input" id="ann-f-start" value="${escapeHtml(value.startsAt)}">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="ann-f-end">Kết thúc hiệu lực</label>
                            <input type="datetime-local" class="form-input" id="ann-f-end" value="${escapeHtml(value.endsAt)}">
                        </div>
                    </div>

                    <div class="ann-form-grid">
                        <div class="form-group">
                            <label class="form-label" for="ann-f-priority">Mức ưu tiên (0 - 1000)</label>
                            <input type="number" class="form-input" id="ann-f-priority" min="0" max="1000" step="1" value="${Number(value.priority) || 0}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Tùy chọn</label>
                            <div class="ann-checkbox-row">
                                <label class="ann-checkbox"><input type="checkbox" id="ann-f-active" ${value.isActive ? 'checked' : ''}> Bật hiển thị</label>
                                <label class="ann-checkbox"><input type="checkbox" id="ann-f-dismissible" ${value.dismissible ? 'checked' : ''}> Cho phép người dùng đóng</label>
                            </div>
                        </div>
                    </div>

                    <div class="ann-form-grid">
                        <div class="form-group">
                            <label class="form-label" for="ann-f-link">Liên kết (tùy chọn)</label>
                            <input type="text" class="form-input" id="ann-f-link" maxlength="500" value="${escapeHtml(value.linkUrl)}" placeholder="/workspace hoặc https://...">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="ann-f-link-label">Nhãn liên kết</label>
                            <input type="text" class="form-input" id="ann-f-link-label" maxlength="80" value="${escapeHtml(value.linkLabel)}" placeholder="Xem chi tiết">
                        </div>
                    </div>
                </div>
            `,
            footerHtml: `
                <button class="btn btn-secondary" id="ann-f-cancel" type="button">Hủy</button>
                <button class="btn btn-primary" id="ann-f-save" type="button">${isEdit ? 'Lưu thay đổi' : 'Tạo thông báo'}</button>
            `,
            onRender: (_body, footer) => {
                const cancelBtn = footer.querySelector('#ann-f-cancel');
                const saveBtn = footer.querySelector('#ann-f-save');
                if (cancelBtn) cancelBtn.addEventListener('click', () => Drawer.close());
                if (saveBtn) saveBtn.addEventListener('click', () => this.submitForm(item?.id, saveBtn));
            },
        });
    },

    async submitForm(id, saveBtn) {
        const read = (fieldId) => document.getElementById(fieldId);
        const title = read('ann-f-title')?.value.trim() || '';
        const body = read('ann-f-body')?.value.trim() || '';

        if (!title) return Toast.error('Vui lòng nhập tiêu đề thông báo.');
        if (!body) return Toast.error('Vui lòng nhập nội dung thông báo.');

        const startRaw = read('ann-f-start')?.value || '';
        const endRaw = read('ann-f-end')?.value || '';

        const payload = {
            title,
            body,
            kind: read('ann-f-kind')?.value || 'info',
            audience: read('ann-f-audience')?.value || 'all',
            priority: Number(read('ann-f-priority')?.value || 0),
            isActive: Boolean(read('ann-f-active')?.checked),
            dismissible: Boolean(read('ann-f-dismissible')?.checked),
            startsAt: startRaw ? new Date(startRaw).toISOString() : null,
            endsAt: endRaw ? new Date(endRaw).toISOString() : null,
            linkUrl: read('ann-f-link')?.value.trim() || null,
            linkLabel: read('ann-f-link-label')?.value.trim() || null,
        };

        saveBtn.disabled = true;
        const original = saveBtn.textContent;
        saveBtn.textContent = 'Đang lưu...';

        try {
            if (id) {
                await AdminApi.updateAnnouncement(id, payload);
                Toast.success('Đã cập nhật thông báo.');
            } else {
                await AdminApi.createAnnouncement(payload);
                Toast.success('Đã tạo thông báo mới.');
            }
            Drawer.close();
            this.fetchAndRender();
        } catch (err) {
            Toast.error(err.message || 'Không lưu được thông báo.');
            saveBtn.disabled = false;
            saveBtn.textContent = original;
        }
    },
};

function formatDateTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
        return iso;
    }
}

/** Chuyển ISO -> giá trị cho <input type="datetime-local"> theo giờ địa phương. */
function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
