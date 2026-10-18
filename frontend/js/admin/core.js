/**
 * Admin Portal Core Orchestrator
 * Handles Authentication Guards, Layout initialization, and View Routing
 */

import { AdminApi } from './api.js';
import { AdminState } from './state.js';
import { Toast, ActionMenu, HealthDot, EnhanceTable, TableDensity } from './components.js';
import { UsersView } from './users-view.js';
import { DashboardView } from './dashboard-view.js';
import { ViewsView } from './views-view.js';
import { JobsView } from './jobs-view.js';
import { OrdersView } from './orders-view.js';
import { FailedPaymentsView } from './failed-payments-view.js';
import { SettingsView } from './settings-view.js';
import { LogsView } from './logs-view.js';
import { MaintenanceView } from './maintenance-view.js';
import { AnnouncementsView } from './announcements-view.js';
import { TicketsView } from './tickets-view.js';
import { DockerLogsView } from './docker-logs-view.js';
import { RefundsView } from './refunds-view.js';

/** Nhóm điều hướng cho breadcrumb — khớp nhãn nhóm trong sidebar. */
const TAB_GROUPS = {
    dashboard: 'Quản lý nghiệp vụ',
    users: 'Quản lý nghiệp vụ',
    views: 'Quản lý nghiệp vụ',
    maintenance: 'Quản lý nghiệp vụ',
    announcements: 'Quản lý nghiệp vụ',
    tickets: 'Quản lý nghiệp vụ',
    refunds: 'Quản lý nghiệp vụ',
    jobs: 'Quản lý nghiệp vụ',
    orders: 'Quản lý nghiệp vụ',
    'failed-payments': 'Quản lý nghiệp vụ',
    settings: 'Hệ thống & An toàn',
    logs: 'Hệ thống & An toàn',
    'docker-logs': 'Hệ thống & An toàn',
};

