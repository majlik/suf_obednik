import React, { useState, useEffect } from 'react';
import type { ParsedMeal } from '@/utils/meal-parser';
import type { CachedMealData, ImageResult } from '@/utils/image-search';

interface Props {
  meal: ParsedMeal;
}

export const MealBadge: React.FC<Props> = ({ meal }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [mealData, setMealData] = useState<CachedMealData | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [cycling, setCycling] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [customSearchQuery, setCustomSearchQuery] = useState<string>('');
  const [isEditingSearch, setIsEditingSearch] = useState<boolean>(false);
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);

  const fetchMeal = (forceRefresh = false, customQuery?: string) => {
    setLoading(true);
    setImageLoadError(false);
    chrome.runtime.sendMessage(
      {
        type: 'SEARCH_MEAL',
        cleanName: meal.cleanName,
        searchTiers: meal.searchTiers,
        forceRefresh,
        customQuery,
      },
      (response) => {
        setLoading(false);
        setRefreshing(false);
        if (response && response.success && response.data) {
          setMealData(response.data);
          if (customQuery) {
            setIsEditingSearch(false);
          }
        }
      }
    );
  };

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setImageLoadError(false);

    chrome.runtime.sendMessage(
      {
        type: 'SEARCH_MEAL',
        cleanName: meal.cleanName,
        searchTiers: meal.searchTiers,
        forceRefresh: false,
      },
      (response) => {
        if (!isMounted) return;
        setLoading(false);
        if (response && response.success && response.data) {
          setMealData(response.data);
        }
      }
    );

    return () => {
      isMounted = false;
    };
  }, [meal.cleanName]);

  const handleCycleImage = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!mealData || mealData.images.length <= 1) return;

    setCycling(true);
    setImageLoadError(false);
    chrome.runtime.sendMessage(
      {
        type: 'CYCLE_MEAL_IMAGE',
        cleanName: meal.cleanName,
      },
      (response) => {
        setCycling(false);
        if (response && response.success && response.data) {
          setMealData(response.data);
        }
      }
    );
  };

  const handleForceRefresh = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRefreshing(true);
    fetchMeal(true);
  };

  const handleCustomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSearchQuery.trim()) return;
    setRefreshing(true);
    fetchMeal(true, customSearchQuery.trim());
  };

  const currentImage: ImageResult | undefined = mealData?.images?.[mealData.selectedIndex || 0];
  const hasImages = !!(
    mealData &&
    mealData.images &&
    mealData.images.length > 0 &&
    !mealData.isFallback &&
    !imageLoadError
  );

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}>
      {/* Thumbnail Box */}
      <div
        onClick={() => setModalOpen(true)}
        title={hasImages ? `Kliknite pre detail: ${meal.cleanName}` : 'Kliknite pre možnosti vyhľadania fotky'}
        style={{
          width: '74px',
          height: '54px',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#f8fafc',
          position: 'relative',
          cursor: 'pointer',
          boxShadow: '0 2px 5px rgba(0,0,0,0.12)',
          border: hasImages ? '1.5px solid #94a3b8' : '1.5px dashed #cbd5e1',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.18)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 2px 5px rgba(0,0,0,0.12)';
        }}
      >
        {loading ? (
          <div
            style={{
              fontSize: '11px',
              color: '#64748b',
              fontWeight: 600,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            <span style={{ fontSize: '15px' }}>🍲</span>
            <span style={{ fontSize: '10px' }}>hľadám...</span>
          </div>
        ) : hasImages && currentImage ? (
          <>
            <img
              src={currentImage.thumbnail || currentImage.url}
              alt={meal.cleanName}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
              onError={(e) => {
                console.warn('[MealBadge] Image load failed');
                setImageLoadError(true);
              }}
            />
            {/* Number of alternative photos badge */}
            {mealData.images.length > 1 && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '2px',
                  backgroundColor: 'rgba(15, 23, 42, 0.75)',
                  color: '#fff',
                  fontSize: '9px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  fontWeight: 'bold',
                }}
              >
                {mealData.selectedIndex + 1}/{mealData.images.length}
              </span>
            )}
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
            }}
          >
            <span style={{ fontSize: '18px' }}>🍽️</span>
            <span style={{ fontSize: '9px', color: '#64748b', fontWeight: 600 }}>+ fotka</span>
          </div>
        )}

        {/* Small quick-refresh button on thumbnail hover */}
        {!loading && (
          <button
            onClick={handleForceRefresh}
            title="Vyhľadať obrázok znova"
            style={{
              position: 'absolute',
              top: '2px',
              left: '2px',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.85)',
              border: 'none',
              padding: 0,
              fontSize: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: 0.7,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
          >
            🔄
          </button>
        )}
      </div>

      {/* Lightbox / Modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              maxWidth: '520px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
              border: '1px solid #e2e8f0',
              fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            }}
          >
            {/* Modal Image Header */}
            <div style={{ position: 'relative', width: '100%', height: '280px', backgroundColor: '#0f172a' }}>
              {hasImages && currentImage ? (
                <img
                  src={currentImage.url}
                  alt={meal.cleanName}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    gap: '12px',
                  }}
                >
                  <span style={{ fontSize: '48px' }}>🍽️</span>
                  <span style={{ fontSize: '14px', color: '#cbd5e1' }}>Pre toto jedlo sa nenašla fotografia</span>
                </div>
              )}

              {/* Close Button */}
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Details */}
            <div style={{ padding: '20px' }}>
              <h3
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '17px',
                  fontWeight: 700,
                  color: '#1e293b',
                  lineHeight: '1.35',
                }}
              >
                {meal.cleanName}
              </h3>

              <div style={{ marginBottom: '10px' }}>
                <span
                  style={{
                    backgroundColor: meal.category === 'soup' ? '#ecfdf5' : '#eff6ff',
                    color: meal.category === 'soup' ? '#047857' : '#1d4ed8',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {meal.category === 'soup' ? '🥣 Polievka' : '🍽️ Hlavné jedlo'}
                </span>
                {currentImage?.source === 'dobruchut' && (
                  <span
                    style={{
                      marginLeft: '6px',
                      backgroundColor: '#fef2f2',
                      color: '#b91c1c',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Zdroj: DobrúChuť.sk
                  </span>
                )}
              </div>

              {/* Allergens badges */}
              {meal.allergens.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    Alergény v pokrme:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {meal.allergens.map((alg) => (
                      <span
                        key={alg.id}
                        title={alg.name}
                        style={{
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          border: '1px solid #fde68a',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {alg.id}. {alg.shortName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Search Box */}
              {isEditingSearch ? (
                <form
                  onSubmit={handleCustomSearch}
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '10px',
                    borderRadius: '8px',
                    marginBottom: '14px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Zadajte výraz pre vyhľadanie receptu na Dobruchut.sk:
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={customSearchQuery}
                      onChange={(e) => setCustomSearchQuery(e.target.value)}
                      placeholder={meal.cleanName.split(',')[0]}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        fontSize: '13px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={refreshing}
                      style={{
                        backgroundColor: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {refreshing ? 'Hľadám...' : 'Hľadať'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingSearch(false)}
                      style={{
                        backgroundColor: '#f1f5f9',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Zrušiť
                    </button>
                  </div>
                </form>
              ) : null}

              {/* Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '12px',
                  borderTop: '1px solid #f1f5f9',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {hasImages && mealData.images.length > 1 && (
                    <span>
                      Fotka {mealData.selectedIndex + 1} z {mealData.images.length}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setCustomSearchQuery(meal.cleanName.split(',')[0]);
                      setIsEditingSearch(!isEditingSearch);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      cursor: 'pointer',
                      fontSize: '11px',
                      textDecoration: 'underline',
                      padding: 0,
                    }}
                  >
                    ✏️ Upraviť hľadanie
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* Next Image Button */}
                  {hasImages && mealData.images.length > 1 && (
                    <button
                      onClick={handleCycleImage}
                      disabled={cycling}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <span>🔄</span>
                      <span>{cycling ? '...' : 'Iná fotka'}</span>
                    </button>
                  )}

                  {/* Force Refresh Button */}
                  <button
                    onClick={handleForceRefresh}
                    disabled={refreshing}
                    title="Znovu spustiť vyhľadávanie na Dobruchut.sk"
                    style={{
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#475569',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <span>⚡</span>
                    <span>{refreshing ? 'Hľadám...' : 'Hľadať znova'}</span>
                  </button>

                  <button
                    onClick={() => setModalOpen(false)}
                    style={{
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '6px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Hotovo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
