import { pages, apps, guides, site } from '../lib/content.mjs';

export function GET() {
  return new Response(JSON.stringify({ pages: pages.length, apps: apps.length, guides: guides.length, checkedAt: site.checkedAt }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
