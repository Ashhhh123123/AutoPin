import React, { useEffect, useState, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import io from 'socket.io-client';
import 'maplibre-gl/dist/maplibre-gl.css';

const socket = io('https://autopin-backend.onrender.com');

// Replace with your ORS Key for walking paths
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjI1MDg5OGUxMTIyYjRkNTM4ZGE2ZmYxMDZhOTAwZmRjIiwiaCI6Im11cm11cjY0In0=';

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
    const [heading, setHeading] = useState(0);

    const userMarker = useRef(null);
    const carMarker = useRef(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500); 
    };

    // --- FETCH WALKING PATH FROM ORS ---
    const updateWalkingPath = async (userCoords, carCoords) => {
        if (!userCoords || !carCoords || !map.current) return;

        const url = `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${ORS_API_KEY}&start=${userCoords.lng},${userCoords.lat}&end=${carCoords.lng},${carCoords.lat}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!data.features || data.features.length === 0) return;

            const coords = data.features[0].geometry.coordinates;

            if (map.current.getSource('route')) {
                map.current.getSource('route').setData({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: coords }
                });
            } else {
                map.current.addSource('route', {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
                });
                map.current.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#00e5ff',
                        'line-width': 5,
                        'line-dasharray': [2, 1]
                    }
                });
            }
        } catch (e) {
            console.error("Routing failed:", e);
        }
    };

    const handleCallTrigger = async () => {
        try {
            // Ask for compass permission (iOS requirement)
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                await DeviceOrientationEvent.requestPermission();
            }
            
            showToast("Ringing! Pick up to save your spot. 📱", "success"); 
            const response = await fetch('https://autopin-backend.onrender.com/trigger-call', { method: 'POST' });
            if (!response.ok) showToast("The call failed to initiate.", "error");
        } catch (err) {
            showToast("Offline or Server Error.", "error");
        }
    };

    useEffect(() => {
        // --- HYBRID COMPASS LOGIC ---
        const handleOrientation = (e) => {
            let compass = null;
            if (e.webkitCompassHeading) {
                compass = e.webkitCompassHeading; // iOS
            } else if (e.alpha !== null) {
                compass = 360 - e.alpha; // Android
            }
            if (compass !== null) setHeading(compass);
        };

        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        window.addEventListener('deviceorientation', handleOrientation, true);

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
            pitch: 60
        });

        // Laptop Fallback: Use map rotation if hardware compass is 0
        map.current.on('rotate', () => {
            if (heading === 0) {
                setHeading(map.current.getBearing());
            }
        });

        // MOBILE GPS FIX: added maximumAge: 0 to force real-time updates
        const watchId = navigator.geolocation.watchPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            
            fetch('https://autopin-backend.onrender.com/update-gps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: latitude, lng: longitude })
            }).catch(() => {});

            if (!userMarker.current) {
                userMarker.current = new maplibregl.Marker({ color: '#00ffff' }).setLngLat([longitude, latitude]).addTo(map.current);
            } else {
                userMarker.current.setLngLat([longitude, latitude]);
            }

            setNavData(prev => {
                if (!prev.car) return prev;
                // MOBILE API CRASH FIX: We removed updateWalkingPath from here!
                const updates = getNavUpdates(latitude, longitude, prev.car.lat, prev.car.lng);
                return { ...prev, dist: updates.distance, bearing: updates.bearing };
            });
        }, null, { enableHighAccuracy: true, maximumAge: 0 });

        socket.on('MAP_UPDATE', (data) => {
            const carCoords = { lat: data.lat, lng: data.lng };
            setNavData(prev => ({ ...prev, car: carCoords, pillar: data.pillar }));
            
            if (carMarker.current) carMarker.current.remove();
            carMarker.current = new maplibregl.Marker({ color: '#ff4d4d' }).setLngLat([data.lng, data.lat]).addTo(map.current);
            map.current.flyTo({ center: [data.lng, data.lat], zoom: 18, speed: 1.5 });
            
            navigator.geolocation.getCurrentPosition((pos) => {
                updateWalkingPath({ lat: pos.coords.latitude, lng: pos.coords.longitude }, carCoords);
            });

            showToast(`Spot saved at ${data.pillar}!`, "success");
        });

        return () => {
            navigator.geolocation.clearWatch(watchId);
            socket.off('MAP_UPDATE');
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const relativeArrowRotation = (navData.bearing - heading + 360) % 360;
    const isArrived = navData.car && navData.dist < 5;
    const themeColor = isArrived ? '#4ade80' : '#00e5ff';

    return (
        <div style={{ height: '100vh', width: '100vw', backgroundColor: '#000', overflow: 'hidden', position: 'relative' }}>
            {toast && <div style={{ position: 'absolute', top: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(15,23,42,0.9)', padding: '12px 24px', borderRadius: '50px', color: '#fff', border: `1px solid ${themeColor}`, backdropFilter: 'blur(10px)', fontWeight: 'bold' }}>{toast.message}</div>}
            
            <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />
            
            <div style={{ position: 'absolute', bottom: '30px', left: '5%', width: '90%', background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(20px)', borderRadius: '32px', padding: '24px', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '30px', width: '100%', justifyContent: 'center' }}>
                    <div style={{ 
                        width: '80px', height: '80px', 
                        transform: `rotate(${relativeArrowRotation}deg)`, 
                        transition: 'transform 0.3s ease-out', 
                        filter: `drop-shadow(0 0 10px ${themeColor})` 
                    }}>
                        <svg viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill={themeColor}/></svg>
                    </div>
                    <div style={{ color: '#fff', display: 'flex', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '4.5rem', fontWeight: '900', letterSpacing: '-2px' }}>{navData.dist}</span>
                        <span style={{ fontSize: '1.5rem', color: themeColor, fontWeight: 'bold', marginLeft: '5px' }}>m</span>
                    </div>
                </div>
                
                <button 
                    onClick={handleCallTrigger} 
                    style={{ width: '100%', marginTop: '25px', padding: '18px', borderRadius: '16px', background: themeColor, border: 'none', fontWeight: '900', color: '#020617', letterSpacing: '1px', textTransform: 'uppercase' }}>
                    {navData.car ? `RETURN TO ${navData.pillar}` : 'TAP TO PIN LOCATION'}
                </button>
            </div>
        </div>
    );
}