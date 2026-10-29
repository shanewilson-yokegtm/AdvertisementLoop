// A small stand-in for the supabase-js query builder, backed by PGlite, so server code runs against the real
// schema, triggers and constraints in tests. Supports only what the server modules use.
const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const col = c => c.includes('->>') ? c.replace(/^(\w+)->>(\w+)$/, `$1->>'$2'`) : `"${c}"`;

export function pgClient(db) {
  const from = table => {
    const st = { op: 'select', cols: '*', where: [], order: null, limit: null, row: null, count: false, head: false, returning: false, upsertKeys: null };
    const b = {
      select(cols = '*', opts = {}) { if (st.op === 'select') { st.cols = cols; st.count = !!opts.count; st.head = !!opts.head; } else st.returning = true; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      update(row) { st.op = 'update'; st.row = row; return b; },
      upsert(row) { st.op = 'upsert'; st.row = row; return b; },
      eq(k, v) { st.where.push(`${col(k)} = ${q(v)}`); return b; },
      match(o) { Object.entries(o).forEach(([k, v]) => b.eq(k, v)); return b; },
      order(k, o = {}) { st.order = `${col(k)} ${o.ascending === false ? 'desc' : 'asc'}`; return b; },
      limit(n) { st.limit = n; return b; },
      async maybeSingle() { const r = await run(); if (r.error) return r; return { data: r.data?.[0] ?? null, error: null }; },
      async single() { const r = await run(); if (r.error) return r; if (!r.data?.length) return { data: null, error: { message: 'no rows' } }; return { data: r.data[0], error: null }; },
      then(res, rej) { return run().then(res, rej); },
    };
    const where = () => st.where.length ? ' where ' + st.where.join(' and ') : '';
    async function run() {
      try {
        let sql;
        if (st.op === 'select') {
          if (st.head) { const r = await db.query(`select count(*)::int n from public.${table}${where()}`); return { data: null, count: r.rows[0].n, error: null }; }
          sql = `select ${st.cols === '*' ? '*' : st.cols.split(',').map(c => col(c.trim())).join(', ')} from public.${table}${where()}${st.order ? ' order by ' + st.order : ''}${st.limit ? ' limit ' + st.limit : ''}`;
        } else if (st.op === 'insert' || st.op === 'upsert') {
          const rows = Array.isArray(st.row) ? st.row : [st.row]; const keys = Object.keys(rows[0]);
          sql = `insert into public.${table}(${keys.map(col).join(',')}) values ${rows.map(r => '(' + keys.map(k => q(r[k])).join(',') + ')').join(',')}`;
          if (st.op === 'upsert') {
            const pk = (await db.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum = any(i.indkey) where i.indrelid='public.${table}'::regclass and i.indisprimary`)).rows.map(r => r.attname);
            sql += ` on conflict (${pk.map(col).join(',')}) do update set ${keys.filter(k => !pk.includes(k)).map(k => `${col(k)} = excluded.${col(k)}`).join(', ')}`;
          }
          sql += ' returning *';
        } else {
          sql = `update public.${table} set ${Object.entries(st.row).map(([k, v]) => `${col(k)} = ${q(v)}`).join(', ')}${where()} returning *`;
        }
        const r = await db.query(sql); return { data: r.rows, error: null };
      } catch (e) { return { data: null, error: { message: String(e.message), code: e.code } }; }
    }
    return b;
  };
  const objects = new Map(); // fake storage: path -> {size, mimetype}
  const rpc = async (fn, args = {}) => {
    try {
      const named = Object.entries(args).map(([k, v]) => `${k} => ${v === null || v === undefined ? 'null' : Array.isArray(v) || typeof v === 'object' ? q(v) : q(v)}`).join(', ');
      const r = await db.query(`select * from public.${fn}(${named})`);
      const ret = (await db.query(`select t.typname from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = '${fn}' limit 1`)).rows[0]?.typname;
      const setof = (await db.query(`select proretset from pg_proc where proname = '${fn}' limit 1`)).rows[0]?.proretset;
      return { data: setof ? r.rows : (ret === 'void' ? null : r.rows[0]), error: null };
    } catch (e) { return { data: null, error: { message: String(e.message), code: e.code } }; }
  };
  return {
    from, rpc, objects,
    storage: { from: () => ({
      createSignedUrl: async p => ({ data: { signedUrl: 'https://signed.example/' + p }, error: null }),
      download: async p => ({ data: new Blob([Buffer.from('fake-video-bytes:' + p)], { type: 'video/mp4' }), error: null }),
      createSignedUrls: async ps => ({ data: ps.map(p => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }),
      createSignedUploadUrl: async p => ({ data: { signedUrl: 'https://upload.example/' + p, path: p, token: 't' }, error: null }),
      list: async (folder, o) => ({ data: [...objects.entries()].filter(([k]) => k === folder + '/' + o.search).map(([k, m]) => ({ name: k.split('/').pop(), metadata: m })), error: null }),
    }) },
  };
}
