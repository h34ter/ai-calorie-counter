'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Calendar, Target, Settings, Save, Camera, Upload, Loader, X } from 'lucide-react';

const INITIAL_USER_CONFIG = {
  user_id: "luis",
  body_weight_lb: 150,
  timezone: "America/New_York",
  targets: {
    daily_calories_kcal: 2400,
    macro_split_pct: { protein: 25, carbs: 50, fat: 25 },
    protein_min_g: null
  },
  day_reset_rule: "manual_or_midnight"
};

// Blob-backed daily persistence (48h, no photo persistence)
const fetchState = async (userId) => {
  const res = await fetch(`/api/state?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load state');
  return res.json();
};

let saveTimer = null;
const saveState = async (userConfig, meals) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userConfig.user_id || 'luis', userConfig, meals })
    });
  }, 400);
};

const NutritionTracker = () => {
  const [userConfig, setUserConfig] = useState(INITIAL_USER_CONFIG);
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [meals, setMeals] = useState([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newMeal, setNewMeal] = useState({
    title: '',
    description: '',
    items: [],
    notes: '',
    photos: [],
    analysisResults: []
  });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Load from Blob on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchState(userConfig.user_id || 'luis');
        if (cancelled) return;
        if (data?.userConfig) setUserConfig(data.userConfig);
        if (Array.isArray(data?.meals)) setMeals(data.meals);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Save to Blob when config or meals change
  useEffect(() => {
    saveState(userConfig, meals);
  }, [userConfig, meals]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error('Play error:', e));
      }
      setShowCamera(true);
      setPreviewUrl(null);
    } catch (err) {
      console.error('Camera error:', err);
      alert('Camera access denied. Please enable camera permissions.');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
    setPreviewUrl(null);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    try {
      const context = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          const photoUrl = URL.createObjectURL(blob);
          setPreviewUrl(photoUrl);
          const photoId = `photo_${Date.now()}`;
          const newPhoto = { id: photoId, url: photoUrl, timestamp: new Date().toISOString(), blob, analyzed: false };
          setNewMeal(prev => ({ ...prev, photos: [...prev.photos, newPhoto] }));
          await analyzePhotoAndText(newPhoto, newMeal.description);
        }
      }, 'image/jpeg', 0.85);
    } catch (err) {
      console.error('Capture error:', err);
      alert('Failed to capture photo');
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const photoUrl = URL.createObjectURL(file);
      setPreviewUrl(photoUrl);
      const photoId = `photo_${Date.now()}`;
      const newPhoto = { id: photoId, url: photoUrl, timestamp: new Date().toISOString(), blob: file, analyzed: false };
      setNewMeal(prev => ({ ...prev, photos: [...prev.photos, newPhoto] }));
      await analyzePhotoAndText(newPhoto, newMeal.description);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const analyzePhotoAndText = async (photo, description) => {
    const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
      setAnalysisError('OpenAI API key not configured.');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const base64 = await new Promise((resolve) => {
        if (!photo.blob) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(photo.blob);
      });

      if (!base64) throw new Error('Photo blob unavailable.');

      let prompt = `You are a professional nutritionist analyzing a food/nutrition image. Extract ALL visible information:
1. If this is a nutrition label: extract ALL macros, serving size, and any micronutrients visible
2. If this is food/meal: identify each distinct food, estimate portions using visual cues, calculate macros using USDA reference
3. If there's both a photo AND optional user text description: use text to clarify portions or improve accuracy

Return ONLY valid JSON (no markdown, no explanations):
{
  "foods": [
    {
      "name": "food name",
      "portion": "estimated amount (e.g., 200g, 1 cup)",
      "kcal": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "confidence": 0.0-1.0
    }
  ],
  "total_kcal": number,
  "analysis_confidence": 0.0-1.0
}

Rules:
- Be conservative with estimates
- Round macros to 1 decimal place
- Include ALL visible foods
- Use realistic portion sizes
- Account for cooking methods`;

      if (description && description.trim().length > 0) {
        prompt += `\n\nUser provided additional info: "${description.trim()}"`;
      }

      const content = [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: base64, detail: "high" } }
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content }],
          max_tokens: 900,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`GPT-4 API error: ${response.status}`);
      }

      const data = await response.json();
      let analysisText = data.choices?.[0]?.message?.content || '';

      let jsonText = analysisText.trim();
      if (jsonText.includes('```json')) {
        const parts = jsonText.split('```json');
        if (parts[1]) {
          jsonText = parts[1].split('```')[0].trim();
        }
      } else if (jsonText.includes('```')) {
        const parts = jsonText.split('```');
        if (parts[1]) {
          jsonText = parts[1].split('```')[0].trim();
        }
      }
      jsonText = jsonText.replace(/^`+|`+$/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error('Invalid JSON response');
        }
      }

      const foods = parsed.foods || [];
      if (!foods.length) throw new Error('No nutrition data extracted from image');

      const items = foods.map((food, idx) => ({
        id: `item_${Date.now()}_${idx}`,
        ref: '',
        servings: '1',
        measured: 'servings',
        fraction: 1,
        aiDetected: true,
        confidence: food.confidence || 0.75,
        customFood: {
          name: food.name || 'Unknown Food',
          kcal: Math.round(food.kcal || 0),
          p: Math.round((food.protein || 0) * 10) / 10,
          c: Math.round((food.carbs || 0) * 10) / 10,
          f: Math.round((food.fat || 0) * 10) / 10,
        },
        editable: true
      }));

      setNewMeal(prev => ({
        ...prev,
        items,
        analysisResults: [{
          photoId: photo.id,
          detectedFoods: foods,
          totalEstimatedCalories: items.reduce((acc, cur) => acc + (cur.customFood.kcal || 0), 0),
          confidence: parsed.analysis_confidence || 0.8,
          analysisMethod: 'GPT-4o Vision',
        }],
        photos: prev.photos.map(p =>
          p.id === photo.id ? { ...p, analyzed: true } : p
        )
      }));

    } catch (err) {
      console.error('Analysis error:', err);
      setAnalysisError(err.message || 'Failed to analyze photo');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const calculateItemMacros = (item) => {
    if (item.customFood) {
      let multiplier = 1;
      if (item.measured === 'servings' && item.servings) {
        multiplier = parseFloat(item.servings) || 1;
      } else if (item.measured === 'cooked' && item.grams) {
        multiplier = (parseFloat(item.grams) || 0) / 100;
      }
      if (item.fraction) {
        multiplier *= parseFloat(item.fraction);
      }
      return {
        kcal: Math.round(item.customFood.kcal * multiplier),
        p: Math.round(item.customFood.p * multiplier * 10) / 10,
        c: Math.round(item.customFood.c * multiplier * 10) / 10,
        f: Math.round(item.customFood.f * multiplier * 10) / 10
      };
    }
    return { kcal: 0, p: 0, c: 0, f: 0 };
  };

  const calculateMealTotals = (mealItems) => {
    return mealItems.reduce((totals, item) => {
      const itemMacros = calculateItemMacros(item);
      return {
        kcal: totals.kcal + itemMacros.kcal,
        p: Math.round((totals.p + itemMacros.p) * 10) / 10,
        c: Math.round((totals.c + itemMacros.c) * 10) / 10,
        f: Math.round((totals.f + itemMacros.f) * 10) / 10
      };
    }, { kcal: 0, p: 0, c: 0, f: 0 });
  };

  const calculateDailyTotals = () => {
    const dayMeals = meals.filter(meal =>
      meal.timestamp?.startsWith?.(currentDate) && !meal.correction_of_meal_id
    );

    const totals = dayMeals.reduce((daily, meal) => {
      const mealTotals = calculateMealTotals(meal.items || []);
      return {
        kcal: daily.kcal + mealTotals.kcal,
        p: Math.round((daily.p + mealTotals.p) * 10) / 10,
        c: Math.round((daily.c + mealTotals.c) * 10) / 10,
        f: Math.round((daily.f + mealTotals.f) * 10) / 10
      };
    }, { kcal: 0, p: 0, c: 0, f: 0 });

    const p_kcal = totals.p * 4;
    const c_kcal = totals.c * 4;
    const f_kcal = totals.f * 9;

    const p_pct = totals.kcal > 0 ? Math.round((p_kcal / totals.kcal) * 100) : 0;
    const c_pct = totals.kcal > 0 ? Math.round((c_kcal / totals.kcal) * 100) : 0;
    const f_pct = totals.kcal > 0 ? Math.round((f_kcal / totals.kcal) * 100) : 0;

    const target_p_g = Math.round((userConfig.targets.daily_calories_kcal * userConfig.targets.macro_split_pct.protein / 100) / 4);
    const target_c_g = Math.round((userConfig.targets.daily_calories_kcal * userConfig.targets.macro_split_pct.carbs / 100) / 4);
    const target_f_g = Math.round((userConfig.targets.daily_calories_kcal * userConfig.targets.macro_split_pct.fat / 100) / 9);

    const remaining_kcal = userConfig.targets.daily_calories_kcal - totals.kcal;
    const remaining_p = Math.round((target_p_g - totals.p) * 10) / 10;
    const remaining_c = Math.round((target_c_g - totals.c) * 10) / 10;
    const remaining_f = Math.round((target_f_g - totals.f) * 10) / 10;

    return {
      totals: { ...totals, p_kcal, c_kcal, f_kcal, p_pct, c_pct, f_pct },
      targets: { kcal: userConfig.targets.daily_calories_kcal, p_g: target_p_g, c_g: target_c_g, f_g: target_f_g },
      remaining: { kcal: remaining_kcal, p_g: remaining_p, c_g: remaining_c, f_g: remaining_f },
      meals: dayMeals
    };
  };

  const saveMeal = () => {
    if (newMeal.items.length === 0) {
      alert('Please add items to the meal first');
      return;
    }

    const meal = {
      id: `meal_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: newMeal.title || `Meal at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      items: newMeal.items,
      notes: newMeal.notes,
      photos: [],
      analysisResults: newMeal.analysisResults,
      source: 'manual'
    };

    setMeals(prev => [...prev, meal]);
    setNewMeal({
      title: '',
      description: '',
      items: [],
      notes: '',
      photos: [],
      analysisResults: []
    });
    setShowAddMeal(false);
    stopCamera();
  };

  const startNewDay = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCurrentDate(tomorrow.toISOString().split('T')[0]);
  };

  const updateUserConfig = (updates) => {
    setUserConfig(prev => ({ ...prev, ...updates }));
  };

  const updateTargets = (newTargets) => {
    setUserConfig(prev => ({
      ...prev,
      targets: { ...prev.targets, ...newTargets }
    }));
  };

  const dailyData = calculateDailyTotals();

  return (
    <div className="w-full min-h-screen bg-gray-50 pb-6">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Target className="h-6 w-6 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900">Nutrition</h1>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <p className="text-xs text-gray-500">Today</p>
              <p className="text-sm font-medium">{currentDate}</p>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <Settings className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* BIG MACROS - Mobile Optimized */}
      <div className="px-4 pt-4 pb-4">
        <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-5 rounded-xl shadow-lg">
          <h2 className="text-white text-sm font-bold mb-4">📊 TODAY</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Calories */}
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-white/20">
              <p className="text-white/70 text-xs font-semibold mb-1">CALS</p>
              <p className="text-white text-3xl font-black">{dailyData.totals.kcal}</p>
              <p className="text-white/60 text-xs mt-1">/ {dailyData.targets.kcal}</p>
            </div>
            {/* Protein */}
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-green-400/20">
              <p className="text-green-200 text-xs font-semibold mb-1">PROTEIN</p>
              <p className="text-green-300 text-3xl font-black">{dailyData.totals.p}g</p>
              <p className="text-green-200/70 text-xs mt-1">{dailyData.totals.p_pct}%</p>
            </div>
            {/* Carbs */}
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-purple-400/20">
              <p className="text-purple-200 text-xs font-semibold mb-1">CARBS</p>
              <p className="text-purple-300 text-3xl font-black">{dailyData.totals.c}g</p>
              <p className="text-purple-200/70 text-xs mt-1">{dailyData.totals.c_pct}%</p>
            </div>
            {/* Fat */}
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-orange-400/20">
              <p className="text-orange-200 text-xs font-semibold mb-1">FAT</p>
              <p className="text-orange-300 text-3xl font-black">{dailyData.totals.f}g</p>
              <p className="text-orange-200/70 text-xs mt-1">{dailyData.totals.f_pct}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add Meal Button */}
      <div className="px-4 pb-4">
        <button
          onClick={() => setShowAddMeal(true)}
          className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          <Camera className="h-5 w-5" />
          <span>📸 Add Meal</span>
        </button>
      </div>

      {/* Meals List */}
      {dailyData.meals.length > 0 && (
        <div className="px-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-900">Meals</h2>
          {dailyData.meals.map(meal => {
            const mealTotals = calculateMealTotals(meal.items || []);
            return (
              <div key={meal.id} className="bg-white rounded-lg p-4 border border-green-200 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-900 text-sm">{meal.title}</h3>
                  <span className="text-xs text-gray-500">
                    {new Date(meal.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="space-y-1 mb-2">
                  {meal.items.map((item, idx) => {
                    const itemMacros = calculateItemMacros(item);
                    return (
                      <p key={idx} className="text-xs text-gray-700">
                        {item.customFood?.name}: {itemMacros.kcal} kcal
                      </p>
                    );
                  })}
                </div>
                <div className="text-xs font-semibold text-green-900 bg-green-100 p-2 rounded">
                  {mealTotals.kcal} kcal | {mealTotals.p}g P | {mealTotals.c}g C | {mealTotals.f}g F
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Camera Modal */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>

          {/* Preview of captured image */}
          {previewUrl && (
            <div className="bg-gray-900 p-3 border-t border-gray-700">
              <img src={previewUrl} alt="Preview" className="w-full max-h-24 object-cover rounded" />
            </div>
          )}

          {/* Camera Controls */}
          <div className="bg-black px-4 py-4 flex gap-2">
            <button
              onClick={capturePhoto}
              className="flex-1 flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Camera className="h-5 w-5" />
              <span>Capture</span>
            </button>
            <button
              onClick={stopCamera}
              className="flex-1 px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add Meal Modal */}
      {showAddMeal && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto flex flex-col">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Add Meal</h3>
            <button
              onClick={() => {
                setShowAddMeal(false);
                stopCamera();
                setNewMeal({ title: '', description: '', items: [], notes: '', photos: [], analysisResults: [] });
              }}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 px-4 py-4 overflow-y-auto space-y-4 pb-24">
            {/* Photo Buttons */}
            <div className="flex gap-2">
              <button
                onClick={startCamera}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
              >
                <Camera className="h-5 w-5" />
                <span>Camera</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                <Upload className="h-5 w-5" />
                <span>Upload</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Photos */}
            {newMeal.photos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Photos</p>
                <div className="flex gap-2 overflow-x-auto">
                  {newMeal.photos.map((photo, idx) => (
                    <div key={photo.id} className="relative flex-shrink-0">
                      <img
                        src={photo.url}
                        alt={`Photo ${idx + 1}`}
                        className="w-20 h-20 object-cover rounded border-2 border-green-500"
                      />
                      <button
                        onClick={() =>
                          setNewMeal(prev => ({
                            ...prev,
                            photos: prev.photos.filter(p => p.id !== photo.id)
                          }))
                        }
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Title Input */}
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Title (optional)</label>
              <input
                type="text"
                value={newMeal.title}
                onChange={(e) => setNewMeal(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Breakfast, Lunch, etc."
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Notes (optional)</label>
              <textarea
                value={newMeal.description}
                onChange={(e) => setNewMeal(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Describe the food or paste label info"
              />
            </div>

            {/* Analyzing */}
            {isAnalyzing && (
              <div className="flex items-center space-x-2 p-3 bg-blue-100 rounded-lg">
                <Loader className="h-5 w-5 text-blue-600 animate-spin" />
                <span className="text-sm text-blue-800">🤖 Analyzing...</span>
              </div>
            )}

            {/* Error */}
            {analysisError && (
              <div className="p-3 bg-red-100 rounded-lg">
                <p className="text-sm text-red-800">❌ {analysisError}</p>
              </div>
            )}

            {/* Detected Items */}
            {newMeal.items.length > 0 && (
              <div className="bg-white border-2 border-green-300 p-3 rounded-lg">
                <p className="text-xs font-semibold text-gray-700 mb-2">✅ Detected Foods</p>
                {newMeal.items.map((item) => {
                  const macros = calculateItemMacros(item);
                  return (
                    <div key={item.id} className="mb-2 p-2 bg-gray-50 rounded text-xs">
                      <p className="font-medium">{item.customFood?.name}</p>
                      <p className="text-gray-600">{macros.kcal} cal | {macros.p}g P | {macros.c}g C | {macros.f}g F</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save Button - Fixed at bottom */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-2">
            <button
              onClick={saveMeal}
              disabled={newMeal.items.length === 0}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 font-medium text-sm"
            >
              💾 Save
            </button>
            <button
              onClick={() => {
                setShowAddMeal(false);
                stopCamera();
                setNewMeal({ title: '', description: '', items: [], notes: '', photos: [], analysisResults: [] });
              }}
              className="flex-1 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Settings</h3>
            <button onClick={() => setShowSettings(false)} className="p-1">
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex-1 px-4 py-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Daily Calorie Target</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={userConfig.targets.daily_calories_kcal}
                  onChange={(e) => updateTargets({ daily_calories_kcal: parseInt(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-sm text-gray-600">kcal</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Body Weight</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={userConfig.body_weight_lb}
                  onChange={(e) => updateUserConfig({ body_weight_lb: parseFloat(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-sm text-gray-600">lbs</span>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Macro Splits</h3>
              <div className="space-y-2">
                {['protein', 'carbs', 'fat'].map(macro => (
                  <div key={macro} className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-700 w-16 capitalize">{macro}</label>
                    <input
                      type="number"
                      value={userConfig.targets.macro_split_pct[macro]}
                      onChange={(e) => updateTargets({
                        macro_split_pct: {
                          ...userConfig.targets.macro_split_pct,
                          [macro]: parseInt(e.target.value) || 0
                        }
                      })}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <span className="text-xs text-gray-600 w-4">%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t gap-2 flex">
            <button
              onClick={() => setShowSettings(false)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              Save
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-medium text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NutritionTracker;
