/**
 * Refund Requests View
 *
 * Duyệt yêu cầu hoàn tiền người dùng gửi từ widget "Hỗ trợ" (danh mục "refund"):
 * xem giao dịch lỗi kèm ảnh chụp, **quét mã VietQR để chuyển tiền hoàn**, rồi
 * chốt luồng Chờ xử lý → Đã duyệt → Đã hoàn tiền (hoặc Từ chối kèm lý do).
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, Pagination, Skeleton, EmptyState, AlertBanner, ConfirmModal } from './components.js';

const STATUS_OPTIONS = [
    { value: 'all', label: 'Mọi trạng thái' },
    { value: 'pending', label: 'Chờ xử lý' },
    { value: 'approved', label: 'Đã duyệt' },
    { value: 'refunded', label: 'Đã hoàn tiền' },
    { value: 'rejected', label: 'Bị từ chối' },
];

const STATUS_LABELS = {
    pending: 'Chờ xử lý',
    approved: 'Đã duyệt',
    refunded: 'Đã hoàn tiền',
    rejected: 'Bị từ chối',
};

const STATUS_BADGE = {
    pending: 'badge-warning',
    approved: 'badge-info',
    refunded: 'badge-success',
    rejected: 'badge-danger',
};

const TICKET_STATUS_LABELS = {
    open: 'Mới',
    in_progress: 'Đang xử lý',
    waiting_user: 'Chờ người dùng',
    resolved: 'Đã giải quyết',
    closed: 'Đã đóng',
};

const ORDER_STATUS_LABELS = {
    paid: 'Đã thanh toán',
    pending: 'Chưa thanh toán',
    claimed: 'Chờ xác nhận',
    expired: 'Hết hạn',
    cancelled: 'Đã hủy',
};

export const RefundsView = {
    containerEl: null,
    items: [],
    searchDebounceTimer: null,
    popstateBound: false,

    async init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        await this.fetchAndRender();

        if (!this.popstateBound) {
            window.addEventListener('popstate', async () => {
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'refunds') {
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

        const statusOptions = STATUS_OPTIONS
            .map((s) => `<option value="${s.value}" ${(state.status || 'all') === s.value ? 'selected' : ''}>${s.label}</option>`)
            .join('');

        this.containerEl.innerHTML = `
            <div class="views-kpi-grid">
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Chờ xử lý</span></div>
                    <div class="views-kpi-value" id="kpi-rf-pending">-</div>
                    <div class="views-kpi-sub">Cần kiểm tra sao kê</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Đã duyệt</span></div>
                    <div class="views-kpi-value" id="kpi-rf-approved">-</div>
                    <div class="views-kpi-sub">Chờ chuyển khoản hoàn</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Đã hoàn tiền</span></div>
                    <div class="views-kpi-value" id="kpi-rf-refunded">-</div>
                    <div class="views-kpi-sub">Đã ghi vào sổ hoàn tiền</div>
                </div>
                <div class="views-kpi-card">
                    <div class="views-kpi-header"><span class="views-kpi-label">Bị từ chối</span></div>
                    <div class="views-kpi-value" id="kpi-rf-rejected">-</div>
                    <div class="views-kpi-sub">Không đủ điều kiện hoàn</div>
                </div>
            </div>

            <div class="filter-toolbar" style="margin-top: 20px;">
                <div class="filter-row-top" style="flex-wrap: wrap;">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="rf-search-input" placeholder="Tìm theo mã, email, mã đơn, số tài khoản..." value="${escapeHtml(state.search || '')}">
                    </div>

                    <div class="filter-select-wrapper">
                        <select class="select-custom" id="rf-status-filter">${statusOptions}</select>
                    </div>

                    <div style="margin-left: auto; display: flex; gap: 8px;">
                        <button class="btn btn-secondary" id="btn-rf-refresh" type="button">Làm mới</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Mã</th>
                                <th>Khách hàng</th>
                                <th>Giao dịch</th>
                                <th style="text-align:right;">Số tiền</th>
                                <th>Nhận về</th>
                                <th>Trạng thái</th>
                                <th>Gửi lúc</th>
                                <th style="text-align:center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="rf-table-body"></tbody>
                    </table>
                </div>
                <div class="table-footer" id="rf-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = document.getElementById('rf-search-input');
        const statusFilter = document.getElementById('rf-status-filter');
        const refreshBtn = document.getElementById('btn-rf-refresh');

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
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.fetchAndRender();
                Toast.info('Đã làm mới danh sách yêu cầu hoàn tiền.');
            });
        }
    },

    async fetchAndRender() {
        const tbody = document.getElementById('rf-table-body');
        if (!tbody) return;

        Skeleton.renderTableRows(tbody, 6, 8);

        const state = AdminState.getParamsFromUrl();
        const page = parseInt(state.page, 10) || 1;
        const limit = parseInt(state.limit, 10) || 25;

        try {
            const res = await AdminApi.getRefundRequests({
                page,
                limit,
                search: state.search || '',
                status: state.status || 'all',
            });
            if (!res.success) throw new Error(res.error || 'Lỗi tải danh sách yêu cầu hoàn tiền.');

            this.items = res.requests || [];
            this.renderStats(res.stats || {});
            this.renderTable(this.items);
            this.renderPagination(res.page, res.totalPages, res.total);
        } catch (err) {
            this.items = [];
            tbody.innerHTML = AlertBanner.rowHtml(8, {
                title: 'Không tải được danh sách yêu cầu hoàn tiền',
                message: err.message,
            });
            AlertBanner.bindRetry(tbody, () => this.fetchAndRender());
        }
    },

    renderStats(stats) {
        const set = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = Number(value || 0).toLocaleString();
        };
        set('kpi-rf-pending', stats.pending);
        set('kpi-rf-approved', stats.approved);
        set('kpi-rf-refunded', stats.refunded);
        set('kpi-rf-rejected', stats.rejected);

        const navTag = document.getElementById('nav-tag-refunds');
        if (navTag) navTag.textContent = Number(stats.pending || 0).toLocaleString();
    },

    renderTable(items) {
        const tbody = document.getElementById('rf-table-body');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = EmptyState.rowHtml(8, {
                title: 'Chưa có yêu cầu hoàn tiền nào',
                description: 'Người dùng gửi yêu cầu từ Hồ sơ hoặc widget "Hỗ trợ" (danh mục "Hoàn tiền") sẽ hiện tại đây.',
            });
            return;
        }

        tbody.innerHTML = items
            .map((item) => {
                const r = item.refund || {};
                const badge = STATUS_BADGE[r.status] || 'badge';
                return `
                <tr>
                    <td style="font-family: var(--font-mono); font-size: 12.5px;">
                        ${escapeHtml(item.code)}
                        <div style="font-size: 11px; color: #94a3b8;">Hội thoại: ${escapeHtml(TICKET_STATUS_LABELS[item.ticketStatus] || item.ticketStatus || '—')}</div>
                    </td>
                    <td style="font-size: 12px; color: #64748b; max-width: 200px; word-break: break-word;">${escapeHtml(item.userEmail || '—')}</td>
                    <td style="font-size: 12px;">
                        <div style="font-family: var(--font-mono);">${escapeHtml(r.payCode || '—')}</div>
                        <div style="color: #94a3b8;">${escapeHtml(r.planName || r.planId || '')}</div>
                    </td>
                    <td style="text-align:right; font-weight: 600; white-space: nowrap;">${escapeHtml(formatVnd(r.amountVnd))}</td>
                    <td style="font-size: 12px; color: #64748b;">
                        <div>${escapeHtml(r.bankName || '—')}</div>
                        <div style="font-family: var(--font-mono);">${escapeHtml(maskAccount(r.bankAccount))}</div>
                    </td>
                    <td><span class="badge ${badge}">${escapeHtml(STATUS_LABELS[r.status] || r.status || '—')}</span></td>
                    <td style="font-size: 12px; color: #64748b; white-space: nowrap;">${escapeHtml(formatDateTime(item.createdAt))}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm btn-rf-open" data-id="${escapeHtml(item.ticketId)}">Xem &amp; xử lý</button>
                    </td>
                </tr>
            `;
            })
            .join('');

        tbody.querySelectorAll('.btn-rf-open').forEach((btn) =>
            btn.addEventListener('click', () => this.openDetail(btn.dataset.id))
        );
    },

    renderPagination(currentPage, totalPages, totalItems) {
        const container = document.getElementById('rf-pagination-container');
        if (!container) return;

        const state = AdminState.getParamsFromUrl();

        Pagination.render({
            container,
            page: currentPage,
            totalPages,
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

    /* ── Chi tiết & xử lý ─────────────────────────────────────────── */

    async openDetail(ticketId) {
        const item = (this.items || []).find((i) => i.ticketId === ticketId);
        if (!item || !item.refund) {
            Toast.error('Không tìm thấy yêu cầu hoàn tiền.');
            return;
        }

        // Lấy thêm hội thoại để hiện ảnh chụp người dùng đã gửi kèm.
        let ticket = null;
        try {
            const res = await AdminApi.getTicket(ticketId);
            if (res.success) ticket = res.ticket;
        } catch (_) {
            // Hội thoại chỉ là thông tin phụ — thiếu vẫn xử lý được yêu cầu.
        }

        const r = item.refund;
        const canApprove = r.status === 'pending';
        const canReject = r.status === 'pending' || r.status === 'approved';
        const canRefund = r.status === 'approved';

        const screenshots = (ticket?.messages || [])
            .flatMap((m) => m.attachments || [])
            .map((a) => `<img src="${escapeHtml(a.url)}" alt="Ảnh chụp đã chuyển tiền" class="rf-shot" onclick="window.open(this.src, '_blank')">`)
            .join('');

        const reviewLine = r.reviewedAt
            ? `<div class="rf-review">Xử lý bởi <strong>${escapeHtml(r.reviewedBy || '—')}</strong> lúc ${escapeHtml(formatDateTime(r.reviewedAt))}${
                  r.refundId ? ` · Bút toán sổ hoàn tiền: <code>${escapeHtml(String(r.refundId))}</code>` : ''
              }</div>`
            : '';

        const noteTitle = r.status === 'rejected' ? 'Lý do từ chối' : r.status === 'refunded' ? 'Ghi chú hoàn tiền' : 'Ghi chú xử lý';
        const noteBlock = r.adminNote && !canApprove && !canRefund && !canReject
            ? `<div class="drawer-section"><div class="drawer-section-title">${noteTitle}</div><div class="rf-reason">${escapeHtml(r.adminNote)}</div></div>`
            : '';

        Drawer.open({
            title: `Yêu cầu hoàn tiền ${item.code}`,
            subtitle: `${escapeHtml(r.payCode || '')} — ${escapeHtml(formatVnd(r.amountVnd))} — ${escapeHtml(item.userEmail || '')}`,
            contentHtml: `
                <div class="tk-detail-meta">
                    <span class="badge ${STATUS_BADGE[r.status] || 'badge'}">${escapeHtml(STATUS_LABELS[r.status] || r.status)}</span>
                    <span class="badge">${escapeHtml(ORDER_STATUS_LABELS[r.orderStatus] || r.orderStatus || 'Đơn chưa xử lý')}</span>
                    <span style="font-size: 12px; color: #64748b;">Gửi: ${escapeHtml(formatDateTime(item.createdAt))}</span>
                </div>

                <div class="rf-grid">
                    <div class="rf-card">
                        <div class="rf-card-title">Giao dịch cần hoàn</div>
                        ${rowHtml('Mã đơn', r.payCode || '—')}
                        ${rowHtml('Gói', r.planName || r.planId || '—')}
                        ${rowHtml('Số tiền', formatVnd(r.amountVnd))}
                        ${rowHtml('Trạng thái đơn khi gửi', ORDER_STATUS_LABELS[r.orderStatus] || r.orderStatus || '—')}
                    </div>
                    <div class="rf-card">
                        <div class="rf-card-title">Tài khoản nhận hoàn</div>
                        ${rowHtml('Ngân hàng', r.bankName || '—')}
                        ${rowHtml('Số tài khoản', r.bankAccount || '—')}
                        ${rowHtml('Chủ tài khoản', r.accountHolder || '—')}
                    </div>
                </div>

                <div class="drawer-section">
                    <div class="drawer-section-title">Lý do người dùng nêu</div>
                    <div class="rf-reason">${escapeHtml(r.reason || '—')}</div>
                    ${screenshots ? `<div class="rf-shots">${screenshots}</div>` : '<p style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">Người dùng không gửi ảnh chụp màn hình.</p>'}
                </div>

                ${this.qrBlockHtml(item.qr, r)}

                ${noteBlock}
                ${reviewLine}
            `,
            footerHtml: canReject || canRefund || canApprove
                ? `
                    <div class="rf-footer">
                        <textarea class="form-input" id="rf-note" rows="2" maxlength="1000"
                            placeholder="Ghi chú xử lý — bắt buộc khi từ chối. Nội dung sẽ được gửi tới người dùng trong hội thoại hỗ trợ."></textarea>
                        <div class="rf-actions">
                            <button class="btn btn-secondary" id="rf-close" type="button">Đóng</button>
                            <span style="flex: 1;"></span>
                            ${canReject ? '<button class="btn btn-danger" id="rf-reject" type="button">Từ chối</button>' : ''}
                            ${canApprove ? '<button class="btn btn-primary" id="rf-approve" type="button">Duyệt yêu cầu</button>' : ''}
                            ${canRefund ? '<button class="btn btn-primary" id="rf-refund" type="button">Xác nhận đã chuyển tiền</button>' : ''}
                        </div>
                    </div>
                `
                : '<div class="rf-footer"><button class="btn btn-secondary" id="rf-close" type="button">Đóng</button></div>',
            onRender: (_body, footer) => {
                const noteEl = footer.querySelector('#rf-note');
                const note = () => (noteEl?.value || '').trim();

                footer.querySelector('#rf-close')?.addEventListener('click', () => Drawer.close());

                // Sao chép nội dung chuyển khoản để dán sang app ngân hàng khác.
                document.getElementById('rf-copy-memo')?.addEventListener('click', async () => {
                    const memo = document.getElementById('rf-copy-memo')?.dataset.memo || '';
                    try {
                        await navigator.clipboard.writeText(memo);
                        Toast.success('Đã sao chép nội dung chuyển khoản.');
                    } catch (_) {
                        Toast.error('Trình duyệt không cho phép sao chép tự động.');
                    }
                });

                footer.querySelector('#rf-approve')?.addEventListener('click', () =>
                    this.transition(item.ticketId, 'approved', note(), { confirm: false })
                );

                footer.querySelector('#rf-reject')?.addEventListener('click', () => {
                    if (note().length < 3) {
                        Toast.error('Vui lòng ghi rõ lý do từ chối để người dùng hiểu.');
                        return;
                    }
                    this.transition(item.ticketId, 'rejected', note(), { confirm: true, danger: true });
                });

                footer.querySelector('#rf-refund')?.addEventListener('click', () => {
                    this.transition(item.ticketId, 'refunded', note(), {
                        confirm: true,
                        message: `Xác nhận đã chuyển khoản hoàn <strong>${formatVnd(r.amountVnd)}</strong> về <strong>${escapeHtml(r.bankName || '')} · ${escapeHtml(r.bankAccount || '')}</strong>?<br><br>Hệ thống sẽ ghi vào sổ hoàn tiền và đóng đơn hàng này lại.`,
                    });
                });
            },
        });
    },

    /** Khối VietQR để quét trả tiền lại cho khách. */
    qrBlockHtml(qr, r) {
        if (!qr || !qr.image) {
            return `
                <div class="drawer-section">
                    <div class="drawer-section-title">Mã QR chuyển tiền hoàn</div>
                    <p style="font-size: 12.5px; color: var(--text-muted);">
                        Không dựng được mã QR cho yêu cầu này (thiếu số tài khoản hoặc số tiền).
                        Vui lòng chuyển khoản thủ công về tài khoản bên trên.
                    </p>
                </div>
            `;
        }

        return `
            <div class="drawer-section">
                <div class="drawer-section-title">Quét mã để chuyển tiền hoàn</div>
                <div class="rf-qr">
                    <img class="rf-qr-img" src="${escapeHtml(qr.image)}" alt="Mã VietQR chuyển tiền hoàn" loading="lazy">
                    <div class="rf-qr-info">
                        <div class="rf-qr-amount">${escapeHtml(formatVnd(qr.amountVnd))}</div>
                        <div class="rf-qr-line">Về <strong>${escapeHtml(qr.bankName)}</strong> — <span class="rf-mono">${escapeHtml(qr.bankAccount)}</span></div>
                        ${r.accountHolder ? `<div class="rf-qr-line">Chủ tài khoản: ${escapeHtml(r.accountHolder)}</div>` : ''}
                        <div class="rf-qr-line">Nội dung: <span class="rf-mono">${escapeHtml(qr.memo)}</span></div>
                        <div class="rf-qr-actions">
                            <button class="btn btn-secondary btn-sm" id="rf-copy-memo" data-memo="${escapeHtml(qr.memo)}" type="button">Sao chép nội dung</button>
                            <a class="btn btn-secondary btn-sm" href="${escapeHtml(qr.image)}" target="_blank" rel="noopener">Mở ảnh QR</a>
                        </div>
                        <p class="rf-qr-hint">Mở app ngân hàng, quét mã rồi kiểm tra đúng số tiền và nội dung trước khi xác nhận chuyển.</p>
                    </div>
                </div>
            </div>
        `;
    },

    async transition(ticketId, status, note, options = {}) {
        const run = async () => {
            try {
                const res = await AdminApi.updateRefundRequest(ticketId, { status, note: note || undefined });
                if (!res.success) throw new Error(res.error || 'Không cập nhật được yêu cầu hoàn tiền.');
                Toast.success(
                    status === 'approved'
                        ? 'Đã duyệt yêu cầu. Nhớ chuyển khoản hoàn cho khách.'
                        : status === 'refunded'
                          ? 'Đã ghi nhận hoàn tiền vào sổ đối soát.'
                          : 'Đã từ chối yêu cầu và thông báo cho người dùng.'
                );
                Drawer.close();
                this.fetchAndRender();
            } catch (err) {
                Toast.error(err.message || 'Không cập nhật được yêu cầu hoàn tiền.');
            }
        };

        if (!options.confirm) return run();

        ConfirmModal.show({
            title: status === 'refunded' ? 'Xác nhận đã chuyển tiền hoàn' : 'Xác nhận từ chối hoàn tiền',
            message: options.message || 'Bạn chắc chắn muốn từ chối yêu cầu hoàn tiền này? Người dùng sẽ nhận được thông báo kèm lý do.',
            confirmText: status === 'refunded' ? 'Đã chuyển khoản' : 'Từ chối',
            isDanger: Boolean(options.danger),
            onConfirm: run,
        });
    },
};

function rowHtml(label, value) {
    return `<div class="rf-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatVnd(amount) {
    const n = Number(amount) || 0;
    try {
        return `${n.toLocaleString('vi-VN')} ₫`;
    } catch (_) {
        return `${n} ₫`;
    }
}

function maskAccount(acc) {
    const digits = String(acc || '').replace(/\D/g, '');
    if (!digits) return '—';
    if (digits.length <= 4) return `***${digits}`;
    return `***${digits.slice(-4)}`;
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
