import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../database/index.js';
import { createSession, deleteSession, getCurrentUser } from './session.js';
import { getConfig } from '../config.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const registerSchema = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,30}$/),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
});

const loginSchema = z.object({
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(128),
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
        try {
            const result = await db.query(
                'INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, email, created_at',
                [randomUUID(), username, email, passwordHash]
            );
            const user = result.rows[0];
            await createSession(user.id, reply);
            return reply.status(201).send({
                id: user.id,
                username: user.username,
                email: user.email,
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
            'SELECT id, username, email, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
            [parsed.data.username]
        );
        const user = result.rows[0];
        if (!user) {
            return reply.status(401).send({
                error: 'Invalid username or password',
            });
        }
        if(!user.password_hash) {
            return reply.status(401).send({
                error: 'đăng nhập bằng Google',
            });
        }
        const validPassword = await bcrypt.compare(
            parsed.data.password,
            user.password_hash
        );
        if (!validPassword) {
            return reply.status(401).send({
                error: 'Invalid username or password',
            });
        }
        await createSession(user.id, reply);
        return {
            id: user.id,
            username: user.username,
            email: user.email,
            createdAt: new Date(user.created_at).toISOString(),
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

    app.get('/api/auth/google', async (_request, reply) => {
        const config = getConfig();
        if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
            return reply.status(503).send({
                error: 'Google OAuth is not configured',
            });
        }
        const state = randomBytes(32).toString('hex');
        reply.setCookie('google_oauth_state', state, {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.NODE_ENV === 'production',
            path: '/',
            maxAge: 10 * 60,
        });
        const params = new URLSearchParams({
            client_id: config.GOOGLE_CLIENT_ID,
            redirect_uri: config.GOOGLE_REDIRECT_URI,
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
                    redirect_uri: config.GOOGLE_REDIRECT_URI,
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
            if (!user) {
                const id = randomUUID();
                const username = `google_${googleId.slice(-8)}_${randomBytes(2).toString('hex')}`;
                const createdResult = await db.query(
                    'INSERT INTO users (id, username, email, password_hash, google_id) VALUES ($1, $2, $3, NULL, $4) RETURNING id, username, email, created_at',
                    [id, username, email, googleId]
                );
                user = createdResult.rows[0];
            }

            await createSession(user.id, reply);
            return reply.redirect('/');
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
