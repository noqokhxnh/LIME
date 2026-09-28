import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';
import { db } from '../database/index.js';

const SESSION_COOKIE = 'vidtml_session';
export interface AuthUser {
    id: string;
    username: string;
    email: string;
    createdAt: string;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
    userId: string,
    reply: FastifyReply
): Promise<void> {
    const config = getConfig();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(
        Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
    );
    await db.query(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, userId, expiresAt]
    );
    reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    });
}

export async function deleteSession(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
        await db.query(
            'DELETE FROM sessions WHERE token_hash = $1',
            [hashToken(token)]
        );
    }
    reply.clearCookie(SESSION_COOKIE, {
        path: '/',
    });
}

export async function getCurrentUser(
    request: FastifyRequest): Promise<AuthUser | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
        return null;
    }
    const result = await db.query(
        'SELECT u.id, u.username, u.email, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1',
        [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user) {
        return null;
    }
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: new Date(user.created_at).toISOString(),
    };
}