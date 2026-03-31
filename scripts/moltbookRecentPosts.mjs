#!/usr/bin/env node
import 'dotenv/config';

const unwrap = (payload) => {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) return payload.data;
  return payload;
};

const parseArgs = (argv) => {
  const rest = argv.slice(2);
  const args = Object.fromEntries(
    rest
      .filter((a) => a.startsWith('--') && a.includes('='))
      .map((a) => {
        const i = a.indexOf('=');
        return [a.slice(2, i), a.slice(i + 1)];
      })
  );
  const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')));
  return { args, flags };
};

export default async function moltbookRecentPosts({ submolt = null, limit = 15, sort = 'new' } = {}) {
  const baseUrl = process.env.MOLTBOOK_BASE_URL || 'https://moltbook.com/api/v1';

  const qs = new URLSearchParams();
  if (sort) qs.set('sort', sort);
  if (limit != null) qs.set('limit', String(limit));
  if (submolt) qs.set('submolt', submolt);

  const url = `${baseUrl}/posts?${qs.toString()}`;
  const res = await fetch(url);

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const msg = payload && typeof payload === 'object'
      ? (payload.error || payload.message || `HTTP ${res.status}`)
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = unwrap(payload);
  const posts = Array.isArray(data?.posts)
    ? data.posts
    : (Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []);

  const header = submolt ? `m/${submolt}` : 'global';
  console.log(`Moltbook recent posts (${header}) count=${posts.length}`);

  for (const p of posts) {
    const id = String(p?._id || p?.id || '');
    const title = String(p?.title || '').trim();
    const author = p?.author?.name || p?.author || p?.agent?.name || '';
    const created = p?.created_at || p?.createdAt || '';

    console.log(`- ${title || '(no title)'}${author ? ` — ${author}` : ''}${created ? ` — ${created}` : ''}${id ? ` — ${id}` : ''}`);
  }

  return { count: posts.length, posts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { args } = parseArgs(process.argv);
  const submolt = args.submolt || null;
  const limit = args.limit ? Number(args.limit) : 15;
  const sort = args.sort || 'new';

  moltbookRecentPosts({ submolt, limit, sort }).catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
