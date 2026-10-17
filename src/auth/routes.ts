import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../database/index.js';
import { createSession, deleteSession, getCurrentUser } from './session.js';
import { getConfig } from '../config.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { recordAuthEvent } from './loginAudit.js';

const registerSchema = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,30}$/),
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
});

const loginSchema = z.object({
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(128),
});

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(6).max(128),
    confirmPassword: z.string().min(6).max(128).optional(),
});

function isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }
    return (error as { code?: string }).code === '23505';
}
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function authRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/auth/register', async (request, reply) => {
        const parsed = registerSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid registration data', details: parsed.error.flatten() });
        }
        const { username, password } = parsed.data;
        const email = parsed.data.email.toLowerCase();
        const passwordHash = await bcrypt.hash(password, 12);
        const isAdmin = email === 'khanh2k5xxx@gmail.com';
        const role = isAdmin ? 'admin' : 'user';
        const tier = isAdmin ? 'enterprise' : 'free';
        const credits = isAdmin ? 10000 : 20;
        const totalCredits = credits;
        try {
            const result = await db.query(
                `INSERT INTO users (id, username, email, password_hash, role, tier, credits, total_credits)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, username, email, role, tier, credits, total_credits, created_at`,
                [randomUUID(), username, email, passwordHash, role, tier, credits, totalCredits]
            );
            const user = result.rows[0];
            await createSession(user.id, reply);
            await recordAuthEvent({
                action: 'auth.register',
                userId: user.id,
                userEmail: user.email,
                provider: 'local',
                request,
                details: { username: user.username },
            });
            await recordAuthEvent({
                action: 'auth.login',
                userId: user.id,
                userEmail: user.email,
                provider: 'local',
                request,
                details: { username: user.username, afterRegister: true },
            });
            return reply.status(201).send({
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                tier: user.tier,
                credits: user.credits,
                totalCredits: user.total_credits,
                creditPercent: 100,
                createdAt: new Date(user.created_at).toISOString(),
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                return reply.status(409).send({
                    error: 'Username or email already exists',
                });
            }
            throw error;
        }
    });

    app.post('/api/auth/login', async (request, reply) => {
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid login data', details: parsed.error.flatten() });
        }
        const result = await db.query(
            'SELECT id, username, email, password_hash, role, tier, credits, total_credits, created_at FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
            [parsed.data.username]
        );
        const user = result.rows[0];
        if (!user) {
            await recordAuthEvent({
                action: 'auth.login_failed',
                status: 'failure',
                request,
                details: { identifier: parsed.data.username, reason: 'user_not_found' },
            });
            return reply.status(401).send({
                error: 'Invalid username or password',
            });
        }
        if(!user.password_hash) {
            await recordAuthEvent({
                action: 'auth.login_failed',
                status: 'failure',
                userId: user.id,
                userEmail: user.email,
                provider: 'google',
                request,
                details: { reason: 'google_account' },
            });
            return reply.status(401).send({
                error: 'đăng nhập bằng Google',
            });
        }
        const validPassword = await bcrypt.compare(
            parsed.data.password,
            user.password_hash
        );
        if (!validPassword) {
            await recordAuthEvent({
                action: 'auth.login_failed',
                status: 'failure',
                userId: user.id,
                userEmail: user.email,
                request,
                details: { reason: 'wrong_password' },
            });
            return reply.status(401).send({
                error: 'Invalid username or password',
            });
        }
        const credits = Number(user.credits ?? 20);
        const totalCredits = Math.max(Number(user.total_credits ?? 20), 1);
        const creditPercent = Math.min(100, Math.max(0, Math.round((credits / totalCredits) * 100)));
        await createSession(user.id, reply);
        await recordAuthEvent({
            action: 'auth.login',
            userId: user.id,
            userEmail: user.email,
            request,
            details: { username: user.username },
        });
        return {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role || 'user',
            tier: user.tier || 'free',
            credits,
            totalCredits,
            creditPercent,
            createdAt: new Date(user.created_at).toISOString(),
        };
    });

    // Đổi mật khẩu khi đã đăng nhập. Yêu cầu session hợp lệ + mật khẩu hiện tại,
    // chỉ tác động đúng tài khoản của người gọi. Không dùng làm "quên mật khẩu"
    // cho người chưa đăng nhập (chưa có hạ tầng gửi email xác thực).
    app.post('/api/auth/reset-password', async (request, reply) => {
        const sessionUser = await getCurrentUser(request);
        if (!sessionUser) {
            return reply.status(401).send({
                error: 'Vui lòng đăng nhập để đổi mật khẩu.',
            });
        }
        const parsed = changePasswordSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: 'Dữ liệu không hợp lệ. Mật khẩu mới phải có từ 6 đến 128 ký tự.',
            });
        }
        const { currentPassword, newPassword, confirmPassword } = parsed.data;
        if (confirmPassword && newPassword !== confirmPassword) {
            return reply.status(400).send({
                error: 'Mật khẩu xác nhận không khớp',
            });
        }

        const result = await db.query(
            'SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1',
            [sessionUser.id]
        );
        const user = result.rows[0];
        if (!user || !user.password_hash) {
            return reply.status(400).send({
                error: 'Tài khoản đăng nhập bằng Google không đặt mật khẩu tại đây.',
            });
        }
        const validCurrent = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validCurrent) {
            return reply.status(403).send({
                error: 'Mật khẩu hiện tại không đúng.',
            });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await db.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [passwordHash, user.id]
        );

        await recordAuthEvent({
            action: 'auth.password_changed',
            userId: sessionUser.id,
            userEmail: sessionUser.email,
            request,
        });

        return {
            ok: true,
            message: 'Đổi mật khẩu thành công!',
        };
    });

    app.get('/api/auth/me', async (request, reply) => {
        const user = await getCurrentUser(request);
        if (!user) {
            return reply.status(401).send({
                error: 'Authentication required',
            });
        }
        return user;
    });

    app.post('/api/auth/logout', async (request, reply) => {
        await deleteSession(request, reply);
        return { ok: true };
    });
    app.get('/api/auth/config', async () => {
        const config = getConfig();
        return {
            googleAuthEnabled: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
        };
    });

    function isLocalhostRequest(request: FastifyRequest): boolean {
        const forwardedHost = request.headers['x-forwarded-host'];
        const hostHeader = (typeof forwardedHost === 'string' ? forwardedHost : Array.isArray(forwardedHost) ? forwardedHost[0] : '') || request.headers.host || request.hostname || '';
        const hostNameOnly = hostHeader.split(':')[0].toLowerCase();
        return hostNameOnly === 'localhost' || hostNameOnly === '127.0.0.1' || hostNameOnly === '[::1]' || hostNameOnly === '::1';
    }

    function resolveGoogleRedirectUri(request: FastifyRequest, defaultUri: string): string {
        const forwardedHost = request.headers['x-forwarded-host'];
        const hostHeader = (typeof forwardedHost === 'string' ? forwardedHost : Array.isArray(forwardedHost) ? forwardedHost[0] : '') || request.headers.host || request.hostname || '';
        if (isLocalhostRequest(request)) {
            const forwardedProto = request.headers['x-forwarded-proto'];
            const proto = (typeof forwardedProto === 'string' ? forwardedProto : Array.isArray(forwardedProto) ? forwardedProto[0] : '') || request.protocol || 'http';
            return `${proto}://${hostHeader}/api/auth/google/callback`;
        }
        return defaultUri;
    }

    app.get('/api/auth/google', async (request, reply) => {
        const config = getConfig();
        if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
            return reply.status(503).send({
                error: 'Google OAuth is not configured',
            });
        }
        const state = randomBytes(32).toString('hex');
        const isLocalhost = isLocalhostRequest(request);
        reply.setCookie('google_oauth_state', state, {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.NODE_ENV === 'production' && !isLocalhost,
            path: '/',
            maxAge: 10 * 60,
        });
        const redirectUri = resolveGoogleRedirectUri(request, config.GOOGLE_REDIRECT_URI);
        const params = new URLSearchParams({
            client_id: config.GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state,
        });
        return reply.redirect(
            `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        );
    });

    app.get('/api/auth/google/callback', async (request, reply) => {
        const savedState = request.cookies.google_oauth_state;
        reply.clearCookie('google_oauth_state', {
            path: '/',
        });

        const redirectAuthError = (message: string) => {
            return reply.redirect(
                `/?auth=open&error=${encodeURIComponent(message)}`
            );
        };

        const query = request.query as Record<string, string | undefined>;
        if (query.error) {
            if (query.error === 'access_denied') {
                return redirectAuthError('Đăng nhập bằng Google đã bị hủy');
            }
            return redirectAuthError(`Lỗi xác thực Google: ${query.error}`);
        }

        const config = getConfig();
        if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
            return redirectAuthError('Google OAuth is not configured');
        }

        const parsed = z.object({
            code: z.string().min(1),
            state: z.string().min(1),
        }).safeParse(request.query);
        if (!parsed.success) {
            return redirectAuthError('Invalid Google callback');
        }

        const isStateValid = Boolean(
            savedState &&
            Buffer.byteLength(savedState) === Buffer.byteLength(parsed.data.state) &&
            timingSafeEqual(Buffer.from(savedState), Buffer.from(parsed.data.state))
        );
        if (!isStateValid) {
            return redirectAuthError('Invalid OAuth state');
        }

        const redirectUri = resolveGoogleRedirectUri(request, config.GOOGLE_REDIRECT_URI);
        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code: parsed.data.code,
                    client_id: config.GOOGLE_CLIENT_ID,
                    client_secret: config.GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });

            const tokenData = await tokenResponse.json() as {
                id_token?: string;
            };
            if (!tokenResponse.ok || !tokenData.id_token) {
                return redirectAuthError('Failed to authenticate with Google');
            }

            const { payload } = await jwtVerify(tokenData.id_token, googleJwks, {
                issuer: [
                    'https://accounts.google.com',
                    'accounts.google.com',
                ],
                audience: config.GOOGLE_CLIENT_ID,
            });

            const googleId = payload.sub;
            const email = payload.email;
            if (!googleId || typeof email !== 'string') {
                return redirectAuthError('Google account information is incomplete');
            }
            if (payload.email_verified !== true) {
                return redirectAuthError('Google email is not verified');
            }

            // 1. Tìm user theo google_id
            let userResult = await db.query(
                'SELECT id, username, email, google_id, created_at FROM users WHERE google_id = $1 LIMIT 1',
                [googleId]
            );
            let user = userResult.rows[0];

            // 2. Nếu chưa có google_id, tìm theo email để liên kết
            if (!user) {
                const emailResult = await db.query(
                    'SELECT id, username, email, google_id, created_at FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
                    [email]
                );
                user = emailResult.rows[0];
            }

            if (user && user.google_id && user.google_id !== googleId) {
                return redirectAuthError('Email is already linked to a different Google account');
            }

            if (user && !user.google_id) {
                const linkedResult = await db.query(
                    'UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, email, created_at',
                    [googleId, user.id]
                );
                user = linkedResult.rows[0];
            }

            // 3. Nếu người dùng chưa tồn tại, tạo mới
            let isNewGoogleUser = false;
            if (!user) {
                const id = randomUUID();
                const username = `google_${googleId.slice(-8)}_${randomBytes(2).toString('hex')}`;
                const isAdmin = email.toLowerCase() === 'khanh2k5xxx@gmail.com';
                const role = isAdmin ? 'admin' : 'user';
                const tier = isAdmin ? 'enterprise' : 'free';
                const credits = isAdmin ? 10000 : 20;
                const totalCredits = credits;
                const createdResult = await db.query(
                    'INSERT INTO users (id, username, email, password_hash, google_id, role, tier, credits, total_credits) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8) RETURNING id, username, email, created_at',
                    [id, username, email, googleId, role, tier, credits, totalCredits]
                );
                user = createdResult.rows[0];
                isNewGoogleUser = true;
            }

            await createSession(user.id, reply);
            if (isNewGoogleUser) {
                await recordAuthEvent({
                    action: 'auth.register',
                    userId: user.id,
                    userEmail: user.email,
                    provider: 'google',
                    request,
                    details: { username: user.username },
                });
            }
            await recordAuthEvent({
                action: 'auth.login',
                userId: user.id,
                userEmail: user.email,
                provider: 'google',
                request,
            });
            return reply.redirect('/workspace');
        } catch (error) {
            request.log.error(
                { err: error },
                'Google OAuth callback failed'
            );
            return redirectAuthError(
                'Google login failed'
            );
        }
    });
}
