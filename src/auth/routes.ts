import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../database/index.js';
import { createSession, deleteSession, getCurrentUser } from './session.js';
import { randomBytes } from 'node:crypto';
import { getConfig } from '@/config.js';

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
    app.get('/api/auth/google', async (_request, reply) => {
    const config = getConfig();
    if (!config.GOOGLE_CLIENT_ID) {
        return reply.status(500).send({
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
}