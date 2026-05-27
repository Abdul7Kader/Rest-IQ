const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const publicDir = path.join(__dirname, '..', 'public');
const STORAGE_DRIVER = process.env.RESTIQ_STORAGE_DRIVER || process.env.STORAGE_DRIVER || 'local';

function isSafeFileName(fileName) {
    return (
        typeof fileName === 'string' &&
        fileName.length > 0 &&
        fileName.length <= 255 &&
        /^[a-zA-Z0-9._-]+$/.test(fileName) &&
        !fileName.includes('..')
    );
}

function assertStorageTarget(restaurantId) {
    if (!Number.isInteger(Number(restaurantId)) || Number(restaurantId) <= 0) {
        throw new Error('INVALID_STORAGE_TARGET');
    }
}

function restaurantImageKey(restaurantId, fileName) {
    return `uploads/restaurants/${restaurantId}/${fileName}`;
}

function restaurantImageUrl(restaurantId, fileName) {
    return `/${restaurantImageKey(restaurantId, fileName)}`;
}

function isLocalUploadUrl(value) {
    const url = String(value || '').replace(/\\/g, '/');
    return url.startsWith('/uploads/restaurants/') && !url.includes('..');
}

function localUploadKey(value) {
    if (!isLocalUploadUrl(value)) return null;
    return String(value).replace(/^\/+/, '');
}

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function encodeKey(key) {
    return String(key).split('/').map(part => encodeURIComponent(part)).join('/');
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
    return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function r2Timestamp(date = new Date()) {
    const stamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return {
        amzDate: stamp,
        dateStamp: stamp.slice(0, 8)
    };
}

function r2SigningKey(secretAccessKey, dateStamp) {
    const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, 'auto');
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
}

function r2ConfigFromEnv(env = process.env) {
    const endpoint = env.R2_ENDPOINT
        ? trimTrailingSlash(env.R2_ENDPOINT)
        : (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

    return {
        endpoint,
        bucket: env.R2_BUCKET,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        publicBaseUrl: trimTrailingSlash(env.R2_PUBLIC_BASE_URL)
    };
}

function assertR2Config(config, fetchImpl) {
    if (!fetchImpl) {
        throw new Error('R2_FETCH_UNAVAILABLE');
    }
    for (const field of ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey', 'publicBaseUrl']) {
        if (!config[field]) throw new Error(`R2_CONFIG_MISSING_${field.toUpperCase()}`);
    }
}

function signR2Request({ method, key, body = Buffer.alloc(0), contentType, config, now = new Date() }) {
    const encodedKey = encodeKey(key);
    const url = new URL(`${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`);
    const payloadHash = sha256Hex(body);
    const { amzDate, dateStamp } = r2Timestamp(now);
    const headers = {
        host: url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate
    };

    if (contentType) {
        headers['content-type'] = contentType;
    }

    const headerNames = Object.keys(headers).sort();
    const canonicalHeaders = headerNames.map(name => `${name}:${headers[name]}\n`).join('');
    const signedHeaders = headerNames.join(';');
    const canonicalRequest = [
        method,
        url.pathname,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest)
    ].join('\n');
    const signature = hmac(r2SigningKey(config.secretAccessKey, dateStamp), stringToSign, 'hex');
    const requestHeaders = { ...headers };
    delete requestHeaders.host;
    requestHeaders.authorization = [
        'AWS4-HMAC-SHA256',
        `Credential=${config.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`
    ].join(', ');

    return { url: url.href, headers: requestHeaders };
}

function createLocalStorage() {
    return {
        async saveRestaurantImage({ restaurantId, fileName, buffer }) {
            assertStorageTarget(restaurantId);
            if (!isSafeFileName(fileName) || !Buffer.isBuffer(buffer)) {
                throw new Error('INVALID_STORAGE_FILE');
            }

            const uploadDir = path.join(publicDir, 'uploads', 'restaurants', String(restaurantId));
            fs.mkdirSync(uploadDir, { recursive: true });

            const targetPath = path.join(uploadDir, fileName);
            fs.writeFileSync(targetPath, buffer, { flag: 'wx' });

            return {
                url: restaurantImageUrl(restaurantId, fileName),
                size: buffer.length
            };
        },

        async deleteRestaurantAsset({ restaurantId, url }) {
            assertStorageTarget(restaurantId);

            const prefix = restaurantImageUrl(restaurantId, '');
            const normalizedUrl = String(url || '').replace(/\\/g, '/');
            if (!normalizedUrl.startsWith(prefix)) {
                return false;
            }

            const fileName = normalizedUrl.slice(prefix.length);
            if (!isSafeFileName(fileName)) {
                return false;
            }

            const filePath = path.join(publicDir, 'uploads', 'restaurants', String(restaurantId), fileName);
            if (!fs.existsSync(filePath)) {
                return false;
            }

            fs.rmSync(filePath, { force: true });
            return true;
        },

        resolveAssetUrl(url) {
            return String(url || '');
        }
    };
}

