/**
 * Template: free_classic
 * Logic: Traditional, centered, elegant layout with serif-inspired fonts.
 */

window.free_classic = function(data) {
    const { restaurant, siteConfig, menu, hours, flags } = data;
    const { utils } = window.RestiqRenderer;

    return `
        <div class="template-free-classic" style="font-family: 'Georgia', serif;">
            <!-- Simple Centered Header -->
            <header style="text-align: center; padding: 3rem 1rem; border-bottom: 3px double var(--accent);">
                ${siteConfig.logoUrl ? `<img src="${siteConfig.logoUrl}" style="max-height: 100px; margin-bottom: 1.5rem;">` : ''}
                <h1 style="font-size: 3.5rem; letter-spacing: -1px; margin-bottom: 0.5rem; color: #1a1a1a;">${siteConfig.hero.title}</h1>
                <p style="font-style: italic; font-size: 1.2rem; color: #444;">${siteConfig.hero.subtitle}</p>
            </header>

            ${utils.adSlot('top_banner', flags)}

            ${utils.donationHint(flags)}

            <div style="max-width: 700px; margin: 0 auto; padding: 3rem 1rem;">
                <!-- About Centered -->
                <section style="text-align: center; margin-bottom: 4rem;">
                    <h2 style="font-size: 2rem; margin-bottom: 1.5rem;">Willkommen</h2>
                    <p style="line-height: 1.8; font-size: 1.1rem;">${siteConfig.aboutText || 'Wir freuen uns auf Ihren Besuch.'}</p>
                </section>

                ${utils.adSlot('in_content', flags)}

                <!-- Menu Centered -->
                <section style="margin-bottom: 4rem;">
                    <h2 style="text-align: center; font-size: 2.5rem; margin-bottom: 3rem; text-transform: uppercase; letter-spacing: 2px;">Karte</h2>
                    ${menu.categories.map(cat => `
                        <div style="margin-bottom: 4rem;">
                            <h3 style="text-align: center; font-size: 1.8rem; margin-bottom: 2rem; color: var(--accent);">${cat.name}</h3>
                            <div style="border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 2rem 0;">
                                ${cat.dishes.map(dish => `
                                    <div style="text-align: center; margin-bottom: 2rem;">
                                        <div style="font-weight: bold; font-size: 1.2rem;">${dish.name}</div>
                                        <div style="font-style: italic; color: #666; margin: 0.5rem 0;">${dish.description}</div>
                                        <div style="font-weight: 700; color: #000;">${dish.price}€</div>
                                    </div>
                                `).join('')}
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
                        <p style="margin-top: 1rem;">${restaurant.address.street} ${restaurant.address.number}<br>${restaurant.address.zip} ${restaurant.address.city}</p>
                        <p style="margin-top: 1rem;">${restaurant.contact.phone}</p>
                    </section>
                </div>
            </div>

            <footer style="text-align: center; padding: 4rem 1rem; background: #fdfdfd; border-top: 1px solid #eee; color: #888;">
                <p>${siteConfig.footerNote || ''}</p>
                <div style="margin-top: 2rem; font-family: sans-serif; font-size: 0.75rem;">Restiq Classic Template</div>
            </footer>
        </div>
    `;
};
