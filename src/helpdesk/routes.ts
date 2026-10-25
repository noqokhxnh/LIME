import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as uploadGuard from "../security/uploadGuard.js";
import { getCurrentUser, type AuthUser } from "../auth/session.js";
import { billingStorage } from "../billing/storage.js";
import { getBankByCode } from "../billing/banks.js";
import {
    helpdeskStore,
    TICKET_CATEGORIES,
    TICKET_PRIORITIES,
    TICKET_CREATE_LIMIT_PER_HOUR,
    ACTIVE_REFUND_STATUSES,
    type TicketCategory,
    type TicketPriority,
    type TicketAttachment,
    type RefundRequestPayload,
} from "./store.js";

/**
 * Helpdesk / Ticketing — endpoint phía người dùng.
 *
 * Widget nổi "Hỗ trợ" trên mọi trang gọi các API này để tạo ticket, xem lại
 * danh sách, mở hội thoại và trả lời thêm. Người dùng đăng nhập bắt buộc: khách
 * chưa đăng nhập chỉ nhận hướng dẫn mở màn hình đăng nhập.
 *
 * Bảo mật trọng tâm: một người dùng chỉ đọc/viết được ticket của chính mình
 * (ticket của người khác phải trả 404, không lộ sự tồn tại), và ảnh đính kèm đi
 * qua đúng bộ kiểm tra upload của brand kit (magic bytes + SVG sanitize).
 */

/** Đuôi file ảnh hợp lệ khi tham chiếu lại URL đã upload. */
const SAFE_ATTACHMENT_URL = /^\/uploads\/tickets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|svg|webp)$/i;
/** Số ảnh đính kèm tối đa mỗi tin nhắn. */
const MAX_ATTACHMENTS = 3;

function validateAttachments(raw: unknown): { error?: string; value?: TicketAttachment[] } {
    if (raw === undefined || raw === null) return { value: [] };
    if (!Array.isArray(raw)) return { error: "Danh sách ảnh đính kèm không hợp lệ." };
    if (raw.length > MAX_ATTACHMENTS) {
        return { error: `Tối đa ${MAX_ATTACHMENTS} ảnh đính kèm mỗi tin nhắn.` };
    }
    const value: TicketAttachment[] = [];
    for (const item of raw) {
        const url = typeof item === "string" ? item : item?.url;
        if (typeof url !== "string" || !SAFE_ATTACHMENT_URL.test(url)) {
            return { error: "Ảnh đính kèm phải là tệp đã upload qua /api/support/attachments." };
        }
        const name = typeof item === "object" && item !== null ? item.name : undefined;
        value.push({
            url,
            name: typeof name === "string" && name.length <= 120 ? name : undefined,
        });
    }
    return { value };
}

/** Log tin nhắn cho phép lưu bối cảnh (context) của ticket, sàng lọc rác. */
function normalizeContext(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as Record<string, unknown>;
    const context: Record<string, unknown> = {};
    for (const key of ["url", "jobId"]) {
        const value = source[key];
        if (typeof value === "string" && value.length <= 300) {
            context[key] = value;
        }
    }
    try {
        context.app = renditionContextApp(source.userAgent);
    } catch {
        context.app = null;
    }
    return Object.keys(context).length > 0 ? context : null;
}

function renditionContextApp(userAgent: unknown): string | null {
    if (typeof userAgent !== "string" || userAgent.length > 400) return null;
    const ua = userAgent.toLowerCase();
    for (const browser of ["edg", "chrome", "safari", "firefox"]) {
        if (ua.includes(browser)) return browser;
    }
    return null;
}

/** Số tài khoản ngân hàng: 6 – 30 chữ số (bỏ khoảng trắng, dấu chấm, gạch nối). */
const REFUND_BANK_ACCOUNT_RE = /^[0-9]{6,30}$/;

