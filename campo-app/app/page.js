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
  'Nombre y apellido': '', 'Teléfono': '', 'Estado': '', 'Última llamada': '',
  'WhatsApp': '', 'WhatsApp Business': '', 'Procedencia': '', 'Etapa comercial': '',
  'Dirección': '', 'Distrito': '', 'Seguimiento': '', 'Resultado último contacto': '',
  'Tipo de inmueble': '', 'Procedencia del lead': '', 'Observación': '', 'Google Maps': '',
  'WhatsApp enviado': false, 'Fecha de recolección': '', 'Fecha de visita': '',
  'Fecha de llamada': '', 'Próxima acción': '', 'Fecha de cierre': '',
};

const TABS = [
  { key: 'nuevo', label: 'Nuevo registro', icon: '➕' },
  { key: 'registros', label: 'Registros', icon: '📋' },
  { key: 'resumen', label: 'Resumen', icon: '📊' },
];

function badgeClass(estado) {
  if (!estado) return '';
  const e = estado.toLowerCase();
  if (e.includes('no interesado') || e.includes('no quiere')) return 'no-interesado';
  if (e.includes('interesado')) return 'interesado';
  if (e.includes('llamado') || e.includes('llamar')) return 'llamado';
  if (e.includes('cierre ganado') || e.includes('cliente')) return 'cierre-ganado';
  return 'pendiente';
}

