const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const PREFIX = `${BASE}/api/v1`;

function getTokens() {
  return {
    access: localStorage.getItem('access_token'),
    refresh: localStorage.getItem('refresh_token'),
  };
}

function saveTokens(access, refresh) {
  localStorage.setItem('access_token', access);
  if (refresh) localStorage.setItem('refresh_token', refresh);
}

function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
}

// FastAPI / Pydantic hata yanıtlarını okunabilir tek bir mesaja çevirir.
// - 422: detail bir array of {loc, msg, type} -> her satırı "alan: mesaj" yapar
// - 400/401/409 vb: detail düz string
// - fallback: data.message ya da genel mesaj
function extractErrorMessage(data, status) {
  const detail = data?.detail;

  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field =
          Array.isArray(e?.loc) && e.loc.length > 0
            ? e.loc[e.loc.length - 1] // genelde "body" sonrası gerçek alan adı
            : null;
        const message = e?.msg ?? 'Geçersiz değer';
        return field ? `${field}: ${message}` : message;
      })
      .join('\n');
  }

  if (typeof detail === 'string') return detail;
  if (typeof data?.message === 'string') return data.message;
  if (typeof data === 'string' && data.trim()) return data;

  return `Bir hata oluştu (${status}).`;
}

async function tryRefresh() {
  const { refresh } = getTokens();
  if (!refresh) return false;
  try {
    const res = await fetch(`${PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function apiRequest(method, path, body, { auth = true, retry = true } = {}) {
  const { access } = getTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (auth && access) headers['Authorization'] = `Bearer ${access}`;

  const res = await fetch(`${PREFIX}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRequest(method, path, body, { auth, retry: false });
    clearTokens();
    window.location.href = '/login';
    return null;
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const error = new Error(extractErrorMessage(data, res.status));
    error.status = res.status;   // çağıran taraf isterse status'a göre dallanabilir
    error.detail = data?.detail; // ham detail de erişilebilir kalsın
    throw error;
  }

  return data;
}

export function wsUrl(path) {
  const base = BASE.replace(/^http/, 'ws');
  return `${base}/api/v1${path}`;
}

export { saveTokens, clearTokens, getTokens };