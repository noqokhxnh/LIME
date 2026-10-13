/* Shared, dependency-free UI primitives for Studio and Admin. */
(function (global) {
    'use strict';

    const UI = global.LIMEUI || {};
    let toastRegion;
    let drawer;
    let confirmDialog;
    let confirmResolver;
    let confirmPreviousFocus;

    function ensureToastRegion() {
        if (toastRegion?.isConnected) return toastRegion;
        toastRegion = document.createElement('div');
        toastRegion.className = 'lime-toast-region';
        toastRegion.setAttribute('aria-live', 'polite');
        toastRegion.setAttribute('aria-atomic', 'false');
        document.body.appendChild(toastRegion);
        return toastRegion;
    }

    UI.Toast = {
        show(message, type = 'info', duration = 3200) {
            const item = document.createElement('div');
            item.className = `lime-toast lime-toast-${type}`;
            item.setAttribute('role', type === 'error' ? 'alert' : 'status');
            item.textContent = String(message);
            ensureToastRegion().appendChild(item);
            global.setTimeout(() => {
                item.classList.add('is-leaving');
                global.setTimeout(() => item.remove(), 220);
            }, duration);
        },
        success(message) { this.show(message, 'success'); },
        error(message) { this.show(message, 'error'); },
        info(message) { this.show(message, 'info'); },
        warning(message) { this.show(message, 'warning'); }
    };

    function ensureDrawer() {
        if (drawer?.panel.isConnected) return drawer;
        const backdrop = document.createElement('div');
        backdrop.className = 'lime-drawer-backdrop';
        backdrop.hidden = true;
        const panel = document.createElement('aside');
        panel.className = 'lime-drawer-panel drawer-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'lime-drawer-title');
        panel.innerHTML = `
            <header class="lime-drawer-header drawer-header">
                <div class="drawer-title-group">
                    <div class="lime-drawer-title drawer-title" id="lime-drawer-title"></div>
                    <div class="lime-drawer-subtitle drawer-subtitle" id="lime-drawer-subtitle"></div>
                </div>
                <button class="lime-close-button btn-icon" type="button" aria-label="Đóng" title="Đóng (Esc)">×</button>
            </header>
            <div class="lime-drawer-body drawer-body" id="lime-drawer-body"></div>
            <footer class="lime-drawer-footer drawer-footer" id="lime-drawer-footer"></footer>`;
        document.body.append(backdrop, panel);
        drawer = {
            backdrop, panel,
            title: panel.querySelector('#lime-drawer-title'),
            subtitle: panel.querySelector('#lime-drawer-subtitle'),
            body: panel.querySelector('#lime-drawer-body'),
            footer: panel.querySelector('#lime-drawer-footer'),
            closeButton: panel.querySelector('.lime-close-button'),
            onClose: null,
            returnFocus: null
        };
        backdrop.addEventListener('click', () => UI.Drawer.close());
        drawer.closeButton.addEventListener('click', () => UI.Drawer.close());
        return drawer;
    }

    UI.Drawer = {
        open({ title = 'Chi tiết', subtitle = '', contentHtml = '', onRender, footerHtml = '', onClose } = {}) {
            const view = ensureDrawer();
            view.returnFocus = document.activeElement;
            view.onClose = onClose || null;
            view.title.textContent = title;
            view.subtitle.textContent = subtitle;
            view.body.innerHTML = contentHtml;
            view.footer.innerHTML = footerHtml;
            view.footer.hidden = !footerHtml;
            view.footer.style.display = footerHtml ? 'flex' : 'none';
            if (onRender) onRender(view.body, view.footer);
            view.backdrop.hidden = false;
            global.requestAnimationFrame(() => {
                view.backdrop.classList.add('is-open');
                view.panel.classList.add('is-open');
                view.closeButton.focus();
            });
            return view.panel;
        },
        close() {
            if (!drawer || !drawer.panel.classList.contains('is-open')) return;
            drawer.panel.classList.remove('is-open');
            drawer.backdrop.classList.remove('is-open');
            global.setTimeout(() => { if (!drawer.panel.classList.contains('is-open')) drawer.backdrop.hidden = true; }, 300);
            const callback = drawer.onClose;
            drawer.onClose = null;
            callback?.();
            drawer.returnFocus?.focus?.();
            drawer.returnFocus = null;
        },
        isOpen() { return Boolean(drawer?.panel.classList.contains('is-open')); }
    };

    function ensureConfirmDialog() {
        if (confirmDialog?.isConnected) return confirmDialog;
        confirmDialog = document.createElement('div');
        confirmDialog.className = 'lime-confirm-backdrop';
        confirmDialog.hidden = true;
        confirmDialog.innerHTML = `<section class="lime-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lime-confirm-title" aria-describedby="lime-confirm-message">
            <h2 id="lime-confirm-title"></h2><div id="lime-confirm-message"></div>
            <div class="lime-confirm-actions"><button type="button" data-action="cancel"></button><button type="button" data-action="confirm"></button></div>
        </section>`;
        document.body.appendChild(confirmDialog);
        confirmDialog.addEventListener('click', (event) => {
            if (event.target === confirmDialog || event.target.closest('[data-action="cancel"]')) UI.Confirm.resolve(false);
            if (event.target.closest('[data-action="confirm"]')) UI.Confirm.resolve(true);
        });
        return confirmDialog;
    }

    UI.Confirm = {
        show({ title = 'Xác nhận', message = '', messageHtml, confirmText = 'Xác nhận', cancelText = 'Hủy', danger = false } = {}) {
            const root = ensureConfirmDialog();
            root.querySelector('#lime-confirm-title').textContent = title;
            const messageEl = root.querySelector('#lime-confirm-message');
            if (messageHtml !== undefined) messageEl.innerHTML = messageHtml;
            else messageEl.textContent = message;
            root.querySelector('[data-action="cancel"]').textContent = cancelText;
            const confirm = root.querySelector('[data-action="confirm"]');
            confirm.textContent = confirmText;
            confirm.classList.toggle('is-danger', danger);
            confirmPreviousFocus = document.activeElement;
            root.hidden = false;
            global.requestAnimationFrame(() => {
                root.classList.add('is-open');
                confirm.focus();
            });
            return new Promise((resolve) => { confirmResolver = resolve; });
        },
        resolve(value) {
            if (!confirmResolver) return;
            const resolve = confirmResolver;
            confirmResolver = null;
            confirmDialog.classList.remove('is-open');
            global.setTimeout(() => { if (!confirmDialog.classList.contains('is-open')) confirmDialog.hidden = true; }, 180);
            resolve(value);
            confirmPreviousFocus?.focus?.();
            confirmPreviousFocus = null;
        }
    };

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Tab' && UI.Drawer.isOpen()) {
            const focusable = [...drawer.panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        if (event.key === 'Tab' && confirmResolver) {
            const focusable = [...confirmDialog.querySelectorAll('button:not(:disabled)')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        if (event.key !== 'Escape') return;
        if (UI.Drawer.isOpen()) UI.Drawer.close();
        else if (confirmResolver) UI.Confirm.resolve(false);
    });

    global.LIMEUI = UI;
})(window);
