import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP, AppTopBar, Chip, Dot } from '../tokens.jsx';
import { Magnetic, TextScramble, Ticker } from '../shared.jsx';
import { listProjects, createProject, deleteProject } from '../api/projects.js';
import { logout, getUser } from '../api/auth.js';

const statusColor = {
  running: APP.accent, starting: APP.warn, stopping: APP.warn,
  idle: APP.faint, created: APP.faint, stopped: APP.faint, error: APP.err,
};

const statusLabel = {
  created: 'yeni', starting: 'başlıyor', running: 'çalışıyor',
  stopping: 'duruyor', stopped: 'durdu', error: 'hata',
};

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} s önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
}

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim());
      onClose();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 420, padding: 28,
        background: APP.panel, border: `1px solid ${APP.line}`,
        borderRadius: 16, fontFamily: APP.sans,
      }}>
        <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
          <span style={{ color: APP.accent }}>+</span> yeni proje
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>proje adı</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-app"
              style={{
                padding: '11px 13px', background: APP.bg,
                border: `1px solid ${APP.line}`, color: APP.fg,
                borderRadius: 9, fontFamily: APP.mono, fontSize: 14, outline: 'none',
              }}
            />
          </label>
          {error && (
            <div style={{ fontSize: 12, color: '#ff7a6e', fontFamily: APP.mono }}>
              [err] {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: '9px 16px', background: 'transparent', border: `1px solid ${APP.line}`,
              color: APP.dim, borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13,
            }}>İptal</button>
            <button type="submit" disabled={loading || !name.trim()} style={{
              padding: '9px 16px', background: APP.fg, border: 'none',
              color: APP.bg, borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13, fontWeight: 500,
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? 'Oluşturuluyor…' : 'Oluştur →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ project, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await onConfirm(project.id);
      onClose();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 380, padding: 28,
        background: APP.panel, border: `1px solid rgba(255,100,100,0.3)`,
        borderRadius: 16, fontFamily: APP.sans,
      }}>
        <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
          <span style={{ color: APP.err }}>!</span> projeyi sil
        </div>
        <div style={{ fontSize: 14, color: APP.dim, lineHeight: 1.6, marginBottom: 20 }}>
          <span style={{ color: APP.fg, fontWeight: 500 }}>{project.name}</span> projesini kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{
            padding: '9px 16px', background: 'transparent', border: `1px solid ${APP.line}`,
            color: APP.dim, borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13,
          }}>İptal</button>
          <button onClick={confirm} disabled={loading} style={{
            padding: '9px 16px', background: 'rgba(255,100,100,0.15)',
            border: '1px solid rgba(255,100,100,0.4)',
            color: '#ff7a6e', borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13, fontWeight: 500,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Siliniyor…' : 'Evet, sil →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('activity');
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const user = getUser();

  const load = useCallback(async () => {
    try {
      const res = await listProjects();
      setProjects(res.projects ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (name) => {
    const proj = await createProject(name);
    setProjects((prev) => [proj, ...prev]);
  };

  const handleDelete = async (id) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const filtered = projects
    .filter((p) => filter === 'all' || p.status === filter)
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      return new Date(b.updated_at) - new Date(a.updated_at);
    });

  const running = projects.filter((p) => p.status === 'running').length;

  return (
    <div style={{ background: APP.bg, color: APP.fg, minHeight: '100vh', fontFamily: APP.sans, display: 'flex', flexDirection: 'column' }}>
      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}

      <AppTopBar
        user={user?.username ?? user?.email ?? 'profil'}
        profileItems={[
          { label: 'Dashboard', action: 'dashboard' },
          { label: 'Profilim', action: 'profile' },
          { label: 'Çıkış yap', action: 'logout', onClick: handleLogout },
        ]}
      >
        <span style={{ fontSize: 12, color: APP.faint, fontFamily: APP.mono }}>
          {user?.username ?? '—'}
        </span>
      </AppTopBar>

      <div style={{ padding: '40px 32px', maxWidth: 1400, margin: '0 auto', width: '100%', flex: 1 }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: 8 }}>
          <div>
            <div style={{
              fontSize: 11, color: APP.faint, textTransform: 'uppercase',
              letterSpacing: '0.15em', fontFamily: APP.mono, marginBottom: 10,
            }}>
              <span style={{ color: APP.accent }}>##</span> ~/dashboard
            </div>
            <h1 style={{ fontSize: 48, fontWeight: 400, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}>
              Projeler.
            </h1>
          </div>
          <Magnetic strength={0.15}>
            <button onClick={() => setShowModal(true)} style={{
              background: APP.fg, color: APP.bg, border: 'none',
              padding: '12px 18px', borderRadius: 10, cursor: 'pointer',
              fontFamily: APP.sans, fontSize: 14, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
              <TextScramble text="Yeni proje" duration={400} />
            </button>
          </Magnetic>
        </div>

        {/* metric strip */}
        <div style={{
          marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          border: `1px solid ${APP.line}`, borderRadius: 12, overflow: 'hidden',
        }}>
          {[
            { l: 'aktif pod', v: running, s: `/ ${projects.length}`, c: APP.accent },
            { l: 'toplam proje', v: projects.length, s: '', c: APP.fg },
            { l: 'hata', v: projects.filter((p) => p.status === 'error').length, s: '', c: APP.err },
            { l: 'durdurulmuş', v: projects.filter((p) => p.status === 'stopped' || p.status === 'created').length, s: '', c: APP.faint },
          ].map((m, i) => (
            <div key={i} style={{
              padding: '18px 22px',
              borderLeft: i > 0 ? `1px solid ${APP.line}` : 'none',
              background: APP.bg,
            }}>
              <div style={{
                fontSize: 11, color: APP.faint, fontFamily: APP.mono,
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>{m.l}</div>
              <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-0.03em', marginTop: 8, color: m.c }}>
                <Ticker value={m.v} />{m.s}
              </div>
            </div>
          ))}
        </div>

        {/* toolbar */}
        <div style={{
          marginTop: 32, display: 'flex', gap: 12, alignItems: 'center',
          padding: '10px 12px',
          border: `1px solid ${APP.line}`, borderRadius: 10,
          background: APP.panelSoft,
        }}>
          <span style={{ color: APP.accent, fontFamily: APP.mono, fontSize: 14, paddingLeft: 6 }}>$</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="grep projects… (yaz ve filtrele)"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: APP.fg, fontFamily: APP.mono, fontSize: 13,
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all', 'hepsi'], ['running', 'çalışan'], ['stopped', 'durdu'], ['created', 'yeni'], ['error', 'hata']].map(([k, v]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                padding: '6px 10px', borderRadius: 6,
                background: filter === k ? APP.bg : 'transparent',
                color: filter === k ? APP.fg : APP.dim,
                border: `1px solid ${filter === k ? APP.line : 'transparent'}`,
                cursor: 'pointer', fontFamily: APP.mono, fontSize: 12,
              }}>{v}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: APP.line }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{
            background: 'transparent', color: APP.dim, border: 'none',
            fontFamily: APP.mono, fontSize: 12, outline: 'none', cursor: 'pointer',
          }}>
            <option value="activity" style={{ background: APP.bg }}>sort: aktivite</option>
            <option value="name" style={{ background: APP.bg }}>sort: isim</option>
          </select>
        </div>

        {/* table */}
        <div style={{
          marginTop: 20, border: `1px solid ${APP.line}`, borderRadius: 12,
          overflow: 'hidden', background: APP.bg,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 36px',
            padding: '12px 20px', gap: 16,
            borderBottom: `1px solid ${APP.line}`,
            background: APP.panelSoft,
            fontSize: 11, fontFamily: APP.mono,
            color: APP.faint, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            <span>proje</span>
            <span>durum</span>
            <span>oluşturulma</span>
            <span>güncellenme</span>
            <span />
          </div>

          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: APP.faint, fontFamily: APP.mono, fontSize: 13 }}>
              → yükleniyor<span style={{ animation: 'blink 1s infinite' }}>▋</span>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: 40, textAlign: 'center', color: '#ff7a6e', fontFamily: APP.mono, fontSize: 13 }}>
              [err] {error}
            </div>
          )}

          {!loading && !error && filtered.map((p, i) => (
            <div
              key={p.id}
              onClick={() => navigate(`/workspace/${p.id}`)}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 60px',
                padding: '16px 20px', gap: 16, alignItems: 'center',
                borderBottom: i < filtered.length - 1 ? `1px solid ${APP.hairline}` : 'none',
                cursor: 'pointer', transition: 'background .15s',
                background: hoveredId === p.id ? 'rgba(255,255,255,0.02)' : 'transparent',
              }}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div>
                <div style={{ fontSize: 14, color: APP.fg, fontWeight: 500, letterSpacing: '-0.01em' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, marginTop: 3 }}>
                  {p.id.slice(-8)}
                </div>
              </div>
              <div>
                <Chip color={statusColor[p.status] ?? APP.faint} border={p.status === 'running' ? APP.accentDim : APP.line}>
                  <Dot color={statusColor[p.status] ?? APP.faint} size={5} glow={p.status === 'running'} />
                  {statusLabel[p.status] ?? p.status}
                </Chip>
              </div>
              <div style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>{timeAgo(p.created_at)}</div>
              <div style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>{timeAgo(p.updated_at)}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                {hoveredId === p.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                    title="Projeyi sil"
                    style={{
                      background: 'transparent', border: `1px solid rgba(255,100,100,0.3)`,
                      color: '#ff7a6e', borderRadius: 6, cursor: 'pointer',
                      width: 24, height: 24, display: 'grid', placeItems: 'center',
                      fontSize: 14, lineHeight: 1, flexShrink: 0,
                      transition: 'all .15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,100,100,0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >×</button>
                )}
                <span style={{ color: APP.faint, fontSize: 18 }}>→</span>
              </div>
            </div>
          ))}

          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: APP.faint, fontFamily: APP.mono, fontSize: 13 }}>
              {projects.length === 0
                ? '→ henüz proje yok. "Yeni proje" ile başla.'
                : '→ eşleşme bulunamadı.'}
            </div>
          )}
        </div>

        <div style={{
          marginTop: 16, display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: APP.faint, fontFamily: APP.mono,
        }}>
          <span>{filtered.length} / {projects.length} proje gösteriliyor</span>
          <button
            onClick={load}
            style={{ background: 'none', border: 'none', color: APP.faint, fontFamily: APP.mono, fontSize: 11, cursor: 'pointer' }}
          >
            ↺ yenile
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        input::placeholder { color: rgba(237,237,237,0.25); }
      `}</style>
    </div>
  );
}
