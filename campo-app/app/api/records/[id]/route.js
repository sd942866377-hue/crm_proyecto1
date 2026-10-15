const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appkesH0lrwUk3PGu';
const TABLE_ID = process.env.AIRTABLE_TABLE_ID || 'tblGjJ6OJnYLFHIQZ';
const PAT = process.env.AIRTABLE_PAT;

function airtableHeaders() {
  return {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  };
}

export async function PATCH(request, { params }) {
  if (!PAT) return Response.json({ error: 'AIRTABLE_PAT not set' }, { status: 500 });
  const body = await request.json();
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${params.id}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields: body }),
  });
  if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
  return Response.json(await res.json());
}

export async function DELETE(request, { params }) {
  if (!PAT) return Response.json({ error: 'AIRTABLE_PAT not set' }, { status: 500 });
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${params.id}`, {
    method: 'DELETE',
    headers: airtableHeaders(),
  });
  if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
  return Response.json(await res.json());
}
