import { pages, site, h, absolute } from '../lib/content.mjs';

export function GET() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.filter(page => !page.noindex).map(page => `<url><loc>${h(absolute(page.route))}</loc><lastmod>${page.modified || site.checkedAt}</lastmod></url>`).join('')}</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
