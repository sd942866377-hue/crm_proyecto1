const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appkesH0lrwUk3PGu';
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || 'tblGjJ6OJnYLFHIQZ';
const PAT = process.env.AIRTABLE_PAT;

function airtableHeaders() {
  return {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  };
}

export async function GET(request) {
  if (!PAT) return Response.json({ error: 'AIRTABLE_PAT not set' }, { status: 500 });
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const estado = searchParams.get('estado') || '';
  const offset = searchParams.get('offset') || '';

  let filterParts = [];
  if (search) filterParts.push(`OR(SEARCH("${search.toLowerCase()}",LOWER({Nombre y apellido})),SEARCH("${search.toLowerCase()}",LOWER({Dirección})),SEARCH("${search.toLowerCase()}",LOWER({Distrito})))`);
  if (estado) filterParts.push(`{Estado}="${estado}"`);
  const filterFormula = filterParts.length > 1 ? `AND(${filterParts.join(',')})` : filterParts[0] || '';

  const params = new URLSearchParams({
    maxRecords: '50',
    sort: JSON.stringify([{ field: 'Última llamada', direction: 'desc' }]),
  });
  if (filterFormula) params.set('filterByFormula', filterFormula);
  if (offset) params.set('offset', offset);

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`;
  const res = await fetch(url, { headers: airtableHeaders() });
  if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
  const data = await res.json();
  return Response.json(data);
}

export async function POST(request) {
  if (!PAT) return Response.json({ error: 'AIRTABLE_PAT not set' }, { status: 500 });
  const body = await request.json();
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields: body }),
  });
  if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
  return Response.json(await res.json());
}
