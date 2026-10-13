/**
 * Orders Management View
 */

import { AdminApi } from './api.js';
import { Toast, ConfirmModal, Skeleton, EmptyState } from './components.js';

export const OrdersView = {
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
                        <span class="filter-label">Quản lý giao dịch nạp credits & đăng ký gói</span>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-orders">↻ Làm mới</button>
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
                                <th>Thời gian</th>
                                <th>Trạng thái</th>
                                <th style="text-align: center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="orders-table-body"></tbody>
                    </table>
                </div>
                <div id="orders-empty-container"></div>
            </div>
        `;

        this.containerEl.querySelector('#btn-refresh-orders').onclick = () => this.fetchAndRender();
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#orders-table-body');
        const emptyContainer = this.containerEl.querySelector('#orders-empty-container');
        emptyContainer.innerHTML = '';

        Skeleton.renderTableRows(tbody, 5, 7);

        try {
            const res = await AdminApi.getOrders();
            const orders = res.orders || [];

            if (orders.length === 0) {
                tbody.innerHTML = '';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Chưa có đơn hàng nào',
                        description: 'Hệ thống chưa ghi nhận đơn thanh toán nào.',
                        actionText: null
                    })
                );
                return;
            }

            tbody.innerHTML = '';
            orders.forEach((o) => {
                const tr = document.createElement('tr');
                const isPaid = o.status === 'paid';
                const isPending = o.status === 'pending';

                const statusBadge = isPaid ? 'badge-success' : isPending ? 'badge-warning' : 'badge-danger';

                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(o.orderId || o.id || 'N/A')}</td>
                    <td>
                        <div style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(o.userEmail || o.userId || 'Guest')}</div>
                    </td>
                    <td><span class="tier-badge tier-${o.tier || 'pro'}">${escapeHtml((o.tier || 'Pro').toUpperCase())}</span></td>
                    <td style="font-family: var(--font-mono); font-weight: 600; color: var(--text-main);">${(o.amountVnd || 0).toLocaleString()} ₫</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${o.createdAt ? new Date(o.createdAt).toLocaleString('vi-VN') : 'N/A'}</td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(o.status)}</span></td>
                    <td style="text-align: center;">
                        ${isPending ? `
                            <div style="display: inline-flex; gap: 4px;">
                                <button class="btn btn-primary btn-fulfill-order" style="padding: 4px 8px; font-size: 11px;">Duyệt nạp</button>
                                <button class="btn btn-danger btn-cancel-order" style="padding: 4px 8px; font-size: 11px;">Hủy</button>
                            </div>
                        ` : '<span style="color: var(--text-dim); font-size: 11px;">Đã xử lý</span>'}
                    </td>
                `;

                const fulfillBtn = tr.querySelector('.btn-fulfill-order');
                if (fulfillBtn) {
                    fulfillBtn.onclick = () => this.handleFulfill(o.orderId || o.id);
                }
                const cancelBtn = tr.querySelector('.btn-cancel-order');
                if (cancelBtn) {
                    cancelBtn.onclick = () => this.handleCancel(o.orderId || o.id);
                }

                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    handleFulfill(orderId) {
        ConfirmModal.show({
            title: 'Duyệt thanh toán đơn hàng',
            message: `Xác nhận duyệt nạp credits cho đơn <strong>${orderId}</strong>?`,
            confirmText: 'Duyệt đơn ngay',
            onConfirm: async () => {
                try {
                    await AdminApi.fulfillOrder(orderId);
                    Toast.success('Đã duyệt đơn hàng thành công!');
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi: ${err.message}`);
                }
            }
        });
    },

    handleCancel(orderId) {
        ConfirmModal.show({
            title: 'Hủy đơn hàng',
            message: `Xác nhận hủy đơn hàng <strong>${orderId}</strong>?`,
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
