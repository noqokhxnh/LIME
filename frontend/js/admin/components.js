/** Admin-specific table controls backed by the shared LIME UI kit. */
import '../ui-kit.js';

const SharedUI = window.LIMEUI;
export const Toast = SharedUI.Toast;
export const Drawer = SharedUI.Drawer;
export const ConfirmModal = {
    show({ title, message, confirmText, cancelText, isDanger, onConfirm }) {
        SharedUI.Confirm.show({ title, messageHtml: message, confirmText, cancelText, danger: isDanger })
            .then((confirmed) => { if (confirmed && typeof onConfirm === 'function') return onConfirm(); })
            .catch((error) => console.error('[ConfirmModal] Action failed:', error));
    },
    close() { SharedUI.Confirm.resolve(false); }
};

// 4. PAGINATION COMPONENT
export const Pagination = {
    render({ container, page = 1, currentPage, limit = 25, total = 0, totalRecords, onPageChange, onLimitChange }) {
        const target = container || document.createElement('div');
        const activePage = parseInt(page || currentPage || 1, 10) || 1;
        const activeLimit = parseInt(limit || 25, 10) || 25;
        const totalCount = parseInt(total !== undefined && total !== null ? total : (totalRecords || 0), 10) || 0;

        const totalPages = Math.ceil(totalCount / activeLimit) || 1;
        const startRecord = totalCount === 0 ? 0 : (activePage - 1) * activeLimit + 1;
        const endRecord = Math.min(activePage * activeLimit, totalCount);

        target.innerHTML = `
            <div class="pagination-bar">
                <div class="pagination-info">
                    Hiển thị <strong>${startRecord.toLocaleString()} - ${endRecord.toLocaleString()}</strong> trên tổng số <strong>${totalCount.toLocaleString()}</strong> bản ghi
                </div>
                <div class="pagination-controls">
                    <div class="filter-select-wrapper pagination-limit-control">
                        <span class="filter-label">Mỗi trang</span>
                        <select class="select-custom select-limit" id="pagination-limit-select">
                            <option value="10" ${activeLimit === 10 ? 'selected' : ''}>10</option>
                            <option value="25" ${activeLimit === 25 ? 'selected' : ''}>25</option>
                            <option value="50" ${activeLimit === 50 ? 'selected' : ''}>50</option>
                            <option value="100" ${activeLimit === 100 ? 'selected' : ''}>100</option>
                        </select>
                    </div>

                    <div class="pagination-stepper" role="group" aria-label="Điều hướng trang">
                        <button class="page-btn" id="btn-page-first" aria-label="Trang đầu" title="Trang đầu" ${activePage <= 1 ? 'disabled' : ''}>«</button>
                        <button class="page-btn" id="btn-page-prev" aria-label="Trang trước" title="Trang trước" ${activePage <= 1 ? 'disabled' : ''}>‹</button>
                        <div id="pagination-page-numbers" class="pagination-page-numbers"></div>
                        <button class="page-btn" id="btn-page-next" aria-label="Trang sau" title="Trang sau" ${activePage >= totalPages ? 'disabled' : ''}>›</button>
                        <button class="page-btn" id="btn-page-last" aria-label="Trang cuối" title="Trang cuối" ${activePage >= totalPages ? 'disabled' : ''}>»</button>
                    </div>
                </div>
            </div>
        `;

        // Render page numbers with ellipsis
        const pagesContainer = target.querySelector('#pagination-page-numbers');
        const pages = this.getVisiblePages(activePage, totalPages);

        pages.forEach((p) => {
            if (p === '...') {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'page-ellipsis';
                ellipsis.textContent = '…';
                pagesContainer.appendChild(ellipsis);
            } else {
                const btn = document.createElement('button');
                btn.className = `page-btn ${p === activePage ? 'active' : ''}`;
                btn.textContent = p;
                btn.onclick = () => {
                    if (p !== activePage && onPageChange) onPageChange(p);
                };
                pagesContainer.appendChild(btn);
            }
        });

        // Event listeners
        const limitSelect = target.querySelector('#pagination-limit-select');
        limitSelect.onchange = (e) => {
            const newLimit = parseInt(e.target.value, 10);
            if (onLimitChange) onLimitChange(newLimit);
        };

        const btnFirst = target.querySelector('#btn-page-first');
        const btnPrev = target.querySelector('#btn-page-prev');
        const btnNext = target.querySelector('#btn-page-next');
        const btnLast = target.querySelector('#btn-page-last');

        btnFirst.onclick = () => { if (activePage > 1 && onPageChange) onPageChange(1); };
        btnPrev.onclick = () => { if (activePage > 1 && onPageChange) onPageChange(activePage - 1); };
        btnNext.onclick = () => { if (activePage < totalPages && onPageChange) onPageChange(activePage + 1); };
        btnLast.onclick = () => { if (activePage < totalPages && onPageChange) onPageChange(totalPages); };

        return target;
    },

    getVisiblePages(current, total) {
        if (total <= 7) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
        if (current <= 4) {
            return [1, 2, 3, 4, 5, '...', total];
        }
        if (current >= total - 3) {
            return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }
        return [1, '...', current - 1, current, current + 1, '...', total];
    }
};

// 5. SKELETON LOADER
export const Skeleton = {
    renderTableRows(tbodyEl, rows = 8, cols = 7) {
        if (!tbodyEl) return;
        let html = '';
        for (let i = 0; i < rows; i++) {
            html += `<tr>`;
            for (let c = 0; c < cols; c++) {
                if (c === 0) {
                    html += `<td><div class="skeleton-box" style="width: 16px; height: 16px;"></div></td>`;
                } else if (c === 1) {
                    html += `<td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="skeleton-box skeleton-avatar"></div>
                            <div style="display: flex; flex-direction: column; gap: 4px; width: 140px;">
                                <div class="skeleton-box skeleton-text" style="width: 80%;"></div>
                                <div class="skeleton-box skeleton-text" style="width: 100%; height: 10px;"></div>
                            </div>
                        </div>
                    </td>`;
                } else if (c === cols - 1) {
                    html += `<td><div class="skeleton-box" style="width: 28px; height: 28px; border-radius: 6px;"></div></td>`;
                } else {
                    html += `<td><div class="skeleton-box skeleton-text" style="width: ${60 + (c * 10 % 30)}%;"></div></td>`;
                }
            }
            html += `</tr>`;
        }
        tbodyEl.innerHTML = html;
    }
};

