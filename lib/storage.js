const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');

function isSafeFileName(fileName) {
    return (
        typeof fileName === 'string' &&
        fileName.length > 0 &&
        fileName.length <= 255 &&
        /^[a-zA-Z0-9._-]+$/.test(fileName) &&
        !fileName.includes('..')
    );
}

function restaurantImageUrl(restaurantId, fileName) {
    return `/uploads/restaurants/${restaurantId}/${fileName}`;
}

function saveRestaurantImage({ restaurantId, fileName, buffer }) {
    if (!Number.isInteger(Number(restaurantId)) || Number(restaurantId) <= 0) {
        throw new Error('INVALID_STORAGE_TARGET');
    }
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
}

function deleteRestaurantAsset({ restaurantId, url }) {
    if (!Number.isInteger(Number(restaurantId)) || Number(restaurantId) <= 0) {
        return false;
    }

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
}

module.exports = {
    saveRestaurantImage,
    deleteRestaurantAsset
};
