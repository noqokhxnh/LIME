// LIME AI Video Studio — Legal Modal Handler (Terms of Service & Privacy Policy)
(function initLegalModal() {
    function getModal() {
        return document.getElementById('legal-modal');
    }

    function switchLegalTab(tabName) {
        const modal = getModal();
        if (!modal) return;
        const termsBtn = modal.querySelector('#legal-tab-terms');
        const privacyBtn = modal.querySelector('#legal-tab-privacy');
        const termsPane = modal.querySelector('#legal-content-terms');
        const privacyPane = modal.querySelector('#legal-content-privacy');

        const isTerms = (tabName !== 'privacy');
        if (termsBtn) termsBtn.classList.toggle('active', isTerms);
        if (privacyBtn) privacyBtn.classList.toggle('active', !isTerms);
        if (termsPane) termsPane.classList.toggle('active', isTerms);
        if (privacyPane) privacyPane.classList.toggle('active', !isTerms);
    }

    function openLegalModal(tabName = 'terms') {
        const modal = getModal();
        if (!modal) return;
        switchLegalTab(tabName);
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeLegalModal() {
        const modal = getModal();
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        // Only restore body overflow if auth modal isn't open
        const authModal = document.getElementById('login-modal');
        if (!authModal || !authModal.classList.contains('show')) {
            document.body.style.overflow = '';
        }
    }

    // Attach click handlers when DOM is ready
    function setupListeners() {
        const modal = getModal();
        if (!modal) return;

        // Close button
        const closeBtn = document.getElementById('legal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeLegalModal();
            });
        }

        // Click outside backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeLegalModal();
            }
        });

        // ESC key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) {
                closeLegalModal();
            }
        });

        // Tab switcher inside modal
        const termsBtn = modal.querySelector('#legal-tab-terms');
        const privacyBtn = modal.querySelector('#legal-tab-privacy');
        if (termsBtn) termsBtn.addEventListener('click', () => switchLegalTab('terms'));
        if (privacyBtn) privacyBtn.addEventListener('click', () => switchLegalTab('privacy'));

        // Accept & close button
        const acceptBtn = document.getElementById('btn-legal-accept');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                const regCheckbox = document.getElementById('register-terms');
                if (regCheckbox) regCheckbox.checked = true;
                closeLegalModal();
            });
        }

        // Global delegate for links opening Terms & Privacy
        document.addEventListener('click', (e) => {
            const termsTarget = e.target.closest('.open-terms-btn, [data-legal="terms"]');
            if (termsTarget) {
                e.preventDefault();
                openLegalModal('terms');
                return;
            }

            const privacyTarget = e.target.closest('.open-privacy-btn, [data-legal="privacy"]');
            if (privacyTarget) {
                e.preventDefault();
                openLegalModal('privacy');
                return;
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupListeners);
    } else {
        setupListeners();
    }

    // Expose global methods
    window.openLimeTerms = () => openLegalModal('terms');
    window.openLimePrivacy = () => openLegalModal('privacy');
})();
