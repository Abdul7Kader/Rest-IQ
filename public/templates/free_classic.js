/**
 * Template: free_classic
 * Logic: Traditional, centered, elegant layout with serif-inspired fonts.
 */

window.free_classic = function(data) {
    const { restaurant, siteConfig, menu, hours, specialClosures, flags } = data;
    const { utils } = window.RestiqRenderer;
    const e = utils.escapeHtml;
    const logoUrl = utils.safeUrl(siteConfig.logoUrl);
    const headingStyle = utils.headingStyle(siteConfig.headingStyle);
    const dishRadius = utils.dishImageRadius(siteConfig.dishImageStyle);

    function renderDish(dish, layout) {
        const dishImage = utils.safeUrl(dish.image);
        if (layout === 'compact') {
            return `
                <div style="display: grid; grid-template-columns: 1fr auto; gap: 1rem; text-align: left; padding: 0.75rem 0; border-bottom: 1px solid #ddd;">
                    <div>
                        <strong>${e(dish.name)}</strong>
                        ${dish.badge ? `<span style="font-size: 0.75rem; color: var(--accent); margin-left: 0.5rem; text-transform: uppercase;">${e(dish.badge)}</span>` : ''}
                        ${dish.description ? `<div style="font-size: 0.9rem; color: #666; font-style: italic;">${e(dish.description)}</div>` : ''}
                    </div>
                    <strong>${e(dish.price)}€</strong>
                </div>
            `;
        }

        if (layout === 'cards') {
            return `
                <div style="border: 1px solid #ddd; padding: 1rem; background: #fff; text-align: center;">
                    ${dishImage ? `<img src="${dishImage}" alt="" style="width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: ${dishRadius}; margin-bottom: 1rem;">` : ''}
                    <div style="font-weight: bold; font-size: 1.1rem;">${e(dish.name)}</div>
                    ${dish.badge ? `<div style="font-size: 0.75rem; color: var(--accent); text-transform: uppercase; letter-spacing: 1px;">${e(dish.badge)}</div>` : ''}
                    ${dish.description ? `<div style="font-style: italic; color: #666; margin: 0.5rem 0;">${e(dish.description)}</div>` : ''}
                    <div style="font-weight: 700; color: #000;">${e(dish.price)}€</div>
                </div>
            `;
        }

        return `
            <div style="text-align: center; margin-bottom: 2rem;">
                ${dishImage ? `<img src="${dishImage}" alt="" style="width: 120px; height: 120px; object-fit: cover; border-radius: ${dishRadius}; margin-bottom: 1rem;">` : ''}
                <div style="font-weight: bold; font-size: 1.2rem;">${e(dish.name)}</div>
                ${dish.badge ? `<div style="font-size: 0.8rem; color: var(--accent); text-transform: uppercase; letter-spacing: 1px;">${e(dish.badge)}</div>` : ''}
                <div style="font-style: italic; color: #666; margin: 0.5rem 0;">${e(dish.description)}</div>
                ${dish.ingredients ? `<div style="font-size: 0.85rem; color: #666;">Zutaten: ${e(dish.ingredients)}</div>` : ''}
                ${dish.allergens ? `<div style="font-size: 0.85rem; color: #666;">Allergene: ${e(dish.allergens)}</div>` : ''}
                <div style="font-weight: 700; color: #000;">${e(dish.price)}€</div>
            </div>
        `;
    }

    return `
        <div class="template-free-classic" style="font-family: 'Georgia', serif;">
            <!-- Simple Centered Header -->
            <header style="text-align: center; padding: 3rem 1rem; border-bottom: 3px double var(--accent);">
                ${logoUrl ? `<img src="${logoUrl}" style="max-height: 100px; margin-bottom: 1.5rem;" alt="">` : ''}
                <h1 style="font-size: 3.5rem; margin-bottom: 0.5rem; color: #1a1a1a; ${headingStyle}">${e(siteConfig.hero.title)}</h1>
                <p style="font-style: italic; font-size: 1.2rem; color: #444;">${e(siteConfig.hero.subtitle)}</p>
            </header>

            ${utils.adSlot('top_banner', flags)}

            ${utils.donationHint(flags)}

            ${utils.specialClosures(specialClosures)}

            <div style="max-width: 700px; margin: 0 auto; padding: 3rem 1rem;">
                <!-- About Centered -->
                <section style="text-align: center; margin-bottom: 4rem;">
                    <h2 style="font-size: 2rem; margin-bottom: 1.5rem; ${headingStyle}">Willkommen</h2>
                    <p style="line-height: 1.8; font-size: 1.1rem;">${e(siteConfig.aboutText || 'Wir freuen uns auf Ihren Besuch.')}</p>
                </section>

                ${utils.adSlot('in_content', flags)}

                <!-- Menu Centered -->
                <section style="margin-bottom: 4rem;">
                    <h2 style="text-align: center; font-size: 2.5rem; margin-bottom: 3rem; ${headingStyle}">Karte</h2>
                    ${menu.categories.map(cat => `
                        <div style="margin-bottom: 4rem;">
                            ${utils.safeUrl(cat.image) ? `<img src="${utils.safeUrl(cat.image)}" alt="" style="width: 100%; max-height: 260px; object-fit: cover; margin-bottom: 1.5rem;">` : ''}
                            <h3 style="text-align: center; font-size: 1.8rem; margin-bottom: 2rem; color: var(--accent); ${headingStyle}">${e(cat.name)}</h3>
                            <div style="border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 2rem 0;">
                                <div style="${(cat.mode === 'cards' || cat.mode === 'horizontal' || siteConfig.menuLayout === 'cards') ? 'display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1rem;' : ''}">
                                    ${cat.dishes.map(dish => renderDish(dish, cat.mode === 'vertical' ? siteConfig.menuLayout : (cat.mode === 'horizontal' ? 'cards' : (cat.mode || siteConfig.menuLayout)))).join('')}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </section>

                ${utils.adSlot('footer_ad', flags)}

                <!-- Info Blocks -->
                <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 4rem;">
                    <section style="text-align: center;">
                        <h4 style="text-transform: uppercase; color: var(--accent);">Öffnungszeiten</h4>
                        <div style="margin-top: 1rem;">
                            ${utils.openingHours(hours)}
                        </div>
                    </section>
                    <section style="text-align: center;">
                        <h4 style="text-transform: uppercase; color: var(--accent);">Kontakt</h4>
                        <p style="margin-top: 1rem;">${e(restaurant.address.street)} ${e(restaurant.address.number)}<br>${e(restaurant.address.zip)} ${e(restaurant.address.city)}</p>
                        <p style="margin-top: 1rem;">${e(restaurant.contact.phone)}</p>
                    </section>
                </div>
            </div>

            <footer style="text-align: center; padding: 4rem 1rem; background: #fdfdfd; border-top: 1px solid #eee; color: #888;">
                <p>${e(siteConfig.footerNote || '')}</p>
                <div style="margin-top: 2rem; font-family: sans-serif; font-size: 0.75rem;">Restiq Classic Template</div>
            </footer>
        </div>
    `;
};
