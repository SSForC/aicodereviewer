import { useNavigate } from 'react-router-dom';
import { APP, AppTopBar, Chip, Dot, Logo } from '../tokens.jsx';
import { logout, getUser } from '../api/auth.js';

const cardStyle = {
  background: APP.panelSoft,
  border: `1px solid ${APP.line}`,
  borderRadius: 16,
  padding: 20,
};

export default function Profile() {
  const navigate = useNavigate();
  const user = getUser();
  const userLabel = user?.username ?? user?.email ?? 'profil';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', background: APP.bg, color: APP.fg, fontFamily: APP.sans }}>
      <AppTopBar
        user={userLabel}
        profileItems={[
          { label: 'Dashboard', action: 'dashboard' },
          { label: 'Profilim', action: 'profile' },
          { label: 'Çıkış yap', action: 'logout', onClick: handleLogout },
        ]}
      >
        <Chip color={APP.accent} border={APP.accentDim}>
          <Dot /> account
        </Chip>
      </AppTopBar>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 24px 72px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'end', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
              <span style={{ color: APP.accent }}>##</span> profil
            </div>
            <h1 style={{ margin: 0, fontSize: 'clamp(36px, 5vw, 58px)', fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 1 }}>
              Hesabın.
            </h1>
            <p style={{ marginTop: 12, color: APP.dim, maxWidth: 620, lineHeight: 1.6 }}>
              Buradan hesap bilgilerine bakabilir, dashboard'a geri dönebilir ya da oturumu kapatabilirsin.
            </p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: APP.fg,
              color: APP.bg,
              border: 'none',
              padding: '12px 18px',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: APP.sans,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Dashboard'a dön
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #7dffb3, #4a9fff)',
                display: 'grid',
                placeItems: 'center',
                color: APP.bg,
                fontWeight: 700,
                fontSize: 22,
              }}>
                {(userLabel || 'P').slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{userLabel}</div>
                <div style={{ fontSize: 12, color: APP.faint, fontFamily: APP.mono, marginTop: 4 }}>active session</div>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
              <div style={{ padding: 12, border: `1px solid ${APP.line}`, borderRadius: 12, background: APP.bg }}>
                <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, textTransform: 'uppercase', letterSpacing: '0.1em' }}>kullanıcı</div>
                <div style={{ marginTop: 6, fontSize: 14 }}>{user?.username ?? '—'}</div>
              </div>
              <div style={{ padding: 12, border: `1px solid ${APP.line}`, borderRadius: 12, background: APP.bg }}>
                <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, textTransform: 'uppercase', letterSpacing: '0.1em' }}>e-posta</div>
                <div style={{ marginTop: 6, fontSize: 14 }}>{user?.email ?? '—'}</div>
              </div>
              <div style={{ padding: 12, border: `1px solid ${APP.line}`, borderRadius: 12, background: APP.bg }}>
                <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, textTransform: 'uppercase', letterSpacing: '0.1em' }}>durum</div>
                <div style={{ marginTop: 6, fontSize: 14, color: APP.accent }}>oturum açık</div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              style={{
                marginTop: 18,
                width: '100%',
                background: 'transparent',
                color: APP.err,
                border: `1px solid rgba(255,122,110,0.3)`,
                padding: '11px 14px',
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: APP.sans,
                fontSize: 14,
              }}
            >
              Çıkış yap
            </button>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                hızlı erişim
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
                {[
                  { title: 'Dashboard', desc: 'Projelerini ve pod durumunu gör', action: () => navigate('/dashboard') },
                  { title: 'Workspace', desc: 'Aktif projene geri dön', action: () => navigate('/dashboard') },
                  { title: 'Oturum', desc: 'Güvenli çıkış yap', action: handleLogout },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={item.action}
                    style={{
                      padding: 16,
                      textAlign: 'left',
                      background: APP.bg,
                      border: `1px solid ${APP.line}`,
                      borderRadius: 14,
                      cursor: 'pointer',
                      color: APP.fg,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: APP.faint, lineHeight: 1.5 }}>{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: APP.faint, fontFamily: APP.mono, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                güvenlik notu
              </div>
              <div style={{ marginTop: 12, color: APP.dim, lineHeight: 1.7, fontSize: 14 }}>
                Hesap menüsüne ileride profil düzenleme, tema seçimi, güvenlik anahtarları ve bağlı cihazlar gibi bölümler ekleyebiliriz.
                Şimdilik bu sayfa, menü akışını ve logout davranışını doğrulamak için kullanışlı bir merkez.
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, color: APP.faint, fontFamily: APP.mono, fontSize: 12 }}>
                <Logo size={18} withWordmark={false} />
                revu account shell
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