// 6. EMPTY STATE
export const EmptyState = {
    /** Markup HTML — dùng khi cần nhúng vào innerHTML (ví dụ một hàng của bảng). */
    markup({ title = 'Không tìm thấy dữ liệu', description = 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.', actionText = 'Đặt lại bộ lọc' } = {}) {
        return `
            <div class="empty-state-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div class="empty-state-title">${title}</div>
            <div class="empty-state-desc">${description}</div>
            ${actionText ? `<button class="btn btn-secondary btn-reset-filter">${actionText}</button>` : ''}
        `;
    },

    render({ title = 'Không tìm thấy dữ liệu', description = 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.', actionText = 'Đặt lại bộ lọc', onAction } = {}) {
        const container = document.createElement('div');
        container.className = 'empty-state';
        container.innerHTML = this.markup({ title, description, actionText });

        if (actionText && typeof onAction === 'function') {
            const btn = container.querySelector('.btn-reset-filter');
            if (btn) btn.onclick = onAction;
        }

        return container;
    },

    /**
     * Hàng bảng rỗng: `<tr><td colspan=N>…empty-state…</td></tr>`.
     * `render()` trả về DOM element nên KHÔNG nội suy được vào template string
     * (sẽ ra "[object HTMLDivElement]") — dùng hàm này cho `<tbody>`.
     */
    rowHtml(colspan, options = {}) {
        const span = Number(colspan) || 1;
        return `<tr class="empty-state-row"><td colspan="${span}"><div class="empty-state">${this.markup(options)}</div></td></tr>`;
    },

    /** Gắn handler cho nút hành động trong vùng vừa ghi bằng rowHtml(). */
    bindAction(scopeEl, onAction) {
        if (!scopeEl) return null;
        const btn = scopeEl.querySelector('.btn-reset-filter');
        if (btn && typeof onAction === 'function') btn.addEventListener('click', onAction);
        return btn;
    }
};

// 6b. INLINE ALERT BANNER — thay cho các dòng lỗi rải rác trong bảng/khối
const escapeAlertHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

export const AlertBanner = {
    iconPath(level) {
        if (level === 'warning') {
            return '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>';
        }
        return '<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/>';
    },

    markup({ title = '', message = '', level = 'danger', retryLabel = 'Thử lại', retryId = '' } = {}) {
        const tone = level === 'warning' ? 'warning' : 'danger';
        const action = retryLabel
            ? `<button type="button" class="btn btn-secondary btn-sm alert-banner-retry"${retryId ? ` id="${escapeAlertHtml(retryId)}"` : ''}>${escapeAlertHtml(retryLabel)}</button>`
            : '';
        const heading = title ? `<div class="alert-banner-title">${escapeAlertHtml(title)}</div>` : '';
        return `
            <div class="alert-banner alert-banner-${tone}" role="alert">
                <svg class="alert-banner-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this.iconPath(level)}</svg>
                <div class="alert-banner-content">
                    ${heading}
                    <div class="alert-banner-message">${escapeAlertHtml(message)}</div>
                </div>
                ${action}
            </div>`;
    },

    /** Markup cho tải bảng thất bại: <tr><td colspan=N>…banner…</td></tr>. */
    rowHtml(colspan, options = {}) {
        const span = Number(colspan) || 1;
        return `<tr class="alert-banner-row"><td colspan="${span}">${this.markup(options)}</td></tr>`;
    },

    /** Thay nội dung một khối bằng banner; gắn sẵn handler cho nút thử lại. */
    render(container, options = {}) {
        if (!container) return null;
        container.innerHTML = this.markup(options);
        return this.bindRetry(container, options.onRetry);
    },

    /** Gắn nút "Thử lại" trong một vùng vừa được ghi bằng rowHtml/render. */
    bindRetry(scopeEl, onRetry) {
        if (!scopeEl) return null;
        const btn = scopeEl.querySelector('.alert-banner-retry');
        if (btn && typeof onRetry === 'function') btn.addEventListener('click', onRetry);
        return btn;
    }
};

// 6c. TABLE ENHANCER — nhãn cột cho card view mobile + cột thao tác dán bên phải
export const EnhanceTable = {
    _tables: new WeakSet(),
    _docObserver: null,
    _rafId: null,

    /**
     * Gắn `data-label` (nhãn cột, dùng cho card view trên mobile) và đánh dấu
     * cột thao tác (dán bên phải khi cuộn ngang).
     *
     * Bỏ qua các "hàng đặc biệt" chỉ có 1 ô (colspan) như hàng rỗng / hàng lỗi —
     * nếu không chúng sẽ bị coi là cột thao tác và dán sai.
     */
    annotate(table) {
        if (!table || !table.querySelector) return;

        const headCells = Array.from(table.querySelectorAll('thead th'));
        if (headCells.length === 0) return;

        const labels = headCells.map((th) => (th.textContent || '').replace(/\s+/g, ' ').trim());
        const actionIndex = labels.findIndex((label) => /^(thao tác|hành động|actions?)$/i.test(label));

        headCells.forEach((th, i) => {
            th.classList.toggle('col-actions', i === actionIndex);
        });

        table.querySelectorAll('tbody tr').forEach((tr) => {
            const cells = tr.querySelectorAll(':scope > td');
            if (cells.length <= 1) {
                // Hàng colspan (empty state / alert banner): không gắn nhãn, không dán.
                cells.forEach((td) => { td.classList.remove('col-actions'); });
                return;
            }
            cells.forEach((td, i) => {
                const label = labels[i];
                if (label && td.dataset.label !== label) td.dataset.label = label;
                td.classList.toggle('col-actions', i === actionIndex);
            });
        });
    },

    /** Idempotent: theo dõi mọi `.admin-table` hiện có và tự chạy lại khi bảng đổi. */
    observe(root = document) {
        root.querySelectorAll('.admin-table').forEach((table) => {
            if (this._tables.has(table)) return;
            this._tables.add(table);
            this.annotate(table);

            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            new MutationObserver(() => this.scheduleAnnotate(table)).observe(tbody, {
                childList: true,
                subtree: true
            });
        });
    },

    /** Gộp nhiều lần render liên tiếp vào một lần quét trong khung hình kế tiếp. */
    scheduleAnnotate(table) {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this.annotate(table);
            this.scheduleFit();
        });
    },

    /** Theo dõi cả những bảng được thêm vào DOM sau (khi đổi tab). */
    watchDocument() {
        if (this._docObserver) {
            this.observe();
        } else {
            this._docObserver = new MutationObserver(() => {
                this.observe();
                this.scheduleFit();
            });
            this._docObserver.observe(document.body, { childList: true, subtree: true });
        }

        window.addEventListener('resize', () => this.scheduleFit());
        this.observe();
        this.scheduleFit();
    },

    /**
     * Cắt chiều cao `.table-wrapper` theo vị trí thật của nó để phần phân trang
     * luôn nằm trong màn hình đầu — nhờ đó `thead` dán được mà vẫn thấy trang.
     */
    fitToViewport() {
        document.querySelectorAll('.table-wrapper').forEach((wrapper) => {
            const documentOffset = wrapper.getBoundingClientRect().top + window.scrollY;
            if (!documentOffset) return;
            const reserve = 104; // phân trang + đệm đáy
            const maxHeight = Math.max(280, Math.round(window.innerHeight - documentOffset - reserve));
            wrapper.style.maxHeight = `${maxHeight}px`;
        });
    },

    scheduleFit() {
        if (this._fitRafId) cancelAnimationFrame(this._fitRafId);
        this._fitRafId = requestAnimationFrame(() => {
            this._fitRafId = null;
            this.fitToViewport();
        });
    }
};

