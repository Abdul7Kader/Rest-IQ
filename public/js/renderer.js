/**
 * Restiq Renderer Layer
 * Decouples normalized data from individual templates.
 */

const Renderer = {
    /**
     * Entry point for rendering a restaurant preview
     * @param {Object} data Normalized View-Model
     * @param {HTMLElement} container Parent element
     */
    render(data, container) {
        const { siteConfig, flags } = data;
        const templateKey = siteConfig.template || 'free_default';
        
        // 1. Update global styles (accent color)
        document.documentElement.style.setProperty('--accent', siteConfig.accentColor || '#2563eb');

        // 2. Clear container
        container.innerHTML = '';

        // 3. Render Template Shell
        const shell = document.createElement('div');
        shell.className = `gastro-shell template-${templateKey}`;
        
        // 4. Invoke Template-specific Rendering
        if (typeof window[templateKey] === 'function') {
            shell.innerHTML = window[templateKey](data);
        } else {
            shell.innerHTML = `<div class="alert alert-error">Template ${templateKey} not found. Falling back to default.</div>`;
            if (typeof window['free_default'] === 'function') {
                shell.innerHTML += window['free_default'](data);
            }
        }

        container.appendChild(shell);
    },

    /**
     * Common component: Ad Slot
     * @param {string} type Slot identifier (top_banner, in_content, footer_ad)
     * @param {Object} flags View-Model flags
     */
    utils: {
        adSlot(type, flags) {
            if (!flags || !flags.adsEnabled) return '';
            
            const labels = {
                top_banner: 'Top Banner Ad',
                in_content: 'In-Content Ad',
                footer_ad: 'Footer Ad'
            };
            
            return `
                <div class="ad-slot ad-slot-${type}" style="background: #f8fafc; border: 2px dashed #cbd5e1; color: #94a3b8; padding: 2rem; text-align: center; margin: 2rem 0; border-radius: 8px;">
                    WERBUNG - ${labels[type] || 'PLATZHALTER'}
                </div>
            `;
        },
        donationHint(flags) {
            if (!flags || !flags.donationHintEnabled) return '';
            return `
                <div class="donation-hint" style="background: #fff7ed; border: 1px solid #ffedd5; color: #9a3412; padding: 1rem; text-align: center; border-radius: 8px; margin-bottom: 2rem;">
                    <strong>Gefällt Ihnen dieses Restaurant?</strong> Unterstützen Sie die Restiq-Plattform mit einer kleinen Spende, damit wir lokale Restaurants weiterhin fördern können.
                </div>
            `;
        },
        openingHours(hours) {
            const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
            let html = '<div class="hours-list" style="font-size: 0.9rem;">';
            weekdays.forEach((day, i) => {
                const h = hours.find(x => x.day === i);
                let timeStr = 'Geschlossen';
                if (h && !h.isClosed) {
                    timeStr = h.slots.map(s => `${s.open} - ${s.close}`).join('<br>');
                }
                html += `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; border-bottom: 1px solid #f1f5f9;">
                        <span>${day}</span>
                        <span style="text-align: right;">${timeStr}</span>
                    </div>
                `;
            });
            html += '</div>';
            return html;
        }
    }
};

window.RestiqRenderer = Renderer;
