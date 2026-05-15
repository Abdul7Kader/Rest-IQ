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

    // 2. Generate and write index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(viewModel.restaurant.name)}</title>
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
    <script>
        // Load data via fetch (requires local web server like 'npx serve' or Cloudflare Pages)
        fetch('./data.json')
            .then(res => res.json())
            .then(data => {
                document.title = data.restaurant.name;
                window.RestiqRenderer.render(data, document.getElementById('renderTarget'));
            })
            .catch(err => {
                document.getElementById('renderTarget').innerHTML = '<div style="padding: 2rem; color: #ef4444; text-align: center;">Daten konnten nicht über fetch() geladen werden. Bitte starten Sie einen Webserver, wenn Sie die Datei direkt von der Festplatte öffnen (CORS-Einschränkung).</div>';
                console.error(err);
            });
    </script>
</body>
</html>`;
    fs.writeFileSync(path.join(siteDir, 'index.html'), indexHtml, 'utf8');

    // 3. Copy Assets
    const publicDir = path.join(__dirname, '..', 'public');
    fs.copyFileSync(path.join(publicDir, 'css', 'style.css'), path.join(cssDir, 'style.css'));
    fs.copyFileSync(path.join(publicDir, 'js', 'renderer.js'), path.join(jsDir, 'renderer.js'));
    fs.copyFileSync(path.join(publicDir, 'templates', 'free_default.js'), path.join(tplDir, 'free_default.js'));
    fs.copyFileSync(path.join(publicDir, 'templates', 'free_classic.js'), path.join(tplDir, 'free_classic.js'));

    return siteDir;
}

module.exports = {
    exportStaticSite
};