// 6d. TABLE DENSITY — chuyển mật độ bảng (thoáng / gọn), ghi nhớ trong localStorage
export const TableDensity = {
    key: 'admin_table_density',
    _value: 'comfortable',

    get() {
        return this._value;
    },

    isCompact() {
        return this._value === 'compact';
    },

    /** Gắn nút bật/tắt mật độ vào topbar. */
    mount(button) {
        if (!button) return;

        let stored = null;
        try { stored = localStorage.getItem(this.key); } catch {}
        if (stored === 'compact' || stored === 'comfortable') this._value = stored;
        this.apply();

        button.addEventListener('click', () => {
            this._value = this.isCompact() ? 'comfortable' : 'compact';
            this.apply();
            try { localStorage.setItem(this.key, this._value); } catch {}
        });
    },

    apply() {
        const compact = this.isCompact();
        document.documentElement.dataset.density = this._value;

        const button = document.getElementById('admin-density-toggle');
        if (button) {
            button.setAttribute('aria-pressed', String(compact));
            button.title = compact ? 'Mật độ: gọn (bấm để chuyển sang thoáng)' : 'Mật độ: thoáng (bấm để chuyển sang gọn)';
            button.setAttribute('aria-label', button.title);
            button.classList.toggle('is-active', compact);
        }
    }
};

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

/** Mũi tên xu hướng dùng chung cho `MetricDelta`. */
const arrowIcon = (kind) => {
    const paths = {
        up: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
        down: '<path d="M7 7l10 10"/><path d="M17 9v8H9"/>',
        flat: '<path d="M6 12h12"/>'
    };
    return `<svg class="metric-delta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.flat}</svg>`;
};

// 6e. METRIC DELTA — mức tăng/giảm so với kỳ liền trước
export const MetricDelta = {
    /**
     * Chênh lệch giữa kỳ này và kỳ trước.
     * - `up` / `down` / `flat`: hướng thay đổi
     * - `new`: kỳ trước bằng 0 nên không có mốc để tính phần trăm
     */
    compute(current, previous) {
        const cur = Number(current) || 0;
        const prev = Number(previous) || 0;
        if (prev === 0) return cur === 0 ? { kind: 'flat', ratio: 0 } : { kind: 'new', ratio: null };
        return { kind: cur === prev ? 'flat' : cur > prev ? 'up' : 'down', ratio: (cur - prev) / Math.abs(prev) };
    },

    /**
     * @param {object} opts
     * @param {number} opts.current         giá trị kỳ này
     * @param {number} opts.previous        giá trị kỳ trước
     * @param {boolean} [opts.invert]       true khi TĂNG là điều xấu (vd: churn rate)
     * @param {'percent'|'point'} [opts.unit] `point` cho các tỷ lệ (chênh lệch điểm %)
     * @param {string} [opts.context]       mô tả kỳ trước, hiện trong tooltip
     * @param {string} [opts.format]        hàm định dạng giá trị kỳ trước
     */
    markup({ current, previous, invert = false, unit = 'percent', context = '', format } = {}) {
        const { kind, ratio } = this.compute(current, previous);

        if (kind === 'new') {
            // Không có mốc so sánh: nêu rõ thay vì bịa phần trăm.
            const label = 'mới';
            return `<span class="metric-delta is-new" title="${escapeHtml(context)}" aria-label="Không có dữ liệu kỳ trước để so sánh">${arrowIcon('flat')}<span>${label}</span></span>`;
        }

        let text;
        if (unit === 'point') {
            const points = ((Number(current) || 0) - (Number(previous) || 0)) * 100;
            text = `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points).toFixed(1).replace('.', ',')} điểm`;
        } else if (kind === 'flat') {
            text = 'không đổi';
        } else {
            const pct = Math.abs(ratio) * 100;
            text = `${kind === 'up' ? '+' : '−'}${pct.toFixed(pct >= 10 ? 0 : 1).replace('.', ',')}%`;
        }

        // "Tốt/xấu" phụ thuộc chiều của chỉ số: churn tăng là xấu, doanh thu tăng là tốt.
        const tone = kind === 'flat' ? 'is-flat' : (kind === 'up') !== Boolean(invert) ? 'is-good' : 'is-bad';

        const prevText = typeof format === 'function' ? format(previous) : String(previous ?? '');
        const tip = [context, Number(previous) || Number(current) ? `Kỳ trước: ${prevText}` : '']
            .filter(Boolean)
            .join(' — ');

        return `<span class="metric-delta ${tone}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(`So với kỳ trước: ${text}`)}">${arrowIcon(kind)}<span>${escapeHtml(text)}</span></span>`;
    },

    /** Ghi kết quả vào một phần tử (thường là dòng phụ của thẻ KPI). */
    render(container, opts = {}) {
        if (!container) return;
        container.innerHTML = this.markup(opts);
        return container.firstElementChild;
    }
};