function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}
function Sel({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Seleccionar —</option>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </Field>
  );
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
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (filterEstado) p.set('estado', filterEstado);
      if (off) p.set('offset', off);
      const res = await fetch(`/api/records?${p}`);
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || 'Error cargando registros', 'error'); return; }
      setRecords(off ? prev => [...prev, ...data.records] : data.records || []);
      setNextOffset(data.offset || '');
    } finally { setLoading(false); }
  }, [search, filterEstado]);

  useEffect(() => {
    if (tab === 'registros' || tab === 'resumen') loadRecords('');
  }, [tab, loadRecords]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const getGPS = () => {
    if (!navigator.geolocation) { showAlert('GPS no disponible', 'error'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        set('Google Maps', `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`);
        setGpsLoading(false);
      },
      () => { showAlert('No se pudo obtener ubicación', 'error'); setGpsLoading(false); }
    );
  };

  const clean = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== null && v !== undefined));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form['Nombre y apellido'].trim()) { showAlert('Nombre y apellido requerido', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean(form)) });
      const data = await res.json();
      if (!res.ok) { showAlert(data.error || 'Error guardando', 'error'); return; }
      showAlert('Registro guardado en Airtable ✓');
      setForm(EMPTY_FORM);
    } finally { setSaving(false); }
  };

  const openEdit = (r) => {
    const f = { ...EMPTY_FORM, ...r.fields };
    if (f['Última llamada']) f['Última llamada'] = f['Última llamada'].split('T')[0];
    setEditRecord({ id: r.id, fields: f });
  };

  const setEF = (key, val) => setEditRecord(r => ({ ...r, fields: { ...r.fields, [key]: val } }));

  const handleUpdate = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await fetch(`/api/records/${editRecord.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean(editRecord.fields)) });
      if (!res.ok) { showAlert((await res.json()).error || 'Error', 'error'); return; }
      showAlert('Actualizado ✓'); setEditRecord(null); loadRecords('');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    await fetch(`/api/records/${id}`, { method: 'DELETE' });
    showAlert('Eliminado'); loadRecords('');
  };

  const stats = {
    total: records.length,
    interesados: records.filter(r => r.fields['Estado'] === 'Interesado').length,
    seguimiento: records.filter(r => r.fields['Etapa comercial'] === 'Seguimiento').length,
    cerrados: records.filter(r => ['Cierre ganado','Cliente'].includes(r.fields['Etapa comercial'])).length,
  };
  const today = new Date().toISOString().split('T')[0];
  const proximas = records.filter(r => r.fields['Próxima acción'] && r.fields['Próxima acción'] <= today);

  const tabLabel = TABS.find(t => t.key === tab)?.label || '';

  return (
    <div className="app-shell">
      {/* ── SIDEBAR (desktop/tablet) ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>🔵 Campo Pro</h1>
          <span>Prosegur · Lima Norte</span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map(t => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── MAIN ── */}
      <div className="main-area">
        {/* Mobile header */}
        <header className="mobile-header">
          <h1>🔵 Campo Pro</h1>
          <span>Prosegur</span>
        </header>

        {/* Desktop topbar */}
        <div className="topbar">
          <h2>{tabLabel}</h2>
          <span className="topbar-right">Base: CRM Prosegur · Henry</span>
        </div>

        {/* Content */}
        <div className="page-content">
          {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

          {/* ── NUEVO ── */}
          {tab === 'nuevo' && (
            <form onSubmit={handleSubmit}>
              <div className="form-layout">
                {/* Columna izquierda */}
                <div className="form-col">
                  <div className="card">
                    <div className="section-title">👤 Datos personales</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Field label="Nombre y apellido *">
                        <input value={form['Nombre y apellido']} onChange={e => set('Nombre y apellido', e.target.value)} placeholder="Juan Pérez García" />
                      </Field>
                      <div className="grid-2">
                        <Field label="Teléfono">
                          <input type="tel" value={form['Teléfono']} onChange={e => set('Teléfono', e.target.value)} placeholder="+51 999 999 999" />
                        </Field>
                        <Sel label="Estado" value={form['Estado']} onChange={v => set('Estado', v)} options={ESTADOS} />
                      </div>
                      <div className="grid-2">
                        <Field label="WhatsApp">
                          <input type="url" value={form['WhatsApp']} onChange={e => set('WhatsApp', e.target.value)} placeholder="https://wa.me/51..." />
                        </Field>
                        <Field label="WhatsApp Business">
                          <input type="url" value={form['WhatsApp Business']} onChange={e => set('WhatsApp Business', e.target.value)} placeholder="https://wa.me/51..." />
                        </Field>
                      </div>
                      <div className="checkbox-row">
                        <input type="checkbox" id="wa" checked={form['WhatsApp enviado']} onChange={e => set('WhatsApp enviado', e.target.checked)} />
                        <label htmlFor="wa">WhatsApp enviado</label>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <div className="section-title">📍 Ubicación</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Field label="Dirección">
                        <input value={form['Dirección']} onChange={e => set('Dirección', e.target.value)} placeholder="Av. Principal 123, Urb. ..." />
                      </Field>
                      <Sel label="Distrito" value={form['Distrito']} onChange={v => set('Distrito', v)} options={DISTRITOS} />
                      <Field label="Google Maps URL">
                        <div className="gps-row">
                          <input type="url" value={form['Google Maps']} onChange={e => set('Google Maps', e.target.value)} placeholder="https://maps.google.com/..." />
                          <button type="button" className="btn btn-secondary btn-sm" onClick={getGPS} disabled={gpsLoading}>
                            {gpsLoading ? <span className="loader" /> : '📍 GPS'}
                          </button>
                        </div>
                      </Field>
                      <Sel label="Tipo de inmueble" value={form['Tipo de inmueble']} onChange={v => set('Tipo de inmueble', v)} options={INMUEBLES} />
                    </div>
                  </div>

                  <div className="card">
                    <div className="section-title">📝 Observación</div>
                    <Field label="Notas">
                      <textarea value={form['Observación']} onChange={e => set('Observación', e.target.value)} placeholder="Detalles, comentarios del cliente..." rows={4} />
                    </Field>
                  </div>
                </div>

                {/* Columna derecha */}
                <div className="form-col">
                  <div className="card">
                    <div className="section-title">🔄 Etapa comercial</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Sel label="Etapa comercial" value={form['Etapa comercial']} onChange={v => set('Etapa comercial', v)} options={ETAPAS} />
                      <Sel label="Seguimiento" value={form['Seguimiento']} onChange={v => set('Seguimiento', v)} options={SEGUIMIENTOS} />
                      <Sel label="Resultado último contacto" value={form['Resultado último contacto']} onChange={v => set('Resultado último contacto', v)} options={RESULTADOS} />
                      <Sel label="Procedencia" value={form['Procedencia']} onChange={v => set('Procedencia', v)} options={PROCEDENCIAS} />
                      <Field label="Procedencia del lead">
                        <input value={form['Procedencia del lead']} onChange={e => set('Procedencia del lead', e.target.value)} placeholder="Campaña, referido..." />
                      </Field>
                    </div>
                  </div>

                  <div className="card">
                    <div className="section-title">📅 Fechas</div>
                    <div className="grid-2">
                      {[
                        ['Fecha de recolección','date'],
                        ['Fecha de visita','date'],
                        ['Fecha de llamada','date'],
                        ['Próxima acción','date'],
                        ['Fecha de cierre','date'],
                      ].map(([key, type]) => (
                        <Field key={key} label={key}>
                          <input type={type} value={form[key]} onChange={e => set(key, e.target.value)} />
                        </Field>
                      ))}
                      <Field label="Última llamada">
                        <input type="datetime-local" value={form['Última llamada']} onChange={e => set('Última llamada', e.target.value)} />
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="form-footer">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <><span className="loader" /> Guardando…</> : '💾 Guardar en Airtable'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setForm(EMPTY_FORM)}>🗑️ Limpiar</button>
                </div>
              </div>
            </form>
          )}

          {/* ── REGISTROS ── */}
          {tab === 'registros' && (
            <>
              <div className="records-toolbar">
                <input
                  placeholder="🔍 Buscar nombre, dirección, distrito..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadRecords('')}
                />
                <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {ESTADOS.map(o => <option key={o}>{o}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" onClick={() => loadRecords('')}>Buscar</button>
              </div>

              {loading && <div style={{ textAlign:'center', padding: 30 }}><span className="loader" /></div>}

              {!loading && records.length === 0 && (
                <div className="empty">
                  <div className="empty-icon">📋</div>
                  Sin registros. Agrega desde + Nuevo registro.
                </div>
              )}

              {/* Table header (desktop only via CSS) */}
              <div className="record-list">
                {records.length > 0 && (
                  <div className="record-table-head">
                    <div className="rth-row">
                      <div className="rth-cell">Nombre y apellido</div>
                      <div className="rth-cell">Teléfono</div>
                      <div className="rth-cell">Estado</div>
                      <div className="rth-cell">Etapa comercial</div>
                      <div className="rth-cell">Distrito</div>
                      <div className="rth-cell">Próxima acción</div>
                    </div>
                  </div>
                )}
                {records.map(r => (
                  <div key={r.id} className="record-card" onClick={() => openEdit(r)}>
                    {/* Desktop cells */}
                    <td className="rc-cell">{r.fields['Nombre y apellido'] || '—'}</td>
                    <td className="rc-cell">{r.fields['Teléfono'] || '—'}</td>
                    <td className="rc-cell"><span className={`badge ${badgeClass(r.fields['Estado'])}`}>{r.fields['Estado'] || '—'}</span></td>
                    <td className="rc-cell">{r.fields['Etapa comercial'] || '—'}</td>
                    <td className="rc-cell">{r.fields['Distrito'] || '—'}</td>
                    <td className="rc-cell">{r.fields['Próxima acción'] || '—'}</td>
                    {/* Mobile/tablet card */}
                    <div className="rc-cell-meta">
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 8 }}>
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
                  </div>
                ))}
              </div>

              {nextOffset && (
                <div style={{ textAlign:'center', margin: '16px 0' }}>
                  <button className="btn btn-secondary" onClick={() => loadRecords(nextOffset)} disabled={loading}>Cargar más</button>
                </div>
              )}
            </>
          )}

          {/* ── RESUMEN ── */}
          {tab === 'resumen' && (
            <>
              <div className="stat-grid">
                <div className="stat-card"><div className="num">{stats.total}</div><div className="lbl">Total cargados</div></div>
                <div className="stat-card"><div className="num">{stats.interesados}</div><div className="lbl">Interesados</div></div>
                <div className="stat-card"><div className="num">{stats.seguimiento}</div><div className="lbl">En seguimiento</div></div>
                <div className="stat-card"><div className="num">{stats.cerrados}</div><div className="lbl">Cierre ganado</div></div>
              </div>

              {proximas.length > 0 && (
                <div className="card">
                  <div className="section-title">⚠️ Acciones pendientes hoy ({proximas.length})</div>
                  <div style={{ display:'flex', flexDirection:'column', gap: 10 }}>
                    {proximas.map(r => (
                      <div key={r.id} className="record-card" onClick={() => openEdit(r)} style={{ cursor:'pointer' }}>
                        <div className="rc-cell-meta">
                          <div className="rc-name">{r.fields['Nombre y apellido']}</div>
                          <div className="rc-meta">
                            <span>📅 {r.fields['Próxima acción']}</span>
                            {r.fields['Teléfono'] && <span>📞 {r.fields['Teléfono']}</span>}
                            {r.fields['Etapa comercial'] && <span>{r.fields['Etapa comercial']}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {proximas.length === 0 && !loading && (
                <div className="empty"><div className="empty-icon">🎉</div>Sin acciones pendientes por hoy</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── BOTTOM NAV (mobile) ── */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {TABS.map(t => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              <span className="bn-icon">{t.icon}</span>
              {t.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </nav>

      {/* ── MODAL EDITAR ── */}
      {editRecord && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditRecord(null)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setEditRecord(null)}>✕</button>
            <div className="modal-title">✏️ Editar — {editRecord.fields['Nombre y apellido']}</div>
            <form onSubmit={handleUpdate}>
              <div className="modal-grid">
                <Field label="Nombre y apellido">
                  <input value={editRecord.fields['Nombre y apellido'] || ''} onChange={e => setEF('Nombre y apellido', e.target.value)} />
                </Field>
                <Field label="Teléfono">
                  <input type="tel" value={editRecord.fields['Teléfono'] || ''} onChange={e => setEF('Teléfono', e.target.value)} />
                </Field>
                <Sel label="Estado" value={editRecord.fields['Estado'] || ''} onChange={v => setEF('Estado', v)} options={ESTADOS} />
                <Sel label="Etapa comercial" value={editRecord.fields['Etapa comercial'] || ''} onChange={v => setEF('Etapa comercial', v)} options={ETAPAS} />
                <Sel label="Seguimiento" value={editRecord.fields['Seguimiento'] || ''} onChange={v => setEF('Seguimiento', v)} options={SEGUIMIENTOS} />
                <Sel label="Resultado último contacto" value={editRecord.fields['Resultado último contacto'] || ''} onChange={v => setEF('Resultado último contacto', v)} options={RESULTADOS} />
                <Sel label="Procedencia" value={editRecord.fields['Procedencia'] || ''} onChange={v => setEF('Procedencia', v)} options={PROCEDENCIAS} />
                <Sel label="Tipo de inmueble" value={editRecord.fields['Tipo de inmueble'] || ''} onChange={v => setEF('Tipo de inmueble', v)} options={INMUEBLES} />
                <Field label="Dirección">
                  <input value={editRecord.fields['Dirección'] || ''} onChange={e => setEF('Dirección', e.target.value)} />
                </Field>
                <Sel label="Distrito" value={editRecord.fields['Distrito'] || ''} onChange={v => setEF('Distrito', v)} options={DISTRITOS} />
                <Field label="WhatsApp">
                  <input type="url" value={editRecord.fields['WhatsApp'] || ''} onChange={e => setEF('WhatsApp', e.target.value)} />
                </Field>
                <Field label="Google Maps">
                  <input type="url" value={editRecord.fields['Google Maps'] || ''} onChange={e => setEF('Google Maps', e.target.value)} />
                </Field>
                {['Fecha de recolección','Fecha de visita','Fecha de llamada','Próxima acción','Fecha de cierre'].map(k => (
                  <Field key={k} label={k}>
                    <input type="date" value={editRecord.fields[k] || ''} onChange={e => setEF(k, e.target.value)} />
                  </Field>
                ))}
                <div style={{ gridColumn: '1/-1' }}>
                  <Field label="Observación">
                    <textarea value={editRecord.fields['Observación'] || ''} onChange={e => setEF('Observación', e.target.value)} rows={3} />
                  </Field>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <div className="checkbox-row">
                    <input type="checkbox" id="wa_edit" checked={editRecord.fields['WhatsApp enviado'] || false} onChange={e => setEF('WhatsApp enviado', e.target.checked)} />
                    <label htmlFor="wa_edit">WhatsApp enviado</label>
                  </div>
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 18 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : '💾 Actualizar'}</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => { handleDelete(editRecord.id); setEditRecord(null); }}>🗑️ Eliminar</button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditRecord(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