/**
 * Kiểm tra và dựng payload yêu cầu hoàn tiền.
 *
 * Quy tắc nghiệp vụ (chốt với chủ dự án):
 *  - Chỉ nhận yêu cầu hoàn tiền cho giao dịch **lỗi / chưa được xử lý**. Giao dịch
 *    đã thanh toán thành công (`status = 'paid'` — tiền vào và gói đã kích hoạt)
 *    bị chặn thẳng: "đã thanh toán thành công và đã được xử lý thì không hoàn tiền".
 *  - Số tiền, mã đơn và tên gói do máy chủ lấy lại từ đơn hàng thật, không tin client.
 *  - Một giao dịch chỉ có tối đa một yêu cầu đang chờ/đã duyệt; đã hoàn tiền thì
 *    không nhận thêm.
 */
async function validateRefundRequest(input: {
    userId: string;
    orderId: unknown;
    bankCode: unknown;
    bankAccount: unknown;
    accountHolder: unknown;
    reason: string;
}): Promise<{ error?: string; value?: RefundRequestPayload }> {
    const orderId = String(input.orderId ?? "").trim();
    if (!orderId) {
        return { error: "Vui lòng chọn giao dịch cần hoàn tiền." };
    }

    const bank = getBankByCode(String(input.bankCode ?? ""));
    if (!bank) {
        return { error: "Vui lòng chọn ngân hàng nhận tiền hoàn từ danh sách hỗ trợ." };
    }

    const bankAccount = String(input.bankAccount ?? "").replace(/[\s.\-]/g, "");
    if (!REFUND_BANK_ACCOUNT_RE.test(bankAccount)) {
        return { error: "Số tài khoản phải gồm 6 – 30 chữ số." };
    }

    const holderRaw =
        input.accountHolder === undefined || input.accountHolder === null
            ? ""
            : String(input.accountHolder).trim();
    if (holderRaw.length > 100) {
        return { error: "Tên chủ tài khoản tối đa 100 ký tự." };
    }

    const order = await billingStorage.findOrderById(orderId);
    if (!order || order.user_id !== input.userId) {
        return { error: "Không tìm thấy giao dịch của bạn ứng với lựa chọn vừa rồi." };
    }
    if (order.status === "paid") {
        return {
            error:
                "Giao dịch này đã thanh toán thành công và đã được xử lý nên không thể hoàn tiền. " +
                "Nếu bạn cho rằng đây là nhầm lẫn, hãy tạo yêu cầu hỗ trợ với danh mục khác.",
        };
    }

    const priorStatuses = await helpdeskStore.mapRefundRequestsByOrder(input.userId);
    const prior = priorStatuses.get(order.id);
    if (prior && ACTIVE_REFUND_STATUSES.includes(prior)) {
        return { error: "Bạn đã gửi yêu cầu hoàn tiền cho giao dịch này và đang chờ xử lý." };
    }
    if (prior === "refunded") {
        return { error: "Giao dịch này đã được hoàn tiền trước đó." };
    }

    const plan = order.plan_id ? await billingStorage.getPlanById(order.plan_id) : null;

    return {
        value: {
            orderId: order.id,
            payCode: order.pay_code,
            planId: order.plan_id || null,
            planName: plan?.name ?? null,
            amountVnd: order.amount_vnd,
            orderStatus: order.status,
            bankCode: bank.code,
            bankName: bank.name,
            bankAccount,
            accountHolder: holderRaw ? holderRaw.toUpperCase() : null,
            reason: input.reason,
            status: "pending",
            adminNote: null,
            reviewedBy: null,
            reviewedAt: null,
            refundId: null,
            refundedAt: null,
        },
    };
}

function unauthorized(reply: FastifyReply): { user?: AuthUser; body?: object } {
    reply.status(401);
    return { body: { error: "Yêu cầu đăng nhập để tiếp nhận và theo dõi yêu cầu hỗ trợ." } };
}