// 6f. DONUT CHART — biểu đồ tròn SVG, không phụ thuộc thư viện ngoài
export const DonutChart = {
    /** Bảng màu lấy từ hệ màu LIME (lime → xanh lá → trung tính) để phân biệt được các phần. */
    colors: ['#B9E72B', '#8FBE0A', '#65A30D', '#4D7C0F', '#14160F', '#9A9E92'],

    color(index) {
        return this.colors[index % this.colors.length];
    },

    /**
     * @param {Array<{name: string, count: number, percentage?: number}>} items
     * @param {object} [opts]
     * @param {number} [opts.size]          đường kính (px)
     * @param {number} [opts.thickness]     độ dày vành
     * @param {string} [opts.centerValue]   số lớn giữa vòng
     * @param {string} [opts.centerLabel]   nhãn nhỏ dưới số
     */
    markup(items, opts = {}) {
        const list = (items || []).filter((item) => Number(item.count) > 0);
        const total = list.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

        if (total === 0) {
            return `<div class="views-widget-empty">Chưa có gói cước nào đang hoạt động.</div>`;
        }

        const size = opts.size || 168;
        const thickness = opts.thickness || 22;
        const radius = (size - thickness) / 2;
        const circumference = 2 * Math.PI * radius;
        const center = size / 2;
        // Khe hở nhỏ giữa các phần; chỉ áp dụng khi có nhiều hơn 1 phần.
        const gap = list.length > 1 ? Math.min(3, circumference / list.length / 4) : 0;

        let offset = 0;
        const arcs = list
            .map((item, index) => {
                const ratio = (Number(item.count) || 0) / total;
                const length = Math.max(0.6, ratio * circumference - gap);
                const arc = `<circle class="donut-segment" cx="${center}" cy="${center}" r="${radius}"
                        fill="none" stroke="${this.color(index)}" stroke-width="${thickness}"
                        stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
                        stroke-dashoffset="${(-offset).toFixed(2)}"
                        transform="rotate(-90 ${center} ${center})">
                        <title>${escapeHtml(`${item.name}: ${item.count} gói (${Math.round(ratio * 100)}%)`)}</title>
                    </circle>`;
                offset += ratio * circumference;
                return arc;
            })
            .join('');

        const label = `Cơ cấu ${total} gói đang hoạt động: ${list
            .map((item) => `${item.name} ${item.count} gói`)
            .join(', ')}`;

        const legend = list
            .map((item, index) => {
                const pct = Math.round(((Number(item.count) || 0) / total) * 100);
                const mrr = Number(item.mrrVnd) || 0;
                return `
                    <li class="donut-legend-item" title="${escapeHtml(`${item.name}: ${pct}%`)}">
                        <span class="donut-legend-dot" style="background: ${this.color(index)};"></span>
                        <span class="donut-legend-name audit-break-word">${escapeHtml(item.name)}</span>
                        <span class="donut-legend-value">${item.count} <span class="donut-legend-pct">(${pct}%)</span></span>
                    </li>
                `;
            })
            .join('');

        return `
            <div class="donut-chart">
                <div class="donut-chart-figure">
                    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(label)}">
                        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="var(--line)" stroke-width="${thickness}"></circle>
                        ${arcs}
                    </svg>
                    <div class="donut-chart-center">
                        <span class="donut-chart-center-value">${escapeHtml(opts.centerValue ?? String(total))}</span>
                        <span class="donut-chart-center-label">${escapeHtml(opts.centerLabel ?? 'gói')}</span>
                    </div>
                </div>
                <ul class="donut-chart-legend">${legend}</ul>
            </div>
        `;
    }
};

// 7. QUICK STATUS TOGGLE (SWITCH)
export const SwitchToggle = {
    create({ checked = true, disabled = false, onChange }) {
        const wrapper = document.createElement('label');
        wrapper.className = 'status-toggle';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.disabled = disabled;

        const slider = document.createElement('span');
        slider.className = 'toggle-slider';

        const label = document.createElement('span');
        label.className = 'toggle-label';
        label.textContent = checked ? 'Active' : 'Suspended';
        label.style.color = checked ? 'var(--success)' : 'var(--danger)';

        input.onchange = (e) => {
            const isNowChecked = e.target.checked;
            label.textContent = isNowChecked ? 'Active' : 'Suspended';
            label.style.color = isNowChecked ? 'var(--success)' : 'var(--danger)';
            if (typeof onChange === 'function') {
                onChange(isNowChecked, () => {
                    // Rollback callback
                    input.checked = !isNowChecked;
                    label.textContent = !isNowChecked ? 'Active' : 'Suspended';
                    label.style.color = !isNowChecked ? 'var(--success)' : 'var(--danger)';
                });
            }
        };

        wrapper.appendChild(input);
        wrapper.appendChild(slider);
        wrapper.appendChild(label);
        return wrapper;
    }
};

