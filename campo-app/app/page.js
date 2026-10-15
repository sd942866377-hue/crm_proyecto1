'use client';
import { useState, useEffect, useCallback } from 'react';

const ESTADOS = ['Pendiente','Llamado','No contesta','Interesado','No interesado','Ocupado','Apagado','nuevo','Wasapp','NoNumero','seguimiento','TelpNoExiste'];
const ETAPAS = ['Nuevo','WhatsApp enviado','Contactado','Visita agendada','Visitado','Cotización enviada','Seguimiento','Llamar nuevamente','No contesta','Telp Apagado','TelpNoExiste','No quiere','Cierre ganado','Cliente','telp ocupado'];
const PROCEDENCIAS = ['Call Center','Visita en frío','Referido','Redes sociales','Otro','Denuncia policial'];
const SEGUIMIENTOS = ['Sin empezar','En curso','Instalado','No quiere','WhatsApp'];
const RESULTADOS = ['Respondió','No contesta','Teléfono apagado','No quiere','Llamar después','Visita coordinada','telp ocupado'];
const INMUEBLES = ['Casa','Negocio','Departamento','Colegio','Otro'];
const DISTRITOS = ['Los Olivos','San Martín de Porres','Comas','Carabayllo','Independencia','Puente Piedra','Callao','San Miguel','Chorrillos','Cercado de Lima','San Juan de Lurigancho','Santiago de Surco','Ate','Miraflores','San Luis','Lurigancho','San Borja','Otro','Piura','Ica','Pueblo libre','Parcona','Huánuco','Tacna','Trujillo'];

const EMPTY_FORM = {
  'Nombre y apellido': '',
  'Teléfono': '',
  'Estado': '',
  'Última llamada': '',
  'WhatsApp': '',
  'WhatsApp Business': '',
  'Procedencia': '',
  'Etapa comercial': '',
  'Dirección': '',
  'Distrito': '',
  'Seguimiento': '',
  'Resultado último contacto': '',
  'Tipo de inmueble': '',
  'Procedencia del lead': '',
  'Observación': '',
  'Google Maps': '',
  'WhatsApp enviado': false,
  'Fecha de recolección': '',
  'Fecha de visita': '',
  'Fecha de llamada': '',
  'Próxima acción': '',
  'Fecha de cierre': '',
};

function badgeClass(estado) {
  if (!estado) return '';
  const e = estado.toLowerCase();
  if (e.includes('interesado') && !e.includes('no')) return 'interesado';
  if (e.includes('no interesado') || e.includes('no quiere')) return 'no-interesado';
  if (e.includes('llamado') || e.includes('llamar')) return 'llamado';
  if (e.includes('cierre ganado') || e.includes('cliente')) return 'cierre-ganado';
  return 'pendiente';
}

