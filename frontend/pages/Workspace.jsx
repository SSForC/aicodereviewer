import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { APP, AppTopBar, Chip, Dot } from '../tokens.jsx';
import {
  getProject,
  startProject,
  stopProject,
  listFiles,
  readFile,
  writeFile,
  createDirectory,
  execCommand,
} from '../api/projects.js';
import { runAgent, createAgentStream, createLogsStream } from '../api/agent.js';
import { cloneGithubRepo } from '../api/github.js';
import { logout, getUser } from '../api/auth.js';

const ideBtn = {
  background: 'transparent', color: APP.fg, border: `1px solid ${APP.line}`,
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
  fontFamily: APP.sans, fontSize: 13, fontWeight: 500,
};

function toApiPath(path = '') {
  return path ? `/${path}` : '/';
}

function normalizeWorkspacePath(input = '') {
  const cleaned = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!cleaned) return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function getFilename(path = '') {
  const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'file.txt';
}

function collectWorkspacePaths(nodes = [], output = []) {
  nodes.forEach((node) => {
    output.push(node.path);
    if (node.children?.length) {
      collectWorkspacePaths(node.children, output);
    }
  });
  return output;
}

function hasPathEnding(nodes = [], suffixes = []) {
  const paths = collectWorkspacePaths(nodes).map((p) => p.toLowerCase());
  return paths.some((p) => suffixes.some((suffix) => p.endsWith(suffix)));
}

function buildPreviewUrl(baseUrl = '', path = '') {
  if (!baseUrl) return '';
  const cleanedPath = String(path || '').replace(/^\/+/, '');
  if (!cleanedPath || cleanedPath === 'index.html') {
    return baseUrl.replace(/\/+$/, '');
  }
  return `${baseUrl.replace(/\/+$/, '')}/${cleanedPath}`;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function shellQuote(value = '') {
  const text = String(value);
  if (!text) return '""';
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function findFirstPathEnding(nodes = [], suffixes = []) {
  const paths = collectWorkspacePaths(nodes);
  return paths.find((path) => suffixes.some((suffix) => path.toLowerCase().endsWith(suffix))) ?? '';
}

function getRunHint(nodes = [], activePath = '') {
  const normalizedActivePath = String(activePath || '').toLowerCase();
  const activeIsPython = normalizedActivePath.endsWith('.py');
  const firstPythonFile = findFirstPathEnding(nodes, ['.py']);
  const runPythonTarget = activeIsPython ? activePath : firstPythonFile;

  if (runPythonTarget) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: `python ${shellQuote(runPythonTarget)}`,
      description: 'Python dosyasını çalıştır. İstersen py_compile ile sözdizimi kontrolü de yapabilirsin.',
    };
  }

  if (hasPathEnding(nodes, ['/package.json', '/vite.config.js', '/vite.config.ts'])) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: 'npm run dev -- --host 0.0.0.0',
      description: 'Node/Vite projesi tespit edildi; dev sunucusunu çalıştır.',
    };
  }

  if (hasPathEnding(nodes, ['/requirements.txt', '/pyproject.toml'])) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: 'python main.py',
      description: 'Python projesi tespit edildi; main.py çalıştırmayı dene.',
    };
  }

  if (hasPathEnding(nodes, ['/go.mod'])) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: 'go run .',
      description: 'Go projesi tespit edildi.',
    };
  }

  if (hasPathEnding(nodes, ['/cargo.toml'])) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: 'cargo run',
      description: 'Rust projesi tespit edildi.',
    };
  }

  if (hasPathEnding(nodes, ['/pom.xml'])) {
    return {
      mode: 'command',
      label: 'Çalıştır',
      command: 'mvn test',
      description: 'Java/Maven projesi tespit edildi.',
    };
  }

  return {
    mode: 'command',
    label: 'Çalıştır',
    command: 'python main.py',
    description: 'Python dosyası seç veya komutu değiştir. Çıktı terminal panelinde görünür.',
  };
}

function createTreeNodes(flatList = [], basePath = '') {
  return flatList.map((item) => {
    const path = basePath ? `${basePath}/${item.name}` : item.name;
    if (item.is_dir) {
      return {
        name: item.name,
        path,
        type: 'directory',
        children: [],
        loaded: false,
        loading: false,
      };
    }
    return { name: item.name, path, type: 'file' };
  });
}

function updateDirectory(nodes, targetPath, updater) {
  return nodes.map((node) => {
    if (node.type === 'directory' && node.path === targetPath) {
      return updater(node);
    }
    if (node.type === 'directory' && node.children?.length) {
      return { ...node, children: updateDirectory(node.children, targetPath, updater) };
    }
    return node;
  });
}