// 8. ROW ACTIONS 3-DOTS MENU (PORTAL-BASED, ZERO LAYOUT SHIFT)
export const ActionMenu = {
    portalEl: null,
    activeTrigger: null,

    init() {
        if (this.portalEl) return;
        this.portalEl = document.createElement('div');
        this.portalEl.className = 'action-menu-portal';
        this.portalEl.id = 'action-menu-portal';
        document.body.appendChild(this.portalEl);

        document.addEventListener('click', (e) => {
            if (!this.portalEl || !this.portalEl.classList.contains('show')) return;
            if (this.portalEl.contains(e.target)) return;
            if (this.activeTrigger && this.activeTrigger.contains(e.target)) return;
            this.close();
        });

        window.addEventListener('resize', () => this.close());
        window.addEventListener('scroll', () => {
            if (this.portalEl && this.portalEl.classList.contains('show')) {
                this.close();
            }
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            // Chỉ xử lý khi menu đang thật sự mở, và trả focus về nút "Thao tác".
            if (!this.portalEl?.classList.contains('show')) return;
            const trigger = this.activeTrigger;
            this.close();
            trigger?.focus?.();
        });
    },

    close() {
        if (!this.portalEl) return;
        this.portalEl.classList.remove('show');
        this.portalEl.innerHTML = '';
        if (this.activeTrigger) {
            this.activeTrigger.classList.remove('active');
            this.activeTrigger = null;
        }
    },

    open(triggerBtn, items = []) {
        this.init();

        if (this.activeTrigger === triggerBtn && this.portalEl.classList.contains('show')) {
            this.close();
            return;
        }

        this.close();
        this.activeTrigger = triggerBtn;
        triggerBtn.classList.add('active');

        this.portalEl.innerHTML = '';
        items.forEach((item) => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'action-menu-divider';
                this.portalEl.appendChild(divider);
                return;
            }

            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = `action-menu-item ${item.danger ? 'danger' : ''}`;
            itemBtn.innerHTML = `<span>${item.label}</span>`;
            itemBtn.onclick = (e) => {
                e.stopPropagation();
                // Trả focus về nút "Thao tác" TRƯỚC khi chạy hành động, để hộp
                // thoại/drawer mở sau đó ghi nhận đúng phần tử cần trả focus khi
                // đóng (nếu không, activeElement là <body> nên focus bị mất).
                const trigger = this.activeTrigger;
                this.close();
                trigger?.focus?.();
                if (typeof item.onClick === 'function') {
                    item.onClick();
                }
            };
            this.portalEl.appendChild(itemBtn);
        });

        this.portalEl.classList.add('show');

        // Position dropdown via getBoundingClientRect (Collision Detection)
        const rect = triggerBtn.getBoundingClientRect();
        const menuWidth = 180;
        const menuHeight = this.portalEl.offsetHeight || 180;

        let top = rect.bottom + 4;
        let left = rect.right - menuWidth;

        // Viewport collision checks: flip up if bottom boundary exceeded
        if (top + menuHeight > window.innerHeight - 8) {
            top = rect.top - menuHeight - 4;
        }
        if (top < 8) {
            top = 8;
        }
        if (left + menuWidth > window.innerWidth - 8) {
            left = window.innerWidth - menuWidth - 8;
        }
        if (left < 8) {
            left = 8;
        }

        this.portalEl.style.top = `${Math.round(top)}px`;
        this.portalEl.style.left = `${Math.round(left)}px`;
    },

    create(items = []) {
        this.init();

        const container = document.createElement('div');
        container.className = 'action-menu-container';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-icon action-menu-trigger';
        btn.innerHTML = '···';
        btn.title = 'Thao tác';

        btn.onclick = (e) => {
            e.stopPropagation();
            this.open(btn, items);
        };

        container.appendChild(btn);
        return container;
    }
};

// 9. STICKY BULK ACTIONS BAR
export const BulkBar = {
    el: null,

    init() {
        if (this.el) return;
        this.el = document.createElement('div');
        this.el.className = 'bulk-bar';
        this.el.id = 'sticky-bulk-bar';
        document.body.appendChild(this.el);
    },

    update({ selectedCount = 0, actions = [], onClear }) {
        this.init();

        if (selectedCount <= 0) {
            this.el.classList.remove('show');
            return;
        }

        this.el.innerHTML = `
            <div class="bulk-count">
                <span class="bulk-count-badge">${selectedCount}</span>
                <span>đã chọn</span>
            </div>
            <div class="bulk-actions-group" id="bulk-actions-container"></div>
            <button class="btn btn-subtle" id="bulk-clear-btn">Bỏ chọn</button>
        `;

        const actionsContainer = this.el.querySelector('#bulk-actions-container');
        actions.forEach((act) => {
            const btn = document.createElement('button');
            btn.className = `btn ${act.isDanger ? 'btn-danger' : 'btn-secondary'}`;
            btn.textContent = act.label;
            btn.onclick = act.onClick;
            actionsContainer.appendChild(btn);
        });

        const clearBtn = this.el.querySelector('#bulk-clear-btn');
        clearBtn.onclick = () => {
            if (typeof onClear === 'function') onClear();
            this.hide();
        };

        this.el.classList.add('show');
    },

    hide() {
        if (this.el) this.el.classList.remove('show');
    }
};

