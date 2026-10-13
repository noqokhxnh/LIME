/**
 * Admin API Client
 * Wraps all /api/admin/* endpoints with automatic JWT token management
 */

export const AdminApi = {
    getToken() {
        return localStorage.getItem('vidtml_token') || '';
    },

    getHeaders() {
        const token = this.getToken();
        return {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    },

    async request(url, options = {}) {
        const headers = { ...this.getHeaders(), ...(options.headers || {}) };
        const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
        if (options.body !== undefined && options.body !== null && !hasContentType) {
            headers['Content-Type'] = 'application/json';
        }
        try {
            const res = await fetch(url, { ...options, credentials: 'include', headers });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const message = data.message && data.message !== data.error
                    ? data.message
                    : data.error || `Request failed with status ${res.status}`;
                throw new Error(message);
            }
            return data;
        } catch (err) {
            console.error(`[AdminApi] Error requesting ${url}:`, err);
            throw err;
        }
    },

    // Auth
    async getMe() {
        return this.request('/api/auth/me');
    },

    // Dashboard Stats
    async getStats() {
        return this.request('/api/admin/stats');
    },

    // Users
    async getUsers(params = {}) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                qs.append(key, val);
            }
        });
        return this.request(`/api/admin/users?${qs.toString()}`);
    },

    async updateUser(userId, data) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    async deleteUser(userId, hard = false) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}${hard ? '?hard=true' : ''}`, {
            method: 'DELETE'
        });
    },

    async restoreUser(userId) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}/restore`, {
            method: 'POST'
        });
    },

    async getUserLoginLogs(userId, limit = 50) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}/login-logs?limit=${limit}`);
    },

    async getUserJobs(userId) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}/jobs`);
    },

    async bulkUsersAction(userIds, action) {
        return this.request('/api/admin/users/bulk', {
            method: 'POST',
            body: JSON.stringify({ userIds, action })
        });
    },

    async resetPassword(userId) {
        return this.request(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
            method: 'POST'
        });
    },

    // Video Jobs
    async getJobs(params = {}) {
        const qs = new URLSearchParams(params);
        return this.request(`/api/admin/jobs?${qs.toString()}`);
    },

    async getJobDetails(jobId) {
        return this.request(`/api/admin/jobs/${encodeURIComponent(jobId)}`);
    },

    async updateJob(jobId, data) {
        return this.request(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    async cancelJob(jobId) {
        return this.request(`/api/admin/jobs/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST'
        });
    },

    async retryJob(jobId) {
        return this.request(`/api/admin/jobs/${encodeURIComponent(jobId)}/retry`, {
            method: 'POST'
        });
    },

    async deleteJob(jobId) {
        return this.request(`/api/admin/jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE'
        });
    },

    // Orders
    async getOrders() {
        return this.request('/api/admin/orders');
    },

    async fulfillOrder(orderId) {
        return this.request(`/api/admin/orders/${encodeURIComponent(orderId)}/fulfill`, {
            method: 'POST'
        });
    },

    async cancelOrder(orderId) {
        return this.request(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, {
            method: 'POST'
        });
    },

    // Failed Payments & Refunds
    async getUnmatched(status = 'pending') {
        return this.request(`/api/admin/unmatched?status=${encodeURIComponent(status)}`);
    },

    async getDuplicatePayments() {
        return this.request('/api/admin/payments/duplicates');
    },

    async resolveUnmatched(id, data) {
        return this.request(`/api/admin/unmatched/${encodeURIComponent(id)}/resolve`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async refundUnmatched(id, data) {
        return this.request(`/api/admin/unmatched/${encodeURIComponent(id)}/refund`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async refundPayment(paymentId, data) {
        return this.request(`/api/admin/payments/${encodeURIComponent(paymentId)}/refund`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async getRefunds() {
        return this.request('/api/admin/refunds');
    },

    // System Settings
    async getSettings() {
        return this.request('/api/admin/settings');
    },

    async updateSettings(settings) {
        return this.request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
    },

    async testProvider(provider, model, type = 'llm', voice = '', text = '', synthesize = false) {
        return this.request('/api/admin/test-provider', {
            method: 'POST',
            body: JSON.stringify({ provider, model, type, voice, text, synthesize })
        });
    },

    // Audit Logs
    async getAuditLogs() {
        return this.request('/api/admin/audit-logs');
    },

    async clearAuditLogs() {
        return this.request('/api/admin/audit-logs', {
            method: 'DELETE'
        });
    },

    // Page Views & Analytics
    async getViews(params = {}) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                qs.append(key, val);
            }
        });
        return this.request(`/api/admin/views?${qs.toString()}`);
    },

    async getViewsStats(period = 'all') {
        return this.request(`/api/admin/views/stats?period=${encodeURIComponent(period)}`);
    },

    async clearViews() {
        return this.request('/api/admin/views', {
            method: 'DELETE'
        });
    },

    // Maintenance Visitor Logs
    async getMaintenanceLogs(params = {}) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                qs.append(key, val);
            }
        });
        return this.request(`/api/admin/maintenance?${qs.toString()}`);
    },

    async getMaintenanceStats() {
        return this.request('/api/admin/maintenance/stats');
    },

    async syncMaintenanceLogs() {
        return this.request('/api/admin/maintenance/sync', {
            method: 'POST'
        });
    },

    async clearMaintenanceLogs() {
        return this.request('/api/admin/maintenance', {
            method: 'DELETE'
        });
    }
};
