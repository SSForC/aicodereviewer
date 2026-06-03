import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const APP = {
  bg: '#0a0a0a',
  bg2: '#0f1210',
  panel: '#0d0d0d',
  panelSoft: '#111313',
  fg: '#ededed',
  dim: 'rgba(237,237,237,0.62)',
  faint: 'rgba(237,237,237,0.38)',
  hairline: 'rgba(255,255,255,0.06)',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',
  accent: '#7dffb3',
  accentDim: 'rgba(125,255,179,0.12)',
  warn: '#ffc861',
  err: '#ff7a6e',
  sans: '"Inter Tight", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

export const Logo = ({ size = 22, withWordmark = true, version = 'v0.3.1' }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        background: APP.fg,
        color: APP.bg,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.55,
        letterSpacing: '-0.04em',
        fontFamily: APP.sans,
      }}
    >
      r
    </div>
    {withWordmark && (
      <>
        <span style={{ fontWeight: 500, letterSpacing: '-0.02em', fontFamily: APP.sans }}>revu</span>
        {version && (
          <span
            style={{
              fontSize: 11,
              color: APP.faint,
              fontFamily: APP.mono,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {version}
          </span>
        )}
      </>
    )}
  </div>
);

const DEFAULT_PROFILE_ITEMS = [
  { label: 'Dashboard', action: 'dashboard' },
  { label: 'Profilim', action: 'profile' },
  { label: 'Çıkış yap', action: 'logout' },
];

export const AppTopBar = ({
  project,
  user = 'seda.k',
  children,
  profileItems = DEFAULT_PROFILE_ITEMS,
  onLogoClick,
}) => {
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const goHome = () => {
    setMenuOpen(false);
    if (onLogoClick) {
      onLogoClick();
      return;
    }
    navigate('/dashboard');
  };

  const handleProfileAction = (item) => {
    setMenuOpen(false);
    if (item.action === 'dashboard') navigate('/dashboard');
    else if (item.action === 'profile') navigate('/profile');
    else if (item.action === 'logout') item.onClick?.();
    else if (item.onClick) item.onClick();
  };

  const initials = (user || 'S')
    .trim()
    .split(/[^\w]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'S';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: `1px solid ${APP.line}`,
        background: APP.bg,
        fontFamily: APP.sans,
        flexShrink: 0,
        position: 'relative',
        zIndex: 40,
      }}
    >
      <button
        type="button"
        onClick={goHome}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          background: 'transparent',
          border: 'none',
          color: APP.fg,
          padding: 0,
          cursor: 'pointer',
          fontFamily: APP.sans,
        }}
        title="Ana sayfa"
      >
        <Logo />
        {project && (
          <>
            <span style={{ color: APP.faint, fontFamily: APP.mono, fontSize: 13 }}>/</span>
            <span style={{ fontSize: 13, color: APP.dim, fontFamily: APP.mono }}>{user}</span>
            <span style={{ color: APP.faint, fontFamily: APP.mono, fontSize: 13 }}>/</span>
            <span style={{ fontSize: 13, color: APP.fg, fontFamily: APP.mono }}>{project}</span>
            <span
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                background: APP.accentDim,
                color: APP.accent,
                fontFamily: APP.mono,
                letterSpacing: '0.05em',
              }}
            >
              ● running
            </span>
          </>
        )}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {children}

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: 'transparent',
              border: `1px solid ${menuOpen ? APP.lineStrong : APP.line}`,
              borderRadius: 999,
              padding: '4px 10px 4px 4px',
              color: APP.fg,
              cursor: 'pointer',
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={user}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #7dffb3, #4a9fff)',
                display: 'grid',
                placeItems: 'center',
                color: APP.bg,
                fontWeight: 700,
                fontSize: 11,
                fontFamily: APP.mono,
              }}
            >
              {initials}
            </span>
            <span style={{ fontSize: 13, color: APP.dim, fontFamily: APP.mono }}>{user}</span>
            <span style={{ color: APP.faint, fontSize: 11 }}>▾</span>
          </button>

          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 10px)',
                minWidth: 220,
                padding: 8,
                background: APP.panel,
                border: `1px solid ${APP.line}`,
                borderRadius: 14,
                boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              }}
            >
              <div
                style={{
                  padding: '10px 10px 12px',
                  borderBottom: `1px solid ${APP.line}`,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: 12, color: APP.fg, fontWeight: 500 }}>{user}</div>
                <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, marginTop: 4 }}>
                  oturum açık
                </div>
              </div>

              {profileItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleProfileAction(item)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: item.action === 'logout' ? APP.err : APP.fg,
                    borderRadius: 10,
                    padding: '10px 10px',
                    cursor: 'pointer',
                    fontFamily: APP.sans,
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Chip = ({ children, color = APP.dim, bg = 'transparent', border = APP.line, mono = true, style = {} }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 9px',
      borderRadius: 4,
      background: bg,
      color,
      border: `1px solid ${border}`,
      fontSize: 11,
      fontFamily: mono ? APP.mono : APP.sans,
      letterSpacing: '0.02em',
      ...style,
    }}
  >
    {children}
  </span>
);

export const Dot = ({ color = APP.accent, size = 6, glow = true }) => (
  <span
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      boxShadow: glow ? `0 0 8px ${color}` : 'none',
      flexShrink: 0,
    }}
  />
);