export default function Home() {
  const [tab, setTab] = useState('nuevo');
  const [form, setForm] = useState(EMPTY_FORM);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [offset, setOffset] = useState('');
  const [nextOffset, setNextOffset] = useState('');
  const [editRecord, setEditRecord] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const showAlert = (msg, type = 'success') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  };

  const loadRecords = useCallback(async (off = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterEstado) params.set('estado', filterEstado);
      if (off) params.set('offset', off);
      const res = await fetch(`/api/records?${params}`);
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || 'Error cargando registros', 'error'); return; }
      setRecords(off ? prev => [...prev, ...data.records] : data.records || []);
      setNextOffset(data.offset || '');
      setOffset(off);
    } finally { setLoading(false); }
  }, [search, filterEstado]);

  useEffect(() => { if (tab === 'registros' || tab === 'resumen') loadRecords(''); }, [tab, loadRecords]);

  const handleFormChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const getGPS = () => {
    if (!navigator.geolocation) { showAlert('GPS no disponible en este dispositivo', 'error'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;
        setForm(f => ({ ...f, 'Google Maps': url }));
        setGpsLoading(false);
      },
      () => { showAlert('No se pudo obtener ubicación', 'error'); setGpsLoading(false); }
    );
  };

  const cleanFields = (f) => {
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (v === '' || v === null || v === undefined) continue;
      if (typeof v === 'boolean') { out[k] = v; continue; }
      out[k] = v;
    }
    return out;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form['Nombre y apellido'].trim()) { showAlert('Nombre y apellido requerido', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanFields(form)),
      });
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || 'Error guardando', 'error'); return; }
      showAlert('Registro guardado en Airtable ✓');
      setForm(EMPTY_FORM);
    } finally { setSaving(false); }
  };

  const openEdit = (record) => {
    const f = { ...EMPTY_FORM, ...record.fields };
    if (f['Última llamada']) f['Última llamada'] = f['Última llamada'].split('T')[0];
    setEditRecord({ id: record.id, fields: f });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/records/${editRecord.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanFields(editRecord.fields)),
      });
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || 'Error actualizando', 'error'); return; }
      showAlert('Actualizado ✓');
      setEditRecord(null);
      loadRecords('');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
    if (res.ok) { showAlert('Eliminado'); loadRecords(''); }
  };

  const stats = {
    total: records.length,
    interesados: records.filter(r => r.fields['Estado'] === 'Interesado').length,
    seguimiento: records.filter(r => r.fields['Etapa comercial'] === 'Seguimiento').length,
    cerrados: records.filter(r => r.fields['Etapa comercial'] === 'Cierre ganado' || r.fields['Estado'] === 'Cierre ganado').length,
  };

  const today = new Date().toISOString().split('T')[0];
  const proximas = records.filter(r => r.fields['Próxima acción'] && r.fields['Próxima acción'] <= today);

  return (
    <>
      <header>
        <div className="inner">
          <h1>🔵 Campo Pro CRM</h1>
          <span>Prosegur · Lima Norte</span>
        </div>
      </header>

      <nav>
        {[['nuevo','+ Nuevo'],['registros','Registros'],['resumen','Resumen']].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <div className="tab-content container">
        {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

        {/* ── TAB NUEVO ── */}
        {tab === 'nuevo' && (
          <form onSubmit={handleSubmit}>
            <div className="card">
              <div className="section-title">Datos personales</div>
              <div className="grid-2">
                <div className="field field-full">
                  <label>Nombre y apellido *</label>
                  <input value={form['Nombre y apellido']} onChange={e => handleFormChange('Nombre y apellido', e.target.value)} placeholder="Juan Pérez García" />
                </div>
                <div className="field">
                  <label>Teléfono</label>
                  <input type="tel" value={form['Teléfono']} onChange={e => handleFormChange('Teléfono', e.target.value)} placeholder="+51 999 999 999" />
                </div>
                <div className="field">
                  <label>Estado</label>
                  <select value={form['Estado']} onChange={e => handleFormChange('Estado', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {ESTADOS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Contacto y comunicación</div>
              <div className="grid-2">
                <div className="field">
                  <label>WhatsApp (link)</label>
                  <input type="url" value={form['WhatsApp']} onChange={e => handleFormChange('WhatsApp', e.target.value)} placeholder="https://wa.me/51..." />
                </div>
                <div className="field">
                  <label>WhatsApp Business (link)</label>
                  <input type="url" value={form['WhatsApp Business']} onChange={e => handleFormChange('WhatsApp Business', e.target.value)} placeholder="https://wa.me/51..." />
                </div>
                <div className="field">
                  <label>Procedencia</label>
                  <select value={form['Procedencia']} onChange={e => handleFormChange('Procedencia', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {PROCEDENCIAS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Procedencia del lead</label>
                  <input value={form['Procedencia del lead']} onChange={e => handleFormChange('Procedencia del lead', e.target.value)} placeholder="Campaña, referido..." />
                </div>
                <div className="field">
                  <label>Tipo de inmueble</label>
                  <select value={form['Tipo de inmueble']} onChange={e => handleFormChange('Tipo de inmueble', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {INMUEBLES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Último contacto resultado</label>
                  <select value={form['Resultado último contacto']} onChange={e => handleFormChange('Resultado último contacto', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {RESULTADOS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field field-full">
                  <div className="checkbox-row">
                    <input type="checkbox" id="wa_enviado" checked={form['WhatsApp enviado']} onChange={e => handleFormChange('WhatsApp enviado', e.target.checked)} />
                    <label htmlFor="wa_enviado">WhatsApp enviado</label>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Etapa comercial y seguimiento</div>
              <div className="grid-2">
                <div className="field">
                  <label>Etapa comercial</label>
                  <select value={form['Etapa comercial']} onChange={e => handleFormChange('Etapa comercial', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {ETAPAS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Seguimiento</label>
                  <select value={form['Seguimiento']} onChange={e => handleFormChange('Seguimiento', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {SEGUIMIENTOS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Ubicación</div>
              <div className="grid-2">
                <div className="field field-full">
                  <label>Dirección</label>
                  <input value={form['Dirección']} onChange={e => handleFormChange('Dirección', e.target.value)} placeholder="Av. Principal 123, Urb. ..." />
                </div>
                <div className="field">
                  <label>Distrito</label>
                  <select value={form['Distrito']} onChange={e => handleFormChange('Distrito', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {DISTRITOS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Google Maps URL</label>
                  <div className="gps-row">
                    <input type="url" value={form['Google Maps']} onChange={e => handleFormChange('Google Maps', e.target.value)} placeholder="https://maps.google.com/..." />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={getGPS} disabled={gpsLoading}>
                      {gpsLoading ? <span className="loader" /> : '📍 GPS'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-title">Fechas</div>
              <div className="grid-2">
                {[
                  ['Última llamada','datetime-local'],
                  ['Fecha de recolección','date'],
                  ['Fecha de visita','date'],
                  ['Fecha de llamada','date'],
                  ['Próxima acción','date'],
                  ['Fecha de cierre','date'],
                ].map(([key, type]) => (
                  <div className="field" key={key}>
                    <label>{key}</label>
                    <input type={type} value={form[key]} onChange={e => handleFormChange(key, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="section-title">Observación</div>
              <div className="field">
                <label>Notas y observaciones</label>
                <textarea value={form['Observación']} onChange={e => handleFormChange('Observación', e.target.value)} placeholder="Detalles adicionales, comentarios del cliente..." rows={4} />
              </div>
            </div>

            <div className="btn-row" style={{ marginBottom: 32 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <><span className="loader" /> Guardando…</> : '💾 Guardar en Airtable'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(EMPTY_FORM)}>Limpiar</button>
            </div>
          </form>
        )}

        {/* ── TAB REGISTROS ── */}
        {tab === 'registros' && (
          <>
            <div className="records-toolbar">
              <input
                placeholder="Buscar nombre, dirección, distrito..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadRecords('')}
              />
              <select value={filterEstado} onChange={e => { setFilterEstado(e.target.value); }}>
                <option value="">Todos los estados</option>
                {ESTADOS.map(o => <option key={o}>{o}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => loadRecords('')}>Buscar</button>
            </div>

            {loading && <div style={{ textAlign: 'center', padding: 20 }}><span className="loader" /></div>}

            {!loading && records.length === 0 && <div className="empty">Sin registros. Agrega el primero desde la pestaña + Nuevo.</div>}

            <div className="record-list">
              {records.map(r => (
                <div key={r.id} className="record-card" onClick={() => openEdit(r)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="rc-name">{r.fields['Nombre y apellido'] || '—'}</div>
                    <span className={`badge ${badgeClass(r.fields['Estado'] || r.fields['Etapa comercial'])}`}>
                      {r.fields['Estado'] || r.fields['Etapa comercial'] || '—'}
                    </span>
                  </div>
                  <div className="rc-meta">
                    {r.fields['Teléfono'] && <span>📞 {r.fields['Teléfono']}</span>}
                    {r.fields['Distrito'] && <span>📍 {r.fields['Distrito']}</span>}
                    {r.fields['Etapa comercial'] && <span>🔄 {r.fields['Etapa comercial']}</span>}
                    {r.fields['Próxima acción'] && <span>📅 {r.fields['Próxima acción']}</span>}
                  </div>
                </div>
              ))}
            </div>

            {nextOffset && (
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <button className="btn btn-secondary" onClick={() => loadRecords(nextOffset)} disabled={loading}>Cargar más</button>
              </div>
            )}
          </>
        )}

        {/* ── TAB RESUMEN ── */}
        {tab === 'resumen' && (
          <>
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card"><div className="num">{stats.total}</div><div className="lbl">Total cargados</div></div>
              <div className="stat-card"><div className="num">{stats.interesados}</div><div className="lbl">Interesados</div></div>
              <div className="stat-card"><div className="num">{stats.seguimiento}</div><div className="lbl">En seguimiento</div></div>
              <div className="stat-card"><div className="num">{stats.cerrados}</div><div className="lbl">Cierre ganado</div></div>
            </div>

            {proximas.length > 0 && (
              <div className="card">
                <div className="section-title">⚠️ Próximas acciones pendientes ({proximas.length})</div>
                <div className="record-list">
                  {proximas.map(r => (
                    <div key={r.id} className="record-card" onClick={() => openEdit(r)}>
                      <div className="rc-name">{r.fields['Nombre y apellido']}</div>
                      <div className="rc-meta">
                        <span>📅 {r.fields['Próxima acción']}</span>
                        {r.fields['Teléfono'] && <span>📞 {r.fields['Teléfono']}</span>}
                        {r.fields['Etapa comercial'] && <span>{r.fields['Etapa comercial']}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {proximas.length === 0 && !loading && <div className="empty">Sin acciones pendientes por hoy 🎉</div>}
          </>
        )}
      </div>

      {/* ── MODAL EDITAR ── */}
      {editRecord && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditRecord(null)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setEditRecord(null)}>✕</button>
            <h2 style={{ marginBottom: 16, fontSize: '1rem' }}>✏️ Editar registro</h2>
            <form onSubmit={handleUpdate}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['Nombre y apellido', 'text'],
                  ['Teléfono', 'tel'],
                  ['Dirección', 'text'],
                  ['WhatsApp', 'url'],
                  ['WhatsApp Business', 'url'],
                  ['Google Maps', 'url'],
                  ['Procedencia del lead', 'text'],
                ].map(([key, type]) => (
                  <div className="field" key={key}>
                    <label>{key}</label>
                    <input type={type} value={editRecord.fields[key] || ''} onChange={e => setEditRecord(r => ({ ...r, fields: { ...r.fields, [key]: e.target.value } }))} />
                  </div>
                ))}
                {[
                  ['Estado', ESTADOS],
                  ['Etapa comercial', ETAPAS],
                  ['Procedencia', PROCEDENCIAS],
                  ['Seguimiento', SEGUIMIENTOS],
                  ['Resultado último contacto', RESULTADOS],
                  ['Tipo de inmueble', INMUEBLES],
                  ['Distrito', DISTRITOS],
                ].map(([key, opts]) => (
                  <div className="field" key={key}>
                    <label>{key}</label>
                    <select value={editRecord.fields[key] || ''} onChange={e => setEditRecord(r => ({ ...r, fields: { ...r.fields, [key]: e.target.value } }))}>
                      <option value="">— Seleccionar —</option>
                      {opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {[
                  ['Fecha de recolección','date'],
                  ['Fecha de visita','date'],
                  ['Fecha de llamada','date'],
                  ['Próxima acción','date'],
                  ['Fecha de cierre','date'],
                ].map(([key, type]) => (
                  <div className="field" key={key}>
                    <label>{key}</label>
                    <input type={type} value={editRecord.fields[key] || ''} onChange={e => setEditRecord(r => ({ ...r, fields: { ...r.fields, [key]: e.target.value } }))} />
                  </div>
                ))}
                <div className="field">
                  <label>Observación</label>
                  <textarea value={editRecord.fields['Observación'] || ''} onChange={e => setEditRecord(r => ({ ...r, fields: { ...r.fields, 'Observación': e.target.value } }))} rows={3} />
                </div>
                <div className="checkbox-row">
                  <input type="checkbox" id="wa_edit" checked={editRecord.fields['WhatsApp enviado'] || false} onChange={e => setEditRecord(r => ({ ...r, fields: { ...r.fields, 'WhatsApp enviado': e.target.checked } }))} />
                  <label htmlFor="wa_edit">WhatsApp enviado</label>
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : '💾 Actualizar'}</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => { handleDelete(editRecord.id); setEditRecord(null); }}>🗑️ Eliminar</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditRecord(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
