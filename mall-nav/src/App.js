    import React, { useEffect, useState, useRef } from 'react';
    import maplibregl from 'maplibre-gl';
    import io from 'socket.io-client';
    import 'maplibre-gl/dist/maplibre-gl.css';

    const socket = io('https://autopin-backend.onrender.com');

    const getNavUpdates = (lat1, lon1, lat2, lon2) => {
        const R = 6371e3; 
        const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
        const distance = Math.round(2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        return { distance, bearing };
    };

    export default function App() {
        const mapContainer = useRef(null);
        const map = useRef(null);
        const [navData, setNavData] = useState({ dist: 0, bearing: 0, car: null, pillar: '' });
        const [toast, setToast] = useState(null); 
        
        //  to track which way the phone is physically pointing
        const [heading, setHeading] = useState(0);

        const userMarker = useRef(null);
        const carMarker = useRef(null);

        const showToast = (message, type = 'success') => {
            setToast({ message, type });
            setTimeout(() => setToast(null), 3500); 
        };

        const handleCallTrigger = async () => {
            try {
                showToast("Ringing! Pick up to save your spot. 📱", "success"); 
                
               const response = await fetch('https://autopin-backend.onrender.com/trigger-call', { method: 'POST' });
                
                if (!response.ok) {
                    showToast("Oops, the call didn't go through.", "error");
                }
            } catch (err) {
                console.error("Call error:", err);
                showToast("Looks like you're offline.", "error");
            }
        };

        //  Compass hardware listener
        useEffect(() => {
            const handleOrientation = (e) => {
                let compassHeading = 0;
                if (e.webkitCompassHeading) {
                    // For iPhones
                    compassHeading = e.webkitCompassHeading;
                } else if (e.absolute && e.alpha !== null) {
                    // For Androids
                    compassHeading = 360 - e.alpha; 
                }
                setHeading(compassHeading);
            };

            // Listen for device rotation
            window.addEventListener('deviceorientationabsolute', handleOrientation);
            window.addEventListener('deviceorientation', handleOrientation);

            return () => {
                window.removeEventListener('deviceorientationabsolute', handleOrientation);
                window.removeEventListener('deviceorientation', handleOrientation);
            };
        }, []);

        useEffect(() => {
            map.current = new maplibregl.Map({
                container: mapContainer.current,
                style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
                center: [77.2090, 28.6139],
                zoom: 16,
                pitch: 60, 
                bearing: 0
            });

            const watchId = navigator.geolocation.watchPosition((pos) => {
                const { latitude, longitude } = pos.coords;
                fetch('https://autopin-backend.onrender.com/update-gps', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: latitude, lng: longitude })
                }).catch(err => console.error(err));

                if (!userMarker.current) {
                    userMarker.current = new maplibregl.Marker({ color: '#00ffff' }).setLngLat([longitude, latitude]).addTo(map.current);
                } else {
                    userMarker.current.setLngLat([longitude, latitude]);
                }

                setNavData(prev => {
                    if (!prev.car) return prev;
                    const updates = getNavUpdates(latitude, longitude, prev.car.lat, prev.car.lng);
                    return { ...prev, dist: updates.distance, bearing: updates.bearing };
                });
            }, null, { enableHighAccuracy: true });

            socket.on('MAP_UPDATE', (data) => {
                setNavData(prev => ({ ...prev, car: { lat: data.lat, lng: data.lng }, pillar: data.pillar }));
                if (carMarker.current) carMarker.current.remove();
                carMarker.current = new maplibregl.Marker({ color: '#ff4d4d' }).setLngLat([data.lng, data.lat]).addTo(map.current);
                map.current.flyTo({ center: [data.lng, data.lat], zoom: 19, speed: 1.2 });
                
                showToast(`Spot saved! Follow the meter below 👇`, "success");
            });

            return () => navigator.geolocation.clearWatch(watchId);
        }, []);

        const isArrived = navData.car && navData.dist < 5;
        const themeColor = isArrived ? '#4ade80' : '#00e5ff'; 
        const glowColor = isArrived ? 'rgba(74, 222, 128, 0.4)' : 'rgba(0, 229, 255, 0.4)';

        // NEW: Calculate the final rotation of the arrow based on where you are facing
        const relativeArrowRotation = navData.bearing - heading;

        return (
            <div style={{ height: '100vh', width: '100vw', backgroundColor: '#000', overflow: 'hidden', position: 'relative', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                
                <style>{`
                    @keyframes pulse {
                        0% { transform: scale(0.9); opacity: 0.8; }
                        100% { transform: scale(2.5); opacity: 0; }
                    }
                    @keyframes float {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-6px); }
                    }
                    @keyframes slideDownFade {
                        0% { opacity: 0; transform: translate(-50%, -20px); }
                        100% { opacity: 1; transform: translate(-50%, 0); }
                    }
                `}</style>

                {toast && (
                    <div style={{
                        position: 'absolute', top: 'calc(env(safe-area-inset-top, 20px) + 20px)', left: '50%', zIndex: 9999, 
                        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                        border: `1px solid ${toast.type === 'error' ? '#ef4444' : '#00e5ff'}`, borderRadius: '30px', padding: '12px 24px',
                        color: toast.type === 'error' ? '#fca5a5' : '#fff',
                        boxShadow: `0 10px 25px rgba(0,0,0,0.5), 0 0 15px ${toast.type === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(0,229,255,0.4)'}`,
                        animation: 'slideDownFade 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                        display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap'
                    }}>
                        <span style={{ fontSize: '1.2rem' }}>{toast.type === 'error' ? '⚠️' : '✨'}</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>{toast.message}</span>
                    </div>
                )}

                <div ref={mapContainer} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '150px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)', zIndex: 2, pointerEvents: 'none' }} />

                <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 20px) + 10px)', left: '20px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '12px', background: `linear-gradient(135deg, rgba(${themeColor === '#4ade80' ? '74,222,128' : '0,229,255'}, 0.15) 0%, rgba(${themeColor === '#4ade80' ? '74,222,128' : '0,229,255'}, 0.05) 100%)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', padding: '10px 18px', borderRadius: '50px', border: `1.5px solid ${themeColor}`, boxShadow: `0 0 20px ${glowColor}, 0 4px 12px rgba(0,0,0,0.3)` }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: themeColor, boxShadow: `0 0 12px ${themeColor}, inset 0 0 8px rgba(255,255,255,0.4)`, animation: 'pulse 2s infinite ease-in-out' }} />
                    <span style={{ color: '#fff', fontSize: '0.95rem', fontWeight: '900', letterSpacing: '1.5px', textShadow: `0 0 10px ${themeColor}85, 0 2px 4px rgba(0,0,0,0.8)` }}>
                    AUTOPIN
                    </span>
                </div>

                <div style={{ 
                    position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '5%', width: '90%',
                    background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.8) 0%, rgba(0, 0, 0, 0.9) 100%)', 
                    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                    borderRadius: '32px', border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: `0 20px 40px rgba(0,0,0,0.8), 0 0 30px ${glowColor} inset`,
                    padding: '24px', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center'
                }}>
                    <div style={{ width: '40px', height: '4px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '2px', marginBottom: '20px' }} />

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: '30px' }}>
                        <div style={{ position: 'relative', width: '80px', height: '80px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: `1px solid ${themeColor}`, animation: 'pulse 2s infinite ease-out' }} />
                            <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: `1px solid ${themeColor}`, animation: 'pulse 2s infinite ease-out', animationDelay: '1s' }} />
                            
                            {/* THE ARROW ROTATION IS UPDATED HERE */}
                            <div style={{ 
                                width: '60px', height: '60px', zIndex: 2,
                                transform: `rotate(${relativeArrowRotation}deg)`, 
                                transition: 'transform 0.2s linear', 
                                animation: 'float 3s ease-in-out infinite', filter: `drop-shadow(0 0 15px ${themeColor})`
                            }}>
                                <svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill={themeColor}/></svg>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '5.5rem', fontWeight: '900', color: '#fff', lineHeight: '1', letterSpacing: '-2px' }}>
                                {navData.dist}
                            </span>
                            <span style={{ fontSize: '2rem', color: themeColor, marginLeft: '4px', fontWeight: 'bold' }}>m</span>
                        </div>
                    </div>

                    <div style={{ width: '100%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)', margin: '25px 0' }} />

                    <button 
                        onClick={handleCallTrigger}
                        style={{ 
                            width: '100%', padding: '16px 0', borderRadius: '16px', border: 'none',
                            background: navData.car ? `linear-gradient(90deg, rgba(0,0,0,0.5), rgba(${isArrived ? '74,222,128' : '0,229,255'}, 0.2), rgba(0,0,0,0.5))` : '#fff',
                            color: navData.car ? themeColor : '#000', fontSize: '1rem', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase',
                            boxShadow: navData.car ? `0 0 15px ${glowColor}` : '0 10px 20px rgba(255,255,255,0.2)',
                            cursor: navData.car ? 'default' : 'pointer', transition: 'all 0.3s ease', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px'
                        }}
                    >
                        {navData.car ? `${navData.dist} METERS AWAY` : 'TAP TO PIN LOCATION'}
                    </button>
                </div>
            </div>
        );
    }