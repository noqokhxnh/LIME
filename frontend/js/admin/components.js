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
    render({ title = 'Không tìm thấy dữ liệu', description = 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.', actionText = 'Đặt lại bộ lọc', onAction }) {
        const container = document.createElement('div');
        container.className = 'empty-state';
        container.innerHTML = `
            <div class="empty-state-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div class="empty-state-title">${title}</div>
            <div class="empty-state-desc">${description}</div>
            ${actionText ? `<button class="btn btn-secondary btn-reset-filter">${actionText}</button>` : ''}
        `;

        if (actionText && typeof onAction === 'function') {
            const btn = container.querySelector('.btn-reset-filter');
            btn.onclick = onAction;
        }

        return container;
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
            if (e.key === 'Escape') this.close();
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
                this.close();
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

