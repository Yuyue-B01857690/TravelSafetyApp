
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Location data storage file
const dataDirectory = path.join(__dirname, 'data');
const dataFile = path.join(dataDirectory, 'locations.json');

// Create data folder and JSON file if they do not exist
if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, { recursive: true });
}

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, JSON.stringify([], null, 2));
}

// Read saved location records
function readLocations() {
  try {
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading location data:', error);
    return [];
  }
}

// Save location records
function saveLocations(locations) {
  fs.writeFileSync(
    dataFile,
    JSON.stringify(locations, null, 2)
  );
}

// Home / health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Travel Safety Tracker Backend is running!',
    status: 'OK'
  });
});

// GET: Retrieve all saved location records
app.get('/api/locations', (req, res) => {
  const locations = readLocations();

  res.status(200).json({
    success: true,
    total: locations.length,
    locations: locations
  });
});

// POST: Receive and save a GPS location
app.post('/api/locations', (req, res) => {
  const {
    latitude,
    longitude,
    accuracy,
    timestamp
  } = req.body;

  // Validate latitude and longitude
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid latitude.'
    });
  }

  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid longitude.'
    });
  }

  if (
    accuracy !== undefined &&
    accuracy !== null &&
    (typeof accuracy !== 'number' || !Number.isFinite(accuracy))
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid accuracy.'
    });
  }

  if (
    typeof timestamp !== 'string' ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid timestamp.'
    });
  }

  // Create a new location record
  const newLocation = {
    id: Date.now().toString(),
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    timestamp,
    receivedAt: new Date().toISOString()
  };

  // Save the new record
  const locations = readLocations();
  locations.push(newLocation);
  saveLocations(locations);

  console.log('New GPS location received:', newLocation);

  res.status(201).json({
    success: true,
    message: 'GPS location received and saved successfully.',
    location: newLocation
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('======================================');
  console.log('Travel Safety Tracker Backend');
  console.log(`Server running on port ${PORT}`);
  console.log(`Local URL: http://localhost:${PORT}`);
  console.log('======================================');
});
