import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';
import { db } from '../database/index.js';
import { userStore } from '../admin/userStore.js';

const SESSION_COOKIE = 'vidtml_session';
export const inMemorySessions = new Map<string, { userId: string; expiresAt: Date }>();
export interface AuthUser {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'admin';
    tier: string;
    credits: number;
    totalCredits: number;
    creditPercent: number;
    status: 'active' | 'banned';
    planId?: string | null;
    planExpiresAt?: string | null;
    preferences?: Record<string, any>;
    createdAt: string;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function createTestSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    inMemorySessions.set(tokenHash, { userId, expiresAt });
    return token;
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

    inMemorySessions.set(tokenHash, { userId, expiresAt });

    if (config.DATABASE_URL) {
        try {
            await db.query(
                'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
                [tokenHash, userId, expiresAt]
            );
        } catch (err) {
            console.error('[Session] Error writing session to DB:', err);
        }
    }

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
        const tokenHash = hashToken(token);
        inMemorySessions.delete(tokenHash);
        const config = getConfig();
        if (config.DATABASE_URL) {
            try {
                await db.query(
                    'DELETE FROM sessions WHERE token_hash = $1',
                    [tokenHash]
                );
            } catch (err) {
                console.error('[Session] Error deleting session from DB:', err);
            }
        }
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
    const tokenHash = hashToken(token);
    const config = getConfig();

    let user: any = null;
    if (config.DATABASE_URL) {
        try {
            const result = await db.query(
                `SELECT u.id, u.username, u.email, u.role, u.tier, u.credits, u.total_credits, u.status,
                        u.plan_id, u.plan_expires_at, u.preferences, u.created_at
                 FROM sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL
                 LIMIT 1`,
                [tokenHash]
            );
            user = result.rows[0];
        } catch {
            // Fallback to inMemorySessions
        }
    }

    if (!user) {
        const mem = inMemorySessions.get(tokenHash);
        if (mem && mem.expiresAt > new Date()) {
            const u = await userStore.findById(mem.userId);
            if (u && !u.deletedAt && u.status !== 'banned') {
                return {
                    id: u.id,
                    username: u.username,
                    email: u.email,
                    role: u.role,
                    tier: u.tier,
                    credits: u.credits,
                    totalCredits: u.totalCredits,
                    creditPercent: u.creditPercent,
                    status: u.status,
                    planId: u.planId || null,
                    planExpiresAt: u.planExpiresAt || null,
                    createdAt: u.createdAt,
                };
            }
        }
        return null;
    }

    const credits = Number(user.credits ?? 20);
    const totalCredits = Math.max(Number(user.total_credits ?? 20), 1);
    const creditPercent = Math.min(100, Math.max(0, Math.round((credits / totalCredits) * 100)));

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role === 'admin' ? 'admin' : 'user',
        tier: user.tier || 'free',
        credits,
        totalCredits,
        creditPercent,
        status: user.status || 'active',
        planId: user.plan_id || null,
        planExpiresAt: user.plan_expires_at ? new Date(user.plan_expires_at).toISOString() : null,
        preferences: user.preferences || {},
        createdAt: new Date(user.created_at).toISOString(),
    };
}