export const AdminCore = {
    currentUser: null,
    currentView: null,

    async init() {
        AdminState.init();

        // 1. Strict Auth Guard (Session Cookie Authentication)
        try {
            const authRes = await AdminApi.getMe();
            const user = authRes?.user || authRes;
            if (!user || user.role !== 'admin') {
                console.warn('[Admin] Tài khoản không có quyền Admin, chuyển hướng về trang chủ.');
                window.location.replace('/');
                return;
            }
            if (user.status === 'banned') {
                console.warn('[Admin] Tài khoản quản trị đã bị khóa, chuyển hướng về trang chủ.');
                window.location.replace('/');
                return;
            }
            this.currentUser = user;
            this.renderUserProfile(user);
        } catch (err) {
            console.error('[Admin] Lỗi xác thực tài khoản:', err);
            window.location.replace('/');
            return;
        }

        // 2. Bind Sidebar Navigation
        this.bindNavigation();

        // 2b. Bind shell chrome: mobile nav drawer, sidebar collapse, account menu, API health
        this.bindShell();

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
        this.switchTab(initialParams.tab || 'dashboard', false);
    },

    renderUserProfile(user) {
        const nameEl = document.getElementById('admin-sidebar-user-name');
        const roleEl = document.getElementById('admin-sidebar-user-role');
        const avatarEl = document.getElementById('admin-sidebar-user-avatar');

        const displayName = user.name || user.username || user.email || 'Admin';
        if (nameEl) nameEl.textContent = displayName;
        if (roleEl) roleEl.textContent = (user.role || 'Admin').toUpperCase();
        if (avatarEl) {
            avatarEl.textContent = displayName.slice(0, 1).toUpperCase();
        }

        const topbarAvatar = document.getElementById('topbar-user-avatar');
        if (topbarAvatar) topbarAvatar.textContent = displayName.slice(0, 1).toUpperCase();
    },

    bindShell() {
        this.bindMobileNav();
        this.bindSidebarCollapse();
        this.bindUserMenu();
        this.bindTopbarMetrics();
        HealthDot.mount(document.getElementById('admin-health-badge'));
        TableDensity.mount(document.getElementById('admin-density-toggle'));

        // Nhãn cột + cột thao tác cho mọi bảng, kể cả bảng render sau khi đổi tab.
        EnhanceTable.watchDocument();
    },

    /**
     * Chiều cao topbar thay đổi theo bề rộng màn hình (tiêu đề có thể xuống dòng),
     * nên đo thực tế và ghi vào biến CSS — đây là mốc dán của header bảng.
     */
    bindTopbarMetrics() {
        const topbar = document.querySelector('.admin-topbar');
        if (!topbar) return;

        const sync = () => {
            const height = Math.round(topbar.getBoundingClientRect().height);
            if (height > 0) document.documentElement.style.setProperty('--admin-topbar-h', `${height}px`);
        };

        sync();
        if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(topbar);
        else window.addEventListener('resize', sync);
    },

    /** Off-canvas navigation for viewports where the sidebar is hidden. */
    bindMobileNav() {
        const toggle = document.getElementById('admin-nav-toggle');
        const sidebar = document.getElementById('admin-sidebar');
        const backdrop = document.getElementById('admin-nav-backdrop');
        if (!toggle || !sidebar || !backdrop) return;

        const isOpen = () => sidebar.classList.contains('is-open');

        const open = () => {
            sidebar.classList.add('is-open');
            backdrop.hidden = false;
            requestAnimationFrame(() => backdrop.classList.add('show'));
            toggle.setAttribute('aria-expanded', 'true');
            const first = sidebar.querySelector('.nav-item');
            if (first) first.focus();
        };

        const close = (returnFocus = false) => {
            if (!isOpen()) return;
            sidebar.classList.remove('is-open');
            backdrop.classList.remove('show');
            window.setTimeout(() => {
                if (!isOpen()) backdrop.hidden = true;
            }, 240);
            toggle.setAttribute('aria-expanded', 'false');
            if (returnFocus) toggle.focus();
        };

        this.closeMobileNav = close;

        toggle.addEventListener('click', () => (isOpen() ? close() : open()));
        backdrop.addEventListener('click', () => close());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) close(true);
        });
        window.addEventListener('resize', () => {
            if (window.innerWidth > 960) close();
        });
    },

    /** Desktop: collapse the sidebar to an icon rail; preference persisted. */
    bindSidebarCollapse() {
        const btn = document.getElementById('sidebar-collapse-btn');
        const sidebar = document.getElementById('admin-sidebar');
        if (!btn || !sidebar) return;

        const KEY = 'admin_sidebar_collapsed';
        let collapsed = false;
        try { collapsed = localStorage.getItem(KEY) === '1'; } catch {}

        const apply = (value) => {
            sidebar.classList.toggle('collapsed', value);
            btn.setAttribute('aria-expanded', String(!value));
            btn.setAttribute('aria-label', value ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng');
            btn.title = value ? 'Mở rộng' : 'Thu gọn';
        };

        apply(collapsed);
        btn.addEventListener('click', () => {
            collapsed = !sidebar.classList.contains('collapsed');
            apply(collapsed);
            try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch {}
        });
    },

    bindUserMenu() {
        const btn = document.getElementById('topbar-user-btn');
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const user = this.currentUser || {};
            const name = user.name || user.username || user.email || 'Quản trị viên';
            const role = (user.role || 'admin').toUpperCase();
            ActionMenu.open(btn, [
                { label: `${name} · ${role}`, onClick: () => {} },
                { divider: true },
                { label: 'Vào Studio', onClick: () => { window.location.href = '/workspace'; } },
                { label: 'Đăng xuất', danger: true, onClick: () => this.logout() }
            ]);
        });
    },

    async logout() {
        try {
            await AdminApi.logout();
        } catch (e) {
            console.warn('[Admin] Lỗi đăng xuất:', e);
        }
        window.location.replace('/');
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
                const annTag = document.getElementById('nav-tag-announcements');

                if (usersTag && s.totalUsers !== undefined) usersTag.textContent = s.totalUsers;
                if (viewsTag && s.views?.total !== undefined) viewsTag.textContent = s.views.total;
                if (maintTag && s.maintenance?.total !== undefined) maintTag.textContent = s.maintenance.total;
                if (jobsTag && s.jobs?.total !== undefined) jobsTag.textContent = s.jobs.total;
                if (ordersTag && s.revenue !== undefined) ordersTag.textContent = s.revenue.paidOrders || '';

                const failedTag = document.getElementById('nav-tag-failed');
                if (failedTag) {
                    try {
                        const um = await AdminApi.getUnmatched('pending');
                        failedTag.textContent = um.total ?? (um.unmatched || []).length;
                    } catch {
                        failedTag.textContent = '-';
                    }
                }

                if (annTag) {
                    try {
                        const ann = await AdminApi.getAnnouncements({ limit: 1 });
                        annTag.textContent = ann.stats?.active ?? '-';
                    } catch {
                        annTag.textContent = '-';
                    }
                }
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
        const previousTab = this.activeTab;
        this.activeTab = tabName;
        const navItems = document.querySelectorAll('.nav-item[data-tab]');
        navItems.forEach((item) => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        // Close the off-canvas nav after a tab is picked.
        if (typeof this.closeMobileNav === 'function') this.closeMobileNav();

        const titleEl = document.getElementById('topbar-page-title');
        const container = document.getElementById('admin-view-container');
        if (!container) return;

        if (this.currentView && typeof this.currentView.destroy === 'function') {
            try {
                this.currentView.destroy();
            } catch (err) {
                console.warn('[Admin] Lỗi dọn dẹp view cũ:', err);
            }
        }

        if (updateState) {
            AdminState.setParams({ tab: tabName });
        }

        switch (tabName) {
            case 'dashboard':
                if (titleEl) titleEl.textContent = 'Bảng điều khiển & Phân tích';
                DashboardView.init(container);
                this.currentView = DashboardView;
                break;
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
            case 'announcements':
                if (titleEl) titleEl.textContent = 'Thông báo toàn hệ thống (Broadcast Banner)';
                AnnouncementsView.init(container);
                this.currentView = AnnouncementsView;
                break;
            case 'tickets':
                if (titleEl) titleEl.textContent = 'Yêu cầu hỗ trợ (Helpdesk)';
                TicketsView.init(container);
                this.currentView = TicketsView;
                break;
            case 'refunds':
                if (titleEl) titleEl.textContent = 'Yêu cầu hoàn tiền';
                RefundsView.init(container);
                this.currentView = RefundsView;
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
            case 'failed-payments':
                if (titleEl) titleEl.textContent = 'Xử lý giao dịch lỗi';
                FailedPaymentsView.init(container);
                this.currentView = FailedPaymentsView;
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
            case 'docker-logs':
                if (titleEl) titleEl.textContent = 'Docker Logs (Nhật ký Containers)';
                DockerLogsView.init(container);
                this.currentView = DockerLogsView;
                break;
            default:
                if (titleEl) titleEl.textContent = 'Bảng điều khiển & Phân tích';
                DashboardView.init(container);
                this.currentView = DashboardView;
                break;
        }

        this.updateBreadcrumb(tabName);

        // Only on a real tab change (not the first render): jump back to the
        // top and move focus to the heading so keyboard/screen-reader users
        // land on the new content instead of staying where they were.
        if (previousTab && previousTab !== tabName) this.focusViewStart(titleEl);
    },

    updateBreadcrumb(tabName) {
        const el = document.getElementById('topbar-crumb-group');
        if (el) el.textContent = TAB_GROUPS[tabName] || 'Tổng quan';
    },

    focusViewStart(titleEl) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        if (titleEl) titleEl.focus({ preventScroll: true });
    }
};

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    AdminCore.init();
});
