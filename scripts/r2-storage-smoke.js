require('dotenv').config({ quiet: true });

const storage = require('../lib/storage');

const REQUIRED_ENV = [
    'RESTIQ_STORAGE_DRIVER',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_PUBLIC_BASE_URL'
];

function missingEnv() {
    const missing = REQUIRED_ENV.filter(key => !process.env[key]);
    if (!process.env.R2_ENDPOINT && !process.env.R2_ACCOUNT_ID) {
        missing.push('R2_ENDPOINT or R2_ACCOUNT_ID');
    }
    if (String(process.env.RESTIQ_STORAGE_DRIVER || '').toLowerCase() !== 'r2') {
        missing.push('RESTIQ_STORAGE_DRIVER must be r2');
    }
    return missing;
}

async function main() {
    const missing = missingEnv();
    if (missing.length > 0) {
        console.error(JSON.stringify({
            ok: false,
            reason: 'missing_r2_configuration',
            missing
        }, null, 2));
        process.exitCode = 2;
        return;
    }

    const restaurantId = Number(process.env.RESTIQ_R2_SMOKE_RESTAURANT_ID || 999999);
    const fileName = `r2-smoke-${Date.now()}.png`;
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
    );
    const r2Storage = storage.createStorage({ env: process.env });

    const saved = await r2Storage.saveRestaurantImage({
        restaurantId,
        fileName,
        buffer: png,
        contentType: 'image/png'
    });
    const deleted = await r2Storage.deleteRestaurantAsset({
        restaurantId,
        url: saved.url,
        storageKey: saved.storageKey
    });

    console.log(JSON.stringify({
        ok: true,
        driver: 'r2',
        storageKey: saved.storageKey,
        url: saved.url,
        size: saved.size,
        deleted
    }, null, 2));
}

main().catch(error => {
    console.error(JSON.stringify({
        ok: false,
        reason: 'r2_smoke_failed',
        error: error.message
    }, null, 2));
    process.exitCode = 1;
});
