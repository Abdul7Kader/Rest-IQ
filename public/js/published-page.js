fetch('./data.json')
    .then(res => res.json())
    .then(data => {
        document.title = (data.meta && data.meta.seoTitle) || data.restaurant.name;
        window.RestiqRenderer.render(data, document.getElementById('renderTarget'));
    })
    .catch(error => {
        const container = document.createElement('div');
        container.style.padding = '2rem';
        container.style.color = '#ef4444';
        container.style.textAlign = 'center';
        container.textContent = 'Daten konnten nicht über fetch() geladen werden. Bitte starten Sie einen Webserver, wenn Sie die Datei direkt von der Festplatte öffnen (CORS-Einschränkung).';
        document.getElementById('renderTarget').replaceChildren(container);
        console.error(error);
    });
