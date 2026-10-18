/**
 * Admin URL State Management
 * Synchronizes table filters, sort, search and pagination 2-way with URL Query Parameters
 */

export const AdminState = {
    defaults: {
        tab: 'users',
        page: 1,
        limit: 25,
        search: '',
        status: 'all',
        role: 'all',
        tier: 'all',
        device: 'all',
        path: 'all',
        period: 'all',
        userType: 'all',
        country: 'all',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        logStatus: 'all',
        action: '',
        from: '',
        to: '',
        kind: 'all'
    },

    listeners: [],

    init() {
        window.addEventListener('popstate', () => {
            const current = this.getParamsFromUrl();
            this.notify(current);
        });
    },

    getParamsFromUrl() {
        const searchParams = new URLSearchParams(window.location.search);
        return {
            tab: searchParams.get('tab') || this.defaults.tab,
            page: parseInt(searchParams.get('page') || String(this.defaults.page), 10),
            limit: parseInt(searchParams.get('limit') || String(this.defaults.limit), 10),
            search: searchParams.get('search') || '',
            status: searchParams.get('status') || this.defaults.status,
            role: searchParams.get('role') || this.defaults.role,
            tier: searchParams.get('tier') || this.defaults.tier,
            device: searchParams.get('device') || this.defaults.device,
            path: searchParams.get('path') || this.defaults.path,
            period: searchParams.get('period') || this.defaults.period,
            userType: searchParams.get('userType') || this.defaults.userType,
            country: searchParams.get('country') || this.defaults.country,
            sortBy: searchParams.get('sortBy') || this.defaults.sortBy,
            sortOrder: searchParams.get('sortOrder') || this.defaults.sortOrder,
            logStatus: searchParams.get('logStatus') || this.defaults.logStatus,
            action: searchParams.get('action') || '',
            from: searchParams.get('from') || '',
            to: searchParams.get('to') || '',
            kind: searchParams.get('kind') || this.defaults.kind
        };
    },

    setParams(updates, replace = false) {
        const current = this.getParamsFromUrl();
        const merged = { ...current, ...updates };

        const searchParams = new URLSearchParams();

        if (merged.tab && merged.tab !== this.defaults.tab) searchParams.set('tab', merged.tab);
        if (merged.page && merged.page > 1) searchParams.set('page', String(merged.page));
        if (merged.limit && merged.limit !== this.defaults.limit) searchParams.set('limit', String(merged.limit));
        if (merged.search && merged.search.trim()) searchParams.set('search', merged.search.trim());
        if (merged.status && merged.status !== 'all') searchParams.set('status', merged.status);
        if (merged.role && merged.role !== 'all') searchParams.set('role', merged.role);
        if (merged.tier && merged.tier !== 'all') searchParams.set('tier', merged.tier);
        if (merged.device && merged.device !== 'all') searchParams.set('device', merged.device);
        if (merged.path && merged.path !== 'all') searchParams.set('path', merged.path);
        if (merged.period && merged.period !== 'all') searchParams.set('period', merged.period);
        if (merged.userType && merged.userType !== 'all') searchParams.set('userType', merged.userType);
        if (merged.country && merged.country !== 'all') searchParams.set('country', merged.country);
        if (merged.sortBy && merged.sortBy !== this.defaults.sortBy) searchParams.set('sortBy', merged.sortBy);
        if (merged.sortOrder && merged.sortOrder !== this.defaults.sortOrder) searchParams.set('sortOrder', merged.sortOrder);
        if (merged.logStatus && merged.logStatus !== 'all') searchParams.set('logStatus', merged.logStatus);
        if (merged.action && String(merged.action).trim()) searchParams.set('action', String(merged.action).trim());
        if (merged.from) searchParams.set('from', merged.from);
        if (merged.to) searchParams.set('to', merged.to);
        if (merged.kind && merged.kind !== 'all') searchParams.set('kind', merged.kind);

        const newQs = searchParams.toString();
        const newUrl = newQs ? `${window.location.pathname}?${newQs}` : window.location.pathname;

        if (replace) {
            history.replaceState(null, '', newUrl);
        } else {
            history.pushState(null, '', newUrl);
        }

        this.notify(merged);
    },

    resetFilters() {
        this.setParams({
            search: '',
            status: 'all',
            role: 'all',
            tier: 'all',
            sortBy: this.defaults.sortBy,
            sortOrder: this.defaults.sortOrder,
            page: 1
        });
    },

    onChange(cb) {
        this.listeners.push(cb);
    },

    notify(state) {
        this.listeners.forEach((cb) => {
            try { cb(state); } catch (e) { console.error('[AdminState] Listener error:', e); }
        });
    }
};
