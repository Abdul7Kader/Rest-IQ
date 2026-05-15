/**
 * Template: free_default
 * Logic: Modern, clean, wide layout.
 */

window.free_default = function(data) {
    const { restaurant, siteConfig, menu, hours, specialClosures, flags } = data;
    const { utils } = window.RestiqRenderer;
    const e = utils.escapeHtml;
    const heroImage = utils.imageStyle(siteConfig.hero.imageUrl);
    const logoUrl = utils.safeUrl(siteConfig.logoUrl);
    const headingStyle = utils.headingStyle(siteConfig.headingStyle);
    const dishRadius = utils.dishImageRadius(siteConfig.dishImageStyle);

    function renderDish(dish, layout) {
        const dishImage = utils.safeUrl(dish.image);
        if (layout === 'compact') {
            return `
                <div class="dish" style="display: grid; grid-template-columns: 1fr auto; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid #e2e8f0;">
                    <div>
                        <strong>${e(dish.name)} ${dish.badge ? `<span style="font-size: 0.75rem; color: var(--accent);"> ${e(dish.badge)}</span>` : ''}</strong>
                        ${dish.description ? `<div style="font-size: 0.85rem; color: var(--text-muted);">${e(dish.description)}</div>` : ''}
                    </div>
                    <div style="color: var(--accent); font-weight: 700;">${e(dish.price)}€</div>
                </div>
            `;
        }

        if (layout === 'cards') {
            return `
                <div class="dish" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: white;">
                    ${dishImage ? `<img src="${dishImage}" alt="" style="width: 100%; aspect-ratio: 4 / 3; object-fit: cover;">` : ''}
                    <div style="padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; gap: 1rem;">
                            <strong>${e(dish.name)}</strong>
                            <strong style="color: var(--accent);">${e(dish.price)}€</strong>
                        </div>
                        ${dish.badge ? `<div style="font-size: 0.75rem; color: var(--accent); margin-top: 0.25rem;">${e(dish.badge)}</div>` : ''}
                        ${dish.description ? `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">${e(dish.description)}</div>` : ''}
                        ${dish.allergens ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Allergene: ${e(dish.allergens)}</div>` : ''}
                    </div>
                </div>
            `;
        }

        return `
            <div class="dish" style="display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem;">
                ${dishImage ? `<img src="${dishImage}" alt="" style="width: 84px; height: 84px; object-fit: cover; border-radius: ${dishRadius};">` : ''}
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${e(dish.name)} ${dish.badge ? `<span style="font-size: 0.75rem; color: var(--accent);"> ${e(dish.badge)}</span>` : ''}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">${e(dish.description)}</div>
                    ${dish.ingredients ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Zutaten: ${e(dish.ingredients)}</div>` : ''}
                    ${dish.allergens ? `<div style="font-size: 0.75rem; color: var(--text-muted);">Allergene: ${e(dish.allergens)}</div>` : ''}
                </div>
                <div style="color: var(--accent); font-weight: 700;">${e(dish.price)}€</div>
            </div>
        `;
    }

    return `
        <div class="template-free-default">
            <!-- Hero Section -->
            <div class="hero" style="background: ${heroImage}; padding: 4rem 2rem; text-align: center; border-radius: 12px; margin-bottom: 2rem; background-size: cover; background-position: center;">
                ${logoUrl ? `<img src="${logoUrl}" style="max-height: 80px; margin-bottom: 1rem;" alt="">` : ''}
                <h1 style="font-size: 3rem; margin-bottom: 0.5rem; ${headingStyle}">${e(siteConfig.hero.title)}</h1>
                <p style="font-size: 1.25rem; color: var(--text-muted);">${e(siteConfig.hero.subtitle)}</p>
            </div>

            ${utils.adSlot('top_banner', flags)}

            ${utils.donationHint(flags)}

            ${utils.specialClosures(specialClosures)}

            <div class="grid" style="grid-template-columns: 2fr 1fr; gap: 3rem;">
                <div>
                    <section style="margin-bottom: 3rem;">
                        <h2 style="color: var(--accent); border-bottom: 2px solid var(--accent); display: inline-block; margin-bottom: 1rem; ${headingStyle}">Über uns</h2>
                        <p>${e(siteConfig.aboutText || 'Willkommen in unserem Restaurant.')}</p>
                    </section>

                    ${utils.adSlot('in_content', flags)}

                    <section>
                        <h2 style="color: var(--accent); margin-bottom: 2rem; ${headingStyle}">Unsere Speisekarte</h2>
                        ${menu.categories.map(cat => `
                            <div class="menu-category" style="margin-bottom: 3rem;">
                                ${utils.safeUrl(cat.image) ? `<img src="${utils.safeUrl(cat.image)}" alt="" style="width: 100%; max-height: 220px; object-fit: cover; border-radius: 8px; margin-bottom: 1rem;">` : ''}
                                <h3 style="margin-bottom: 1rem; border-bottom: 1px solid var(--border); ${headingStyle}">${e(cat.name)}</h3>
                                <div style="${(cat.mode === 'cards' || cat.mode === 'horizontal' || siteConfig.menuLayout === 'cards') ? 'display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1rem;' : ''}">
                                    ${cat.dishes.map(dish => renderDish(dish, cat.mode === 'vertical' ? siteConfig.menuLayout : (cat.mode === 'horizontal' ? 'cards' : (cat.mode || siteConfig.menuLayout)))).join('')}
                                </div>
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
