const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express(); 
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const BOLNA_API_KEY = 'bn-37d0342c5a0d4bcaabbeecd2e78d2665'; 
const AGENT_ID = 'c805e7c2-524b-4e55-a4dd-152edb5eeff2';
const USER_PHONE = '+918319431235'; 

let lastKnownLocation = { lat: 28.6139, lng: 77.2090 };

//  user's current GPS coordinates
app.post('/update-gps', (req, res) => {
    const { lat, lng } = req.body;
    if (lat && lng) {
        lastKnownLocation = { lat, lng };
    }
    res.sendStatus(200);
});

// Bolna AI outbound call
app.post('/trigger-call', async (req, res) => {
    try {
        const response = await axios.post('https://api.bolna.ai/call', {
            agent_id: AGENT_ID,
            recipient_phone_number: USER_PHONE,
            user_data: { 
                lat: lastKnownLocation.lat,
                lng: lastKnownLocation.lng 
            }
        }, {
            headers: { 
                'Authorization': `Bearer ${BOLNA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("[Bolna] Call queued:", response.data.id || "success");
        res.json({ success: true });

    } catch (error) {
        console.error("[Bolna] Call failed:", error.message);
        res.status(500).json({ success: false, message: "Call initiation failed" });
    }
});

// Webhook for Bolna to save extracted location data
app.post('/bolna-save', (req, res) => {
    const extractedPillar = req.body.pillar_id; 
    
    console.log(`[Webhook] Location saved: ${extractedPillar}`);

    const carData = {
        lat: lastKnownLocation.lat,
        lng: lastKnownLocation.lng,
        pillar: extractedPillar || "Unknown Spot",
        timestamp: Date.now()
    };

    io.emit('MAP_UPDATE', carData);

    res.json({ 
        text: `Got it. I've pinned your car at ${extractedPillar}. Follow the meter on your screen to return.` 
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});