import { Pool } from 'pg';
import { getConfig } from '../config.js';
import { AUTH_SQL } from './base.js';

const config = getConfig();

export const db = new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
});

db.on('error', (error: Error) => {
    console.error(
        'Unexpected PostgreSQL pool error:',
        error
    );
});

export async function initDatabase(): Promise<void> {
    await db.query(AUTH_SQL);
}