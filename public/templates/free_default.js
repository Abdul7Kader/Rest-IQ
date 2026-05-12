/**
 * Template: free_default
 * Logic: Modern, clean, wide layout.
 */

window.free_default = function(data) {
    const { restaurant, siteConfig, menu, hours, flags } = data;
    const { utils } = window.RestiqRenderer;
    const e = utils.escapeHtml;
    const heroImage = utils.imageStyle(siteConfig.hero.imageUrl);
    const logoUrl = utils.safeUrl(siteConfig.logoUrl);

    return `
        <div class="template-free-default">
            <!-- Hero Section -->
            <div class="hero" style="background: ${heroImage}; padding: 4rem 2rem; text-align: center; border-radius: 12px; margin-bottom: 2rem; background-size: cover; background-position: center;">
                ${logoUrl ? `<img src="${logoUrl}" style="max-height: 80px; margin-bottom: 1rem;" alt="">` : ''}
                <h1 style="font-size: 3rem; margin-bottom: 0.5rem;">${e(siteConfig.hero.title)}</h1>
                <p style="font-size: 1.25rem; color: var(--text-muted);">${e(siteConfig.hero.subtitle)}</p>
            </div>

            ${utils.adSlot('top_banner', flags)}

            ${utils.donationHint(flags)}

            <div class="grid" style="grid-template-columns: 2fr 1fr; gap: 3rem;">
                <div>
                    <section style="margin-bottom: 3rem;">
                        <h2 style="color: var(--accent); border-bottom: 2px solid var(--accent); display: inline-block; margin-bottom: 1rem;">Über uns</h2>
                        <p>${e(siteConfig.aboutText || 'Willkommen in unserem Restaurant.')}</p>
                    </section>

                    ${utils.adSlot('in_content', flags)}

                    <section>
                        <h2 style="color: var(--accent); margin-bottom: 2rem;">Unsere Speisekarte</h2>
                        ${menu.categories.map(cat => `
                            <div class="menu-category" style="margin-bottom: 3rem;">
                                <h3 style="margin-bottom: 1rem; border-bottom: 1px solid var(--border);">${e(cat.name)}</h3>
                                ${cat.dishes.map(dish => `
                                    <div class="dish" style="display: flex; justify-content: space-between; margin-bottom: 1.5rem;">
                                        <div>
                                            <div style="font-weight: 600;">${e(dish.name)}</div>
                                            <div style="font-size: 0.85rem; color: var(--text-muted);">${e(dish.description)}</div>
                                        </div>
                                        <div style="color: var(--accent); font-weight: 700;">${e(dish.price)}€</div>
                                    </div>
                                `).join('')}
                            </div>
                        `).join('')}
                    </section>
                </div>

                <aside>
                    <div class="card" style="margin-bottom: 2rem;">
                        <h3 style="color: var(--accent);">Öffnungszeiten</h3>
                        ${utils.openingHours(hours)}
                    </div>

                    <div class="card">
                        <h3 style="color: var(--accent);">Kontakt</h3>
                        <div style="margin-top: 1rem; font-size: 0.9rem;">
                            <p>${e(restaurant.address.street)} ${e(restaurant.address.number)}</p>
                            <p>${e(restaurant.address.zip)} ${e(restaurant.address.city)}</p>
                            <br>
                            <p><strong>Tel:</strong> ${e(restaurant.contact.phone)}</p>
                            <p><strong>E-Mail:</strong> ${e(restaurant.contact.email)}</p>
                        </div>
                    </div>
                </aside>
            </div>

            ${utils.adSlot('footer_ad', flags)}
            
            <footer style="margin-top: 5rem; padding: 2rem; border-top: 1px solid var(--border); text-align: center; color: var(--text-muted);">
                <p>${e(siteConfig.footerNote || '')}</p>
                <p style="font-size: 0.8rem; margin-top: 1rem;">Powered by Restiq Platform</p>
            </footer>
        </div>
    `;
};
