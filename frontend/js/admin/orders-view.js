/**
 * Orders Management View
 * Quản lý giao dịch nạp credits & đăng ký gói: tìm kiếm, lọc trạng thái,
 * phân trang phía server, duyệt nạp và hủy đơn.
 */

import { AdminApi } from './api.js';
import { Toast, ConfirmModal, Pagination, Skeleton, EmptyState } from './components.js';

const ORDER_STATUS_LABEL = {
    pending: 'Chờ thanh toán',
    claimed: 'Đã xác nhận CK',
    paid: 'Đã thanh toán',
    expired: 'Hết hạn',
    cancelled: 'Đã hủy',
};

const ORDER_STATUS_BADGE = {
    pending: 'badge-warning',
    claimed: 'badge-info',
    paid: 'badge-success',
    expired: 'badge-danger',
    cancelled: 'badge-neutral',
};

/** Trạng thái admin được phép duyệt nạp thủ công. */
const FULFILLABLE = new Set(['pending', 'claimed', 'expired']);
/** Trạng thái admin được phép hủy (khớp ràng buộc của billingStorage.cancelOrder). */
const CANCELLABLE = new Set(['pending', 'claimed']);

export const OrdersView = {
    containerEl: null,
    filters: { search: '', status: 'all', page: 1, limit: 25 },
    totalRecords: 0,
    searchDebounceTimer: null,

    init(container) {
        this.containerEl = container;
        this.filters = { search: '', status: 'all', page: 1, limit: 25 };
        this.renderStructure();
        this.bindEvents();
        this.fetchAndRender();
    },

    renderStructure() {
        const { search, status } = this.filters;

        this.containerEl.innerHTML = `
            <div class="filter-toolbar">
                <div class="filter-row-top">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="order-search-input" placeholder="Tìm theo mã đơn, ID đơn, ID người dùng hoặc email khách hàng..." value="${escapeHtml(search)}">
                        <button class="search-clear-btn" id="order-search-clear-btn" style="display: ${search ? 'block' : 'none'};">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Trạng thái:</span>
                            <select class="select-custom" id="filter-order-status">
                                <option value="all" ${status === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="pending" ${status === 'pending' ? 'selected' : ''}>Chờ thanh toán</option>
                                <option value="claimed" ${status === 'claimed' ? 'selected' : ''}>Đã xác nhận CK</option>
                                <option value="paid" ${status === 'paid' ? 'selected' : ''}>Đã thanh toán</option>
                                <option value="expired" ${status === 'expired' ? 'selected' : ''}>Hết hạn</option>
                                <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Đã hủy</option>
                            </select>
                        </div>
                        <span class="filter-label" id="orders-total-label"></span>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-orders">Làm mới</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Mã đơn</th>
                                <th>Khách hàng</th>
                                <th>Gói cước</th>
                                <th>Số tiền (VNĐ)</th>
                                <th>Hạn mức</th>
                                <th>Thời gian</th>
                                <th>Trạng thái</th>
                                <th style="text-align: center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="orders-table-body"></tbody>
                    </table>
                </div>
                <div id="orders-empty-container"></div>
                <div id="orders-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = this.containerEl.querySelector('#order-search-input');
        const clearBtn = this.containerEl.querySelector('#order-search-clear-btn');
        const statusSelect = this.containerEl.querySelector('#filter-order-status');
        const refreshBtn = this.containerEl.querySelector('#btn-refresh-orders');

        searchInput.oninput = (e) => {
            const val = e.target.value;
            clearBtn.style.display = val ? 'block' : 'none';
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.filters.search = val.trim();
                this.filters.page = 1;
                this.fetchAndRender();
            }, 300);
        };

        clearBtn.onclick = () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            this.filters.search = '';
            this.filters.page = 1;
            this.fetchAndRender();
        };

        statusSelect.onchange = (e) => {
            this.filters.status = e.target.value;
            this.filters.page = 1;
            this.fetchAndRender();
        };

        refreshBtn.onclick = () => {
            this.fetchAndRender();
            Toast.info('Đang làm mới danh sách đơn hàng...');
        };
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#orders-table-body');
        const emptyContainer = this.containerEl.querySelector('#orders-empty-container');
        const paginationContainer = this.containerEl.querySelector('#orders-pagination-container');
        const totalLabel = this.containerEl.querySelector('#orders-total-label');

        emptyContainer.innerHTML = '';
        paginationContainer.innerHTML = '';
        Skeleton.renderTableRows(tbody, 5, 8);

        try {
            const res = await AdminApi.getOrders({
                search: this.filters.search,
                status: this.filters.status,
                page: this.filters.page,
                limit: this.filters.limit,
            });

            const orders = res.orders || [];
            this.totalRecords = res.total || 0;

            if (totalLabel) {
                totalLabel.textContent = this.totalRecords > 0 ? `Tổng ${this.totalRecords.toLocaleString('vi-VN')} đơn hàng` : '';
            }

            if (orders.length === 0) {
                tbody.innerHTML = '';
                const hasFilters = Boolean(this.filters.search) || this.filters.status !== 'all';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không có đơn hàng nào',
                        description: hasFilters
                            ? 'Không tìm thấy đơn hàng khớp với bộ lọc hiện tại.'
                            : 'Hệ thống chưa ghi nhận đơn thanh toán nào.',
                        actionText: hasFilters ? 'Đặt lại bộ lọc' : null,
                        onAction: hasFilters
                            ? () => {
                                this.filters = { search: '', status: 'all', page: 1, limit: this.filters.limit };
                                this.renderStructure();
                                this.bindEvents();
                                this.fetchAndRender();
                            }
                            : null,
                    })
                );
                return;
            }

            this.renderTableRows(tbody, orders);

            Pagination.render({
                container: paginationContainer,
                page: this.filters.page,
                limit: this.filters.limit,
                total: this.totalRecords,
                onPageChange: (newPage) => {
                    this.filters.page = newPage;
                    this.fetchAndRender();
                },
                onLimitChange: (newLimit) => {
                    this.filters.limit = newLimit;
                    this.filters.page = 1;
                    this.fetchAndRender();
                },
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    renderTableRows(tbody, orders) {
        tbody.innerHTML = '';

        orders.forEach((o) => {
            const tr = document.createElement('tr');
            const statusLabel = ORDER_STATUS_LABEL[o.status] || o.status;
            const statusBadge = ORDER_STATUS_BADGE[o.status] || 'badge-neutral';
            const customer = o.userEmail || o.userName || o.userId || 'Guest';
            const canFulfill = FULFILLABLE.has(o.status);
            const canCancel = CANCELLABLE.has(o.status);

            const quotaText =
                o.quotaVideo !== null && o.quotaVideo !== undefined
                    ? `${Number(o.quotaVideo).toLocaleString('vi-VN')} video / ${o.planDays ?? '?'} ngày`
                    : '—';

            tr.innerHTML = `
                <td style="font-family: var(--font-mono); font-size: 12px;" title="${escapeHtml(o.orderId || '')}">
                    ${escapeHtml(o.payCode || o.orderId || 'N/A')}
                </td>
                <td>
                    <div style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(customer)}</div>
                </td>
                <td><span class="tier-badge tier-${escapeHtml(o.tier || 'free')}">${escapeHtml((o.planName || o.planId || 'N/A').toUpperCase())}</span></td>
                <td style="font-family: var(--font-mono); font-weight: 600; color: var(--text-main);">${formatVnd(o.amountVnd)}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(quotaText)}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${formatTime(o.createdAt)}</td>
                <td><span class="badge ${statusBadge}">${escapeHtml(statusLabel)}</span></td>
                <td style="text-align: center;">
                    ${canFulfill || canCancel ? `
                        <div style="display: inline-flex; gap: 4px;">
                            ${canFulfill ? '<button class="btn btn-primary btn-fulfill-order" style="padding: 4px 8px; font-size: 11px;">Duyệt nạp</button>' : ''}
                            ${canCancel ? '<button class="btn btn-danger btn-cancel-order" style="padding: 4px 8px; font-size: 11px;">Hủy</button>' : ''}
                        </div>
                    ` : '<span style="color: var(--text-dim); font-size: 11px;">Đã xử lý</span>'}
                </td>
            `;

            const fulfillBtn = tr.querySelector('.btn-fulfill-order');
            if (fulfillBtn) {
                fulfillBtn.onclick = () => this.handleFulfill(o);
            }
            const cancelBtn = tr.querySelector('.btn-cancel-order');
            if (cancelBtn) {
                cancelBtn.onclick = () => this.handleCancel(o);
            }

            tbody.appendChild(tr);
        });
    },

    handleFulfill(order) {
        const orderId = order.orderId || order.id;
        const amount = formatVnd(order.amountVnd);
        const quota = order.quotaVideo !== null && order.quotaVideo !== undefined
            ? `${Number(order.quotaVideo).toLocaleString('vi-VN')} video trong ${order.planDays ?? '?'} ngày`
            : 'theo cấu hình gói cước';

        ConfirmModal.show({
            title: 'Duyệt thanh toán đơn hàng',
            message: `Xác nhận duyệt nạp <strong>${escapeHtml(amount)}</strong> cho đơn <strong>${escapeHtml(order.payCode || orderId)}</strong>?<br>Hệ thống sẽ cộng <strong>${escapeHtml(quota)}</strong> cho khách hàng.`,
            confirmText: 'Duyệt đơn ngay',
            onConfirm: async () => {
                try {
                    await AdminApi.fulfillOrder(orderId);
                    Toast.success('Đã duyệt đơn hàng thành công!');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            },
        });
    },

    handleCancel(order) {
        const orderId = order.orderId || order.id;
        ConfirmModal.show({
            title: 'Hủy đơn hàng',
            message: `Xác nhận hủy đơn hàng <strong>${escapeHtml(order.payCode || orderId)}</strong>? Khách hàng sẽ không thể thanh toán đơn này nữa.`,
            confirmText: 'Hủy đơn',
            isDanger: true,
            onConfirm: async () => {
                try {
                    await AdminApi.cancelOrder(orderId);
                    Toast.success('Đã hủy đơn hàng.');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            },
        });
    },
};

function formatVnd(n) {
    return `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
}

function formatTime(iso) {
    return iso ? new Date(iso).toLocaleString('vi-VN') : 'N/A';
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
