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
        document.documentElement.style.setProperty('--accent', Renderer.utils.safeCssColor(siteConfig.accentColor));
        document.documentElement.style.setProperty('--restiq-font', Renderer.utils.fontStack(siteConfig.fontFamily));

        // 2. Clear container
        container.innerHTML = '';

        // 3. Render Template Shell
        const shell = document.createElement('div');
        shell.className = `gastro-shell template-${templateKey} font-${Renderer.utils.cssToken(siteConfig.fontFamily)} heading-${Renderer.utils.cssToken(siteConfig.headingStyle)} menu-${Renderer.utils.cssToken(siteConfig.menuLayout)}`;
        shell.style.fontFamily = 'var(--restiq-font)';
        
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
        escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        safeUrl(value) {
            const url = String(value || '').trim();
            if (!url) return '';
            try {
                const parsed = new URL(url, window.location.origin);
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                    return parsed.href;
                }
                if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(url)) return url;
            } catch (error) {
                return '';
            }
            return '';
        },
        safeCssColor(value, fallback = '#2563eb') {
            const color = String(value || '').trim();
            return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : fallback;
        },
        cssToken(value) {
            return String(value || '').replace(/[^a-z0-9_-]/gi, '') || 'default';
        },
        fontStack(value) {
            const stacks = {
                serif: "Georgia, 'Times New Roman', serif",
                rounded: "'Trebuchet MS', 'Segoe UI', sans-serif",
                system: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            };
            return stacks[value] || stacks.system;
        },
        headingStyle(value) {
            const styles = {
                editorial: 'font-family: Georgia, serif; font-weight: 700;',
                uppercase: 'text-transform: uppercase; letter-spacing: 1px;',
                clean: ''
            };
            return styles[value] || styles.clean;
        },
        dishImageRadius(value) {
            const radii = {
                circle: '999px',
                square: '0',
                rounded: '8px'
            };
            return radii[value] || radii.rounded;
        },
        imageStyle(url) {
            const safe = this.safeUrl(url);
            return safe ? `url('${safe.replace(/'/g, '%27')}')` : '#f1f5f9';
        },
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
                    timeStr = h.slots.map(s => `${this.escapeHtml(s.open)} - ${this.escapeHtml(s.close)}`).join('<br>');
                    if (!timeStr) timeStr = 'Nach Vereinbarung';
                }
                const note = h && h.note ? `<div style="font-size: 0.75rem; color: #64748b;">${this.escapeHtml(h.note)}</div>` : '';
                html += `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; border-bottom: 1px solid #f1f5f9;">
                        <span>${this.escapeHtml(day)}</span>
                        <span style="text-align: right;">${timeStr}${note}</span>
                    </div>
                `;
            });
            html += '</div>';
            return html;
        },
        specialClosures(closures) {
            if (!Array.isArray(closures) || closures.length === 0) return '';

            return `
                <div class="special-closures" style="background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 1rem; border-radius: 8px; margin: 1.5rem 0;">
                    <strong>Aktuelle Hinweise</strong>
                    ${closures.map(item => `
                        <div style="margin-top: 0.75rem;">
                            <div>${this.escapeHtml(item.title)}</div>
                            <div style="font-size: 0.85rem;">${this.escapeHtml(item.startDate)} bis ${this.escapeHtml(item.endDate)}</div>
                            ${item.note ? `<div style="font-size: 0.85rem; margin-top: 0.25rem;">${this.escapeHtml(item.note)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }
};

window.RestiqRenderer = Renderer;
