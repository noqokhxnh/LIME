/**
 * Maintenance Visitors Management View
 * Displays visitors who visited the website while the server was down/under maintenance
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, ConfirmModal, Pagination, Skeleton, EmptyState, AlertBanner } from './components.js';

export const MaintenanceView = {
    containerEl: null,
    totalRecords: 0,
    searchDebounceTimer: null,
    popstateBound: false,

    async init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        await this.fetchAndRender();
        this.fetchStats();

        if (!this.popstateBound) {
            window.addEventListener('popstate', async () => {
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'maintenance') {
                    clearTimeout(this.searchDebounceTimer);
                    this.renderStructure();
                    this.bindEvents();
                    await this.fetchAndRender();
                    this.fetchStats();
                }
            });
            this.popstateBound = true;
        }
    },

    renderStructure() {
        const state = AdminState.getParamsFromUrl();

        this.containerEl.innerHTML = `
            <!-- Top KPI Cards -->
            <div class="views-kpi-grid">
                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Tổng lượt truy cập khi tắt máy</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-maint-total">-</div>
                    <div class="views-kpi-sub">Lượt ghi nhận bảo trì</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Khách duy nhất (IP)</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-maint-unique">-</div>
                    <div class="views-kpi-sub">Địa chỉ IP độc lập</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Ghi nhận hôm nay</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-maint-today">-</div>
                    <div class="views-kpi-sub">Trong ngày hôm nay</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Cơ chế bảo vệ</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" style="font-size: 16px; color: #38bdf8; margin-top: 4px;">Cloudflare D1</div>
                    <div class="views-kpi-sub">Tự động đồng bộ</div>
                </div>
            </div>

            <!-- Breakdown Widgets Panel -->
            <div class="views-widgets-grid">
                <div class="views-widget-card">
                    <div class="views-widget-title">Vị trí địa lý (GeoIP)</div>
                    <div class="views-widget-list" id="widget-maint-locations">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Nhà mạng / ASN</div>
                    <div class="views-widget-list" id="widget-maint-asns">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Trang khách cố truy cập</div>
                    <div class="views-widget-list" id="widget-maint-urls">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Phân bố thiết bị</div>
                    <div class="views-widget-list" id="widget-maint-devices">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
            </div>

            <!-- Filter & Action Toolbar -->
            <div class="filter-toolbar" style="margin-top: 20px;">
                <div class="filter-row-top">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="maint-search-input" placeholder="Tìm theo IP, Quốc gia, Thành phố, Nhà mạng, URL..." value="${escapeHtml(state.search || '')}">
                        <button class="search-clear-btn" id="maint-search-clear-btn" style="display: ${state.search ? 'block' : 'none'};">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-primary" id="btn-sync-maint" type="button" style="display: inline-flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                            <span>Đồng bộ từ Cloudflare</span>
                        </button>
                        <button class="btn btn-secondary" id="btn-refresh-maint" type="button">Làm mới</button>
                        <button class="btn btn-danger" id="btn-clear-maint" type="button">Xóa nhật ký</button>
                    </div>
                </div>
            </div>

            <!-- Table Panel -->
            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Thời gian</th>
                                <th>Địa chỉ IP</th>
                                <th>Vị trí & Nhà mạng (ASN)</th>
                                <th>Đường dẫn cố truy cập</th>
                                <th>Thiết bị & Trình duyệt</th>
                                <th>Nguồn (Referer)</th>
                                <th style="text-align: center;">Chi tiết</th>
                            </tr>
                        </thead>
                        <tbody id="maint-table-body"></tbody>
                    </table>
                </div>

                <div class="table-footer" id="maint-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = document.getElementById('maint-search-input');
        const clearBtn = document.getElementById('maint-search-clear-btn');
        const syncBtn = document.getElementById('btn-sync-maint');
        const refreshBtn = document.getElementById('btn-refresh-maint');
        const clearLogsBtn = document.getElementById('btn-clear-maint');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';

                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    AdminState.setParams({ search: val, page: 1 });
                    this.fetchAndRender();
                }, 300);
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                clearBtn.style.display = 'none';
                AdminState.setParams({ search: '', page: 1 });
                this.fetchAndRender();
            });
        }

        if (syncBtn) {
            syncBtn.addEventListener('click', async () => {
                const originalHtml = syncBtn.innerHTML;
                syncBtn.disabled = true;
                syncBtn.innerHTML = `<span>Đang đồng bộ...</span>`;

                try {
                    const res = await AdminApi.syncMaintenanceLogs();
                    Toast.success(res.message || `Đã đồng bộ ${res.syncedCount || 0} bản ghi mới!`);
                    this.fetchStats();
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(err.message || 'Lỗi khi đồng bộ từ Cloudflare');
                } finally {
                    syncBtn.disabled = false;
                    syncBtn.innerHTML = originalHtml;
                }
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.fetchStats();
                this.fetchAndRender();
                Toast.info('Đã làm mới dữ liệu.');
            });
        }

        if (clearLogsBtn) {
            clearLogsBtn.addEventListener('click', () => {
                ConfirmModal.show({
                    title: 'Xóa toàn bộ nhật ký khách khi bảo trì?',
                    message: 'Hành động này sẽ xóa toàn bộ danh sách khách truy cập đã lưu trong thời gian bảo trì. Thao tác này không thể hoàn tác.',
                    confirmText: 'Xác nhận xóa',
                    danger: true,
                    onConfirm: async () => {
                        try {
                            await AdminApi.clearMaintenanceLogs();
                            Toast.success('Đã xóa toàn bộ nhật ký khách khi bảo trì.');
                            this.fetchStats();
                            this.fetchAndRender();
                        } catch (err) {
                            Toast.error(err.message || 'Lỗi khi xóa nhật ký.');
                        }
                    },
                });
            });
        }
    },

    async fetchStats() {
        try {
            const res = await AdminApi.getMaintenanceStats();
            if (res.success && res.stats) {
                this.renderStats(res.stats);
            }
        } catch (e) {
            console.warn('[MaintenanceView] Lỗi tải thống kê:', e);
        }
    },

    renderStats(stats) {
        const totalEl = document.getElementById('kpi-maint-total');
        const uniqueEl = document.getElementById('kpi-maint-unique');
        const todayEl = document.getElementById('kpi-maint-today');
        const navTag = document.getElementById('nav-tag-maintenance');

        if (totalEl) totalEl.textContent = Number(stats.totalLogs || 0).toLocaleString();
        if (uniqueEl) uniqueEl.textContent = Number(stats.uniqueIps || 0).toLocaleString();
        if (todayEl) todayEl.textContent = Number(stats.todayLogs || 0).toLocaleString();
        if (navTag) navTag.textContent = stats.totalLogs || '-';

        this.renderWidgetList('widget-maint-locations', stats.topLocations, 'location');
        this.renderWidgetList('widget-maint-asns', stats.topAsns, 'asn');
        this.renderWidgetList('widget-maint-urls', stats.topUrls, 'url');
        this.renderWidgetList('widget-maint-devices', stats.deviceBreakdown, 'device');
    },

    renderWidgetList(containerId, items, labelKey) {
        const el = document.getElementById(containerId);
        if (!el) return;

        if (!items || items.length === 0) {
            el.innerHTML = `<div class="views-widget-empty">Chưa có dữ liệu</div>`;
            return;
        }

        el.innerHTML = items
            .map(
                (item) => `
            <div class="views-widget-item">
                <div class="views-widget-item-info">
                    <span class="views-widget-item-name" title="${escapeHtml(item[labelKey] || '')}">${escapeHtml(item[labelKey] || 'Không xác định')}</span>
                    <span class="views-widget-item-val">${Number(item.count).toLocaleString()} (${item.percentage}%)</span>
                </div>
                <div class="views-widget-bar-bg">
                    <div class="views-widget-bar-fill" style="width: ${item.percentage}%;"></div>
                </div>
            </div>
        `
            )
            .join('');
    },

    async fetchAndRender() {
        const tbody = document.getElementById('maint-table-body');
        if (!tbody) return;

        Skeleton.renderTableRows(tbody, 7, 5);

        const state = AdminState.getParamsFromUrl();
        const page = parseInt(state.page, 10) || 1;
        const limit = parseInt(state.limit, 10) || 25;
        const search = state.search || '';

        try {
            const res = await AdminApi.getMaintenanceLogs({ page, limit, search });
            if (!res.success) {
                throw new Error(res.error || 'Lỗi tải danh sách');
            }

            this.totalRecords = res.total;
            this.renderTable(res.logs || []);
            this.renderPagination(res.page, res.totalPages, res.total);
            // Cập nhật lại số liệu thống kê sau khi danh sách được tải/đồng bộ
            this.fetchStats();
        } catch (err) {
            tbody.innerHTML = AlertBanner.rowHtml(7, {
                title: 'Không tải được danh sách khách bảo trì',
                message: err.message
            });
            AlertBanner.bindRetry(tbody, () => this.fetchAndRender());
        }
    },

    renderTable(items) {
        const tbody = document.getElementById('maint-table-body');
        if (!tbody) return;

        if (!items || items.length === 0) {
            tbody.innerHTML = EmptyState.rowHtml(7, {
                title: 'Không có nhật ký nào',
                description: 'Chưa có lượt truy cập nào trong thời gian máy chủ tắt hoặc bảo trì.',
            });
            return;
        }

        tbody.innerHTML = items
            .map((item) => {
                const timeFormatted = formatTime(item.timestamp);
                const locationStr = [item.city, item.country].filter(Boolean).join(', ') || 'Không rõ';

                return `
                <tr>
                    <td>
                        <div style="font-weight: 500; font-size: 13px;">${timeFormatted.date}</div>
                        <div style="font-size: 11px; color: #94a3b8;">${timeFormatted.time}</div>
                    </td>
                    <td>
                        <span class="ip-badge">${escapeHtml(item.ip)}</span>
                    </td>
                    <td>
                        <div style="font-size: 13px; font-weight: 500;">${escapeHtml(locationStr)}</div>
                        <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(item.asn || 'Không rõ ISP')}</div>
                    </td>
                    <td>
                        <span class="path-badge" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
                    </td>
                    <td>
                        <div style="font-size: 13px;">${escapeHtml(item.browser)} (${escapeHtml(item.os)})</div>
                        <div style="font-size: 11px; color: #64748b;">${escapeHtml(item.device)}</div>
                    </td>
                    <td>
                        <span style="font-size: 12px; color: #94a3b8;">${escapeHtml(item.referer || 'Truy cập trực tiếp')}</span>
                    </td>
                    <td style="text-align: center;">
                        <button class="btn btn-secondary btn-sm btn-view-maint-detail" data-id="${escapeHtml(item.id)}">Chi tiết</button>
                    </td>
                </tr>
            `;
            })
            .join('');

        tbody.querySelectorAll('.btn-view-maint-detail').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const found = items.find((x) => x.id === id);
                if (found) this.showDetailDrawer(found);
            });
        });
    },

    renderPagination(currentPage, totalPages, totalItems) {
        const container = document.getElementById('maint-pagination-container');
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

    showDetailDrawer(item) {
        const timeFormatted = formatTime(item.timestamp);
        const locationStr = [item.city, item.country].filter(Boolean).join(', ') || 'Không xác định';

        Drawer.open({
            title: `Chi tiết truy cập bảo trì`,
            content: `
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Thời điểm truy cập</div>
                        <div style="font-size: 14px; font-weight: 500;">${timeFormatted.date} ${timeFormatted.time}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Địa chỉ IP</div>
                        <span class="ip-badge" style="font-size: 13px;">${escapeHtml(item.ip)}</span>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Vị trí địa lý & ASN</div>
                        <div style="font-size: 14px;">${escapeHtml(locationStr)}</div>
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">${escapeHtml(item.asn || 'Không rõ ISP')}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">URL khách cố mở</div>
                        <div style="font-family: monospace; font-size: 13px; word-break: break-all; background: #0f172a; padding: 10px; border-radius: 8px;">${escapeHtml(item.url)}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Thiết bị & Trình duyệt</div>
                        <div style="font-size: 14px;">${escapeHtml(item.device)} &bull; ${escapeHtml(item.browser)} &bull; ${escapeHtml(item.os)}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">User-Agent đầy đủ</div>
                        <div style="font-size: 12px; color: #94a3b8; word-break: break-all; background: #0f172a; padding: 10px; border-radius: 8px;">${escapeHtml(item.userAgent || 'Không có')}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Nguồn giới thiệu (Referer)</div>
                        <div style="font-size: 13px; color: #94a3b8;">${escapeHtml(item.referer || 'Không có')}</div>
                    </div>
                </div>
            `,
        });
    },
};

function formatTime(isoStr) {
    if (!isoStr) return { date: '-', time: '-' };
    try {
        const d = new Date(isoStr);
        const date = d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return { date, time };
    } catch (_) {
        return { date: isoStr, time: '' };
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
