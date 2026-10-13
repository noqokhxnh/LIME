/**
 * User Management View Component
 * Handles table rendering, filtering, side sheet (drawer), quick status toggle, and bulk actions
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, Drawer, ConfirmModal, Pagination, Skeleton, EmptyState, SwitchToggle, ActionMenu, BulkBar, formatLocation, formatIsp } from './components.js';

export const UsersView = {
    containerEl: null,
    selectedUserIds: new Set(),
    cachedUsers: [],
    totalRecords: 0,
    searchDebounceTimer: null,
    popstateBound: false,

    init(container) {
        this.containerEl = container;
        this.selectedUserIds.clear();
        this.renderStructure();
        this.bindEvents();
        this.fetchAndRender();
        if (!this.popstateBound) {
            window.addEventListener('popstate', () => {
                if (this.containerEl?.isConnected && AdminState.getParamsFromUrl().tab === 'users') {
                    clearTimeout(this.searchDebounceTimer);
                    this.selectedUserIds.clear();
                    this.renderStructure();
                    this.bindEvents();
                    this.fetchAndRender();
                }
            });
            this.popstateBound = true;
        }
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
                        <input type="text" class="search-input" id="user-search-input" placeholder="Tìm kiếm theo Tên, Email, ID, IP hoặc Nhà mạng..." value="${escapeHtml(state.search)}">
                        <button class="search-clear-btn" id="user-search-clear-btn" style="display: ${state.search ? 'block' : 'none'};">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Trạng thái:</span>
                            <select class="select-custom" id="filter-user-status">
                                <option value="all" ${state.status === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="active" ${state.status === 'active' ? 'selected' : ''}>Đang hoạt động</option>
                                <option value="banned" ${state.status === 'banned' ? 'selected' : ''}>Bị khóa</option>
                                <option value="deleted" ${state.status === 'deleted' ? 'selected' : ''}>Đã xóa mềm</option>
                            </select>
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Vai trò:</span>
                            <select class="select-custom" id="filter-user-role">
                                <option value="all" ${state.role === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="user" ${state.role === 'user' ? 'selected' : ''}>User</option>
                                <option value="admin" ${state.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Gói cước:</span>
                            <select class="select-custom" id="filter-user-tier">
                                <option value="all" ${state.tier === 'all' ? 'selected' : ''}>Tất cả</option>
                                <option value="free" ${state.tier === 'free' ? 'selected' : ''}>Free</option>
                                <option value="pro" ${state.tier === 'pro' ? 'selected' : ''}>Pro</option>
                                <option value="enterprise" ${state.tier === 'enterprise' ? 'selected' : ''}>Enterprise</option>
                            </select>
                        </div>
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Sắp xếp:</span>
                            <select class="select-custom" id="filter-user-sort">
                                <option value="createdAt_desc" ${state.sortBy === 'createdAt' && state.sortOrder === 'desc' ? 'selected' : ''}>Mới nhất</option>
                                <option value="createdAt_asc" ${state.sortBy === 'createdAt' && state.sortOrder === 'asc' ? 'selected' : ''}>Cũ nhất</option>
                                <option value="credits_desc" ${state.sortBy === 'credits' && state.sortOrder === 'desc' ? 'selected' : ''}>Nhiều credits nhất</option>
                                <option value="name_asc" ${state.sortBy === 'name' && state.sortOrder === 'asc' ? 'selected' : ''}>Tên A-Z</option>
                            </select>
                        </div>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-users" title="Làm mới">↻ Tải lại</button>
                    </div>
                </div>
            </div>

            <div class="table-panel">
                <div class="table-wrapper">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;">
                                    <input type="checkbox" class="admin-checkbox" id="check-all-users">
                                </th>
                                <th>Người dùng</th>
                                <th>Gói cước & Credits</th>
                                <th>Địa điểm / ISP</th>
                                <th>Đăng nhập cuối</th>
                                <th style="width: 130px;">Trạng thái</th>
                                <th style="width: 60px; text-align: center;">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="users-table-body"></tbody>
                    </table>
                </div>
                <div id="users-empty-container"></div>
                <div id="users-pagination-container"></div>
            </div>
        `;
    },

    bindEvents() {
        const searchInput = this.containerEl.querySelector('#user-search-input');
        const clearBtn = this.containerEl.querySelector('#user-search-clear-btn');
        const statusSelect = this.containerEl.querySelector('#filter-user-status');
        const roleSelect = this.containerEl.querySelector('#filter-user-role');
        const tierSelect = this.containerEl.querySelector('#filter-user-tier');
        const sortSelect = this.containerEl.querySelector('#filter-user-sort');
        const refreshBtn = this.containerEl.querySelector('#btn-refresh-users');
        const checkAll = this.containerEl.querySelector('#check-all-users');

        // Search Input Debouncing
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
            AdminState.setParams({ status: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        roleSelect.onchange = (e) => {
            AdminState.setParams({ role: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        tierSelect.onchange = (e) => {
            AdminState.setParams({ tier: e.target.value, page: 1 });
            this.fetchAndRender();
        };

        sortSelect.onchange = (e) => {
            const [sortBy, sortOrder] = e.target.value.split('_');
            AdminState.setParams({ sortBy, sortOrder, page: 1 });
            this.fetchAndRender();
        };

        refreshBtn.onclick = () => {
            this.fetchAndRender();
            Toast.info('Đang làm mới danh sách người dùng...');
        };

        // Select All Checkbox
        checkAll.onchange = (e) => {
            const isChecked = e.target.checked;
            const checkboxes = this.containerEl.querySelectorAll('.user-row-checkbox');
            checkboxes.forEach((cb) => {
                cb.checked = isChecked;
                const userId = cb.dataset.userId;
                if (isChecked) {
                    this.selectedUserIds.add(userId);
                    cb.closest('tr')?.classList.add('row-selected');
                } else {
                    this.selectedUserIds.delete(userId);
                    cb.closest('tr')?.classList.remove('row-selected');
                }
            });
            this.updateBulkBar();
        };
    },

    async fetchAndRender() {
        const tbody = this.containerEl.querySelector('#users-table-body');
        const emptyContainer = this.containerEl.querySelector('#users-empty-container');
        const paginationContainer = this.containerEl.querySelector('#users-pagination-container');
        const checkAll = this.containerEl.querySelector('#check-all-users');

        if (checkAll) checkAll.checked = false;
        emptyContainer.innerHTML = '';

        // Render Skeleton Loader (Avoid Layout Shift)
        Skeleton.renderTableRows(tbody, 8, 7);

        const params = AdminState.getParamsFromUrl();

        try {
            const res = await AdminApi.getUsers({
                page: params.page,
                limit: params.limit,
                search: params.search,
                status: params.status,
                role: params.role,
                tier: params.tier,
                sortBy: params.sortBy,
                sortOrder: params.sortOrder
            });

            const users = res.users || [];
            this.cachedUsers = users;
            this.totalRecords = res.total || users.length;

            if (users.length === 0) {
                tbody.innerHTML = '';
                emptyContainer.appendChild(
                    EmptyState.render({
                        title: 'Không tìm thấy người dùng nào',
                        description: params.search || params.status !== 'all' || params.role !== 'all' || params.tier !== 'all'
                            ? 'Không có kết quả khớp với tiêu chí tìm kiếm và bộ lọc hiện tại.'
                            : 'Chưa có người dùng nào trong cơ sở dữ liệu.',
                        actionText: (params.search || params.status !== 'all' || params.role !== 'all' || params.tier !== 'all') ? 'Đặt lại bộ lọc' : null,
                        onAction: () => {
                            AdminState.resetFilters();
                            this.renderStructure();
                            this.bindEvents();
                            this.fetchAndRender();
                        }
                    })
                );
                paginationContainer.innerHTML = '';
                return;
            }

            // Render Table Rows
            this.renderTableRows(tbody, users);

            // Render Pagination Component
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

            this.updateBulkBar();
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 30px;">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</td></tr>`;
        }
    },

    renderTableRows(tbody, users) {
        tbody.innerHTML = '';

        users.forEach((user) => {
            const tr = document.createElement('tr');
            if (this.selectedUserIds.has(user.id)) {
                tr.classList.add('row-selected');
            }

            const isBanned = user.status === 'banned';
            const isDeleted = Boolean(user.deletedAt);
            const isSuperAdmin = user.role === 'admin' && (user.email === 'khanh2k5xxx@gmail.com' || user.id === '00000000-0000-4000-a000-000000000001');

            // 1. Checkbox Cell
            const tdCheck = document.createElement('td');
            tdCheck.style.textAlign = 'center';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'admin-checkbox user-row-checkbox';
            cb.dataset.userId = user.id;
            cb.checked = this.selectedUserIds.has(user.id);
            cb.disabled = isSuperAdmin;
            cb.onchange = (e) => {
                if (e.target.checked) {
                    this.selectedUserIds.add(user.id);
                    tr.classList.add('row-selected');
                } else {
                    this.selectedUserIds.delete(user.id);
                    tr.classList.remove('row-selected');
                }
                this.updateBulkBar();
            };
            tdCheck.appendChild(cb);
            tr.appendChild(tdCheck);

            // 2. User Info Cell
            const tdUser = document.createElement('td');
            tdUser.innerHTML = `
                <div class="user-cell">
                    <div class="user-avatar">
                        ${user.picture ? `<img src="${escapeHtml(user.picture)}" alt="" onerror="this.remove()">` : ''}
                        <span>${escapeHtml((user.name || user.email || 'U').slice(0, 1).toUpperCase())}</span>
                    </div>
                    <div class="user-info">
                        <div class="user-name-line">
                            <span>${escapeHtml(user.name || 'Chưa đặt tên')}</span>
                            ${user.role === 'admin' ? '<span class="badge badge-info" style="font-size: 9px; padding: 1px 5px;">ADMIN</span>' : ''}
                            ${isDeleted ? '<span class="badge badge-danger" style="font-size: 9px; padding: 1px 5px;">DELETED</span>' : ''}
                        </div>
                        <div class="user-email-line">${escapeHtml(user.email)}</div>
                    </div>
                </div>
            `;
            tr.appendChild(tdUser);

            // 3. Tier & Credits Cell
            const tdTier = document.createElement('td');
            const tierClass = `tier-${user.tier || 'free'}`;
            tdTier.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="tier-badge ${tierClass}">${escapeHtml((user.tier || 'free').toUpperCase())}</span>
                    <span style="font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--text-main);">${(user.credits || 0).toLocaleString()} cr</span>
                </div>
            `;
            tr.appendChild(tdTier);

            // 4. Location & ISP Cell
            const tdLoc = document.createElement('td');
            tdLoc.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 12px; color: var(--text-main); font-weight: 500;">${escapeHtml(formatLocation(user.lastLocation))}</span>
                    <span style="font-size: 11px; color: var(--text-dim);">${escapeHtml(formatIsp(user.lastIsp) || user.lastLoginIp || 'N/A')}</span>
                </div>
            `;
            tr.appendChild(tdLoc);

            // 5. Last Login Cell
            const tdLogin = document.createElement('td');
            const lastLoginFormatted = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập';
            tdLogin.innerHTML = `<span style="font-size: 12px; color: var(--text-muted);">${lastLoginFormatted}</span>`;
            tr.appendChild(tdLogin);

            // 6. Quick Status Toggle Cell
            const tdStatus = document.createElement('td');
            if (isDeleted) {
                tdStatus.innerHTML = `<span class="badge badge-danger">Đã xóa mềm</span>`;
            } else if (isSuperAdmin) {
                tdStatus.innerHTML = `<span class="badge badge-success">Vĩnh viễn</span>`;
            } else {
                const toggle = SwitchToggle.create({
                    checked: !isBanned,
                    onChange: async (isActive, rollback) => {
                        const targetStatus = isActive ? 'active' : 'banned';
                        try {
                            await AdminApi.updateUser(user.id, { status: targetStatus });
                            user.status = targetStatus;
                            Toast.success(`Đã chuyển trạng thái user ${user.email} thành ${targetStatus}`);
                        } catch (err) {
                            rollback();
                            Toast.error(`Lỗi cập nhật trạng thái: ${err.message}`);
                        }
                    }
                });
                tdStatus.appendChild(toggle);
            }
            tr.appendChild(tdStatus);

            // 7. Action Menu (3-dots)
            const tdActions = document.createElement('td');
            tdActions.style.textAlign = 'center';

            const menuItems = [
                {
                    label: 'Xem chi tiết',
                    onClick: () => this.openUserDrawer(user, 'info')
                },
                {
                    label: 'Chỉnh sửa tài khoản',
                    onClick: () => this.openUserDrawer(user, 'edit')
                },
                {
                    label: 'Lịch sử đăng nhập',
                    onClick: () => this.openUserDrawer(user, 'logs')
                },
                {
                    label: 'Lịch sử Video Jobs',
                    onClick: () => this.openUserDrawer(user, 'jobs')
                },
                { divider: true },
                {
                    label: 'Đặt lại mật khẩu / Key',
                    onClick: () => this.handleResetPassword(user)
                }
            ];

            if (!isSuperAdmin) {
                if (!isDeleted) {
                    menuItems.push({
                        label: 'Xóa tài khoản',
                        danger: true,
                        onClick: () => this.handleDeleteUser(user)
                    });
                } else {
                    menuItems.push({
                        label: 'Khôi phục tài khoản',
                        onClick: () => this.handleRestoreUser(user)
                    });
                }
            }

            const actionMenu = ActionMenu.create(menuItems);
            tdActions.appendChild(actionMenu);
            tr.appendChild(tdActions);

            tbody.appendChild(tr);
        });
    },

    // -------------------------------------------------------------
    // SIDE SHEET / DRAWER LOGIC
    // -------------------------------------------------------------
    openUserDrawer(user, initialTab = 'info') {
        const isSuperAdmin = user.role === 'admin' && (user.email === 'khanh2k5xxx@gmail.com' || user.id === '00000000-0000-4000-a000-000000000001');

        Drawer.open({
            title: user.name || user.email,
            subtitle: `ID: ${user.id}`,
            contentHtml: `
                <div class="drawer-tabs">
                    <button class="drawer-tab ${initialTab === 'info' || initialTab === 'edit' ? 'active' : ''}" data-tab="tab-edit">Thông tin & Cấu hình</button>
                    <button class="drawer-tab ${initialTab === 'logs' ? 'active' : ''}" data-tab="tab-logs">Lịch sử đăng nhập</button>
                    <button class="drawer-tab ${initialTab === 'jobs' ? 'active' : ''}" data-tab="tab-jobs">Lịch sử Video</button>
                </div>

                <div id="drawer-tab-content" style="display: flex; flex-direction: column; gap: 16px;"></div>
            `,
            footerHtml: `
                <button class="btn btn-secondary" id="drawer-cancel-btn">Đóng</button>
                <button class="btn btn-primary" id="drawer-save-btn">Lưu thay đổi</button>
            `,
            onRender: (bodyEl, footerEl) => {
                const tabs = bodyEl.querySelectorAll('.drawer-tab');
                const contentContainer = bodyEl.querySelector('#drawer-tab-content');
                const saveBtn = footerEl.querySelector('#drawer-save-btn');
                const cancelBtn = footerEl.querySelector('#drawer-cancel-btn');

                cancelBtn.onclick = () => Drawer.close();

                const switchTab = (tabName) => {
                    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));

                    if (tabName === 'tab-edit') {
                        saveBtn.style.display = 'inline-flex';
                        this.renderDrawerEditTab(contentContainer, user, isSuperAdmin);
                    } else if (tabName === 'tab-logs') {
                        saveBtn.style.display = 'none';
                        this.renderDrawerLogsTab(contentContainer, user);
                    } else if (tabName === 'tab-jobs') {
                        saveBtn.style.display = 'none';
                        this.renderDrawerJobsTab(contentContainer, user);
                    }
                };

                tabs.forEach((t) => {
                    t.onclick = () => switchTab(t.dataset.tab);
                });

                // Initial Tab Render
                switchTab(initialTab === 'logs' ? 'tab-logs' : initialTab === 'jobs' ? 'tab-jobs' : 'tab-edit');

                // Save button handler
                saveBtn.onclick = async () => {
                    await this.saveUserChanges(user, bodyEl);
                };
            }
        });
    },

    renderDrawerEditTab(container, user, isSuperAdmin) {
        container.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${escapeHtml(user.email)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Đăng ký IP</span>
                    <span class="detail-value">${escapeHtml(user.signupIp || 'N/A')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Vị trí gần nhất</span>
                    <span class="detail-value">${escapeHtml(formatLocation(user.lastLocation))}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Nhà mạng (ISP)</span>
                    <span class="detail-value">${escapeHtml(formatIsp(user.lastIsp))}</span>
                </div>
            </div>

            <div class="drawer-section">
                <div class="drawer-section-title">Cấu hình tài khoản</div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label class="form-label">Gói cước (Tier)</label>
                        <select class="select-custom" id="drawer-user-tier" style="width: 100%;">
                            <option value="free" ${user.tier === 'free' ? 'selected' : ''}>Free</option>
                            <option value="pro" ${user.tier === 'pro' ? 'selected' : ''}>Pro</option>
                            <option value="enterprise" ${user.tier === 'enterprise' ? 'selected' : ''}>Enterprise</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Thời hạn gói (ngày)</label>
                        <input type="number" class="form-input" id="drawer-user-duration" value="30" min="1" max="3650">
                    </div>
                </div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label class="form-label">Credits hiện tại</label>
                        <input type="number" class="form-input" id="drawer-user-credits" value="${user.credits || 0}">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Vai trò (Role)</label>
                        <select class="select-custom" id="drawer-user-role" style="width: 100%;" ${isSuperAdmin ? 'disabled' : ''}>
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Trạng thái tài khoản</label>
                    <select class="select-custom" id="drawer-user-status" style="width: 100%;" ${isSuperAdmin ? 'disabled' : ''}>
                        <option value="active" ${user.status !== 'banned' ? 'selected' : ''}>Active (Hoạt động)</option>
                        <option value="banned" ${user.status === 'banned' ? 'selected' : ''}>Banned (Bị khóa)</option>
                    </select>
                </div>
            </div>
        `;
    },

    async renderDrawerLogsTab(container, user) {
        container.innerHTML = '<div style="color: var(--text-dim); padding: 20px 0; text-align: center;">Đang tải lịch sử đăng nhập...</div>';

        try {
            const res = await AdminApi.getUserLoginLogs(user.id, 50);
            const logs = res.logs || [];

            if (logs.length === 0) {
                container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">Chưa có lịch sử đăng nhập nào được ghi nhận.</div>';
                return;
            }

            let html = `
                <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 8px;">Hiển thị ${logs.length} lượt đăng nhập gần nhất:</div>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
                    <table class="admin-table" style="font-size: 11px;">
                        <thead>
                            <tr>
                                <th>Thời gian</th>
                                <th>IP & Địa điểm</th>
                                <th>Nhà mạng</th>
                                <th>Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            logs.forEach((log) => {
                const time = new Date(log.createdAt).toLocaleString('vi-VN');
                const isSuccess = log.status === 'success';
                html += `
                    <tr>
                        <td style="white-space: nowrap;">${time}</td>
                        <td>
                            <div>${escapeHtml(log.ipAddress)}</div>
                            <div style="color: var(--text-dim); font-size: 10px;">${escapeHtml(formatLocation(log.location))}</div>
                        </td>
                        <td>${escapeHtml(formatIsp(log.isp))}</td>
                        <td><span class="badge ${isSuccess ? 'badge-success' : 'badge-danger'}">${log.status}</span></td>
                    </tr>
                `;
            });

            html += `</tbody></table></div>`;
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 20px;">Lỗi: ${escapeHtml(err.message)}</div>`;
        }
    },

    async renderDrawerJobsTab(container, user) {
        container.innerHTML = '<div style="color: var(--text-dim); padding: 20px 0; text-align: center;">Đang tải danh sách video...</div>';

        try {
            const res = await AdminApi.getUserJobs(user.id);
            const jobs = res.jobs || [];

            if (jobs.length === 0) {
                container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">Người dùng này chưa tạo video nào.</div>';
                return;
            }

            let html = `
                <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 8px;">Tổng cộng ${jobs.length} video jobs:</div>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
                    <table class="admin-table" style="font-size: 11px;">
                        <thead>
                            <tr>
                                <th>Job ID</th>
                                <th>Chủ đề / Prompt</th>
                                <th>Trạng thái</th>
                                <th>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            jobs.forEach((j) => {
                const jobId = j.id || j.jobId || '';
                const shortId = jobId ? jobId.slice(0, 8) + '...' : 'N/A';
                const time = j.createdAt ? new Date(j.createdAt).toLocaleDateString('vi-VN') : 'N/A';
                const statusBadge = j.status === 'completed' ? 'badge-success' : j.status === 'failed' ? 'badge-danger' : 'badge-warning';
                const prompt = j.prompt || j.topic || (j.request && j.request.prompt) || 'Video generation';
                html += `
                    <tr>
                        <td style="font-family: var(--font-mono);">${escapeHtml(shortId)}</td>
                        <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(prompt)}</td>
                        <td><span class="badge ${statusBadge}">${escapeHtml(j.status || 'unknown')}</span></td>
                        <td>${time}</td>
                    </tr>
                `;
            });

            html += `</tbody></table></div>`;
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 20px;">Lỗi: ${escapeHtml(err.message)}</div>`;
        }
    },

    async saveUserChanges(user, drawerBody) {
        const tier = drawerBody.querySelector('#drawer-user-tier')?.value;
        const durationDays = parseInt(drawerBody.querySelector('#drawer-user-duration')?.value || '30', 10);
        const credits = parseInt(drawerBody.querySelector('#drawer-user-credits')?.value || '0', 10);
        const role = drawerBody.querySelector('#drawer-user-role')?.value;
        const status = drawerBody.querySelector('#drawer-user-status')?.value;

        try {
            const updatePayload = { tier, durationDays, credits };
            if (role) updatePayload.role = role;
            if (status) updatePayload.status = status;

            await AdminApi.updateUser(user.id, updatePayload);
            Toast.success('Cập nhật thông tin người dùng thành công!');
            Drawer.close();
            this.fetchAndRender();
        } catch (err) {
            Toast.error(`Lỗi cập nhật: ${err.message}`);
        }
    },

    // -------------------------------------------------------------
    // ROW ACTIONS HANDLERS
    // -------------------------------------------------------------
    handleResetPassword(user) {
        ConfirmModal.show({
            title: 'Đặt lại mật khẩu / API Key',
            message: `Bạn có chắc muốn đặt lại quyền truy cập cho người dùng <strong>${escapeHtml(user.email)}</strong>? Hệ thống sẽ cập nhật thông tin bảo mật và ghi nhật ký kiểm toán.`,
            confirmText: 'Đặt lại ngay',
            onConfirm: async () => {
                try {
                    await AdminApi.resetPassword(user.id);
                    Toast.success(`Đã xử lý đặt lại quyền truy cập cho ${user.email}`);
                } catch (err) {
                    Toast.error(`Lỗi đặt lại: ${err.message}`);
                }
            }
        });
    },

    handleDeleteUser(user) {
        ConfirmModal.show({
            title: 'Xác nhận xóa người dùng',
            message: `Bạn có chắc chắn muốn xóa người dùng <strong>${escapeHtml(user.email)}</strong>? Thao tác này sẽ đưa người dùng vào trạng thái xóa mềm (Soft-deleted).`,
            confirmText: 'Xóa người dùng',
            isDanger: true,
            onConfirm: async () => {
                try {
                    await AdminApi.deleteUser(user.id, false);
                    Toast.success(`Đã xóa mềm người dùng ${user.email}`);
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi xóa người dùng: ${err.message}`);
                }
            }
        });
    },

    handleRestoreUser(user) {
        ConfirmModal.show({
            title: 'Khôi phục người dùng',
            message: `Khôi phục tài khoản <strong>${escapeHtml(user.email)}</strong> hoạt động trở lại?`,
            confirmText: 'Khôi phục',
            onConfirm: async () => {
                try {
                    await AdminApi.restoreUser(user.id);
                    Toast.success(`Đã khôi phục người dùng ${user.email}`);
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi khôi phục: ${err.message}`);
                }
            }
        });
    },

    // -------------------------------------------------------------
    // BULK ACTIONS BAR
    // -------------------------------------------------------------
    updateBulkBar() {
        const count = this.selectedUserIds.size;

        BulkBar.update({
            selectedCount: count,
            actions: [
                {
                    label: 'Kích hoạt hàng loạt',
                    onClick: () => this.handleBulkAction('activate')
                },
                {
                    label: 'Khóa hàng loạt',
                    onClick: () => this.handleBulkAction('suspend')
                },
                {
                    label: 'Xóa hàng loạt',
                    isDanger: true,
                    onClick: () => this.handleBulkAction('delete')
                },
                {
                    label: 'Xuất CSV',
                    onClick: () => this.exportSelectedUsers()
                }
            ],
            onClear: () => {
                this.selectedUserIds.clear();
                const checkAll = this.containerEl.querySelector('#check-all-users');
                if (checkAll) checkAll.checked = false;
                this.containerEl.querySelectorAll('.user-row-checkbox').forEach((cb) => {
                    cb.checked = false;
                    cb.closest('tr')?.classList.remove('row-selected');
                });
            }
        });
    },

    async handleBulkAction(action) {
        const count = this.selectedUserIds.size;
        if (count === 0) return;

        const actionText = action === 'activate' ? 'kích hoạt' : action === 'suspend' ? 'tạm khóa' : 'xóa';

        ConfirmModal.show({
            title: `Xác nhận ${actionText} hàng loạt`,
            message: `Bạn có chắc muốn <strong>${actionText}</strong> cho <strong>${count}</strong> người dùng đã chọn?`,
            confirmText: `Tiến hành ${actionText}`,
            isDanger: action === 'delete' || action === 'suspend',
            onConfirm: async () => {
                try {
                    const ids = Array.from(this.selectedUserIds);
                    await AdminApi.bulkUsersAction(ids, action);
                    Toast.success(`Đã ${actionText} thành công ${count} người dùng!`);
                    this.selectedUserIds.clear();
                    BulkBar.hide();
                    this.fetchAndRender();
                } catch (err) {
                    Toast.error(`Lỗi thao tác hàng loạt: ${err.message}`);
                }
            }
        });
    },

    exportSelectedUsers() {
        const selected = this.cachedUsers.filter((u) => this.selectedUserIds.has(u.id));
        if (selected.length === 0) {
            Toast.error('Vui lòng chọn ít nhất một người dùng để xuất dữ liệu.');
            return;
        }

        const headers = ['ID', 'Email', 'Name', 'Role', 'Tier', 'Credits', 'Status', 'LastLoginAt', 'LastLocation', 'LastIsp'];
        const csvRows = [headers.join(',')];

        selected.forEach((u) => {
            const row = [
                `"${u.id}"`,
                `"${u.email}"`,
                `"${(u.name || '').replace(/"/g, '""')}"`,
                `"${u.role}"`,
                `"${u.tier}"`,
                u.credits || 0,
                `"${u.status || 'active'}"`,
                `"${u.lastLoginAt || ''}"`,
                `"${(u.lastLocation || '').replace(/"/g, '""')}"`,
                `"${(u.lastIsp || '').replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(','));
        });

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vidtml_users_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        Toast.success(`Đã xuất file CSV cho ${selected.length} người dùng.`);
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
