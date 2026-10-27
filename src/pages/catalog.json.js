import { site, apps } from '../lib/content.mjs';

export function GET() {
  return new Response(JSON.stringify({ checkedAt: site.checkedAt, apps }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
