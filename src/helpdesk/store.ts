import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { db } from "../database/index.js";
import { getConfig } from "../config.js";

/**
 * Helpdesk / Ticketing — kho lưu yêu cầu hỗ trợ của người dùng.
 *
 * Mỗi ticket là một chuỗi hội thoại: user gửi (báo lỗi / yêu cầu hỗ trợ kỹ thuật)
 * qua widget nổi trên trang, admin tiếp nhận & phản hồi ngay trong cổng quản trị.
 * Tin nhắn có thể kèm ảnh (screenshot) và có ghi chú nội bộ (`is_internal`)
 * chỉ admin nhìn thấy.
 *
 * Kho hoạt động ở hai chế độ giống `announcementsStore`: PostgreSQL khi có
 * `DATABASE_URL`, nếu không thì lùi về tệp JSON `data/tickets.json` (dev/test).
 */
export const TICKET_CATEGORIES = ["bug", "feature_request", "billing", "account", "render", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = ["open", "in_progress", "waiting_user", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SENDER_TYPES = ["user", "admin", "system"] as const;
export type TicketSenderType = (typeof TICKET_SENDER_TYPES)[number];

/** Bảng chữ cái sinh mã ticket (bỏ O, 0, 1, I để tránh đọc nhầm). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Số ticket tối đa một user được tạo trong 1 giờ (chống spam widget). */
export const TICKET_CREATE_LIMIT_PER_HOUR = 5;

export interface TicketAttachment {
    url: string;
    name?: string;
    size?: number;
    mime?: string;
}

export interface TicketMessage {
    id: string;
    senderType: TicketSenderType;
    senderId?: string | null;
    senderEmail?: string | null;
    body: string;
    attachments: TicketAttachment[];
    isInternal: boolean;
    createdAt: string;
}

export interface Ticket {
    id: string;
    code: string;
    userId: string | null;
    userEmail: string | null;
    subject: string;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    context: Record<string, unknown> | null;
    lastMessageAt: string;
    lastAdminReplyAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface TicketWithMessages extends Ticket {
    messages: TicketMessage[];
}

export interface TicketListOptions {
    status?: string;
    category?: string;
    priority?: string;
    search?: string;
    page?: number;
    limit?: number;
}

const STORAGE_FILE = join(process.cwd(), "data", "tickets.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

let cacheTickets: Ticket[] = [];
let cacheMessages = new Map<string, TicketMessage[]>();
let isLoaded = false;

function ensureLoaded(): void {
    if (isLoaded) return;
    isLoaded = true;

    try {
        if (existsSync(STORAGE_FILE)) {
            const parsed = JSON.parse(readFileSync(STORAGE_FILE, "utf8"));
            if (Array.isArray(parsed?.tickets)) {
                for (const t of parsed.tickets) {
                    if (t && t.id) cacheTickets.push(normalizeStoredTicket(t));
                }
            }
            if (parsed?.messages && typeof parsed.messages === "object") {
                for (const [ticketId, messages] of Object.entries(parsed.messages)) {
                    if (Array.isArray(messages)) {
                        cacheMessages.set(ticketId, (messages as any[]).map(normalizeStoredMessage));
                    }
                }
            }
        }
    } catch (err) {
        console.error("[Helpdesk] Failed to read tickets from disk:", err);
    }
}

function saveToDisk(): void {
    if (isTestEnv) return;
    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const payload = {
            tickets: cacheTickets,
            messages: Object.fromEntries(cacheMessages),
        };
        const tempFile = `${STORAGE_FILE}.tmp`;
        writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
        renameSync(tempFile, STORAGE_FILE);
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[Helpdesk] Failed to persist tickets to disk:", err);
        }
    }
}

function toIsoOrNull(value: unknown): string | null {
    if (!value) return null;
    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStoredTicket(t: any): Ticket {
    return {
        id: String(t.id),
        code: String(t.code || ""),
        userId: t.userId ?? t.user_id ?? null,
        userEmail: t.userEmail ?? t.user_email ?? null,
        subject: String(t.subject || ""),
        category: TICKET_CATEGORIES.includes(t.category) ? t.category : "other",
        priority: TICKET_PRIORITIES.includes(t.priority) ? t.priority : "normal",
        status: TICKET_STATUSES.includes(t.status) ? t.status : "open",
        context: (t.context && typeof t.context === "object") ? t.context : null,
        lastMessageAt: toIsoOrNull(t.lastMessageAt ?? t.last_message_at) || new Date().toISOString(),
        lastAdminReplyAt: toIsoOrNull(t.lastAdminReplyAt ?? t.last_admin_reply_at),
        createdAt: toIsoOrNull(t.createdAt ?? t.created_at) || new Date().toISOString(),
        updatedAt: toIsoOrNull(t.updatedAt ?? t.updated_at) || new Date().toISOString(),
    };
}

function normalizeStoredMessage(m: any): TicketMessage {
    return {
        id: String(m.id || v4()),
        senderType: TICKET_SENDER_TYPES.includes(m.senderType ?? m.sender_type) ? (m.senderType ?? m.sender_type) : "system",
        senderId: (m.senderId ?? m.sender_id ?? null) as string | null,
        senderEmail: (m.senderEmail ?? m.sender_email ?? null) as string | null,
        body: String(m.body || ""),
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        isInternal: Boolean(m.isInternal ?? m.is_internal),
        createdAt: toIsoOrNull(m.createdAt ?? m.created_at) || new Date().toISOString(),
    };
}

function formatTicketRow(row: any): Ticket {
    return normalizeStoredTicket(row);
}

function formatMessageRow(row: any): TicketMessage {
    return normalizeStoredMessage(row);
}

async function loadTickets(): Promise<Ticket[]> {
    const config = getConfig();
    if (config.DATABASE_URL) {
        try {
            const res = await db.query(
                `SELECT * FROM tickets ORDER BY last_message_at DESC LIMIT 5000`
            );
            cacheTickets = res.rows.map(formatTicketRow);
            isLoaded = true;
            return cacheTickets;
        } catch (err) {
            console.error("[Helpdesk] DB error in loadTickets, falling back to cache:", err);
        }
    }
    ensureLoaded();
    return cacheTickets;
}

async function loadMessages(ticketId: string): Promise<TicketMessage[]> {
    const config = getConfig();
    if (config.DATABASE_URL) {
        try {
            const res = await db.query(
                `SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
                [ticketId]
            );
            return res.rows.map(formatMessageRow);
        } catch (err) {
            console.error("[Helpdesk] DB error in loadMessages:", err);
        }
    }
    ensureLoaded();
    return [...(cacheMessages.get(ticketId) || [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

function generateCode(): string {
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return `LIME-T-${code}`;
}

async function persistMessage(message: TicketMessage): Promise<void> {
    const config = getConfig();
    if (config.DATABASE_URL) {
        await db.query(
            `INSERT INTO ticket_messages
                (id, ticket_id, sender_type, sender_id, sender_email, body, attachments, is_internal, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                message.id,
                (message as any).ticketId,
                message.senderType,
                message.senderId || null,
                message.senderEmail || null,
                message.body,
                JSON.stringify(message.attachments || []),
                message.isInternal,
                message.createdAt,
            ]
        );
        return;
    }
    saveToDisk();
}

export const helpdeskStore = {
    /** Danh ticket cho user (chỉ của chính họ), phân trang. */
    async listForUser(
        userId: string,
        options: { page?: number; limit?: number } = {}
    ): Promise<{ items: Ticket[]; total: number; page: number; limit: number; totalPages: number }> {
        const all = await loadTickets();
        const owned = all
            .filter((t) => t.userId === userId)
            .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

        const page = Math.max(1, options.page || 1);
        const limit = Math.max(1, Math.min(50, options.limit || 20));
        const totalPages = Math.ceil(owned.length / limit) || 1;
        const start = (page - 1) * limit;

        return { items: owned.slice(start, start + limit), total: owned.length, page, limit, totalPages };
    },

    /** Danh ticket cho admin (lọc nhiều điều kiện + phân trang). */
    async listForAdmin(
        options: TicketListOptions = {}
    ): Promise<{ items: Ticket[]; total: number; page: number; limit: number; totalPages: number }> {
        const all = await loadTickets();

        let filtered = all;
        if (options.status && options.status !== "all") {
            filtered = filtered.filter((t) => t.status === options.status);
        }
        if (options.category && options.category !== "all") {
            filtered = filtered.filter((t) => t.category === options.category);
        }
        if (options.priority && options.priority !== "all") {
            filtered = filtered.filter((t) => t.priority === options.priority);
        }
        const search = (options.search || "").trim().toLowerCase();
        if (search) {
            filtered = filtered.filter(
                (t) =>
                    t.code.toLowerCase().includes(search) ||
                    t.subject.toLowerCase().includes(search) ||
                    (t.userEmail || "").toLowerCase().includes(search)
            );
        }

        filtered = filtered.sort(
            (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
        );

        const page = Math.max(1, options.page || 1);
        const limit = Math.max(1, Math.min(100, options.limit || 25));
        const totalPages = Math.ceil(filtered.length / limit) || 1;
        const start = (page - 1) * limit;

        return { items: filtered.slice(start, start + limit), total: filtered.length, page, limit, totalPages };
    },

    async getStats(): Promise<Record<string, number>> {
        const all = await loadTickets();
        const stats: Record<string, number> = { total: all.length, open: 0, in_progress: 0, waiting_user: 0, resolved: 0, closed: 0 };
        for (const t of all) stats[t.status] = (stats[t.status] || 0) + 1;
        return stats;
    },

    async findById(id: string): Promise<Ticket | null> {
        const all = await loadTickets();
        const ticket = all.find((t) => t.id === id);
        return ticket || null;
    },

    /** Chi tiết ticket kèm toàn bộ hội thoại. */
    async getTicket(id: string): Promise<TicketWithMessages | null> {
        const ticket = await this.findById(id);
        if (!ticket) return null;
        const messages = await loadMessages(id);
        return { ...ticket, messages };
    },

    async findByCode(code: string): Promise<Ticket | null> {
        const all = await loadTickets();
        return all.find((t) => t.code.toLowerCase() === code.trim().toLowerCase()) || null;
    },

    async createTicket(input: {
        userId: string;
        userEmail?: string | null;
        subject: string;
        category: TicketCategory;
        priority?: TicketPriority;
        body: string;
        attachments?: TicketAttachment[];
        context?: Record<string, unknown> | null;
    }): Promise<TicketWithMessages> {
        const nowIso = new Date().toISOString();
        const message: TicketMessage = {
            id: v4(),
            senderType: "user",
            senderId: input.userId,
            senderEmail: input.userEmail || null,
            body: input.body,
            attachments: input.attachments || [],
            isInternal: false,
            createdAt: nowIso,
        };

        const config = getConfig();
        let ticket: Ticket | null = null;

        if (config.DATABASE_URL) {
            let lastError: unknown = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                const id = v4();
                const code = generateCode();
                try {
                    const res = await db.query(
                        `INSERT INTO tickets
                            (id, code, user_id, user_email, subject, category, priority, status, context, last_message_at, created_at, updated_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$9,$9)
                         RETURNING *`,
                        [
                            id,
                            code,
                            input.userId,
                            input.userEmail || null,
                            input.subject,
                            input.category,
                            input.priority || "normal",
                            input.context ? JSON.stringify(input.context) : null,
                            nowIso,
                        ]
                    );
                    ticket = formatTicketRow(res.rows[0]);
                    await persistMessage({ ...(message as any), ticketId: ticket.id });
                    return { ...ticket, messages: [message] };
                } catch (err: any) {
                    lastError = err;
                    // Mã trùng (23505) → sinh lại mã cho lần thử sau.
                    if (err?.code !== "23505") throw err;
                }
            }
            throw lastError instanceof Error ? lastError : new Error("Không tạo được ticket.");
        }

        ensureLoaded();
        ticket = {
            id: v4(),
            code: generateCode(),
            userId: input.userId,
            userEmail: input.userEmail || null,
            subject: input.subject,
            category: input.category,
            priority: input.priority || "normal",
            status: "open",
            context: input.context || null,
            lastMessageAt: nowIso,
            lastAdminReplyAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
        };
        cacheTickets.unshift(ticket);
        cacheMessages.set(ticket.id, [message]);
        saveToDisk();
        return { ...ticket, messages: [message] };
    },

    /**
     * Thêm 1 tin nhắn vào hội thoại và cập nhật các mốc thời gian / trạng thái phiếu.
     *
     * Chuyển trạng thái tự động:
     *  - user trả lời khi chờ phản hồi (waiting_user) → mở lại (open);
     *  - admin phản hồi lần đầu khi ticket đang mở → đang xử lý (in_progress).
     */
    async addMessage(
        ticketId: string,
        input: {
            senderType: TicketSenderType;
            senderId?: string | null;
            senderEmail?: string | null;
            body: string;
            attachments?: TicketAttachment[];
            isInternal?: boolean;
        }
    ): Promise<TicketWithMessages | null> {
        const ticket = await this.findById(ticketId);
        if (!ticket) return null;

        const nowIso = new Date().toISOString();
        const message: TicketMessage = {
            id: v4(),
            senderType: input.senderType,
            senderId: input.senderId || null,
            senderEmail: input.senderEmail || null,
            body: input.body,
            attachments: input.attachments || [],
            isInternal: Boolean(input.isInternal),
            createdAt: nowIso,
        };

        const nextStatus: TicketStatus =
            input.senderType === "user" && ticket.status === "waiting_user"
                ? "open"
                : input.senderType === "admin" && !message.isInternal && ticket.status === "open"
                  ? "in_progress"
                  : ticket.status;

        if (nextStatus !== ticket.status) {
            ticket.status = nextStatus;
        }
        ticket.lastMessageAt = nowIso;
        ticket.updatedAt = nowIso;
        if (input.senderType === "admin" && !message.isInternal) {
            ticket.lastAdminReplyAt = nowIso;
        }

        const config = getConfig();
        if (config.DATABASE_URL) {
            await persistMessage({ ...(message as any), ticketId });
            await db.query(
                `UPDATE tickets
                 SET last_message_at = $2, last_admin_reply_at = $3, status = $4, updated_at = $2
                 WHERE id = $1`,
                [ticketId, nowIso, ticket.lastAdminReplyAt, ticket.status]
            );
        } else {
            const list = cacheMessages.get(ticketId) || [];
            list.push(message);
            cacheMessages.set(ticketId, list);
            cacheTickets = cacheTickets.map((t) => (t.id === ticketId ? { ...ticket } : t));
            saveToDisk();
        }

        return { ...ticket, messages: await loadMessages(ticketId) };
    },

    async updateTicket(id: string, patch: { status?: TicketStatus; priority?: TicketPriority }): Promise<Ticket | null> {
        const ticket = await this.findById(id);
        if (!ticket) return null;

        const nowIso = new Date().toISOString();
        ticket.updatedAt = nowIso;
        if (patch.status !== undefined) ticket.status = patch.status;
        if (patch.priority !== undefined) ticket.priority = patch.priority;

        const config = getConfig();
        if (config.DATABASE_URL) {
            await db.query(
                `UPDATE tickets SET status = $2, priority = $3, updated_at = $4 WHERE id = $1`,
                [id, ticket.status, ticket.priority, nowIso]
            );
        } else {
            cacheTickets = cacheTickets.map((t) => (t.id === id ? { ...ticket } : t));
            saveToDisk();
        }
        return ticket;
    },

    /** Đếm số ticket user tạo trong khoảng thời gian gần đây (chống spam). */
    async countRecentByUser(userId: string, sinceMs: number = 3600_000): Promise<number> {
        const since = new Date(Date.now() - sinceMs).toISOString();
        const all = await loadTickets();
        return all.filter((t) => t.userId === userId && t.createdAt >= since).length;
    },
};
