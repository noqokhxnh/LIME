/**
 * Dashboard View — Bảng điều khiển chỉ số SaaS.
 *
 * Hiển thị các chỉ số tăng trưởng & doanh thu định kỳ cho Super Admin:
 *  - Số đăng ký mới, Churn Rate, Trial→Paid
 *  - MRR / ARR, ARPU, LTV
 *  - Chức năng nào được dùng nhiều (từ các job đã tạo và lượt truy cập trang)
 *
 * Giao diện tái sử dụng bộ class có sẵn của views (`views-kpi-*`, `views-widget-*`,
 * `views-bar-*`) và bổ sung một vài class `dash-*` cho biểu đồ xu hướng.
 */

import { AdminApi } from './api.js';
import { Toast, AlertBanner } from './components.js';

const PERIODS = [
    { value: '7d', label: '7 ngày qua' },
    { value: '30d', label: '30 ngày qua' },
    { value: '90d', label: '90 ngày qua' },
    { value: '12m', label: '12 tháng qua' },
];

export const DashboardView = {
    containerEl: null,
    period: '30d',
    lastData: null,

    init(container) {
        this.containerEl = container;
        this.renderStructure();
        this.bindEvents();
        this.fetchAndRender();
    },

    renderStructure() {
        this.containerEl.innerHTML = `
            <!-- Thanh chọn kỳ + làm mới -->
            <div class="filter-toolbar">
                <div class="filter-row-bottom">
                    <div class="filter-groups">
                        <div class="filter-select-wrapper">
                            <span class="filter-label">Khoảng thời gian:</span>
                            <select class="select-custom" id="dashboard-period">
                                ${PERIODS.map(
                                    (p) =>
                                        `<option value="${p.value}" ${this.period === p.value ? 'selected' : ''}>${p.label}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <span class="filter-label" id="dashboard-window-label"></span>
                    </div>
                    <div class="filter-actions">
                        <button class="btn btn-secondary" id="btn-refresh-dashboard">Làm mới</button>
                    </div>
                </div>
            </div>

            <!-- KPI chính -->
            <div class="views-kpi-grid" id="dashboard-kpi-grid">
                ${this.kpiCard('dashboard-kpi-mrr', 'MRR (Doanh thu tháng)', 'chart')}
                ${this.kpiCard('dashboard-kpi-arr', 'ARR (Doanh thu năm)', 'chart')}
                ${this.kpiCard('dashboard-kpi-arpu', 'ARPU (TB/khách)', 'user')}
                ${this.kpiCard('dashboard-kpi-ltv', 'LTV (Vòng đời)', 'heart')}
                ${this.kpiCard('dashboard-kpi-churn', 'Churn Rate (Rời bỏ)', 'down')}
                ${this.kpiCard('dashboard-kpi-conversion', 'Trial → Trả phí', 'check')}
                ${this.kpiCard('dashboard-kpi-signups', 'Đăng ký mới', 'plus')}
            </div>

            <!-- Biểu đồ xu hướng đăng ký -->
            <div class="views-widget-card" style="margin-top: 16px;">
                <div class="views-widget-title">Đăng ký mới theo thời gian</div>
                <div class="dash-trend" id="dashboard-signups-trend">
                    <div class="views-widget-loading">Đang tải số liệu...</div>
                </div>
            </div>

            <!-- Widget chức năng dùng nhiều -->
            <div class="views-widgets-grid" style="margin-top: 16px;" id="dashboard-feature-grid">
                <div class="views-widget-card">
                    <div class="views-widget-title">Tỷ lệ khung hình được dùng</div>
                    <div class="views-widget-list" id="dash-dim-aspectRatio">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
                <div class="views-widget-card">
                    <div class="views-widget-title">Phong cách hình ảnh</div>
                    <div class="views-widget-list" id="dash-dim-style">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
                <div class="views-widget-card">
                    <div class="views-widget-title">Giọng đọc (TTS) sử dụng</div>
                    <div class="views-widget-list" id="dash-dim-ttsProvider">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
                <div class="views-widget-card">
                    <div class="views-widget-title">Tính năng nâng cao được bật</div>
                    <div class="views-widget-list" id="dash-adoption">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
                <div class="views-widget-card">
                    <div class="views-widget-title">Trang được truy cập nhiều nhất</div>
                    <div class="views-widget-list" id="dash-top-pages">
                        <div class="views-widget-loading">Đang tải số liệu...</div>
                    </div>
                </div>
            </div>
        `;
    },

    /** Thẻ KPI dùng lại class `views-kpi-card`. */
    kpiCard(id, label, icon) {
        return `
            <div class="views-kpi-card">
                <div class="views-kpi-header">
                    <span class="views-kpi-label">${escapeHtml(label)}</span>
                    <span class="views-kpi-icon">${iconSvg(icon)}</span>
                </div>
                <div class="views-kpi-value" id="${id}">-</div>
                <div class="views-kpi-sub" id="${id}-sub"></div>
            </div>
        `;
    },

    bindEvents() {
        const periodSelect = this.containerEl.querySelector('#dashboard-period');
        if (periodSelect) {
            periodSelect.addEventListener('change', (e) => {
                this.period = e.target.value;
                this.fetchAndRender();
            });
        }
        const refreshBtn = this.containerEl.querySelector('#btn-refresh-dashboard');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.fetchAndRender();
                Toast.info('Đang làm mới số liệu dashboard...');
            });
        }
    },

    async fetchAndRender() {
        this.renderLoading();
        try {
            const data = await AdminApi.getAnalytics(this.period);
            this.lastData = data;
            this.renderData(data);
        } catch (err) {
            console.warn('[DashboardView] Lỗi lấy số liệu analytics:', err);
            this.renderError(err);
        }
    },

    renderLoading() {
        const skeleton = '<span class="skeleton-box skeleton-text" style="width: 72%; height: 22px;"></span>';
        for (const id of [
            'dashboard-kpi-mrr',
            'dashboard-kpi-arr',
            'dashboard-kpi-arpu',
            'dashboard-kpi-ltv',
            'dashboard-kpi-churn',
            'dashboard-kpi-conversion',
            'dashboard-kpi-signups',
        ]) {
            const el = this.containerEl.querySelector(`#${id}`);
            if (el) el.innerHTML = skeleton;
            const sub = this.containerEl.querySelector(`#${id}-sub`);
            if (sub) sub.textContent = '';
        }
        const trend = this.containerEl.querySelector('#dashboard-signups-trend');
        if (trend) trend.innerHTML = '<div class="views-widget-loading">Đang tải số liệu...</div>';
    },

    renderError(err) {
        const trend = this.containerEl.querySelector('#dashboard-signups-trend');
        if (trend) {
            AlertBanner.render(trend, {
                title: 'Không tải được số liệu phân tích',
                message: err.message || 'Vui lòng thử lại sau ít phút.',
                onRetry: () => this.fetchAndRender()
            });
        }
    },

    renderData(data) {
        const kpi = data.kpi || {};
        const { window } = data;
        const windowLabel = this.containerEl.querySelector('#dashboard-window-label');
        if (windowLabel && window) {
            windowLabel.textContent = `Từ ${formatDate(window.from)} đến ${formatDate(window.to)}`;
        }

        this.setText('dashboard-kpi-mrr', formatVnd(kpi.mrrVnd));
        this.setSub('dashboard-kpi-mrr', `${formatNumber(data.revenue?.activeSubscriptions)} gói đang hoạt động`);

        this.setText('dashboard-kpi-arr', formatVnd(kpi.arrVnd));
        this.setSub('dashboard-kpi-arr', 'MRR × 12');

        this.setText('dashboard-kpi-arpu', formatVnd(kpi.arpuVnd));
        this.setSub('dashboard-kpi-arpu', 'MRR ÷ số khách trả phí');

        this.setText('dashboard-kpi-ltv', formatVnd(kpi.ltvVnd));
        this.setSub('dashboard-kpi-ltv', `ARPU ÷ churn tháng (${formatPercent(data.churn?.monthlyRate)})`);

        this.setText('dashboard-kpi-churn', formatPercent(kpi.churnRate));
        this.setSub('dashboard-kpi-churn', `${formatNumber(data.churn?.churned)} rời bỏ / ${formatNumber(data.churn?.activeAtStart)} đầu kỳ`);

        this.setText('dashboard-kpi-conversion', formatPercent(kpi.trialToPaidRate));
        this.setSub('dashboard-kpi-conversion', `${formatNumber(data.conversion?.converted)} chuyển đổi / ${formatNumber(data.conversion?.trialPool)} dùng thử`);

        this.setText('dashboard-kpi-signups', formatNumber(kpi.newSignups));
        this.setSub('dashboard-kpi-signups', `Toàn hệ thống: ${formatNumber(data.conversion?.totalUsers)} tài khoản`);

        this.renderTrend(data.signups);
        this.renderFeatureUsage(data.featureUsage);
    },

    setText(id, value) {
        const el = this.containerEl.querySelector(`#${id}`);
        if (el) el.textContent = value;
    },

    setSub(id, value) {
        const el = this.containerEl.querySelector(`#${id}-sub`);
        if (el) el.textContent = value;
    },

    renderTrend(signups) {
        const container = this.containerEl.querySelector('#dashboard-signups-trend');
        if (!container) return;
        const series = signups?.series || [];
        if (series.length === 0) {
            container.innerHTML = `<div class="views-widget-empty">Chưa có dữ liệu đăng ký.</div>`;
            return;
        }

        const max = Math.max(1, ...series.map((p) => p.count));
        // Với chuỗi dài (90 ngày / 12 tháng) chỉ hiện nhãn thưa để không rối.
        const labelEvery = Math.ceil(series.length / 12);

        container.innerHTML = series
            .map((point, index) => {
                const heightPct = Math.round((point.count / max) * 100);
                const showLabel = index % labelEvery === 0 || index === series.length - 1;
                const shortDate = signups.monthly ? point.date : point.date.slice(5);
                return `
                    <div class="dash-trend-col" title="${escapeHtml(point.date)}: ${point.count} đăng ký">
                        <div class="dash-trend-bar-track">
                            <div class="dash-trend-bar" style="height: ${Math.max(2, heightPct)}%;"></div>
                        </div>
                        <span class="dash-trend-value">${point.count > 0 ? point.count : ''}</span>
                        <span class="dash-trend-label">${showLabel ? escapeHtml(shortDate) : ''}</span>
                    </div>
                `;
            })
            .join('');
    },

    renderFeatureUsage(featureUsage) {
        const usage = featureUsage || {};
        const dimensions = usage.dimensions || [];

        for (const dim of dimensions) {
            this.renderBarList(`#dash-dim-${dim.key}`, dim.items || [], 'Chưa có dữ liệu');
        }
        this.renderBarList('#dash-adoption', usage.adoption || [], 'Chưa có job nào được tạo trong hệ thống');
        this.renderBarList('#dash-top-pages', usage.topPages || [], 'Chưa có dữ liệu truy cập');
    },

    /** Danh sách thanh ngang — dùng lại class `views-bar-*` của views. */
    renderBarList(selector, items, emptyMsg) {
        const container = this.containerEl.querySelector(selector);
        if (!container) return;
        if (!items || items.length === 0) {
            container.innerHTML = `<div class="views-widget-empty">${escapeHtml(emptyMsg)}</div>`;
            return;
        }
        container.innerHTML = items
            .map(
                (item) => `
                <div class="views-bar-item">
                    <div class="views-bar-header">
                        <span class="views-bar-label audit-break-word" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                        <span class="views-bar-count">${formatNumber(item.count)} <span class="views-bar-pct">(${item.percentage}%)</span></span>
                    </div>
                    <div class="views-bar-track">
                        <div class="views-bar-fill" style="width: ${Math.min(100, Math.max(2, item.percentage))}%;"></div>
                    </div>
                </div>
            `
            )
            .join('');
    },
};

function iconSvg(name) {
    const icons = {
        chart:
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
        user: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        heart:
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
        down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l6 6 4-4 8 8"/><path d="M21 17v-4h-4"/></svg>',
        check:
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
        plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    };
    return icons[name] || icons.chart;
}

function formatVnd(value) {
    return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')} ₫`;
}

function formatNumber(value) {
    return (Number(value) || 0).toLocaleString('vi-VN');
}

function formatPercent(rate) {
    const pct = (Number(rate) || 0) * 100;
    return `${pct.toFixed(pct > 0 && pct < 10 ? 1 : 0)}%`;
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('vi-VN');
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
