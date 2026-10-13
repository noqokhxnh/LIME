/**
 * Admin Portal Core Orchestrator
 * Handles Authentication Guards, Layout initialization, and View Routing
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast } from './components.js';
import { UsersView } from './users-view.js';
import { ViewsView } from './views-view.js';
import { JobsView } from './jobs-view.js';
import { OrdersView } from './orders-view.js';
import { SettingsView } from './settings-view.js';
import { LogsView } from './logs-view.js';
import { MaintenanceView } from './maintenance-view.js';

export const AdminCore = {
    currentUser: null,
    currentView: null,

    async init() {
        AdminState.init();

        // 1. Strict Auth Guard
        let token = AdminApi.getToken();
        if (!token) {
            try {
                const cookieRes = await fetch('/api/auth/me', { credentials: 'include' });
                const authData = await cookieRes.json();
                if (authData?.authenticated && authData?.token) {
                    localStorage.setItem('vidtml_token', authData.token);
                    token = authData.token;
                }
            } catch (e) {}
        }

        if (!token) {
            console.warn('[Admin] Chưa đăng nhập, chuyển hướng về trang chủ.');
            window.location.replace('/');
            return;
        }

        try {
            const authRes = await AdminApi.getMe();
            if (!authRes.authenticated || !authRes.user || authRes.user.role !== 'admin') {
                console.warn('[Admin] Tài khoản không có quyền Admin, chuyển hướng về trang chủ.');
                window.location.replace('/');
                return;
            }
            this.currentUser = authRes.user;
            this.renderUserProfile(authRes.user);
        } catch (err) {
            console.error('[Admin] Lỗi xác thực tài khoản:', err);
            window.location.replace('/');
            return;
        }

        // 2. Bind Sidebar Navigation
        this.bindNavigation();

        // 3. Load stats for badge tags
        this.loadSidebarStats();

        // 4. Listen for URL changes
        AdminState.onChange((state) => {
            // Query changes within a tab are handled by that view. Reinitializing
            // here used to discard selection and race the view's own fetch.
            if (state.tab !== this.activeTab) this.switchTab(state.tab, false);
        });

        // 5. Initial Tab Load
        const initialParams = AdminState.getParamsFromUrl();
        this.switchTab(initialParams.tab || 'users', false);
    },

    renderUserProfile(user) {
        const nameEl = document.getElementById('admin-sidebar-user-name');
        const roleEl = document.getElementById('admin-sidebar-user-role');
        const avatarEl = document.getElementById('admin-sidebar-user-avatar');

        if (nameEl) nameEl.textContent = user.name || user.email;
        if (roleEl) roleEl.textContent = (user.role || 'Admin').toUpperCase();
        if (avatarEl) {
            avatarEl.textContent = (user.name || user.email || 'A').slice(0, 1).toUpperCase();
        }
    },

    async loadSidebarStats() {
        try {
            const res = await AdminApi.getStats();
            if (res.stats) {
                const s = res.stats;
                const usersTag = document.getElementById('nav-tag-users');
                const viewsTag = document.getElementById('nav-tag-views');
                const maintTag = document.getElementById('nav-tag-maintenance');
                const jobsTag = document.getElementById('nav-tag-jobs');
                const ordersTag = document.getElementById('nav-tag-orders');

                if (usersTag && s.totalUsers !== undefined) usersTag.textContent = s.totalUsers;
                if (viewsTag && s.views?.total !== undefined) viewsTag.textContent = s.views.total;
                if (maintTag && s.maintenance?.total !== undefined) maintTag.textContent = s.maintenance.total;
                if (jobsTag && s.jobs?.total !== undefined) jobsTag.textContent = s.jobs.total;
                if (ordersTag && s.revenue !== undefined) ordersTag.textContent = s.revenue.paidOrders || '';
            }
        } catch (e) {
            console.warn('[Admin] Lỗi lấy số liệu sidebar:', e);
        }
    },

    bindNavigation() {
        const navItems = document.querySelectorAll('.nav-item[data-tab]');
        navItems.forEach((item) => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = item.dataset.tab;
                AdminState.setParams({ tab, page: 1 });
            });
        });
    },

    switchTab(tabName, updateState = true) {
        this.activeTab = tabName;
        const navItems = document.querySelectorAll('.nav-item[data-tab]');
        navItems.forEach((item) => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        const titleEl = document.getElementById('topbar-page-title');
        const container = document.getElementById('admin-view-container');
        if (!container) return;

        if (updateState) {
            AdminState.setParams({ tab: tabName });
        }

        switch (tabName) {
            case 'users':
                if (titleEl) titleEl.textContent = 'Quản lý người dùng';
                UsersView.init(container);
                this.currentView = UsersView;
                break;
            case 'views':
                if (titleEl) titleEl.textContent = 'Quản lý lượt xem & Khách truy cập';
                ViewsView.init(container);
                this.currentView = ViewsView;
                break;
            case 'maintenance':
                if (titleEl) titleEl.textContent = 'Khách truy cập khi tắt máy / bảo trì';
                MaintenanceView.init(container);
                this.currentView = MaintenanceView;
                break;
            case 'jobs':
                if (titleEl) titleEl.textContent = 'Quản lý Video Jobs';
                JobsView.init(container);
                this.currentView = JobsView;
                break;
            case 'orders':
                if (titleEl) titleEl.textContent = 'Quản lý đơn hàng & Doanh thu';
                OrdersView.init(container);
                this.currentView = OrdersView;
                break;
            case 'settings':
                if (titleEl) titleEl.textContent = 'Cấu hình hệ thống';
                SettingsView.init(container);
                this.currentView = SettingsView;
                break;
            case 'logs':
                if (titleEl) titleEl.textContent = 'Nhật ký kiểm toán (Audit Logs)';
                LogsView.init(container);
                this.currentView = LogsView;
                break;
            default:
                if (titleEl) titleEl.textContent = 'Quản lý người dùng';
                UsersView.init(container);
                this.currentView = UsersView;
                break;
        }
    }
};

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    AdminCore.init();
});