export async function supportRoutes(app: FastifyInstance): Promise<void> {
    // ------------------------------------------------------------------
    // 1. Tạo ticket
    // ------------------------------------------------------------------
    app.post("/api/support/tickets", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return unauthorized(reply).body;
        }

        const body = (request.body as any) || {};
        const subject = String(body.subject ?? "").trim();
        const text = String(body.body ?? "").trim();
        const category = String(body.category ?? "other");

        if (subject.length < 5 || subject.length > 200) {
            reply.status(400);
            return { error: "Tiêu đề phải từ 5 đến 200 ký tự." };
        }
        if (text.length < 5 || text.length > 5000) {
            reply.status(400);
            return { error: "Nội dung phải từ 5 đến 5000 ký tự." };
        }
        if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
            reply.status(400);
            return { error: `Danh mục không hợp lệ. Chỉ chấp nhận: ${TICKET_CATEGORIES.join(", ")}.` };
        }
        const priority = String(body.priority ?? "normal");
        if (!TICKET_PRIORITIES.includes(priority as TicketPriority)) {
            reply.status(400);
            return { error: `Mức ưu tiên không hợp lệ. Chỉ chấp nhận: ${TICKET_PRIORITIES.join(", ")}.` };
        }

        const attachments = validateAttachments(body.attachments);
        if (attachments.error) {
            reply.status(400);
            return { error: attachments.error };
        }

        // Chống spam: giới hạn số ticket mỗi user trong 1 giờ.
        const recentCount = await helpdeskStore.countRecentByUser(user.id);
        if (recentCount >= TICKET_CREATE_LIMIT_PER_HOUR) {
            reply.status(429);
            return { error: `Bạn đã tạo ${TICKET_CREATE_LIMIT_PER_HOUR} yêu cầu trong 1 giờ. Vui lòng chờ rồi thử lại.` };
        }

        let context = normalizeContext(body.context);

        // Danh mục "Hoàn tiền": người dùng chọn giao dịch lỗi + nhập số tài khoản,
        // ngân hàng, (tuỳ chọn) ảnh chụp màn hình và lý do. Máy chủ dựng payload
        // hoàn tiền từ đơn hàng thật rồi gắn vào context của ticket.
        if (category === "refund") {
            const refund = await validateRefundRequest({
                userId: user.id,
                orderId: (body.refund || {}).orderId,
                bankCode: (body.refund || {}).bankCode,
                bankAccount: (body.refund || {}).bankAccount,
                accountHolder: (body.refund || {}).accountHolder,
                reason: text,
            });
            if (refund.error) {
                reply.status(400);
                return { error: refund.error };
            }
            context = { ...(context || {}), refund: refund.value };
        }

        try {
            const created = await helpdeskStore.createTicket({
                userId: user.id,
                userEmail: user.email || null,
                subject,
                category: category as TicketCategory,
                priority: priority as TicketPriority,
                body: text,
                attachments: attachments.value,
                context,
            });
            return { success: true, ticket: created };
        } catch (err: any) {
            reply.status(500);
            return { error: `Không tạo được yêu cầu hỗ trợ: ${err.message || err}` };
        }
    });

    // ------------------------------------------------------------------
    // 2. Upload ảnh đính kèm (screenshot báo lỗi)
    // ------------------------------------------------------------------
    app.post("/api/support/attachments", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return unauthorized(reply).body;
        }

        try {
            const data = await request.file();
            if (!data) {
                reply.status(400);
                return { error: 'Không tìm thấy file trong request. Hãy gửi file với field name là "file".' };
            }

            const chunks: Buffer[] = [];
            for await (const chunk of data.file) {
                chunks.push(chunk);
            }
            if (data.file.truncated) {
                reply.status(413);
                return { error: "Ảnh vượt quá dung lượng cho phép (tối đa 5MB)." };
            }

            const fileBuffer = Buffer.concat(chunks);
            const mimeType = data.mimetype || "application/octet-stream";
            const validation = uploadGuard.validateUploadedFile(fileBuffer, mimeType);
            if (!validation.isValid) {
                reply.status(400);
                return { error: validation.reason || "Tệp không hợp lệ." };
            }

            const savePath = uploadGuard.generateSafeFilePath(mimeType, uploadGuard.getCanonicalTicketsDir());
            if (mimeType === "image/svg+xml") {
                if (!validation.sanitizedContent || !validation.sanitizedContent.trim()) {
                    reply.status(400);
                    return { error: "Nội dung SVG rỗng hoặc không hợp lệ sau khi làm sạch." };
                }
                uploadGuard.writeFileSyncInTickets(savePath, validation.sanitizedContent);
            } else {
                uploadGuard.writeFileSyncInTickets(savePath, fileBuffer);
            }

            const filename = savePath.split(/[\\/]/).pop();
            return { success: true, url: `/uploads/tickets/${filename}` };
        } catch (err: any) {
            reply.status(500);
            return { error: `Lỗi khi tải ảnh lên: ${err.message || err}` };
        }
    });

    // ------------------------------------------------------------------
    // 3. Danh sách ticket của tôi
    // ------------------------------------------------------------------
    app.get("/api/support/tickets", async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return unauthorized(reply).body;
        }

        const query = (request.query as any) || {};
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 20;

        const result = await helpdeskStore.listForUser(user.id, { page, limit });
        return { success: true, ...result };
    });

    // ------------------------------------------------------------------
    // 4. Chi tiết ticket (chỉ chủ sở hữu hoặc admin)
    // ------------------------------------------------------------------
    app.get("/api/support/tickets/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return unauthorized(reply).body;
        }

        const ticket = await helpdeskStore.getTicket(request.params.id);
        // Fail-closed: ticket mồ côi (userId null do chủ bị xoá — FK SET NULL)
        // chỉ admin xem được; điều kiện cũ có `ticket.userId &&` khiến mọi
        // người dùng đăng nhập đều đọc được ticket không chủ.
        if (!ticket || (ticket.userId !== user.id && user.role !== "admin")) {
            reply.status(404);
            return { error: "Không tìm thấy yêu cầu hỗ trợ." };
        }

        // Người dùng không được thấy các ghi chú nội bộ của admin.
        const messages = ticket.messages.filter((m) => !m.isInternal || user.role === "admin");
        return { success: true, ticket: { ...ticket, messages } };
    });

    // ------------------------------------------------------------------
    // 5. Trả lời thêm vào hội thoại
    // ------------------------------------------------------------------
    app.post(
        "/api/support/tickets/:id/messages",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const user = await getCurrentUser(request);
            if (!user) {
                return unauthorized(reply).body;
            }

            const ticket = await helpdeskStore.getTicket(request.params.id);
            // Fail-closed như route đọc: ticket không chủ (userId null) không
            // mở cho người dùng thường đọc hay trả lời.
            if (!ticket || (ticket.userId !== user.id && user.role !== "admin")) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }
            if (ticket.status === "closed") {
                reply.status(409);
                return { error: "Yêu cầu này đã đóng. Vui lòng tạo yêu cầu mới nếu cần hỗ trợ tiếp." };
            }

            const body = (request.body as any) || {};
            const text = String(body.body ?? "").trim();
            if (text.length < 1 || text.length > 5000) {
                reply.status(400);
                return { error: "Nội dung phản hồi phải từ 1 đến 5000 ký tự." };
            }

            const attachments = validateAttachments(body.attachments);
            if (attachments.error) {
                reply.status(400);
                return { error: attachments.error };
            }

            try {
                const updated = await helpdeskStore.addMessage(ticket.id, {
                    senderType: "user",
                    senderId: user.id,
                    senderEmail: user.email || null,
                    body: text,
                    attachments: attachments.value,
                });
                if (!updated) {
                    reply.status(404);
                    return { error: "Không tìm thấy yêu cầu hỗ trợ." };
                }
                const messages = updated.messages.filter((m) => !m.isInternal || user.role === "admin");
                return { success: true, ticket: { ...updated, messages } };
            } catch (err: any) {
                reply.status(500);
                return { error: `Không gửi được phản hồi: ${err.message || err}` };
            }
        }
    );

    // ------------------------------------------------------------------
    // 6. Người dùng tự đóng ticket
    // ------------------------------------------------------------------
    app.post(
        "/api/support/tickets/:id/close",
        async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
            const user = await getCurrentUser(request);
            if (!user) {
                return unauthorized(reply).body;
            }

            const ticket = await helpdeskStore.findById(request.params.id);
            if (!ticket || !ticket.userId || ticket.userId !== user.id) {
                reply.status(404);
                return { error: "Không tìm thấy yêu cầu hỗ trợ." };
            }

            const updated = await helpdeskStore.updateTicket(ticket.id, { status: "closed" });
            return { success: true, ticket: updated };
        }
    );
}
