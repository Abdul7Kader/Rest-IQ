const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');

async function loadArticles() {
    const res = await fetch('/api/help/articles');
    const articles = await res.json();
    const list = document.getElementById('articleList');
    list.innerHTML = '';

    articles.forEach(article => {
        const card = document.createElement('div');
        card.className = 'card article-card';
        card.innerHTML = `
            <div class="badge badge-free" style="margin-bottom: 1rem;">${escapeHtml(article.article_type.toUpperCase())}</div>
            <h3>${escapeHtml(article.title)}</h3>
            <p style="font-size: 0.875rem; color: var(--text-muted);">Erfahren Sie mehr über ${escapeHtml(article.title.toLowerCase())}.</p>
        `;
        card.addEventListener('click', () => loadDetail(article.id));
        list.appendChild(card);
    });

    const params = new URLSearchParams(window.location.search);
    const articleId = params.get('article');
    if (articleId) loadDetail(articleId);
}

async function loadDetail(id) {
    const res = await fetch(`/api/help/articles/${id}`);
    const article = await res.json();

    document.getElementById('articleTitle').textContent = article.title;
    document.getElementById('articleType').textContent = article.article_type.toUpperCase();
    document.getElementById('articleContent').innerHTML = renderMarkdownLite(article.content_markdown);

    listView.classList.add('hidden');
    detailView.classList.remove('hidden');
}

function showList() {
    history.replaceState(null, '', 'help.html');
    listView.classList.remove('hidden');
    detailView.classList.add('hidden');
}

function renderMarkdownLite(markdown) {
    const lines = String(markdown || '').split('\n');
    let html = '';
    let listType = null;

    function closeList() {
        if (listType) {
            html += `</${listType}>`;
            listType = null;
        }
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            closeList();
            continue;
        }
        if (trimmed.startsWith('## ')) {
            closeList();
            html += `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
        } else if (trimmed.startsWith('# ')) {
            closeList();
            html += `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
        } else if (/^\d+\.\s/.test(trimmed)) {
            if (listType !== 'ol') {
                closeList();
                listType = 'ol';
                html += '<ol>';
            }
            html += `<li>${escapeHtml(trimmed.replace(/^\d+\.\s/, ''))}</li>`;
        } else if (trimmed.startsWith('- ')) {
            if (listType !== 'ul') {
                closeList();
                listType = 'ul';
                html += '<ul>';
            }
            html += `<li>${escapeHtml(trimmed.slice(2))}</li>`;
        } else {
            closeList();
            html += `<p>${escapeHtml(trimmed)}</p>`;
        }
    }
    closeList();
    return html;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function checkBack() {
    const res = await fetch('/api/auth/me');
    const me = await res.json();
    if (me.role === 'platform_admin') {
        document.getElementById('backBtn').href = 'admin.html';
        document.getElementById('backBtn').textContent = 'Zurück zum Admin-Bereich';
    }
}

document.getElementById('showListBtn').addEventListener('click', showList);
checkBack();
loadArticles();