// 9b. VIDEO PREVIEW — xem video của job đã hoàn thành ngay trong trang quản trị.
// Dùng route sẵn có `/api/jobs/:jobId/video` (stream có hỗ trợ Range) và
// `/api/jobs/:jobId/download`; cả hai cùng origin với trang admin.
export const VideoPreview = {
    rootEl: null,
    playerEl: null,
    statusEl: null,
    returnFocus: null,
    activeJobId: '',
    onKeydown: null,

    videoUrl(jobId) {
        return `/api/jobs/${encodeURIComponent(jobId)}/video`;
    },

    downloadUrl(jobId) {
        return `/api/jobs/${encodeURIComponent(jobId)}/download`;
    },

    init() {
        if (this.rootEl?.isConnected) return this.rootEl;

        const root = document.createElement('div');
        root.className = 'video-preview-backdrop';
        root.hidden = true;
        root.innerHTML = `
            <section class="video-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="video-preview-title">
                <header class="video-preview-header">
                    <div class="video-preview-heading">
                        <h2 class="video-preview-title" id="video-preview-title">Video</h2>
                        <div class="video-preview-subtitle" data-video-preview-subtitle></div>
                    </div>
                    <button class="btn-icon" type="button" data-video-preview-close aria-label="Đóng cửa sổ xem video" title="Đóng">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </header>
                <div class="video-preview-stage">
                    <video class="video-preview-player" data-video-preview-player controls playsinline preload="metadata"></video>
                    <div class="video-preview-status" data-video-preview-status role="status" hidden></div>
                </div>
                <footer class="video-preview-footer">
                    <a class="btn btn-secondary" data-video-preview-newtab target="_blank" rel="noopener">Mở trong tab mới</a>
                    <a class="btn btn-primary" data-video-preview-download>⬇ Tải video</a>
                </footer>
            </section>`;
        document.body.appendChild(root);

        this.rootEl = root;
        this.playerEl = root.querySelector('[data-video-preview-player]');
        this.statusEl = root.querySelector('[data-video-preview-status]');

        // Không dùng sự kiện `close` mà tự đóng khi bấm nền/nút ✕.
        root.addEventListener('click', (event) => {
            if (event.target === root || event.target.closest('[data-video-preview-close]')) this.close();
        });

        // Thẻ <video> chỉ báo "error" chung chung, không nói vì sao: có thể tệp đã bị
        // dọn khỏi thư mục tạm (404) hoặc trình duyệt không giải mã được tệp. Hỏi lại
        // máy chủ một phát gọn (Range 0-0) để báo đúng nguyên nhân.
        this.playerEl.addEventListener('error', async () => {
            if (!this.activeJobId || this.rootEl.hidden) return;
            const jobId = this.activeJobId;
            let fileMissing = false;
            let checked = false;
            try {
                const res = await fetch(this.videoUrl(jobId), { headers: { Range: 'bytes=0-0' } });
                fileMissing = res.status === 404;
                checked = true;
            } catch {
                // Lỗi mạng thì giữ thông báo chung bên dưới.
            }
            // Người dùng có thể đã đóng cửa sổ hoặc mở job khác trong lúc chờ.
            if (!this.activeJobId || this.rootEl.hidden || this.activeJobId !== jobId) return;
            if (fileMissing) {
                this.setStatus('Tệp video không còn trên máy chủ: đã bị xoá khỏi thư mục tạm (tmp) hoặc job được render ở máy khác. Hãy tạo lại video để có tệp mới.');
            } else if (checked) {
                this.setStatus('Trình duyệt không phát được tệp video này (định dạng hoặc chuẩn mã hoá chưa được hỗ trợ). Bạn vẫn có thể bấm "Tải video" rồi mở bằng trình phát khác.');
            } else {
                this.setStatus('Không tải được tệp video. Kiểm tra kết nối tới máy chủ rồi thử lại, hoặc bấm "Tải video" để tải trực tiếp.');
            }
        });
        const clearStatus = () => {
            if (this.activeJobId && !this.rootEl.hidden) this.setStatus('');
        };
        this.playerEl.addEventListener('loadedmetadata', clearStatus);
        this.playerEl.addEventListener('canplay', clearStatus);

        return root;
    },

    setStatus(message) {
        if (!this.statusEl) return;
        this.statusEl.textContent = message || '';
        this.statusEl.hidden = !message;
    },

    /** Mở cửa sổ xem video cho một job đã có tệp video. */
    show({ jobId, title = 'Video đã hoàn thành', subtitle = '' } = {}) {
        const id = String(jobId || '').trim();
        if (!id) return null;

        this.init();
        this.returnFocus = document.activeElement;
        this.activeJobId = id;

        this.rootEl.querySelector('#video-preview-title').textContent = title || 'Video đã hoàn thành';
        this.rootEl.querySelector('[data-video-preview-subtitle]').textContent = subtitle || `Job ${id.slice(0, 8)}…`;
        this.rootEl.querySelector('[data-video-preview-newtab]').href = this.videoUrl(id);
        this.rootEl.querySelector('[data-video-preview-download]').href = this.downloadUrl(id);

        this.setStatus('Đang tải video…');
        this.playerEl.src = this.videoUrl(id);
        this.playerEl.load();

        this.rootEl.hidden = false;
        requestAnimationFrame(() => {
            this.rootEl.classList.add('is-open');
            this.rootEl.querySelector('[data-video-preview-close]')?.focus();
            // Chặn autoplay là bình thường (video có tiếng) — bỏ qua lỗi để không
            // hiện cảnh báo thừa.
            this.playerEl.play?.()?.catch?.(() => { });
        });

        this.onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.close();
            }
        };
        document.addEventListener('keydown', this.onKeydown, true);

        return this.rootEl;
    },

    close() {
        if (!this.rootEl || this.rootEl.hidden) return;
        this.activeJobId = '';
        this.rootEl.classList.remove('is-open');
        this.rootEl.hidden = true;
        this.playerEl.pause();
        this.playerEl.removeAttribute('src');
        this.playerEl.load();
        this.setStatus('');
        if (this.onKeydown) {
            document.removeEventListener('keydown', this.onKeydown, true);
            this.onKeydown = null;
        }
        this.returnFocus?.focus?.();
        this.returnFocus = null;
    },

    isOpen() {
        return Boolean(this.rootEl && !this.rootEl.hidden);
    }
};

