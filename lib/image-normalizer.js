const sharp = require('sharp');

const NORMALIZED_IMAGE_MIME = 'image/png';

async function normalizeRestaurantImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('INVALID_IMAGE_TYPE');
    }

    try {
        const normalizedBuffer = await sharp(buffer, {
            animated: false,
            limitInputPixels: 25_000_000
        })
            .rotate()
            .png({ compressionLevel: 9 })
            .toBuffer();

        return {
            buffer: normalizedBuffer,
            mimeType: NORMALIZED_IMAGE_MIME
        };
    } catch (error) {
        throw new Error('INVALID_IMAGE_TYPE');
    }
}

module.exports = {
    NORMALIZED_IMAGE_MIME,
    normalizeRestaurantImage
};
