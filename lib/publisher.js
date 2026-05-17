const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function absoluteAssetUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/')) return `.${url}`;
    return url;
}

function collectLocalUploadUrls(value, result = new Set()) {
    if (!value) return result;
    if (typeof value === 'string') {
        if (value.startsWith('/uploads/')) result.add(value);
        return result;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectLocalUploadUrls(item, result));
        return result;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach(item => collectLocalUploadUrls(item, result));
    }
    return result;
}

function copyLocalUploads(siteDir, viewModel) {
    const publicDir = path.join(__dirname, '..', 'public');
    for (const uploadUrl of collectLocalUploadUrls(viewModel)) {
        const relativePath = uploadUrl.replace(/^\/+/, '');
        if (!relativePath.startsWith('uploads/') || relativePath.includes('..')) continue;

        const sourcePath = path.join(publicDir, relativePath);
        if (!fs.existsSync(sourcePath)) continue;

        const targetPath = path.join(siteDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
    }
}

/**
 * Exports the restaurant data as a static site.
 * @param {string} slug The public slug of the restaurant.
 * @param {Object} viewModel The normalized data for the renderer.
 * @returns {string} The path to the exported site.
 */
function exportStaticSite(slug, viewModel) {
    const publishDir = path.join(__dirname, '..', 'publish');
    const siteDir = path.join(publishDir, slug);
    const cssDir = path.join(siteDir, 'css');
    const jsDir = path.join(siteDir, 'js');
    const tplDir = path.join(siteDir, 'templates');
    
    // Ensure directories exist
    fs.mkdirSync(cssDir, { recursive: true });
    fs.mkdirSync(jsDir, { recursive: true });
    fs.mkdirSync(tplDir, { recursive: true });

    // 1. Write the normalized data
    fs.writeFileSync(path.join(siteDir, 'data.json'), JSON.stringify(viewModel, null, 2), 'utf8');

    const seoTitle = viewModel.meta && viewModel.meta.seoTitle
        ? viewModel.meta.seoTitle
        : viewModel.restaurant.name;
    const seoDescription = viewModel.meta && viewModel.meta.seoDescription
        ? viewModel.meta.seoDescription
        : viewModel.restaurant.description || '';
    const previewImage = absoluteAssetUrl(
        (viewModel.siteConfig && viewModel.siteConfig.hero && viewModel.siteConfig.hero.imageUrl) ||
        (viewModel.siteConfig && viewModel.siteConfig.logoUrl)
    );

    // 2. Generate and write index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(seoTitle)}</title>
    <meta name="description" content="${escapeHtml(seoDescription)}">
    <meta property="og:title" content="${escapeHtml(seoTitle)}">
    <meta property="og:description" content="${escapeHtml(seoDescription)}">
    <meta property="og:type" content="website">
    ${previewImage ? `<meta property="og:image" content="${escapeHtml(previewImage)}">` : ''}
    <meta name="twitter:card" content="${previewImage ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${escapeHtml(seoTitle)}">
    <meta name="twitter:description" content="${escapeHtml(seoDescription)}">
    <link rel="stylesheet" href="./css/style.css">
    <style>
        body { background: #f1f5f9; }
        .gastro-shell { background: white; min-height: 100vh; }
    </style>
</head>
<body>
    <div id="renderTarget">
        <div style="padding: 5rem; text-align: center; color: var(--text-muted);">
            Lade Inhalte...
        </div>
    </div>
    
    <!-- Renderer -->
    <script src="./js/renderer.js"></script>
    
    <!-- Templates -->
    <script src="./templates/free_default.js"></script>
    <script src="./templates/free_classic.js"></script>
    
    <!-- Initialization -->
    <script src="./js/published-page.js"></script>
</body>
</html>`;
    fs.writeFileSync(path.join(siteDir, 'index.html'), indexHtml, 'utf8');

    // 3. Copy Assets
    const publicDir = path.join(__dirname, '..', 'public');
    fs.copyFileSync(path.join(publicDir, 'css', 'style.css'), path.join(cssDir, 'style.css'));
    fs.copyFileSync(path.join(publicDir, 'js', 'renderer.js'), path.join(jsDir, 'renderer.js'));
    fs.copyFileSync(path.join(publicDir, 'js', 'published-page.js'), path.join(jsDir, 'published-page.js'));
    fs.copyFileSync(path.join(publicDir, 'templates', 'free_default.js'), path.join(tplDir, 'free_default.js'));
    fs.copyFileSync(path.join(publicDir, 'templates', 'free_classic.js'), path.join(tplDir, 'free_classic.js'));
    copyLocalUploads(siteDir, viewModel);

    return siteDir;
}

module.exports = {
    exportStaticSite
};
