const session = require('express-session');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

class SQLiteSessionStore extends session.Store {
    constructor(db) {
        super();
        this.db = db;
        this.ensureTable();

        this.cleanupTimer = setInterval(() => {
            this.pruneExpired();
        }, CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref();
    }

    ensureTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expires INTEGER NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
        `);
    }

    get(sid, callback) {
        try {
            const row = this.db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
            if (!row) return callback(null, null);

            if (row.expires <= Date.now()) {
                this.destroy(sid, () => callback(null, null));
                return;
            }

            callback(null, JSON.parse(row.sess));
        } catch (error) {
            callback(error);
        }
    }

    set(sid, sess, callback) {
        try {
            const expires = this.getExpiresAt(sess);
            this.db.prepare(`
                INSERT INTO sessions (sid, sess, expires)
                VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET
                    sess = excluded.sess,
                    expires = excluded.expires,
                    updated_at = CURRENT_TIMESTAMP
            `).run(sid, JSON.stringify(sess), expires);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sid, sess, callback) {
        try {
            const expires = this.getExpiresAt(sess);
            this.db.prepare(`
                UPDATE sessions
                SET expires = ?, updated_at = CURRENT_TIMESTAMP
                WHERE sid = ?
            `).run(expires, sid);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sid, callback) {
        try {
            this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    clear(callback) {
        try {
            this.db.prepare('DELETE FROM sessions').run();
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    length(callback) {
        try {
            const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
            callback(null, row.count);
        } catch (error) {
            callback(error);
        }
    }

    pruneExpired() {
        this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    }

    getExpiresAt(sess) {
        if (sess.cookie && sess.cookie.expires) {
            return new Date(sess.cookie.expires).getTime();
        }

        const maxAge = sess.cookie && sess.cookie.originalMaxAge
            ? sess.cookie.originalMaxAge
            : SESSION_TTL_MS;
        return Date.now() + maxAge;
    }
}

module.exports = SQLiteSessionStore;