// ─── GitHub import modal ──────────────────────────────────────
function GitHubModal({ onClose, onImport }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.match(/^https?:\/\/|^git@/)) {
      setError('Geçerli bir Git URL girin (https:// veya git@...)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onImport(trimmed);
      onClose();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 440, padding: 28,
        background: APP.panel, border: `1px solid ${APP.line}`,
        borderRadius: 16, fontFamily: APP.sans,
      }}>
        <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
          <span style={{ color: APP.accent }}>◑</span> GitHub import
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>repo URL</span>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/kullanici/repo"
              style={{
                padding: '11px 13px', background: APP.bg,
                border: `1px solid ${APP.line}`, color: APP.fg,
                borderRadius: 9, fontFamily: APP.mono, fontSize: 13, outline: 'none',
              }}
            />
          </label>
          <div style={{ fontSize: 12, color: APP.faint, fontFamily: APP.mono, lineHeight: 1.6 }}>
            → public repolar için token gerekmez.<br />
            → private için önce pod içinde SSH anahtarı kur.
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#ff7a6e', fontFamily: APP.mono }}>[err] {error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              padding: '9px 16px', background: 'transparent', border: `1px solid ${APP.line}`,
              color: APP.dim, borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13,
            }}>İptal</button>
            <button type="submit" disabled={loading || !url.trim()} style={{
              padding: '9px 16px', background: APP.fg, border: 'none',
              color: APP.bg, borderRadius: 8, cursor: 'pointer', fontFamily: APP.sans, fontSize: 13, fontWeight: 500,
              opacity: (loading || !url.trim()) ? 0.6 : 1,
            }}>
              {loading ? 'Clone ediliyor…' : 'Import et →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────
function PathActionModal({
  title,
  description,
  confirmLabel,
  initialPath,
  pathLabel,
  pathPlaceholder,
  showContent = false,
  initialContent = '',
  contentLabel = 'içerik',
  contentPlaceholder = '',
  onClose,
  onSubmit,
}) {
  const [path, setPath] = useState(initialPath);
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath || normalizedPath === '/') {
      setError('Geçerli bir yol girin.');
      return;
    }

    try {
      setError('');
      await onSubmit(normalizedPath, content);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '92vw',
          padding: 28,
          background: APP.panel,
          border: `1px solid ${APP.line}`,
          borderRadius: 16,
          fontFamily: APP.sans,
        }}
      >
        <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
          <span style={{ color: APP.accent }}>◐</span> {title}
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: APP.dim, lineHeight: 1.6 }}>
          {description}
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>{pathLabel}</span>
            <input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={pathPlaceholder}
              style={{
                padding: '11px 13px',
                background: APP.bg,
                border: `1px solid ${APP.line}`,
                color: APP.fg,
                borderRadius: 9,
                fontFamily: APP.mono,
                fontSize: 13,
                outline: 'none',
              }}
            />
          </label>
          {showContent && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>{contentLabel}</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={contentPlaceholder}
                rows={11}
                style={{
                  padding: '11px 13px',
                  background: APP.bg,
                  border: `1px solid ${APP.line}`,
                  color: APP.fg,
                  borderRadius: 9,
                  fontFamily: APP.mono,
                  fontSize: 13,
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </label>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff7a6e', fontFamily: APP.mono }}>[err] {error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 16px',
                background: 'transparent',
                border: `1px solid ${APP.line}`,
                color: APP.dim,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: APP.sans,
                fontSize: 13,
              }}
            >
              İptal
            </button>
            <button
              type="submit"
              style={{
                padding: '9px 16px',
                background: APP.fg,
                border: 'none',
                color: APP.bg,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: APP.sans,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CommandModal({
  title,
  description,
  initialCommand,
  onClose,
  onSubmit,
  suggestions = [],
}) {
  const [command, setCommand] = useState(initialCommand);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const normalized = command.trim();
    if (!normalized) {
      setError('Komut boş olamaz.');
      return;
    }

    try {
      setError('');
      await onSubmit(normalized);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '92vw',
          padding: 28,
          background: APP.panel,
          border: `1px solid ${APP.line}`,
          borderRadius: 16,
          fontFamily: APP.sans,
        }}
      >
        <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>
          <span style={{ color: APP.accent }}>◔</span> {title}
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: APP.dim, lineHeight: 1.6 }}>
          {description}
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: APP.dim, fontFamily: APP.mono }}>komut</span>
            <textarea
              autoFocus
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={4}
              placeholder="npm run dev -- --host 0.0.0.0"
              style={{
                padding: '11px 13px',
                background: APP.bg,
                border: `1px solid ${APP.line}`,
                color: APP.fg,
                borderRadius: 9,
                fontFamily: APP.mono,
                fontSize: 13,
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </label>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCommand(item)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: `1px solid ${APP.line}`,
                    background: APP.bg,
                    color: APP.dim,
                    cursor: 'pointer',
                    fontFamily: APP.mono,
                    fontSize: 11,
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff7a6e', fontFamily: APP.mono }}>[err] {error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 16px',
                background: 'transparent',
                border: `1px solid ${APP.line}`,
                color: APP.dim,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: APP.sans,
                fontSize: 13,
              }}
            >
              İptal
            </button>
            <button
              type="submit"
              style={{
                padding: '9px 16px',
                background: APP.fg,
                border: 'none',
                color: APP.bg,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: APP.sans,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Çalıştır
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkspaceEmpty({
  project,
  userLabel,
  profileItems,
  onStart,
  onGitHubImport,
  pendingMsg,
  onPendingMsg,
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [showGithub, setShowGithub] = useState(false);

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setStartError('');
    try {
      await onStart();
      // parent will poll and re-render; keep starting=true until then
    } catch (err) {
      setStartError(err.message);
      setStarting(false);
    }
  };

  const handleInputSubmit = async () => {
    if (!pendingMsg.trim()) return;
    await handleStart();
  };

  const handleGitHub = async (url) => {
    await onGitHubImport(url);
  };

  const options = [
    { icon: '◐', t: "Pod'u başlat", d: "Kubernetes namespace'ini ayağa kaldır", k: 'start' },
    { icon: '◑', t: "GitHub'dan import et", d: 'Public veya private repo — git clone', k: 'github' },
    { icon: '◒', t: 'ZIP dosyası yükle', d: 'Yakında geliyor', k: 'zip', soon: true },
    { icon: '◓', t: 'Bir URL yapıştır', d: 'Yakında geliyor', k: 'url', soon: true },
  ];

  const handleOption = (k) => {
    if (k === 'start') handleStart();
    else if (k === 'github') setShowGithub(true);
  };

  return (
    <>
      {showGithub && (
        <GitHubModal onClose={() => setShowGithub(false)} onImport={handleGitHub} />
      )}
      <div style={{ background: APP.bg, color: APP.fg, height: '100vh', fontFamily: APP.sans, display: 'flex', flexDirection: 'column' }}>
        <AppTopBar project={project?.name ?? '…'} user={userLabel} profileItems={profileItems}>
          <Chip color={project?.status === 'error' ? APP.err : APP.dim}>
            <Dot color={project?.status === 'error' ? APP.err : APP.faint} size={5} glow={false} />
            pod: {project?.status ?? 'yükleniyor'}
          </Chip>
        </AppTopBar>

        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 32px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: `linear-gradient(${APP.line} 1px, transparent 1px), linear-gradient(90deg, ${APP.line} 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
            maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 65%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 10%, transparent 65%)',
          }} />

          <div style={{ position: 'relative', width: '100%', maxWidth: 760 }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '7px 14px', borderRadius: 999,
                background: APP.accentDim, border: `1px solid ${APP.accentDim}`,
                fontSize: 11, color: APP.accent, fontFamily: APP.mono,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                marginBottom: 24,
              }}>
                <Dot /> agent ready · {project?.id?.slice(-8) ?? '…'} · pod awaiting code
              </div>
              <h1 style={{
                fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 400,
                letterSpacing: '-0.035em', lineHeight: 1.05, margin: 0,
              }}>
                Workspace&apos;ini{' '}
                <span style={{ fontStyle: 'italic', fontWeight: 300, opacity: 0.7 }}>hazırla</span>.
              </h1>
              <p style={{ marginTop: 16, fontSize: 15, color: APP.dim, lineHeight: 1.55, maxWidth: 520, margin: '16px auto 0' }}>
                Ajan izole bir pod&apos;da seni bekliyor. Pod&apos;u başlatmak için aşağıya tıkla.
              </p>
            </div>

            {starting && (
              <div style={{
                marginBottom: 20, padding: '12px 16px',
                background: 'rgba(125,255,179,0.04)', border: `1px solid ${APP.accentDim}`,
                borderRadius: 10, fontFamily: APP.mono, fontSize: 12, color: APP.accent,
                display: 'flex', gap: 10, alignItems: 'center',
              }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◜</span>
                Pod başlatılıyor… Kubernetes namespace hazırlanıyor, lütfen bekle.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {[
                'Merhaba. Ben senin code review ajanınım.',
                "Bu projeye henüz pod başlatılmamış. İlk kartı kullanarak pod'u ayağa kaldır.",
              ].map((t, i) => (
                <div key={i} style={{
                  maxWidth: 560, padding: '12px 16px',
                  background: APP.panelSoft, border: `1px solid ${APP.line}`,
                  borderRadius: 14, borderTopLeftRadius: 4,
                  fontSize: 14, color: APP.dim, lineHeight: 1.55,
                  display: 'flex', gap: 10,
                }}>
                  <span style={{ color: APP.accent, fontFamily: APP.mono, fontSize: 12 }}>◆</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 28 }}>
              {options.map((o) => (
                <button
                  key={o.k}
                  onClick={o.soon ? undefined : () => handleOption(o.k)}
                  disabled={(o.k === 'start' && starting) || o.soon}
                  style={{
                    padding: 18, textAlign: 'left',
                    background: APP.panelSoft, border: `1px solid ${APP.line}`,
                    borderRadius: 12, cursor: o.soon ? 'default' : 'pointer',
                    color: o.soon ? APP.faint : APP.fg, fontFamily: APP.sans,
                    display: 'flex', gap: 14, alignItems: 'flex-start',
                    transition: 'all .2s',
                    opacity: ((o.k === 'start' && starting) || o.soon) ? 0.45 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!o.soon && !(o.k === 'start' && starting)) {
                      e.currentTarget.style.borderColor = APP.lineStrong;
                      e.currentTarget.style.background = '#141414';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = APP.line;
                    e.currentTarget.style.background = APP.panelSoft;
                  }}
                >
                  <span style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: APP.bg, display: 'grid', placeItems: 'center',
                    color: o.soon ? APP.faint : APP.accent, fontSize: 18, flexShrink: 0,
                    border: `1px solid ${APP.line}`,
                  }}>
                    {starting && o.k === 'start' ? '◜' : o.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {o.k === 'start' && starting ? 'Başlatılıyor…' : o.t}
                    </div>
                    <div style={{ fontSize: 12, color: APP.faint, marginTop: 4, fontFamily: APP.mono }}>{o.d}</div>
                  </div>
                  {o.soon
                    ? <span style={{ fontSize: 10, color: APP.faint, fontFamily: APP.mono, background: APP.bg, padding: '2px 6px', borderRadius: 4, border: `1px solid ${APP.line}`, flexShrink: 0 }}>yakında</span>
                    : <span style={{ color: APP.faint, fontSize: 14 }}>→</span>
                  }
                </button>
              ))}
            </div>

            <div style={{
              padding: '14px 16px', background: APP.panelSoft,
              border: `1px solid ${APP.line}`, borderRadius: 14,
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}>
              <span style={{ color: APP.accent, fontFamily: APP.mono, fontSize: 14 }}>$</span>
              <input
                value={pendingMsg}
                onChange={(e) => onPendingMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleInputSubmit()}
                placeholder='ya da ajan ile konuş: "React projemi import et ve auth akışını incele"'
                disabled={starting}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: APP.fg, fontFamily: APP.sans, fontSize: 14,
                }}
              />
              <button
                onClick={handleInputSubmit}
                disabled={starting || !pendingMsg.trim()}
                style={{
                  background: (starting || !pendingMsg.trim()) ? APP.line : APP.fg,
                  color: APP.bg, border: 'none',
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  cursor: (starting || !pendingMsg.trim()) ? 'default' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}
              >↑</button>
            </div>

            {startError && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                background: 'rgba(255,100,100,0.06)',
                border: '1px solid rgba(255,100,100,0.25)',
                borderRadius: 8, fontFamily: APP.mono, fontSize: 12, color: '#ff7a6e',
              }}>
                [err] {startError}
              </div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '10px 24px', borderTop: `1px solid ${APP.line}`,
          fontSize: 11, fontFamily: APP.mono, color: APP.faint, flexShrink: 0,
        }}>
          <span><Dot /> pod: {project?.status ?? '…'} · namespace {project?.id?.slice(-8) ?? '…'}</span>
          <span>context: 0 files · 0 LOC</span>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

// ─── File tree ────────────────────────────────────────────────
function FileTree({ nodes, depth, active, expandedDirs, onToggle, onSelect }) {
  return (
    <div>
      {nodes.map((n, i) => {
        const key = `${depth}-${n.name}-${i}`;
        if (n.type === 'directory') {
          const isExpanded = expandedDirs.has(n.path);
          return (
            <div key={key}>
              <div style={{
                padding: `4px 14px 4px ${14 + depth * 14}px`,
                display: 'flex', alignItems: 'center', gap: 6,
                color: APP.dim, cursor: 'default',
              }}>
                <span style={{ fontSize: 9, color: APP.faint }}>▼</span>
                <span style={{ color: APP.accent, fontSize: 12 }}>▤</span>
                {n.name}
              </div>
              {n.children && (
                <FileTree nodes={n.children} depth={depth + 1} active={active} onSelect={onSelect} />
              )}
            </div>
          );
        }
        const isActive = active === n.path;
        return (
          <div key={key} onClick={() => onSelect(n)} style={{
            padding: `4px 14px 4px ${14 + depth * 14}px`,
            display: 'flex', alignItems: 'center', gap: 6,
            color: isActive ? APP.fg : APP.dim,
            background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
            cursor: 'pointer',
          }}>
            <span style={{ width: 9 }} />
            <span style={{ color: APP.faint, fontSize: 11 }}>◦</span>
            <span style={{ flex: 1 }}>{n.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExplorerTree({ nodes, depth, active, expandedDirs, onToggle, onSelect }) {
  return (
    <div>
      {nodes.map((node) => {
        const isDir = node.type === 'directory';
        const isExpanded = isDir && expandedDirs.has(node.path);
        const isActive = active === node.path;

        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => (isDir ? onToggle(node) : onSelect(node))}
              style={{
                width: '100%',
                background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: 'none',
                textAlign: 'left',
                padding: `4px 14px 4px ${14 + depth * 14}px`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: isActive ? APP.fg : APP.dim,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 9, color: APP.faint }}>
                {isDir ? (isExpanded ? '▾' : '▸') : ''}
              </span>
              <span style={{ color: isDir ? APP.accent : APP.faint, fontSize: 11 }}>
                {isDir ? '▤' : '◦'}
              </span>
              <span style={{ flex: 1 }}>{node.name}</span>
            </button>

            {isDir && isExpanded && node.loading && (
              <div
                style={{
                  padding: `4px 14px 4px ${28 + depth * 14}px`,
                  color: APP.faint,
                  fontSize: 12,
                }}
              >
                yükleniyor...
              </div>
            )}

            {isDir && isExpanded && node.children?.length > 0 && (
              <ExplorerTree
                nodes={node.children}
                depth={depth + 1}
                active={active}
                expandedDirs={expandedDirs}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}

            {isDir && isExpanded && !node.loading && node.loaded && node.children?.length === 0 && (
              <div
                style={{
                  padding: `4px 14px 4px ${28 + depth * 14}px`,
                  color: APP.faint,
                  fontSize: 12,
                }}
              >
                boş klasör
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Full state ───────────────────────────────────────────────
function WorkspaceFull({ project, userLabel, profileItems, onStop, initialMessage }) {
  const projectId = project.id;
  const [files, setFiles] = useState([]);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState('');
  const [activeFile, setActiveFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorStatus, setEditorStatus] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [agentLogs, setAgentLogs] = useState([]);
  const [terminalLines, setTerminalLines] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('agent');
  const [stopping, setStopping] = useState(false);
  const [showCreateFile, setShowCreateFile] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showRunCommand, setShowRunCommand] = useState(false);
  const [runningCommand, setRunningCommand] = useState(false);
  const wsRef = useRef(null);
  const logsWsRef = useRef(null);
  const chatEndRef = useRef(null);
  const initialSent = useRef(false);
  const runHint = useMemo(() => getRunHint(files, activeFile?.path ?? ''), [files, activeFile?.path]);
  const hasUnsavedChanges = editorContent !== fileContent;

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError('');
    try {
      const res = await listFiles(projectId, '/');
      const flat = res.files ?? res ?? [];
      setFiles(createTreeNodes(flat));
      setExpandedDirs(new Set());
    } catch (err) {
      setFilesError(err.message ?? 'Dosyalar yuklenemedi.');
      // pod henüz hazır değil, sessizce geç
    } finally {
      setFilesLoading(false);
    }
  }, [projectId]);

  const createFile = useCallback(async (path, content) => {
    setFilesError('');
    await writeFile(projectId, path, content);
    await loadFiles();
  }, [projectId, loadFiles]);

  const createFolder = useCallback(async (path) => {
    setFilesError('');
    await createDirectory(projectId, path);
    await loadFiles();
  }, [projectId, loadFiles]);

  const runCommand = useCallback(async (command) => {
    if (runningCommand) return;
    setRunningCommand(true);
    setActiveTab('terminal');
    setFilesError('');
    setTerminalLines((prev) => [
      ...prev,
      { t: `$ ${command}`, c: APP.accent },
    ]);

    try {
      const res = await execCommand(projectId, command, 120);
      const lines = [];
      if (res.stdout) {
        res.stdout.split('\n').filter(Boolean).forEach((line) => {
          lines.push({ t: line, c: APP.fg });
        });
      }
      if (res.stderr) {
        res.stderr.split('\n').filter(Boolean).forEach((line) => {
          lines.push({ t: line, c: APP.warn });
        });
      }
      lines.push({
        t: `[exit ${res.exit_code ?? 'ok'}] ${res.command}`,
        c: res.exit_code === 0 ? APP.accent : APP.err,
      });
      setTerminalLines((prev) => [...prev, ...lines]);
      await loadFiles();
    } catch (err) {
      setTerminalLines((prev) => [...prev, { t: `[err] ${err.message}`, c: APP.err }]);
      throw err;
    } finally {
      setRunningCommand(false);
    }
  }, [projectId, loadFiles, runningCommand]);

  const handlePrimaryRun = useCallback(() => {
    setShowRunCommand(true);
  }, []);

  const toggleDirectory = useCallback(async (node) => {
    const isOpen = expandedDirs.has(node.path);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(node.path);
      else next.add(node.path);
      return next;
    });

    if (isOpen || node.loaded || node.loading) return;

    setFiles((prev) => updateDirectory(prev, node.path, (dir) => ({ ...dir, loading: true })));
    try {
      const res = await listFiles(projectId, toApiPath(node.path));
      const flat = res.files ?? res ?? [];
      setFiles((prev) => updateDirectory(prev, node.path, (dir) => ({
        ...dir,
        loaded: true,
        loading: false,
        children: createTreeNodes(flat, node.path),
      })));
    } catch {
      setFiles((prev) => updateDirectory(prev, node.path, (dir) => ({
        ...dir,
        loaded: true,
        loading: false,
        children: [],
      })));
    }
  }, [expandedDirs, projectId]);

  useEffect(() => {
    loadFiles();
    const ws = createLogsStream(projectId);
    logsWsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'logs' && msg.content) {
          const lines = msg.content.split('\n').filter(Boolean);
          setTerminalLines(lines.map((l) => ({ t: l, c: APP.faint })));
        }
      } catch {}
    };
    ws.onerror = () => {
      setTerminalLines((prev) => (prev.length > 0 ? prev : [{ t: 'log stream baglantisi kesildi', c: APP.warn }]));
    };
    return () => {
      ws.close();
      logsWsRef.current = null;
    };
  }, [projectId, loadFiles]);

  useEffect(() => () => {
    if (wsRef.current) wsRef.current.close();
    if (logsWsRef.current) logsWsRef.current.close();
  }, []);

  // Pre-fill chat input with pending message from empty state
  useEffect(() => {
    if (initialMessage && !initialSent.current) {
      initialSent.current = true;
      setChatInput(initialMessage);
    }
  }, [initialMessage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const openFile = async (node) => {
    setActiveFile(node);
    try {
      const res = await readFile(projectId, toApiPath(node.path));
      const content = res.content ?? '';
      setFileContent(content);
      setEditorContent(content);
      setEditorStatus('');
    } catch {
      setFileContent('// dosya okunamadı');
      setEditorContent('// dosya okunamadı');
    }
  };

  const saveCurrentFile = useCallback(async () => {
    if (!activeFile) return;
    setEditorSaving(true);
    setEditorStatus('');
    try {
      await writeFile(projectId, toApiPath(activeFile.path), editorContent);
      setFileContent(editorContent);
      setEditorStatus('Kaydedildi');
      await loadFiles();
    } catch (err) {
      setEditorStatus(err.message ?? 'Kaydedilemedi');
      throw err;
    } finally {
      setEditorSaving(false);
    }
  }, [activeFile, editorContent, loadFiles, projectId]);

  const downloadCurrentFile = useCallback(() => {
    if (!activeFile) return;
    downloadTextFile(getFilename(activeFile.path), editorContent || fileContent || '');
  }, [activeFile, editorContent, fileContent]);

  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || agentRunning) return;
    setChatInput('');
    setChatMessages((prev) => [...prev, { who: 'user', t: msg }]);
    setAgentRunning(true);
    setActiveTab('agent');

    try {
      const res = await runAgent(projectId, msg);
      setSessionId(res.session_id);

      const ws = createAgentStream(res.session_id);
      wsRef.current = ws;

      let stepBuffer = [];
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'step') {
            stepBuffer.push(`→ [${data.node}] ${data.action}`);
            setAgentLogs([...stepBuffer.map((l) => ({ t: l, c: APP.accent }))]);
          } else if (data.type === 'complete') {
            setChatMessages((prev) => [
              ...prev,
              { who: 'agent', t: `Tamamlandı. ${data.total_steps} adım çalıştı.` },
            ]);
            setAgentRunning(false);
            loadFiles();
            ws.close();
          } else if (data.type === 'error') {
            setChatMessages((prev) => [
              ...prev,
              { who: 'agent', t: `[hata] ${data.error ?? 'Agent başarısız oldu.'}` },
            ]);
            setAgentRunning(false);
            ws.close();
          }
        } catch {}
      };
      ws.onerror = () => {
        setAgentRunning(false);
        setChatMessages((prev) => [...prev, { who: 'agent', t: '[hata] WebSocket bağlantısı kesildi.' }]);
      };
    } catch (err) {
      setChatMessages((prev) => [...prev, { who: 'agent', t: `[hata] ${err.message}` }]);
      setAgentRunning(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopProject(projectId);
      onStop();
    } catch {
      setStopping(false);
    }
  };

  const codeLines = fileContent
    ? editorContent.split('\n').map((t, i) => ({ n: i + 1, t }))
    : [];

  const displayedLogs = activeTab === 'agent' ? agentLogs : terminalLines;

  return (
    <div style={{ background: APP.bg, color: APP.fg, height: '100vh', fontFamily: APP.sans, display: 'flex', flexDirection: 'column' }}>
      {showCreateFile && (
        <PathActionModal
          title="Yeni dosya"
          description="Workspace içine yeni bir dosya ekleyelim. Dilersen kök dizine, dilersen alt klasöre yazabilirsin."
          confirmLabel="Dosyayı oluştur"
          initialPath="/index.html"
          pathLabel="dosya yolu"
          pathPlaceholder="/src/index.html"
          showContent
          initialContent={`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Preview</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:40px}
    code{background:#111827;color:#e5e7eb;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <h1>Preview hazır</h1>
  <p>Bu dosya UI üzerinden oluşturuldu.</p>
  <p>Dosya: <code>/index.html</code></p>
</body>
</html>`}
          contentLabel="dosya içeriği"
          contentPlaceholder="HTML, JS, Python..."
          onClose={() => setShowCreateFile(false)}
          onSubmit={async (path, content) => {
            await createFile(path, content);
          }}
        />
      )}

      {showCreateFolder && (
        <PathActionModal
          title="Yeni klasör"
          description="Klasörler boş da olabilir; dosya oluştururken parent klasörleri de otomatik açabiliriz."
          confirmLabel="Klasörü oluştur"
          initialPath="/src"
          pathLabel="klasör yolu"
          pathPlaceholder="/src/components"
          onClose={() => setShowCreateFolder(false)}
          onSubmit={async (path) => {
            await createFolder(path);
          }}
        />
      )}

      {showRunCommand && (
        <CommandModal
          title="Komut çalıştır"
          description={runHint.description}
          initialCommand={runHint.command ?? 'npm test'}
          onClose={() => setShowRunCommand(false)}
          onSubmit={async (command) => {
            await runCommand(command);
          }}
          suggestions={
            runHint.mode === 'command'
              ? [
                  runHint.command,
                  activeFile?.path?.toLowerCase().endsWith('.py') ? `python -m py_compile ${shellQuote(activeFile.path)}` : '',
                  'npm test',
                  'npm run build',
                  'python main.py',
                ].filter((item, index, arr) => item && arr.indexOf(item) === index)
              : ['index.html'].filter(Boolean)
          }
        />
      )}

      <AppTopBar project={project.name} user={userLabel} profileItems={profileItems}>
        <Chip color={APP.accent} border={APP.accentDim}><Dot /> pod: running</Chip>
        {project.preview_url && (
          <a
            href={project.preview_url}
            target="_blank"
            rel="noreferrer"
            style={{ ...ideBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 11 }}>↗</span> Önizleme
          </a>
        )}
        <button
          style={{ ...ideBtn, opacity: stopping ? 0.6 : 1 }}
          onClick={handleStop}
          disabled={stopping}
        >
          {stopping ? 'Durduruluyor…' : 'Durdur'}
        </button>
      </AppTopBar>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr 380px', minHeight: 0 }}>
          {/* FILE TREE */}
          <div style={{ borderRight: `1px solid ${APP.line}`, display: 'flex', flexDirection: 'column', background: APP.bg, overflow: 'hidden' }}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${APP.line}`,
              fontSize: 11, fontFamily: APP.mono, color: APP.faint,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              display: 'flex', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <span>gezgin</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setShowCreateFile(true)}
                  title="Yeni dosya"
                  style={{ background: 'none', border: 'none', color: APP.faint, cursor: 'pointer', fontSize: 14 }}
                >
                  ＋
                </button>
                <button
                  onClick={() => setShowCreateFolder(true)}
                  title="Yeni klasör"
                  style={{ background: 'none', border: 'none', color: APP.faint, cursor: 'pointer', fontSize: 14 }}
                >
                  ⊞
                </button>
                <button
                  onClick={handlePrimaryRun}
                  title="Komut çalıştır"
                  style={{ background: 'none', border: 'none', color: APP.faint, cursor: 'pointer', fontSize: 14 }}
                >
                  ▶
                </button>
                <button onClick={loadFiles} title="yenile" style={{ background: 'none', border: 'none', color: APP.faint, cursor: 'pointer', fontSize: 13 }}>↺</button>
              </div>
            </div>
            <div style={{ padding: '8px 0', fontFamily: APP.mono, fontSize: 13, flex: 1, overflow: 'auto' }}>
              {filesError && (
                <div style={{ padding: 14, color: APP.err, fontSize: 12 }}>
                  {filesError}
              </div>
            )}
            {filesLoading ? (
              <div style={{ padding: 14, color: APP.faint, fontSize: 12 }}>dosyalar yÃ¼kleniyorâ€¦</div>
            ) : files.length > 0 ? (
              <ExplorerTree
                nodes={files}
                depth={0}
                active={activeFile?.path}
                expandedDirs={expandedDirs}
                onToggle={toggleDirectory}
                onSelect={openFile}
              />
            ) : (
              <div style={{ padding: 14, color: APP.faint, fontSize: 12 }}>dosya yok</div>
            )}
          </div>
        </div>

        {/* CODE + LOGS */}
        <div style={{ display: 'flex', flexDirection: 'column', background: APP.bg, minWidth: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', borderBottom: `1px solid ${APP.line}`,
            background: APP.bg, fontFamily: APP.mono, fontSize: 12, flexShrink: 0,
          }}>
            {activeFile ? (
              <div style={{
                padding: '10px 16px',
                borderRight: `1px solid ${APP.line}`,
                borderBottom: `2px solid ${APP.accent}`,
                marginBottom: -1,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {activeFile.name}
              </div>
            ) : (
              <div style={{ padding: '10px 16px', color: APP.faint }}>dosya seçilmedi</div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12 }}>
              {activeFile && (
                <>
                  <button
                    onClick={downloadCurrentFile}
                    style={{
                      ...ideBtn,
                      padding: '6px 10px',
                      fontSize: 12,
                    }}
                  >
                    İndir
                  </button>
                  <button
                    onClick={saveCurrentFile}
                    disabled={!hasUnsavedChanges || editorSaving}
                    style={{
                      ...ideBtn,
                      padding: '6px 10px',
                      fontSize: 12,
                      background: hasUnsavedChanges ? APP.fg : 'transparent',
                      color: hasUnsavedChanges ? APP.bg : APP.faint,
                      opacity: editorSaving ? 0.6 : 1,
                    }}
                  >
                    {editorSaving ? 'Kaydediliyor…' : 'Kaydet'}
                  </button>
                </>
              )}
            </div>
          </div>

          {activeFile && (
            <div style={{
              padding: '8px 16px', borderBottom: `1px solid ${APP.hairline}`,
              display: 'flex', justifyContent: 'space-between',
              fontFamily: APP.mono, fontSize: 11, color: APP.faint, flexShrink: 0,
            }}>
              <span>{activeFile.path}</span>
              <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span>{codeLines.length} satır</span>
                {hasUnsavedChanges && <span style={{ color: APP.warn }}>değişiklik var</span>}
                {editorStatus && <span>{editorStatus}</span>}
              </span>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeFile ? (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1,
                  width: '100%',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: APP.bg,
                  color: APP.fg,
                  fontFamily: APP.mono,
                  fontSize: 13,
                  lineHeight: 1.7,
                  padding: '14px 16px',
                  whiteSpace: 'pre',
                }}
              />
            ) : (
              <div style={{ padding: '20px 16px', color: APP.faint, fontSize: 13 }}>
                Soldaki gezginden bir dosya seç.
              </div>
            )}
          </div>

          {/* log strip */}
          <div style={{
            borderTop: `1px solid ${APP.line}`, background: APP.panel,
            flexShrink: 0, maxHeight: 180, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '0 16px', borderBottom: `1px solid ${APP.line}`,
              display: 'flex', gap: 20, fontFamily: APP.mono, fontSize: 11,
              color: APP.faint, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              {[['agent', 'agent logs'], ['terminal', 'terminal']].map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setActiveTab(k)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0',
                    color: activeTab === k ? APP.fg : APP.faint,
                    borderBottom: activeTab === k ? `1px solid ${APP.accent}` : '1px solid transparent',
                    fontFamily: APP.mono, fontSize: 11,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginBottom: -1,
                  }}
                >{v}</button>
              ))}
            </div>
            <div style={{ padding: '10px 16px', fontFamily: APP.mono, fontSize: 12, lineHeight: 1.75, overflow: 'auto', flex: 1 }}>
              {displayedLogs.length > 0
                ? displayedLogs.map((l, i) => <div key={i} style={{ color: l.c }}>{l.t}</div>)
                : <div style={{ color: APP.faint }}>
                    {activeTab === 'agent' ? '— henüz agent adımı yok' : '— terminal çıktısı yok'}
                  </div>
              }
              {activeTab === 'agent' && agentRunning && (
                <div style={{ color: APP.accent }}>
                  $ <span style={{ animation: 'blink 1s infinite' }}>▋</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AGENT CHAT */}
        <div style={{
          borderLeft: `1px solid ${APP.line}`,
          background: APP.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${APP.line}`,
            display: 'flex', justifyContent: 'space-between',
            fontFamily: APP.mono, fontSize: 11, color: APP.faint,
            letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0,
          }}>
            <span><span style={{ color: APP.accent }}>◆</span> agent</span>
            {sessionId && <span>session · {sessionId.slice(-6)}</span>}
          </div>

          <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {chatMessages.length === 0 && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '92%', padding: '10px 14px',
                background: APP.panelSoft, border: `1px solid ${APP.line}`,
                borderRadius: 14, borderTopLeftRadius: 4, fontSize: 13, lineHeight: 1.55,
              }}>
                <div style={{ fontFamily: APP.mono, fontSize: 10, color: APP.accent, marginBottom: 6, letterSpacing: '0.1em' }}>AGENT</div>
                <div>Merhaba. Kodunuzu incelemeye hazırım. Ne yapmamı istersiniz?</div>
              </div>
            )}

            {chatMessages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.who === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '92%', padding: '10px 14px',
                background: m.who === 'user' ? APP.fg : APP.panelSoft,
                color: m.who === 'user' ? APP.bg : APP.fg,
                border: m.who === 'user' ? 'none' : `1px solid ${APP.line}`,
                borderRadius: 14,
                borderTopRightRadius: m.who === 'user' ? 4 : 14,
                borderTopLeftRadius: m.who === 'user' ? 14 : 4,
                fontSize: 13, lineHeight: 1.55,
              }}>
                {m.who === 'agent' && (
                  <div style={{ fontFamily: APP.mono, fontSize: 10, color: APP.accent, marginBottom: 6, letterSpacing: '0.1em' }}>AGENT</div>
                )}
                <div>{m.t}</div>
              </div>
            ))}

            {agentRunning && (
              <div style={{
                alignSelf: 'flex-start', fontFamily: APP.mono, fontSize: 11,
                color: APP.faint, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px',
              }}>
                <span style={{ display: 'flex', gap: 3 }}>
                  {[0, 200, 400].map((d) => (
                    <span key={d} style={{
                      width: 4, height: 4, borderRadius: '50%', background: APP.accent,
                      animation: `bounceDot 1.4s infinite ${d}ms`,
                    }} />
                  ))}
                </span>
                agent düşünüyor…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: 12, borderTop: `1px solid ${APP.line}`, flexShrink: 0 }}>
            <div style={{
              padding: '10px 12px', background: APP.panelSoft,
              border: `1px solid ${APP.line}`, borderRadius: 12,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ color: APP.accent, fontFamily: APP.mono, fontSize: 13 }}>›</span>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="ajan ile konuş…"
                disabled={agentRunning}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: APP.fg, fontFamily: APP.sans, fontSize: 13,
                }}
              />
              <button
                onClick={sendMessage}
                disabled={agentRunning || !chatInput.trim()}
                style={{
                  background: (agentRunning || !chatInput.trim()) ? APP.line : APP.fg,
                  color: APP.bg, border: 'none',
                  width: 28, height: 28, borderRadius: 8,
                  cursor: agentRunning ? 'wait' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}
              >↑</button>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: APP.faint, fontFamily: APP.mono }}>
              Enter ile gönder
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes bounceDot {
          0%,80%,100% { transform: translateY(0); opacity: .4 }
          40% { transform: translateY(-4px); opacity: 1 }
        }
        @keyframes spin { to { transform: rotate(360deg) } }
        input::placeholder { color: rgba(237,237,237,0.25); }
      `}</style>
    </div>
  );
}

// ─── Page entry ───────────────────────────────────────────────
export default function Workspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [pendingMsg, setPendingMsg] = useState('');
  const pollRef = useRef(null);
  const user = getUser();
  const userLabel = user?.username ?? user?.email ?? 'profil';

  const profileItems = [
    { label: 'Dashboard', action: 'dashboard' },
    { label: 'Profilim', action: 'profile' },
    { label: 'Çıkış yap', action: 'logout', onClick: async () => {
      await logout();
      navigate('/login');
    } },
  ];

  const load = useCallback(async () => {
    try {
      const p = await getProject(projectId);
      setProject(p);
      return p;
    } catch (err) {
      setError(err.message);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await getProject(projectId);
        setProject(p);
        if (p.status === 'running' || p.status === 'error' || p.status === 'stopped') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
    }, 2500);
  };

  const handleStart = async () => {
    try {
      await startProject(projectId);
      startPolling();
    } catch (err) {
      await load();
      throw err;
    }
  };

  const handleGitHubImport = async (url) => {
    if (project?.status !== 'running') {
      await startProject(projectId);
      await new Promise((resolve, reject) => {
        const timer = setInterval(async () => {
          try {
            const p = await getProject(projectId);
            setProject(p);
            if (p.status === 'running') { clearInterval(timer); resolve(); }
            else if (p.status === 'error') { clearInterval(timer); reject(new Error('Pod başlatılamadı')); }
          } catch (e) { clearInterval(timer); reject(e); }
        }, 2500);
      });
    }
    await cloneGithubRepo(projectId, url);
  };

  const handleStop = () => {
    setProject((prev) => prev ? { ...prev, status: 'stopped' } : prev);
    load();
  };

  if (error) {
    return (
      <div style={{ background: APP.bg, color: '#ff7a6e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: APP.mono, fontSize: 14 }}>
        [err] {error} — <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: 'none', color: APP.dim, cursor: 'pointer', fontFamily: APP.mono }}>← dashboard</button>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ background: APP.bg, color: APP.faint, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: APP.mono, fontSize: 13 }}>
        yükleniyor<span style={{ animation: 'blink 1s infinite' }}>▋</span>
        <style>{`@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }`}</style>
      </div>
    );
  }

  if (project.status !== 'running') {
    return (
    <WorkspaceEmpty
      project={project}
      userLabel={userLabel}
      profileItems={profileItems}
      onStart={handleStart}
      onGitHubImport={handleGitHubImport}
      pendingMsg={pendingMsg}
      onPendingMsg={setPendingMsg}
    />
    );
  }

  return (
    <WorkspaceFull
      project={project}
      userLabel={userLabel}
      profileItems={profileItems}
      onStop={handleStop}
      initialMessage={pendingMsg}
    />
  );
}
