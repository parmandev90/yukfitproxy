const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 8080;
const PYTHON_API = "https://pythonapiyukfit.up.railway.app";

// CORS middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept']
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Workout storage system
const workoutStorage = {
  items: [],
  
  // Method to add a new workout
  add(workoutData) {
    const id = Date.now().toString();
    const savedWorkout = {
      id,
      timestamp: new Date(),
      ...workoutData
    };
    
    this.items.push(savedWorkout);
    return savedWorkout;
  },
  
  // Method to check duplicates with configurable criteria
  exists(workout, criteria = ['age', 'gender', 'height', 'weight', 'bmi']) {
    return this.items.some(item => {
      return criteria.every(key => item[key] === workout[key]);
    });
  },
  
  // Find workout by ID
  findById(id) {
    return this.items.find(item => item.id === id);
  },
  
  // Get all workouts 
  getAll() {
    return this.items;
  }
};

// Serve static files from the dist directory for bundled webpack files
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to serve the original files during development
app.use(express.static(path.join(__dirname)));

// Proxy endpoint for /api/recommend
app.post("/api/recommend", async (req, res) => {
  try {
    console.log('Forwarding request to Python API:', req.body);
    
    const response = await fetch(`${PYTHON_API}/api/recommend`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(req.body)
    });
    
    if (!response.ok) {
      throw new Error(`Python API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Response from Python API:', data);
    res.json(data);
  } catch (error) {
    console.error('Error calling Python API:', error);
    res.status(500).json({ 
      success: false,
      error: "Gagal mengambil rekomendasi dari API Python"
    });
  }
});

// Endpoint to save workout data
app.post("/api/save", (req, res) => {
  try {
    const workoutData = req.body;
    console.log('Received workout data to save:', workoutData);
    
    // Validate required fields
    const requiredFields = ['age', 'gender', 'height', 'weight', 'bmi'];
    const missingFields = requiredFields.filter(field => 
      workoutData[field] === undefined || workoutData[field] === null || workoutData[field] === ''
    );
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Data tidak lengkap. Field berikut diperlukan: ${missingFields.join(', ')}`
      });
    }
    
    // Check duplicate with custom error messages
    if (workoutStorage.exists(workoutData)) {
      return res.status(409).json({
        success: false,
        error: "Data latihan dengan karakteristik yang sama sudah tersimpan"
      });
    }
    
    // Save to our improved storage system
    const savedWorkout = workoutStorage.add(workoutData);
    console.log('Workout saved successfully:', savedWorkout.id);
    
    // Return success with the saved data including ID
    res.status(201).json({
      success: true,
      message: "Data latihan berhasil disimpan",
      data: { id: savedWorkout.id }
    });
  } catch (error) {
    console.error("Error saving workout:", error);
    res.status(500).json({ 
      success: false,
      error: "Gagal menyimpan data latihan" 
    });
  }
});

// Endpoint to get all saved workouts
app.get("/api/saved-workouts", (req, res) => {
  try {
    const workouts = workoutStorage.getAll();
    console.log(`Returning ${workouts.length} saved workouts`);
    
    res.json({
      success: true,
      data: workouts
    });
  } catch (error) {
    console.error("Error fetching saved workouts:", error);
    res.status(500).json({
      success: false,
      error: "Gagal mengambil data latihan tersimpan"
    });
  }
});

// Endpoint to get a specific saved workout by ID
app.get("/api/saved-workouts/:id", (req, res) => {
  try {
    const workout = workoutStorage.findById(req.params.id);
    
    if (workout) {
      console.log(`Found workout with ID: ${req.params.id}`);
      res.json({
        success: true,
        data: workout
      });
    } else {
      console.log(`Workout not found with ID: ${req.params.id}`);
      res.status(404).json({
        success: false,
        error: "Data latihan tidak ditemukan"
      });
    }
  } catch (error) {
    console.error("Error fetching workout by ID:", error);
    res.status(500).json({
      success: false,
      error: "Gagal mengambil data latihan"
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

// Catch-all handler for serving the main HTML file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server proxy berjalan di http://localhost:${PORT}`);
  console.log(`API Python tersedia di ${PYTHON_API}`);
  console.log(`Health check available at http://localhost:${PORT}/api/health`);
});