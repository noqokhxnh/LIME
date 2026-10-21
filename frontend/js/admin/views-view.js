/**
 * Page Views & Visitor Management View
 * Tracks traffic, visitor device/OS/browser, location, and page analytics
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, ConfirmModal, Pagination, Skeleton, EmptyState, AlertBanner, formatLocation, formatIsp } from './components.js';

export const ViewsView = {
    containerEl: null,
    totalRecords: 0,
    searchDebounceTimer: null,
    popstateBound: false,

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        this.fetchStats();
        this.fetchAndRender();

        if (!this.popstateBound) {
            window.addEventListener('popstate', () => {
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'views') {
                    clearTimeout(this.searchDebounceTimer);
                    this.renderStructure();
                    this.bindEvents();
                    this.fetchStats();
                    this.fetchAndRender();
                }
            });
            this.popstateBound = true;
        }
    },

    renderStructure() {
        const state = AdminState.getParamsFromUrl();

        this.containerEl.innerHTML = `
            <!-- Top Analytics KPI Cards -->
            <div class="views-kpi-grid">
                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Tổng lượt xem</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-total-views">-</div>
                    <div class="views-kpi-sub">Toàn bộ thời gian</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Khách duy nhất (IP)</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-unique-visitors">-</div>
                    <div class="views-kpi-sub">Địa chỉ IP độc lập</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Lượt xem hôm nay</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-today-views">-</div>
                    <div class="views-kpi-sub" id="kpi-today-date">Hôm nay</div>
                </div>

                <div class="views-kpi-card">
                    <div class="views-kpi-header">
                        <span class="views-kpi-label">Khách hôm nay</span>
                        <span class="views-kpi-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </span>
                    </div>
                    <div class="views-kpi-value" id="kpi-today-visitors">-</div>
                    <div class="views-kpi-sub">Khách truy cập trong ngày</div>
                </div>
            </div>

            <!-- Breakdown Widgets Panel -->
            <div class="views-widgets-grid">
                <div class="views-widget-card">
                    <div class="views-widget-title">Top trang được xem nhiều nhất</div>
                    <div class="views-widget-list" id="widget-top-pages">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Phân loại đối tượng truy cập</div>
                    <div class="views-widget-list" id="widget-user-breakdown">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Phân bố theo thiết bị</div>
                    <div class="views-widget-list" id="widget-device-breakdown">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>

                <div class="views-widget-card">
                    <div class="views-widget-title">Vị trí địa lý (GeoIP)</div>
                    <div class="views-widget-list" id="widget-top-locations">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
            </div>

            <!-- Filter Toolbar -->
            <div class="filter-toolbar" style="margin-top: 20px;">
                <div class="filter-row-top">
                    <div class="search-input-wrapper">
                        <span class="search-icon-prefix">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input type="text" class="search-input" id="views-search-input" placeholder="Tìm theo IP, Đường dẫn, Email, Vị trí, ISP, Trình duyệt..." value="${escapeHtml(state.search)}">
                        <button class="search-clear-btn" id="views-search-clear-btn" style="display: ${state.search ? 'block' : 'none'};">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>

                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Đối tượng:</span>
                            <select class="select-custom" id="filter-views-user-type">
                                <option value="all" ${state.userType === 'all' ? 'selected' : ''}>Tất cả đối tượng</option>
                                <option value="user" ${state.userType === 'user' ? 'selected' : ''}>Thành viên (User)</option>
                                <option value="guest" ${state.userType === 'guest' ? 'selected' : ''}>Khách vãng lai (Guest)</option>
                            </select>
                        </div>

                        <div class="filter-select-wrapper">
                            <span class="filter-label">Đường dẫn:</span>
                            <select class="select-custom" id="filter-views-path">
                                <option value="all" ${state.path === 'all' ? 'selected' : ''}>Tất cả trang</option>
                                <option value="/" ${state.path === '/' ? 'selected' : ''}>/ (Trang chủ)</option>
                                <option value="/workspace" ${state.path === '/workspace' || state.path === '/ui' ? 'selected' : ''}>/workspace (Studio)</option>
                                <option value="/admin" ${state.path === '/admin' ? 'selected' : ''}>/admin (Quản trị)</option>
                            </select>
                        </div>

                        <div class="filter-select-wrapper">
                            <span class="filter-label">Thiết bị:</span>
                            <select class="select-custom" id="filter-views-device">
                                <option value="all" ${state.device === 'all' ? 'selected' : ''}>Tất cả thiết bị</option>
                                <option value="Desktop" ${state.device === 'Desktop' ? 'selected' : ''}>Desktop</option>
                                <option value="Mobile" ${state.device === 'Mobile' ? 'selected' : ''}>Mobile</option>
                                <option value="Tablet" ${state.device === 'Tablet' ? 'selected' : ''}>Tablet</option>
                                <option value="Bot" ${state.device === 'Bot' ? 'selected' : ''}>Bot / Crawler</option>
                            </select>
                        </div>

                        <div class="filter-select-wrapper">
                            <span class="filter-label">Thời gian:</span>
                            <select class="select-custom" id="filter-views-period">
                                <option value="all" ${state.period === 'all' ? 'selected' : ''}>Toàn bộ thời gian</option>
                                <option value="today" ${state.period === 'today' ? 'selected' : ''}>Hôm nay</option>
                                <option value="24h" ${state.period === '24h' ? 'selected' : ''}>24 giờ qua</option>
                                <option value="7d" ${state.period === '7d' ? 'selected' : ''}>7 ngày qua</option>
                                <option value="30d" ${state.period === '30d' ? 'selected' : ''}>30 ngày qua</option>
                            </select>
                        </div>

                        <div class="filter-select-wrapper">
                            <span class="filter-label">Quốc gia:</span>
                            <select class="select-custom" id="filter-views-country">
                                <option value="all" ${state.country === 'all' ? 'selected' : ''}>Tất cả quốc gia</option>
                                ${state.country && state.country !== 'all' ? `<option value="${escapeHtml(state.country)}" selected>${escapeHtml(state.country)}</option>` : ''}
                            </select>
                        </div>
                    </div>

                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-views" type="button">Làm mới</button>
                        <button class="btn btn-danger" id="btn-clear-views" type="button">Xóa nhật ký</button>
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
                                <th>Người dùng / Khách</th>
                                <th>Trang truy cập</th>
                                <th>Thiết bị & Trình duyệt</th>
                                <th>Vị trí & Nhà mạng (ISP)</th>
                                <th>Nguồn giới thiệu</th>
                                <th style="text-align: center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="views-table-body"></tbody>
                    </table>
                </div>

                <div id="views-empty-container"></div>
                <div id="views-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = this.containerEl.querySelector('#views-search-input');
        const clearBtn = this.containerEl.querySelector('#views-search-clear-btn');
        const userTypeSelect = this.containerEl.querySelector('#filter-views-user-type');
        const pathSelect = this.containerEl.querySelector('#filter-views-path');
        const deviceSelect = this.containerEl.querySelector('#filter-views-device');
        const periodSelect = this.containerEl.querySelector('#filter-views-period');
        const countrySelect = this.containerEl.querySelector('#filter-views-country');
        const refreshBtn = this.containerEl.querySelector('#btn-refresh-views');
        const clearViewsBtn = this.containerEl.querySelector('#btn-clear-views');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value;
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
                if (searchInput) {
                    searchInput.value = '';
                    clearBtn.style.display = 'none';
                    searchInput.focus();
                }
                AdminState.setParams({ search: '', page: 1 });
                this.fetchAndRender();
            });
        }

        if (userTypeSelect) {
            userTypeSelect.addEventListener('change', (e) => {
                AdminState.setParams({ userType: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }

        if (pathSelect) {
            pathSelect.addEventListener('change', (e) => {
                AdminState.setParams({ path: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }

        if (deviceSelect) {
            deviceSelect.addEventListener('change', (e) => {
                AdminState.setParams({ device: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }

        if (periodSelect) {
            periodSelect.addEventListener('change', (e) => {
                const period = e.target.value;
                AdminState.setParams({ period, page: 1 });
                this.fetchStats(period);
                this.fetchAndRender();
            });
        }

        if (countrySelect) {
            countrySelect.addEventListener('change', (e) => {
                AdminState.setParams({ country: e.target.value, page: 1 });
                this.fetchAndRender();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const currentPeriod = AdminState.getParamsFromUrl().period;
                this.fetchStats(currentPeriod);
                this.fetchAndRender();
                Toast.info('Đã làm mới dữ liệu lượt xem.');
            });
        }

        if (clearViewsBtn) {
            clearViewsBtn.addEventListener('click', () => this.handleClearViews());
        }
    },

    async fetchStats(periodOverride) {
        const period = periodOverride || AdminState.getParamsFromUrl().period || 'all';
        try {
            const res = await AdminApi.getViewsStats(period);
            const stats = res.stats;
            if (!stats) return;

            const totalEl = this.containerEl.querySelector('#kpi-total-views');
            const uniqueEl = this.containerEl.querySelector('#kpi-unique-visitors');
            const todayViewsEl = this.containerEl.querySelector('#kpi-today-views');
            const todayVisitorsEl = this.containerEl.querySelector('#kpi-today-visitors');

            if (totalEl) totalEl.textContent = Number(stats.totalViews || 0).toLocaleString('vi-VN');
            if (uniqueEl) uniqueEl.textContent = Number(stats.uniqueVisitors || 0).toLocaleString('vi-VN');
            if (todayViewsEl) todayViewsEl.textContent = Number(stats.todayViews || 0).toLocaleString('vi-VN');
            if (todayVisitorsEl) todayVisitorsEl.textContent = Number(stats.todayVisitors || 0).toLocaleString('vi-VN');

            // Render Top Pages Widget
            this.renderBarList('#widget-top-pages', stats.topPages || [], (item) => ({
                label: item.path,
                count: item.count,
                percentage: item.percentage
            }), 'Chưa có dữ liệu trang');

            // Render User Breakdown Widget
            this.renderBarList('#widget-user-breakdown', stats.userBreakdown || [], (item) => ({
                label: item.name,
                count: item.count,
                percentage: item.percentage
            }), 'Chưa có dữ liệu đối tượng');

            // Render Device Breakdown Widget
            this.renderBarList('#widget-device-breakdown', stats.deviceBreakdown || [], (item) => ({
                label: item.device,
                count: item.count,
                percentage: item.percentage
            }), 'Chưa có dữ liệu thiết bị');

            // Render Top Locations Widget
            this.renderBarList('#widget-top-locations', stats.topLocations || [], (item) => ({
                label: formatLocation(item.location),
                count: item.count,
                percentage: item.percentage
            }), 'Chưa có dữ liệu vị trí');

        } catch (err) {
            console.warn('[ViewsView] Lỗi lấy số liệu thống kê:', err);
        }
    },

    renderBarList(selector, items, transformFn, emptyMsg) {
        const container = this.containerEl.querySelector(selector);
        if (!container) return;

        if (!items || items.length === 0) {
            container.innerHTML = `<div class="views-widget-empty">${escapeHtml(emptyMsg)}</div>`;
            return;
        }

        container.innerHTML = items.map((raw) => {
            const item = transformFn(raw);
            return `
                <div class="views-bar-item">
                    <div class="views-bar-header">
                        <span class="views-bar-label audit-break-word" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
                        <span class="views-bar-count">${item.count} <span class="views-bar-pct">(${item.percentage}%)</span></span>
                    </div>
                    <div class="views-bar-track">
                        <div class="views-bar-fill" style="width: ${Math.min(100, Math.max(2, item.percentage))}%;"></div>
                    </div>
                </div>
            `;
        }).join('');
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#views-table-body');
        const emptyContainer = this.containerEl.querySelector('#views-empty-container');
        const paginationContainer = this.containerEl.querySelector('#views-pagination-container');

        if (!tbody) return;
        emptyContainer.innerHTML = '';
        paginationContainer.innerHTML = '';

        Skeleton.renderTableRows(tbody, 8, 7);

        const state = AdminState.getParamsFromUrl();
        const params = {
            page: state.page || 1,
            limit: state.limit || 25,
            search: state.search,
            path: state.path,
            device: state.device,
            period: state.period,
            userType: state.userType,
            country: state.country,
        };

        try {
            const res = await AdminApi.getViews(params);
            const views = res.views || [];
            this.totalRecords = res.total || 0;

            // Update country dropdown options dynamically
            this.updateCountryOptions(res.availableCountries || [], params.country);

            if (views.length === 0) {
                tbody.innerHTML = '';
                const hasFilters = Boolean(
                    state.search ||
                    (state.path && state.path !== 'all') ||
                    (state.device && state.device !== 'all') ||
                    (state.period && state.period !== 'all') ||
                    (state.userType && state.userType !== 'all') ||
                    (state.country && state.country !== 'all')
                );
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Chưa có bản ghi lượt xem nào',
                        description: hasFilters
                            ? 'Không tìm thấy lượt truy cập nào phù hợp với bộ lọc hiện tại.'
                            : 'Hệ thống chưa ghi nhận lượt xem trang web nào.',
                        actionText: hasFilters ? 'Đặt lại bộ lọc' : null,
                        onAction: () => {
                            AdminState.setParams({ search: '', path: 'all', device: 'all', period: 'all', userType: 'all', country: 'all', page: 1 });
                            this.renderStructure();
                            this.bindEvents();
                            this.fetchStats();
                            this.fetchAndRender();
                        }
                    })
                );
                return;
            }

            tbody.innerHTML = '';
            views.forEach((v) => {
                const tr = document.createElement('tr');
                const timestamp = v.timestamp ? new Date(v.timestamp).toLocaleString('vi-VN') : 'N/A';

                const deviceBadgeClass = v.device === 'Mobile' ? 'badge-primary' : v.device === 'Tablet' ? 'badge-info' : v.device === 'Bot' ? 'badge-warning' : 'badge-neutral';
                const pathBadgeClass = v.path === '/admin' ? 'badge-warning' : (v.path === '/workspace' || v.path === '/ui') ? 'badge-primary' : 'badge-neutral';

                const userDisplay = v.userEmail || v.userName
                    ? `<div style="display: flex; align-items: center; gap: 6px;"><span class="badge badge-primary" style="font-size: 10px;">User</span><div style="font-weight: 500; color: var(--text-main); font-size: 12px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(v.userName || v.userEmail)}">${escapeHtml(v.userName || v.userEmail)}</div></div><div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">${escapeHtml(v.ip)}</div>`
                    : `<div style="display: flex; align-items: center; gap: 6px;"><span class="badge badge-neutral" style="font-size: 10px;">Khách</span><span style="font-size: 12px; font-family: var(--font-mono); color: var(--text-main);">${escapeHtml(v.ip)}</span></div>`;

                tr.innerHTML = `
                    <td style="font-size: 12px; color: var(--text-muted); white-space: nowrap;">${escapeHtml(timestamp)}</td>
                    <td>${userDisplay}</td>
                    <td>
                        <span class="badge ${pathBadgeClass}" style="font-family: var(--font-mono); font-size: 11px;">${escapeHtml(v.path)}</span>
                    </td>
                    <td>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="badge ${deviceBadgeClass}" style="font-size: 10px;">${escapeHtml(v.device)}</span>
                                <span style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(v.browser)}</span>
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(v.os)}</span>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(formatLocation(v.location))}</span>
                            <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(formatIsp(v.isp))}</span>
                        </div>
                    </td>
                    <td style="font-size: 12px; color: var(--text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(v.referrer)}">
                        ${escapeHtml(v.referrer || 'Trực tiếp')}
                    </td>
                    <td style="text-align: center;">
                        <button class="btn btn-secondary btn-log-details" type="button" data-view-id="${escapeHtml(v.id)}">Chi tiết</button>
                    </td>
                `;

                tr.querySelector('.btn-log-details').addEventListener('click', () => this.openViewDrawer(v));
                tbody.appendChild(tr);
            });

            // Render Pagination
            Pagination.render({
                container: paginationContainer,
                page: params.page,
                limit: params.limit,
                total: this.totalRecords,
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
            tbody.innerHTML = AlertBanner.rowHtml(7, {
                title: 'Không tải được lượt truy cập',
                message: err.message
            });
            AlertBanner.bindRetry(tbody, () => this.fetchAndRender());
        }
    },

    openViewDrawer(item) {
        const timestamp = item.timestamp ? new Date(item.timestamp).toLocaleString('vi-VN') : 'N/A';
        const userTitle = item.userName || item.userEmail || `Khách (${item.ip})`;

        Drawer.open({
            title: 'Chi tiết lượt truy cập',
            subtitle: `${item.ip} · ${item.path}`,
            contentHtml: `
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Địa chỉ IP</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span class="detail-value" style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(item.ip)}</span>
                            <button class="btn-copy-sm" data-copy-ip="${escapeHtml(item.ip)}" type="button" title="Sao chép IP">Sao chép</button>
                        </div>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Thời gian</span>
                        <span class="detail-value">${escapeHtml(timestamp)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Trang truy cập (Path)</span>
                        <span class="detail-value" style="font-family: var(--font-mono);">${escapeHtml(item.path)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Loại thiết bị</span>
                        <span class="detail-value">${escapeHtml(item.device)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Hệ điều hành (OS)</span>
                        <span class="detail-value">${escapeHtml(item.os)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Trình duyệt</span>
                        <span class="detail-value">${escapeHtml(item.browser)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Vị trí địa lý</span>
                        <span class="detail-value">${escapeHtml(formatLocation(item.location))}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Nhà mạng (ISP)</span>
                        <span class="detail-value">${escapeHtml(formatIsp(item.isp))}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Người dùng liên kết</span>
                        <span class="detail-value">${item.userEmail || item.userName ? `<span class="badge badge-primary" style="font-size: 10px; margin-right: 6px;">User</span>${escapeHtml(item.userName ? `${item.userName} (${item.userEmail})` : item.userEmail)}` : '<span class="badge badge-neutral" style="font-size: 10px;">Khách vãng lai (Guest)</span>'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Nguồn giới thiệu</span>
                        <span class="detail-value audit-break-word">${escapeHtml(item.referrer || 'Trực tiếp (Direct)')}</span>
                    </div>
                </div>

                <section class="drawer-section">
                    <div class="drawer-section-title">User-Agent đầy đủ</div>
                    <div class="job-detail-summary audit-break-word" style="font-family: var(--font-mono); font-size: 11px;">
                        ${escapeHtml(item.userAgent || 'Không có User-Agent')}
                    </div>
                </section>

                <section class="drawer-section">
                    <div class="drawer-section-title">Dữ liệu thô (JSON)</div>
                    <pre class="job-detail-stack">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
                </section>
            `,
            footerHtml: `
                <button class="btn btn-secondary" type="button" data-close-view-drawer>Đóng</button>
            `,
            onRender: (body, footer) => {
                footer.querySelector('[data-close-view-drawer]').addEventListener('click', () => Drawer.close());
                body.querySelector('[data-copy-ip]')?.addEventListener('click', (e) => {
                    const ip = e.currentTarget.dataset.copyIp;
                    if (ip) {
                        navigator.clipboard.writeText(ip);
                        Toast.success(`Đã sao chép IP: ${ip}`);
                    }
                });
            }
        });
    },

    updateCountryOptions(availableCountries, selectedCountry) {
        const countrySelect = this.containerEl?.querySelector('#filter-views-country');
        if (!countrySelect) return;

        const currentVal = countrySelect.value;
        const activeCountry = selectedCountry && selectedCountry !== 'all' ? selectedCountry : currentVal;

        // Rebuild options: "all" + sorted countries with counts
        let html = `<option value="all" ${!activeCountry || activeCountry === 'all' ? 'selected' : ''}>Tất cả quốc gia</option>`;
        if (availableCountries && availableCountries.length > 0) {
            html += availableCountries.map(({ name, count }) =>
                `<option value="${escapeHtml(name)}" ${activeCountry === name ? 'selected' : ''}>${escapeHtml(name)} (${count})</option>`
            ).join('');
        } else if (activeCountry && activeCountry !== 'all') {
            // Keep the manually-set filter visible even if list is empty
            html += `<option value="${escapeHtml(activeCountry)}" selected>${escapeHtml(activeCountry)}</option>`;
        }

        countrySelect.innerHTML = html;
    },

    handleClearViews() {
        ConfirmModal.show({
            title: 'Xóa toàn bộ nhật ký lượt xem',
            message: 'Bạn có chắc chắn muốn xóa toàn bộ lịch sử lượt xem và khách truy cập? Thao tác này sẽ đặt lại toàn bộ thống kê và không thể hoàn tác.',
            confirmText: 'Xóa toàn bộ',
            isDanger: true,
            onConfirm: async () => {
                try {
                    await AdminApi.clearViews();
                    Toast.success('Đã xóa sạch lịch sử lượt xem.');
                    this.fetchStats();
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
