import { baseApi } from './baseApi';

// Purchase Dashboard (company view) — one load of the EXISTING Purchase FMS
// list APIs (GET only, every page), joined in the browser by
// features/purchase-dashboard/purchaseDashboardModel.js. No new backend API.
//
// `required` lists are needed to draw the page; if an optional one cannot be
// read (e.g. the person may not open it), its figures show "—" and the page
// says which list is missing — nothing is filled in.
const SOURCES = [
  { key: 'indents', url: '/procurement/indents', required: true },
  { key: 'pos', url: '/procurement/purchase-orders', required: true },
  // Open Purchase doer tasks: each indent's current step, owner and planned time.
  { key: 'tasks', url: '/fms-doers/tasks', params: { fmsKey: 'PURCHASE', status: 'OPEN' }, required: true },
  { key: 'followUps', url: '/procurement/follow-ups' },
  { key: 'pis', url: '/procurement/proforma-invoices' },
  { key: 'grns', url: '/procurement/grns' },
  { key: 'qcs', url: '/procurement/incoming-qc' },
  { key: 'invoices', url: '/procurement/vendor-invoices' },
  { key: 'vouchers', url: '/procurement/vouchers' },
  { key: 'tallies', url: '/procurement/tally-entries' },
  { key: 'finals', url: '/procurement/final-payments' },
  { key: 'services', url: '/procurement/service-completions' },
  { key: 'rateChanges', url: '/procurement/rate-changes', params: { status: 'PENDING' }, limit: 200 },
];
const PAGE = 1000;     // the lists' own maximum page size
const MAX_PAGES = 50;  // safety stop

// Most lists answer { data: [...], pagination }; a few (rate changes) answer
// { data: { rows: [...], pagination } }.
const rowsOf = (body) => (Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.rows) ? body.data.rows : []);
const pagingOf = (body) => body?.pagination || body?.data?.pagination || {};

const fetchAll = async (baseQuery, { url, params = {}, limit = PAGE }) => {
  const get = (page) => baseQuery({ url, params: { ...params, page, limit } });
  const first = await get(1);
  if (first.error) return { error: first.error };
  const rows = [...rowsOf(first.data)];
  const pg = pagingOf(first.data);
  const pages = Math.min(Number(pg.totalPages || pg.pages) || 1, MAX_PAGES);
  for (let p = 2; p <= pages; p += 1) {
    const next = await get(p);
    if (next.error) return { error: next.error };
    rows.push(...rowsOf(next.data));
  }
  return { rows, total: Number(pg.total) || rows.length };
};

export const purchaseDashboardApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPurchaseDashboardData: builder.query({
      async queryFn(_arg, _api, _extra, baseQuery) {
        const results = await Promise.all(SOURCES.map((s) => fetchAll(baseQuery, s)));
        const data = { missing: [], totals: {} };
        for (let i = 0; i < SOURCES.length; i += 1) {
          const s = SOURCES[i];
          const r = results[i];
          if (r.error) {
            if (s.required) return { error: r.error };
            data[s.key] = [];
            data.missing.push(s.key);
          } else {
            data[s.key] = r.rows;
            data.totals[s.key] = r.total;
          }
        }
        data.loadedAt = new Date().toISOString();
        return { data };
      },
    }),
  }),
});

export const { useGetPurchaseDashboardDataQuery } = purchaseDashboardApi;
