import { useState, useEffect } from 'react';

function App() {
  const [cachedCount, setCachedCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' }, (res) => {
      if (res && typeof res.count === 'number') {
        setCachedCount(res.count);
      }
    });
  }, []);

  const handleClearCache = () => {
    setClearing(true);
    chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, (res) => {
      setClearing(false);
      if (res && res.success) {
        setCachedCount(0);
        setMessage('Vyrovnávacia pamäť bola vyčistená.');
        setTimeout(() => setMessage(''), 3000);
      }
    });
  };

  return (
    <div
      style={{
        width: '320px',
        padding: '16px',
        fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
        color: '#1e293b',
        boxSizing: 'border-box',
        backgroundColor: '#ffffff',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
          }}
        >
          🍽️
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
            SUF obedník
          </h2>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Školská jedáleň (Apetit / phpBox)
          </div>
        </div>
      </div>

      {/* Target status card */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#22c55e',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#166534' }}>Rozšírenie je aktívne</span>
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
          Podporovaný portál:{' '}
          <a
            href="http://194.160.223.198/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
          >
            194.160.223.198
          </a>
        </div>
      </div>

      {/* Cache management */}
      <div
        style={{
          backgroundColor: '#fafaf9',
          border: '1px solid #e7e5e4',
          borderRadius: '8px',
          padding: '10px 12px',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#44403c' }}>Uložené jedlá v pamäti:</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0c0a09' }}>
            {cachedCount !== null ? `${cachedCount} jedál` : '...'}
          </span>
        </div>

        <button
          onClick={handleClearCache}
          disabled={clearing || cachedCount === 0}
          style={{
            marginTop: '8px',
            width: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid #d6d3d1',
            borderRadius: '6px',
            padding: '6px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#57534e',
            cursor: cachedCount === 0 ? 'not-allowed' : 'pointer',
            opacity: cachedCount === 0 ? 0.6 : 1,
            transition: 'background 0.15s ease',
          }}
        >
          {clearing ? 'Prebieha čistenie...' : '🔄 Obnoviť všetky fotky (vymazať cache)'}
        </button>

        {message && (
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '6px', textAlign: 'center' }}>
            {message}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div
        style={{
          fontSize: '11px',
          color: '#475569',
          lineHeight: '1.45',
          backgroundColor: '#f1f5f9',
          padding: '10px',
          borderRadius: '8px',
        }}
      >
        <strong>Ako to funguje:</strong>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
          <li>Náhľad jedla sa automaticky vloží do riadku obedov.</li>
          <li>Kliknutím na obrázok otvoríte zväčšenú fotografiu a zoznam alergénov.</li>
          <li>Ak fotka nesedí, tlačidlom <em>Iná fotka</em> prepnete ďalší nájdený výsledok.</li>
        </ul>
      </div>

      <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '10px', color: '#94a3b8' }}>
        Verzia 1.0.0 • Vyrobené pre rodičov
      </div>
    </div>
  );
}

export default App;