// 9c. API HEALTH INDICATOR (sidebar/topbar badge)
export const HealthDot = {
    el: null,
    timer: null,
    intervalMs: 30000,

    mount(el) {
        this.el = el || document.getElementById('admin-health-badge');
        if (!this.el) return;
        this.el.classList.add('admin-health-badge');
        this.check();
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.check(), this.intervalMs);
    },

    async check() {
        const el = this.el;
        if (!el) return;

        let ok = false;
        let reason = '';
        try {
            const res = await fetch('/api/health', {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const data = await res.json().catch(() => ({}));
            ok = res.ok && data.status === 'ok';
            if (!ok) reason = `HTTP ${res.status}`;
        } catch (err) {
            reason = 'không kết nối được';
        }

        el.classList.toggle('badge-success', ok);
        el.classList.toggle('badge-danger', !ok);
        el.classList.toggle('badge-neutral', false);
        el.title = ok
            ? 'Máy chủ API hoạt động bình thường'
            : `Máy chủ API không phản hồi (${reason || 'lỗi'})`;

        const label = el.querySelector('.admin-health-label');
        if (label) label.textContent = ok ? 'API Online' : 'API Offline';
    },

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
};

// 10. GEO & ISP FORMATTERS
const COUNTRY_MAP = {
    'vn': 'Việt Nam',
    'vietnam': 'Việt Nam',
    'viet nam': 'Việt Nam',
    'us': 'Hoa Kỳ',
    'usa': 'Hoa Kỳ',
    'united states': 'Hoa Kỳ',
    'united states of america': 'Hoa Kỳ',
    'jp': 'Nhật Bản',
    'japan': 'Nhật Bản',
    'kr': 'Hàn Quốc',
    'korea': 'Hàn Quốc',
    'south korea': 'Hàn Quốc',
    'cn': 'Trung Quốc',
    'china': 'Trung Quốc',
    'sg': 'Singapore',
    'singapore': 'Singapore',
    'th': 'Thái Lan',
    'thailand': 'Thái Lan',
    'my': 'Malaysia',
    'malaysia': 'Malaysia',
    'id': 'Indonesia',
    'indonesia': 'Indonesia',
    'ph': 'Philippines',
    'philippines': 'Philippines',
    'gb': 'Vương quốc Anh',
    'uk': 'Vương quốc Anh',
    'united kingdom': 'Vương quốc Anh',
    'fr': 'Pháp',
    'france': 'Pháp',
    'de': 'Đức',
    'germany': 'Đức',
    'au': 'Úc',
    'australia': 'Úc',
    'ca': 'Canada',
    'canada': 'Canada',
    'ru': 'Nga',
    'russia': 'Nga',
    'tw': 'Đài Loan',
    'taiwan': 'Đài Loan',
    'hk': 'Hồng Kông',
    'hong kong': 'Hồng Kông',
    'in': 'Ấn Độ',
    'india': 'Ấn Độ',
    'la': 'Lào',
    'laos': 'Lào',
    'kh': 'Campuchia',
    'cambodia': 'Campuchia',
    'mm': 'Myanmar',
    'nl': 'Hà Lan',
    'netherlands': 'Hà Lan',
    'se': 'Thụy Điển',
    'sweden': 'Thụy Điển',
    'ch': 'Thụy Sĩ',
    'switzerland': 'Thụy Sĩ',
    'no': 'Na Uy',
    'norway': 'Na Uy',
    'fi': 'Phần Lan',
    'finland': 'Phần Lan',
    'dk': 'Đan Mạch',
    'denmark': 'Đan Mạch',
    'es': 'Tây Ban Nha',
    'spain': 'Tây Ban Nha',
    'it': 'Ý',
    'italy': 'Ý',
    'br': 'Brazil',
    'brazil': 'Brazil',
    'za': 'Nam Phi',
    'south africa': 'Nam Phi',
    'nz': 'New Zealand',
    'new zealand': 'New Zealand',
};

const CITY_MAP = {
    // Vietnamese cities
    'hanoi': 'Hà Nội',
    'ha noi': 'Hà Nội',
    'ha-noi': 'Hà Nội',
    'ho chi minh city': 'TP. Hồ Chí Minh',
    'ho chi minh': 'TP. Hồ Chí Minh',
    'ho-chi-minh': 'TP. Hồ Chí Minh',
    'saigon': 'TP. Hồ Chí Minh',
    'sai gon': 'TP. Hồ Chí Minh',
    'tphcm': 'TP. Hồ Chí Minh',
    'tp hcm': 'TP. Hồ Chí Minh',
    'da nang': 'Đà Nẵng',
    'danang': 'Đà Nẵng',
    'da-nang': 'Đà Nẵng',
    'hai phong': 'Hải Phòng',
    'haiphong': 'Hải Phòng',
    'can tho': 'Cần Thơ',
    'cantho': 'Cần Thơ',
    'hue': 'Huế',
    'thua thien hue': 'Huế',
    'nha trang': 'Nha Trang',
    'nhatrang': 'Nha Trang',
    'vung tau': 'Vũng Tàu',
    'vungtau': 'Vũng Tàu',
    'bien hoa': 'Biên Hòa',
    'bienhoa': 'Biên Hòa',
    'buon ma thuot': 'Buôn Ma Thuột',
    'buonmathuot': 'Buôn Ma Thuột',
    'quy nhon': 'Quy Nhơn',
    'quynhon': 'Quy Nhơn',
    'long xuyen': 'Long Xuyên',
    'thai nguyen': 'Thái Nguyên',
    'nam dinh': 'Nam Định',
    'bac ninh': 'Bắc Ninh',
    'bac giang': 'Bắc Giang',
    'quang ninh': 'Quảng Ninh',
    'ha long': 'Hạ Long',
    'halong': 'Hạ Long',
    'thanh hoa': 'Thanh Hóa',
    'nghe an': 'Nghệ An',
    'vinh': 'Vinh',
    'binh duong': 'Bình Dương',
    'thu dau mot': 'Thủ Dầu Một',
    'dong nai': 'Đồng Nai',
    'lao cai': 'Lào Cai',
    'sa pa': 'Sa Pa',
    'sapa': 'Sa Pa',
    'da lat': 'Đà Lạt',
    'dalat': 'Đà Lạt',
    'phan thiet': 'Phan Thiết',
    'phanthiet': 'Phan Thiết',
    'tay ninh': 'Tây Ninh',
    'tayninh': 'Tây Ninh',
    'tien giang': 'Tiền Giang',
    'my tho': 'Mỹ Tho',
    'mytho': 'Mỹ Tho',
    'ben tre': 'Bến Tre',
    'bentre': 'Bến Tre',
    'an giang': 'An Giang',
    'kien giang': 'Kiên Giang',
    'rach gia': 'Rạch Giá',
    'phu quoc': 'Phú Quốc',
    'phuquoc': 'Phú Quốc',
    'ca mau': 'Cà Mau',
    'camau': 'Cà Mau',
    'dong thap': 'Đồng Tháp',
    'cao lanh': 'Cao Lãnh',
    'soc trang': 'Sóc Trăng',
    'tra vinh': 'Trà Vinh',
    'vinh long': 'Vĩnh Long',
    'hau giang': 'Hậu Giang',
    'vi thanh': 'Vị Thanh',
    'quang nam': 'Quảng Nam',
    'hoi an': 'Hội An',
    'tam ky': 'Tam Kỳ',
    'quang ngai': 'Quảng Ngãi',
    'binh dinh': 'Bình Định',
    'phu yen': 'Phú Yên',
    'tuy hoa': 'Tuy Hòa',
    'khanh hoa': 'Khánh Hòa',
    'cam ranh': 'Cam Ranh',
    'ninh thuan': 'Ninh Thuận',
    'phan rang': 'Phan Rang',
    'binh thuan': 'Bình Thuận',
    'kon tum': 'Kon Tum',
    'gia lai': 'Gia Lai',
    'pleiku': 'Pleiku',
    'dak lak': 'Đắk Lắk',
    'dak nong': 'Đắk Nông',
    'gia nghia': 'Gia Nghĩa',
    'lam dong': 'Lâm Đồng',
    'bao loc': 'Bảo Lộc',
    'binh phuoc': 'Bình Phước',
    'dong xoai': 'Đồng Xoài',
    'ba ria': 'Bà Rịa',
    'ha giang': 'Hà Giang',
    'cao bang': 'Cao Bằng',
    'bac kan': 'Bắc Kạn',
    'tuyen quang': 'Tuyên Quang',
    'yen bai': 'Yên Bái',
    'dien bien': 'Điện Biên',
    'dien bien phu': 'Điện Biên Phủ',
    'lai chau': 'Lai Châu',
    'son la': 'Sơn La',
    'hoa binh': 'Hòa Bình',
    'phu tho': 'Phú Thọ',
    'viet tri': 'Việt Trì',
    'vinh phuc': 'Vĩnh Phúc',
    'vinh yen': 'Vĩnh Yên',
    'hai duong': 'Hải Dương',
    'hung yen': 'Hưng Yên',
    'ha nam': 'Hà Nam',
    'phu ly': 'Phủ Lý',
    'ninh binh': 'Ninh Bình',
    'quang binh': 'Quảng Bình',
    'dong hoi': 'Đồng Hới',
    'quang tri': 'Quảng Trị',
    'dong ha': 'Đông Hà',

    // Global cities
    'tokyo': 'Tokyo',
    'seoul': 'Seoul',
    'bangkok': 'Bangkok',
    'beijing': 'Bắc Kinh',
    'shanghai': 'Thượng Hải',
    'guangzhou': 'Quảng Châu',
    'shenzhen': 'Thâm Quyến',
    'london': 'Luân Đôn',
    'paris': 'Paris',
    'berlin': 'Berlin',
    'moscow': 'Mát-xcơ-va',
    'washington': 'Washington, D.C.',
    'new york': 'New York',
    'los angeles': 'Los Angeles',
    'san francisco': 'San Francisco',
    'chicago': 'Chicago',
    'seattle': 'Seattle',
    'singapore': 'Singapore',
    'sydney': 'Sydney',
    'melbourne': 'Melbourne',
    'toronto': 'Toronto',
    'vancouver': 'Vancouver',
    'taipei': 'Đài Bắc',
    'hong kong': 'Hồng Kông',
    'kuala lumpur': 'Kuala Lumpur',
    'jakarta': 'Jakarta',
    'manila': 'Manila',
};

let clientViDisplayNames = null;
try {
    clientViDisplayNames = new Intl.DisplayNames(['vi'], { type: 'region' });
} catch {}

export const GeoFormatter = {
    formatCountry(raw) {
        if (!raw) return '';
        const clean = String(raw).trim();
        if (!clean || clean === 'XX' || clean === 'T1') return '';
        const lower = clean.toLowerCase();
        if (COUNTRY_MAP[lower]) return COUNTRY_MAP[lower];
        if (clean.length === 2 && clientViDisplayNames) {
            try {
                const name = clientViDisplayNames.of(clean.toUpperCase());
                if (name && name !== clean.toUpperCase()) return name;
            } catch {}
        }
        return clean;
    },

    formatCity(raw) {
        if (!raw) return '';
        const clean = String(raw).trim();
        const lower = clean.toLowerCase();
        if (CITY_MAP[lower]) return CITY_MAP[lower];
        return clean;
    },

    formatLocation(locStr) {
        if (!locStr) return 'Không xác định';
        const trimmed = String(locStr).trim();
        if (!trimmed || trimmed === 'Không xác định' || trimmed === 'N/A' || trimmed === '—') return 'Không xác định';
        if (trimmed.includes('Local') || trimmed.includes('cục bộ') || trimmed.includes('LAN')) {
            return 'Mạng cục bộ (Local / LAN)';
        }

        if (trimmed.includes(',')) {
            const parts = trimmed.split(',').map((p) => p.trim());
            const country = this.formatCountry(parts[parts.length - 1]);
            const city = this.formatCity(parts[0]);
            if (city && country) {
                if (city.toLowerCase() === country.toLowerCase()) return country;
                return `${city}, ${country}`;
            }
            return city || country || 'Không xác định';
        }

        return this.formatCountry(trimmed);
    },

    formatIsp(rawIsp) {
        if (!rawIsp) return 'Không xác định';
        const clean = String(rawIsp).trim();
        if (!clean || clean === 'Không xác định' || clean === '—' || clean === 'N/A') return 'Không xác định';
        if (clean.includes('Loopback') || clean.includes('Private') || clean.includes('LAN')) {
            return 'Loopback / Private LAN';
        }

        const lower = clean.toLowerCase();
        if (lower.includes('viettel')) return 'Viettel';
        if (lower.includes('vnpt') || lower.includes('vietnam posts and telecommunications') || lower.includes('vietnam post and telecom')) return 'VNPT';
        if (lower.includes('fpt')) return 'FPT Telecom';
        if (lower.includes('mobifone') || lower.includes('mobi phone')) return 'MobiFone';
        if (lower.includes('cmc telecom') || lower.includes('cmc corp') || lower === 'cmc') return 'CMC Telecom';
        if (lower.includes('vietnamobile') || lower.includes('vietnam mobile')) return 'Vietnamobile';
        if (lower.includes('sctv')) return 'SCTV';
        if (lower.includes('vtvcab')) return 'VTVCab';
        if (lower.includes('spt')) return 'SPT Telecom';
        if (lower.includes('cloudflare')) return 'Cloudflare';
        if (lower.includes('google')) return 'Google';
        if (lower.includes('microsoft')) return 'Microsoft';
        if (lower.includes('amazon') || lower === 'aws') return 'Amazon (AWS)';

        return clean;
    }
};

export const formatLocation = (loc) => GeoFormatter.formatLocation(loc);
export const formatIsp = (isp) => GeoFormatter.formatIsp(isp);

