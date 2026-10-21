/*
 * System Broadcast Banner — hiển thị thông báo toàn hệ thống cho mọi người dùng.
 *
 * Module tự chứa, dùng chung cho mọi trang (index/workspace/profile/settings/legal).
 * Nạp danh sách thông báo đang hiệu lực từ `GET /api/announcements` rồi render thành
 * lớp thông báo to nổi bật ở chính giữa màn hình (nền mờ giống modal). Trạng thái
 * "đã đóng" lưu ở localStorage (theo id + phiên bản nội dung) nên khi admin sửa
 * nội dung, thông báo sẽ hiện lại.
 *
 * Không phụ thuộc UI kit để có thể chạy cả ở trang công khai không nạp ui-kit.js.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined') return;
    if (window.__limeBroadcastLoaded) return;
    window.__limeBroadcastLoaded = true;

    var STORAGE_KEY = 'lime_broadcast_dismissed_v1';
    var ROOT_ID = 'lime-broadcast-root';

    var KIND_ICONS = {
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
        feature: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.09 4.26L19 8l-3.5 3.4.83 4.85L12 14l-4.33 2.25L8.5 11.4 5 8l4.91-.74z"/></svg>',
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        maintenance: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.1-2.1z"/></svg>',
    };

    var KIND_LABEL = {
        info: 'Thông báo',
        feature: 'Tính năng mới',
        warning: 'Cảnh báo',
        maintenance: 'Bảo trì',
    };

    function loadDismissed() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }

    function saveDismissed(list) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-300)));
        } catch (err) {
            /* localStorage có thể bị chặn (chế độ riêng tư) — bỏ qua. */
        }
    }

    function signature(item) {
        return String(item.id || '') + ':' + String(item.version || item.updatedAt || item.endsAt || '');
    }

    function getRoot() {
        var root = document.getElementById(ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = ROOT_ID;
            root.className = 'lime-broadcast-root';
            root.setAttribute('role', 'region');
            root.setAttribute('aria-label', 'Thông báo hệ thống');
            root.setAttribute('aria-live', 'polite');
            document.body.appendChild(root);
        }
        return root;
    }

    function isSafeHref(url) {
        if (!url) return false;
        return /^(https?:\/\/|\/)/i.test(String(url));
    }

    function renderBanner(item, onDismiss) {
        var kind = KIND_ICONS[item.kind] ? item.kind : 'info';

        var banner = document.createElement('div');
        banner.className = 'lime-broadcast-banner lime-broadcast-' + kind;

        var icon = document.createElement('span');
        icon.className = 'lime-broadcast-icon';
        icon.innerHTML = KIND_ICONS[kind];

        var content = document.createElement('div');
        content.className = 'lime-broadcast-content';

        var head = document.createElement('div');
        head.className = 'lime-broadcast-head';

        var badge = document.createElement('span');
        badge.className = 'lime-broadcast-badge';
        badge.textContent = KIND_LABEL[kind];
        head.appendChild(badge);

        if (item.title) {
            var title = document.createElement('span');
            title.className = 'lime-broadcast-title';
            title.textContent = item.title;
            head.appendChild(title);
        }
        content.appendChild(head);

        if (item.body) {
            var body = document.createElement('div');
            body.className = 'lime-broadcast-body';
            body.textContent = item.body;
            content.appendChild(body);
        }

        if (item.linkUrl && item.linkLabel && isSafeHref(item.linkUrl)) {
            var link = document.createElement('a');
            link.className = 'lime-broadcast-link';
            link.href = item.linkUrl;
            link.textContent = item.linkLabel;
            if (/^https?:\/\//i.test(item.linkUrl)) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            content.appendChild(link);
        }

        banner.appendChild(icon);
        banner.appendChild(content);

        if (item.dismissible !== false) {
            var close = document.createElement('button');
            close.type = 'button';
            close.className = 'lime-broadcast-close';
            close.setAttribute('aria-label', 'Đóng thông báo');
            close.title = 'Đóng';
            close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
            close.addEventListener('click', function () {
                banner.classList.add('is-leaving');
                window.setTimeout(function () {
                    banner.remove();
                    if (onDismiss) onDismiss(item);
                }, 180);
            });
            banner.appendChild(close);
        }

        return banner;
    }

    function collectItems(data) {
        var items = [];

        var list = Array.isArray(data.announcements) ? data.announcements : [];
        list.forEach(function (a) {
            if (!a || !a.id) return;
            items.push({
                id: a.id,
                title: a.title,
                body: a.body,
                kind: a.kind,
                dismissible: a.dismissible !== false,
                linkUrl: a.linkUrl,
                linkLabel: a.linkLabel,
                updatedAt: a.updatedAt,
            });
        });

        var legacy = (data.legacyNotice || '').trim();
        if (legacy) {
            items.push({
                id: 'legacy-system-notice',
                title: 'Thông báo toàn hệ thống',
                body: legacy,
                kind: 'info',
                dismissible: true,
            });
        }

        var hasMaintenance = items.some(function (i) { return i.kind === 'maintenance'; });
        if (data.maintenanceMode && !hasMaintenance) {
            items.push({
                id: 'maintenance-mode',
                title: 'Hệ thống đang bảo trì',
                body: 'Một số tính năng tạm thời không khả dụng trong lúc bảo trì. Vui lòng quay lại sau ít phút.',
                kind: 'maintenance',
                dismissible: false,
            });
        }

        return items;
    }

    function render(items) {
        var dismissed = loadDismissed();
        var visible = items.filter(function (item) {
            return item.dismissible === false || dismissed.indexOf(signature(item)) === -1;
        });
        if (!visible.length) return;

        var root = getRoot();
        root.innerHTML = '';

        // Nền mờ phía sau, giúp thông báo ở giữa màn hình thật nổi bật.
        var backdrop = document.createElement('div');
        backdrop.className = 'lime-broadcast-backdrop';
        root.appendChild(backdrop);

        // Cột thông báo căn chính giữa màn hình (cả hai trục).
        var stack = document.createElement('div');
        stack.className = 'lime-broadcast-stack';
        root.appendChild(stack);

        visible.forEach(function (item) {
            stack.appendChild(
                renderBanner(item, function (dismissedItem) {
                    var list = loadDismissed();
                    var sig = signature(dismissedItem);
                    if (list.indexOf(sig) === -1) {
                        list.push(sig);
                        saveDismissed(list);
                    }
                    if (!stack.children.length) root.remove();
                })
            );
        });
    }

    async function init() {
        if (!document.body) return;

        var data;
        try {
            var res = await window.fetch('/api/announcements', {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) return;
            data = await res.json();
        } catch (err) {
            // Không hiển thị gì nếu không tải được — không được chặn trang.
            return;
        }

        var items = collectItems(data || {});
        if (items.length) render(items);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