function createR2Storage({ env = process.env, fetchImpl = global.fetch, now = () => new Date() } = {}) {
    const config = r2ConfigFromEnv(env);
    assertR2Config(config, fetchImpl);

    function publicUrlForKey(key) {
        return `${config.publicBaseUrl}/${encodeKey(key)}`;
    }

    function keyFromPublicUrl(url) {
        const normalizedUrl = String(url || '').replace(/\\/g, '/');
        const prefix = `${config.publicBaseUrl}/`;
        return normalizedUrl.startsWith(prefix) ? normalizedUrl.slice(prefix.length) : null;
    }

    function resolveAssetUrl(url) {
        const value = String(url || '').trim();
        const localKey = localUploadKey(value);
        if (localKey) return publicUrlForKey(localKey);
        return value;
    }

    async function requestR2({ method, key, body, contentType }) {
        const signed = signR2Request({ method, key, body, contentType, config, now: now() });
        const response = await fetchImpl(signed.url, {
            method,
            headers: signed.headers,
            body: method === 'PUT' ? body : undefined
        });

        if (!response.ok) {
            const message = typeof response.text === 'function' ? await response.text() : '';
            const error = new Error(`R2_REQUEST_FAILED_${response.status}`);
            error.details = message.slice(0, 500);
            throw error;
        }

        return response;
    }

    return {
        async saveRestaurantImage({ restaurantId, fileName, buffer, contentType }) {
            assertStorageTarget(restaurantId);
            if (!isSafeFileName(fileName) || !Buffer.isBuffer(buffer)) {
                throw new Error('INVALID_STORAGE_FILE');
            }

            const key = restaurantImageKey(restaurantId, fileName);
            await requestR2({ method: 'PUT', key, body: buffer, contentType: contentType || 'application/octet-stream' });

            return {
                url: publicUrlForKey(key),
                size: buffer.length
            };
        },

        async deleteRestaurantAsset({ restaurantId, url }) {
            assertStorageTarget(restaurantId);
            const key = keyFromPublicUrl(url);
            if (!key || !key.startsWith(restaurantImageKey(restaurantId, ''))) {
                return false;
            }

            await requestR2({ method: 'DELETE', key, body: Buffer.alloc(0) });
            return true;
        },

        resolveAssetUrl
    };
}

function resolveStorageAssetUrl(url) {
    if (!url) return '';
    if (typeof defaultStorage.resolveAssetUrl === 'function') {
        return defaultStorage.resolveAssetUrl(url);
    }
    return String(url || '');
}

function resolveLocalAssetUrl(url) {
    return createLocalStorage().resolveAssetUrl(url);
}

function createStorage({ env = process.env, fetchImpl = global.fetch, now } = {}) {
    const driver = String(env.RESTIQ_STORAGE_DRIVER || env.STORAGE_DRIVER || STORAGE_DRIVER).trim().toLowerCase();
    if (driver === 'local') return createLocalStorage();
    if (driver === 'r2') return createR2Storage({ env, fetchImpl, now });
    throw new Error('INVALID_STORAGE_DRIVER');
}

const defaultStorage = createStorage();

module.exports = {
    saveRestaurantImage: (...args) => defaultStorage.saveRestaurantImage(...args),
    deleteRestaurantAsset: (...args) => defaultStorage.deleteRestaurantAsset(...args),
    resolveAssetUrl: resolveStorageAssetUrl,
    resolveLocalAssetUrl,
    isLocalUploadUrl,
    createStorage,
    createLocalStorage,
    createR2Storage
};
