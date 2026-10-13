/**
 * Failed Payments Management View
 * Xử lý giao dịch thanh toán lỗi: unmatched (không khớp đơn), duplicate (trùng lặp),
 * và lịch sử hoàn tiền thủ công.
 */

import { AdminApi } from './api.js';
import { Toast, ConfirmModal, Drawer, Skeleton, EmptyState } from './components.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatVnd(n) {
    return `${(n || 0).toLocaleString('vi-VN')} ₫`;
}

function formatTime(iso) {
    return iso ? new Date(iso).toLocaleString('vi-VN') : 'N/A';
}

// Che giữa STK:
// - Không có chữ số: 'N/A'
// - <= 4 số: '***' + digits (ví dụ '123' -> '***123', tránh lặp số '12***23')
// - 5 đến 8 số: 2 số đầu + '***' + 2 số cuối (không chồng lấn)
// - > 8 số: 4 số đầu + '***' + 4 số cuối
function maskBankAccount(acc) {
    const digits = String(acc || '').replace(/\D/g, '');
    if (!digits) return 'N/A';
    if (digits.length <= 4) return `***${digits}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
    return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

const UNMATCHED_STATUS_BADGE = {
    pending: 'badge-warning',
    resolved: 'badge-info',
    refunded: 'badge-success',
};

const UNMATCHED_STATUS_LABEL = {
    pending: 'Chờ xử lý',
    resolved: 'Đã đối soát',
    refunded: 'Đã hoàn tiền',
};

export const FailedPaymentsView = {
    containerEl: null,
    unmatchedFilter: 'pending',

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindFilter();
        this.fetchAll();
    },

    renderStructure() {
        this.containerEl.innerHTML = `
            <div class="filter-toolbar">
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <span class="filter-label">Xử lý giao dịch thanh toán lỗi & hoàn tiền thủ công</span>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-failed">Làm mới</button>
                    </div>
                </div>
            </div>

            <div class="drawer-section" style="margin-bottom: 20px;">
                <div class="drawer-section-title" style="display: flex; align-items: center; justify-content: space-between;">
                    <span>Giao dịch không khớp đơn (Unmatched)</span>
                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="unmatched-status-filter">
                            <option value="pending">Chờ xử lý</option>
                            <option value="resolved">Đã đối soát</option>
                            <option value="refunded">Đã hoàn tiền</option>
                            <option value="all">Tất cả</option>
                        </select>
                    </div>
                </div>
                <div class="table-panel">
                    <div class="table-wrapper">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Mã SePay</th>
                                    <th>Số tiền (VNĐ)</th>
                                    <th>Nội dung CK</th>
                                    <th>Thời gian</th>
                                    <th>Trạng thái</th>
                                    <th style="text-align: center;">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody id="unmatched-table-body"></tbody>
                        </table>
                    </div>
                    <div id="unmatched-empty-container"></div>
                </div>
            </div>

            <div class="drawer-section" style="margin-bottom: 20px;">
                <div class="drawer-section-title">Giao dịch trùng lặp (Duplicate)</div>
                <div class="table-panel">
                    <div class="table-wrapper">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Mã SePay</th>
                                    <th>Đơn gốc</th>
                                    <th>Khách hàng</th>
                                    <th>Số tiền (VNĐ)</th>
                                    <th>Thời gian</th>
                                    <th>Hoàn tiền</th>
                                    <th style="text-align: center;">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody id="duplicates-table-body"></tbody>
                        </table>
                    </div>
                    <div id="duplicates-empty-container"></div>
                </div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Lịch sử hoàn tiền</div>
                <div class="table-panel">
                    <div class="table-wrapper">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Loại nguồn</th>
                                    <th>Mã SePay</th>
                                    <th>STK khách</th>
                                    <th>Ngân hàng</th>
                                    <th>Số tiền (VNĐ)</th>
                                    <th>Người duyệt</th>
                                    <th>Thời gian</th>
                                </tr>
                            </thead>
                            <tbody id="refunds-table-body"></tbody>
                        </table>
                    </div>
                    <div id="refunds-empty-container"></div>
                </div>
            </div>
        `;
    },

    bindFilter() {
        const refreshBtn = this.containerEl.querySelector('#btn-refresh-failed');
        if (refreshBtn) refreshBtn.onclick = () => this.fetchAll();

        const filter = this.containerEl.querySelector('#unmatched-status-filter');
        if (filter) {
            filter.value = this.unmatchedFilter;
            filter.onchange = () => {
                this.unmatchedFilter = filter.value;
                this.fetchUnmatched();
            };
        }
    },

    fetchAll() {
        this.fetchUnmatched();
        this.fetchDuplicates();
        this.fetchRefunds();
        this.refreshPendingBadge();
    },

    async refreshPendingBadge() {
        const failedTag = document.getElementById('nav-tag-failed');
        if (failedTag) {
            try {
                const um = await AdminApi.getUnmatched('pending');
                failedTag.textContent = um.total ?? (um.unmatched || []).length;
            } catch {
                // ignore
            }
        }
    },

    // ---------------------------------------------------------
    // Unmatched
    // ---------------------------------------------------------
    async fetchUnmatched() {
        const tbody = this.containerEl.querySelector('#unmatched-table-body');
        const emptyContainer = this.containerEl.querySelector('#unmatched-empty-container');
        if (!tbody) return;
        emptyContainer.innerHTML = '';
        Skeleton.renderTableRows(tbody, 4, 6);

        try {
            const res = await AdminApi.getUnmatched(this.unmatchedFilter);
            const items = res.unmatched || [];
            tbody.innerHTML = '';

            if (items.length === 0) {
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không có giao dịch nào',
                        description: 'Không tìm thấy giao dịch không khớp đơn ở trạng thái này.',
                        actionText: null,
                    })
                );
                return;
            }

            items.forEach((u) => {
                const tr = document.createElement('tr');
                const badge = UNMATCHED_STATUS_BADGE[u.status] || 'badge-neutral';
                const label = UNMATCHED_STATUS_LABEL[u.status] || u.status;
                const isPending = u.status === 'pending';

                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(u.sepay_ref)}</td>
                    <td style="font-weight: 600;">${formatVnd(u.amount_vnd)}</td>
                    <td style="font-size: 12px; max-width: 280px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(u.content)}">${escapeHtml(u.content)}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${formatTime(u.created_at)}</td>
                    <td><span class="badge ${badge}">${escapeHtml(label)}</span></td>
                    <td style="text-align: center;">
                        ${isPending ? `
                            <div style="display: inline-flex; gap: 4px;">
                                <button class="btn btn-secondary btn-sm btn-resolve-unmatched">Đối soát</button>
                                <button class="btn btn-danger btn-sm btn-refund-unmatched">Hoàn tiền</button>
                            </div>
                        ` : '<span style="color: var(--text-dim); font-size: 11px;">Đã xử lý</span>'}
                    </td>
                `;

                const resolveBtn = tr.querySelector('.btn-resolve-unmatched');
                if (resolveBtn) resolveBtn.onclick = () => this.openResolveDrawer(u);
                const refundBtn = tr.querySelector('.btn-refund-unmatched');
                if (refundBtn) refundBtn.onclick = () => this.openRefundDrawer('unmatched', u);

                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    openResolveDrawer(u) {
        Drawer.open({
            title: 'Đối soát giao dịch',
            subtitle: `SePay: ${u.sepay_ref} — ${formatVnd(u.amount_vnd)}`,
            contentHtml: `
                <div class="drawer-section">
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Nội dung chuyển khoản</span>
                            <span class="detail-value">${escapeHtml(u.content)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Thời gian nhận</span>
                            <span class="detail-value">${formatTime(u.created_at)}</span>
                        </div>
                    </div>
                </div>
                <div class="drawer-section">
                    <div class="drawer-section-title">Thông tin đối soát</div>
                    <div class="form-group">
                        <label class="form-label">Mã đơn hàng khớp (tùy chọn)</label>
                        <input class="form-input" id="resolve-order-id" placeholder="Nhập ID đơn hàng nếu tìm thấy đơn khớp" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ghi chú</label>
                        <input class="form-input" id="resolve-note" placeholder="Ghi chú đối soát (tùy chọn)" />
                    </div>
                </div>
            `,
            footerHtml: `
                <button class="btn btn-secondary" id="drawer-cancel-btn">Đóng</button>
                <button class="btn btn-primary" id="drawer-save-btn">Xác nhận đối soát</button>
            `,
            onRender: (bodyEl, footerEl) => {
                footerEl.querySelector('#drawer-cancel-btn').onclick = () => Drawer.close();
                footerEl.querySelector('#drawer-save-btn').onclick = async () => {
                    const orderId = bodyEl.querySelector('#resolve-order-id').value.trim();
                    const adminNote = bodyEl.querySelector('#resolve-note').value.trim();
                    try {
                        await AdminApi.resolveUnmatched(u.id, { orderId: orderId || undefined, adminNote: adminNote || undefined });
                        Toast.success('Đã đối soát giao dịch.');
                        Drawer.close();
                        this.fetchUnmatched();
                        this.refreshPendingBadge();
                    } catch (err) {
                        Toast.error(`Lỗi: ${err.message}`);
                    }
                };
            },
        });
    },

    openRefundDrawer(kind, item) {
        const isUnmatched = kind === 'unmatched';
        const title = isUnmatched ? 'Hoàn tiền giao dịch không khớp' : 'Hoàn tiền giao dịch trùng lặp';
        const subtitle = isUnmatched
            ? `SePay: ${item.sepay_ref} — ${formatVnd(item.amount_vnd)}`
            : `SePay: ${item.sepay_ref} — ${formatVnd(item.amount_vnd)}${item.userEmail ? ` — ${item.userEmail}` : ''}`;

        Drawer.open({
            title,
            subtitle,
            contentHtml: `
                <div class="drawer-section">
                    <div class="drawer-section-title">Thông tin tài khoản nhận hoàn tiền</div>
                    <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                        SePay không cung cấp số tài khoản người chuyển. Vui lòng liên hệ khách hàng
                        để lấy thông tin và nhập chính xác bên dưới.
                    </p>
                    <div class="form-group">
                        <label class="form-label">Số tài khoản khách hàng *</label>
                        <input class="form-input" id="refund-bank-account" inputmode="numeric" placeholder="VD: 97042212345678" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tên ngân hàng *</label>
                        <input class="form-input" id="refund-bank-name" placeholder="VD: Vietcombank" />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ghi chú</label>
                        <input class="form-input" id="refund-note" placeholder="Ghi chú hoàn tiền (tùy chọn)" />
                    </div>
                </div>
            `,
            footerHtml: `
                <button class="btn btn-secondary" id="drawer-cancel-btn">Đóng</button>
                <button class="btn btn-danger" id="drawer-save-btn">Xác nhận hoàn tiền</button>
            `,
            onRender: (bodyEl, footerEl) => {
                footerEl.querySelector('#drawer-cancel-btn').onclick = () => Drawer.close();
                footerEl.querySelector('#drawer-save-btn').onclick = async () => {
                    const bankAccount = bodyEl.querySelector('#refund-bank-account').value.trim();
                    const bankName = bodyEl.querySelector('#refund-bank-name').value.trim();
                    const adminNote = bodyEl.querySelector('#refund-note').value.trim();
                    if (!bankAccount || !bankName) {
                        Toast.error('Vui lòng nhập số tài khoản và tên ngân hàng.');
                        return;
                    }
                    const doRefund = async () => {
                        if (isUnmatched) {
                            await AdminApi.refundUnmatched(item.id, { bankAccount, bankName, adminNote: adminNote || undefined });
                        } else {
                            await AdminApi.refundPayment(item.id, { bankAccount, bankName, adminNote: adminNote || undefined });
                        }
                    };
                    ConfirmModal.show({
                        title: 'Xác nhận hoàn tiền',
                        message: `Xác nhận đã chuyển khoản hoàn <strong>${formatVnd(item.amount_vnd)}</strong> về STK <strong>${escapeHtml(bankAccount)}</strong> (${escapeHtml(bankName)})?`,
                        confirmText: 'Đã hoàn tiền',
                        isDanger: true,
                        onConfirm: async () => {
                            try {
                                await doRefund();
                                Toast.success('Đã ghi nhận hoàn tiền.');
                                Drawer.close();
                                this.fetchAll();
                            } catch (err) {
                                Toast.error(`Lỗi: ${err.message}`);
                            }
                        },
                    });
                };
            },
        });
    },

    // ---------------------------------------------------------
    // Duplicates
    // ---------------------------------------------------------
    async fetchDuplicates() {
        const tbody = this.containerEl.querySelector('#duplicates-table-body');
        const emptyContainer = this.containerEl.querySelector('#duplicates-empty-container');
        if (!tbody) return;
        emptyContainer.innerHTML = '';
        Skeleton.renderTableRows(tbody, 4, 7);

        try {
            const res = await AdminApi.getDuplicatePayments();
            const items = res.duplicates || [];
            tbody.innerHTML = '';

            if (items.length === 0) {
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không có giao dịch trùng lặp',
                        description: 'Chưa ghi nhận giao dịch nào bị trùng.',
                        actionText: null,
                    })
                );
                return;
            }

            items.forEach((p) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(p.sepay_ref)}</td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(p.order?.pay_code || 'N/A')}</td>
                    <td style="font-size: 12px;">${escapeHtml(p.userEmail || 'N/A')}</td>
                    <td style="font-weight: 600;">${formatVnd(p.amount_vnd)}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${formatTime(p.received_at)}</td>
                    <td>${p.alreadyRefunded
                        ? '<span class="badge badge-success">Đã hoàn</span>'
                        : '<span class="badge badge-warning">Chờ xử lý</span>'}</td>
                    <td style="text-align: center;">
                        ${p.alreadyRefunded
                            ? '<span style="color: var(--text-dim); font-size: 11px;">Đã xử lý</span>'
                            : '<button class="btn btn-danger btn-sm btn-refund-duplicate">Hoàn tiền</button>'}
                    </td>
                `;
                const refundBtn = tr.querySelector('.btn-refund-duplicate');
                if (refundBtn) refundBtn.onclick = () => this.openRefundDrawer('duplicate', p);
                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    // ---------------------------------------------------------
    // Refund history
    // ---------------------------------------------------------
    async fetchRefunds() {
        const tbody = this.containerEl.querySelector('#refunds-table-body');
        const emptyContainer = this.containerEl.querySelector('#refunds-empty-container');
        if (!tbody) return;
        emptyContainer.innerHTML = '';
        Skeleton.renderTableRows(tbody, 4, 7);

        try {
            const res = await AdminApi.getRefunds();
            const items = res.refunds || [];
            tbody.innerHTML = '';

            if (items.length === 0) {
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Chưa có hoàn tiền nào',
                        description: 'Lịch sử hoàn tiền thủ công sẽ hiện ở đây.',
                        actionText: null,
                    })
                );
                return;
            }

            const sourceLabel = { unmatched: 'Không khớp', duplicate: 'Trùng lặp' };
            items.forEach((r) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><span class="badge badge-info">${escapeHtml(sourceLabel[r.source_type] || r.source_type)}</span></td>
                    <td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(r.sepay_ref)}</td>
                    <td style="font-family: var(--font-mono); font-size: 12px;" title="Đã che một phần vì bảo mật">${escapeHtml(maskBankAccount(r.bank_account))}</td>
                    <td style="font-size: 12px;">${escapeHtml(r.bank_name)}</td>
                    <td style="font-weight: 600;">${formatVnd(r.amount_vnd)}</td>
                    <td style="font-size: 12px;">${escapeHtml(r.refunded_by || 'N/A')}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${formatTime(r.refunded_at)}</td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
        }
    },
};
