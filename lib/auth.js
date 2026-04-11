const bcrypt = require('bcryptjs');

/**
 * Hash a password using bcrypt
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
    return await bcrypt.hash(password, 12);
}

/**
 * Verify a password against a hash
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * Middleware to check if user is authenticated
 */
function isAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Middleware to check if user has a specific role
 */
function hasRole(role) {
    return (req, res, next) => {
        if (req.session && req.session.role === role) {
            return next();
        }
        res.status(403).json({ error: 'Forbidden' });
    };
}

module.exports = {
    hashPassword,
    verifyPassword,
    isAuthenticated,
    hasRole
};
