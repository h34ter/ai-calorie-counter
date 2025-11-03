'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Calendar, Target, TrendingUp, CheckCircle, AlertCircle, Settings, Save, Camera, Upload, Loader } from 'lucide-react';

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

const formatFoodName = (key) => {
  return key.split('_').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ').replace(/(\d+)/g, ' $1').trim();
};

// ---- Blob-backed daily persistence (48h, no photo persistence) ----
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setShowCamera(true);
    } catch (err) {
      alert('Camera access denied or not available');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(async (blob) => {
        const photoUrl = URL.createObjectURL(blob);
        const photoId = `photo_${Date.now()}`;
        const newPhoto = { id: photoId, url: photoUrl, timestamp: new Date().toISOString(), blob, analyzed: false };
        setNewMeal(prev => ({ ...prev, photos: [...prev.photos, newPhoto] }));
        await analyzePhotoAndText(newPhoto, newMeal.description);
      }, 'image/jpeg', 0.8);
    }
    stopCamera();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const photoUrl = URL.createObjectURL(file);
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

      if (!base64) throw new Error('Photo blob unavailable after refresh.');

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

  const updateFoodItem = (itemId, field, value) => {
    setNewMeal(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id === itemId) {
          if (field === 'customFood') {
            return {
              ...item,
              customFood: { ...item.customFood, ...value }
            };
          }
          return { ...item, [field]: value };
        }
        return item;
      })
    }));
  };

  const removeFoodItem = (itemId) => {
    setNewMeal(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== itemId)
    }));
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

    const protein_ok = Math.abs(p_pct - userConfig.targets.macro_split_pct.protein) <= 5;
    const carbs_ok = Math.abs(c_pct - userConfig.targets.macro_split_pct.carbs) <= 5;
    const fat_ok = Math.abs(f_pct - userConfig.targets.macro_split_pct.fat) <= 5;

    return {
      totals: { ...totals, p_kcal, c_kcal, f_kcal, p_pct, c_pct, f_pct },
      targets: { kcal: userConfig.targets.daily_calories_kcal, p_g: target_p_g, c_g: target_c_g, f_g: target_f_g },
      remaining: { kcal: remaining_kcal, p_g: remaining_p, c_g: remaining_c, f_g: remaining_f },
      status: { protein_ok, carbs_ok, fat_ok },
      meals: dayMeals
    };
  };

  const saveMeal = () => {
    if (!newMeal.title || newMeal.items.length === 0) return;

    const meal = {
      id: `meal_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: newMeal.title,
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
  };

  const startNewDay = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setCurrentDate(tomorrow.toISOString().split('T')[0]);
  };

  const dailyData = calculateDailyTotals();

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Target className="h-8 w-8 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">AI Nutrition Tracker</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-gray-500" />
              <span className="text-gray-700 font-medium">{currentDate}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>
            <button
              onClick={startNewDay}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Start New Day
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-8 rounded-2xl mb-8 shadow-xl">
          <h2 className="text-white text-2xl font-bold mb-6">📊 TODAY'S MACROS</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white/10 backdrop-blur p-6 rounded-xl border-2 border-white/30">
              <p className="text-white/80 text-sm font-semibold mb-2">CALORIES</p>
              <p className="text-white text-6xl font-black">{dailyData.totals.kcal}</p>
              <p className="text-white/70 text-xl mt-2">/ {dailyData.targets.kcal}</p>
              <p className="text-green-300 text-lg font-bold mt-2">{dailyData.remaining.kcal} left</p>
            </div>
            <div className="bg-white/10 backdrop-blur p-6 rounded-xl border-2 border-green-400/30">
              <p className="text-green-200 text-sm font-semibold mb-2">PROTEIN</p>
              <p className="text-green-300 text-6xl font-black">{dailyData.totals.p}g</p>
              <p className="text-white/70 text-xl mt-2">/ {dailyData.targets.p_g}g</p>
              <p className={`text-lg font-bold mt-2 ${Math.abs(dailyData.totals.p_pct - userConfig.targets.macro_split_pct.protein) <= 5 ? 'text-green-400' : 'text-yellow-300'}`}>
                {dailyData.totals.p_pct}%
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur p-6 rounded-xl border-2 border-purple-400/30">
              <p className="text-purple-200 text-sm font-semibold mb-2">CARBS</p>
              <p className="text-purple-300 text-6xl font-black">{dailyData.totals.c}g</p>
              <p className="text-white/70 text-xl mt-2">/ {dailyData.targets.c_g}g</p>
              <p className={`text-lg font-bold mt-2 ${Math.abs(dailyData.totals.c_pct - userConfig.targets.macro_split_pct.carbs) <= 5 ? 'text-purple-400' : 'text-yellow-300'}`}>
                {dailyData.totals.c_pct}%
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur p-6 rounded-xl border-2 border-orange-400/30">
              <p className="text-orange-200 text-sm font-semibold mb-2">FAT</p>
              <p className="text-orange-300 text-6xl font-black">{dailyData.totals.f}g</p>
              <p className="text-white/70 text-xl mt-2">/ {dailyData.targets.f_g}g</p>
              <p className={`text-lg font-bold mt-2 ${Math.abs(dailyData.totals.f_pct - userConfig.targets.macro_split_pct.fat) <= 5 ? 'text-orange-400' : 'text-yellow-300'}`}>
                {dailyData.totals.f_pct}%
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <button
            onClick={() => setShowAddMeal(true)}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Camera className="h-5 w-5" />
            <span>📸 Add Meal (Photo Required)</span>
          </button>
        </div>

        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">Nutrition Settings</h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Daily Calorie Target</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={userConfig.targets.daily_calories_kcal}
                      onChange={(e) => updateTargets({ daily_calories_kcal: parseInt(e.target.value) || 0 })}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-600">kcal</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Body Weight</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={userConfig.body_weight_lb}
                      onChange={(e) => updateUserConfig({ body_weight_lb: parseFloat(e.target.value) || 0 })}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-600">lbs</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-4">Macro Split Percentages</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Protein %</label>
                      <input
                        type="number"
                        value={userConfig.targets.macro_split_pct.protein}
                        onChange={(e) => updateTargets({
                          macro_split_pct: {
                            ...userConfig.targets.macro_split_pct,
                            protein: parseInt(e.target.value) || 0
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Carbs %</label>
                      <input
                        type="number"
                        value={userConfig.targets.macro_split_pct.carbs}
                        onChange={(e) => updateTargets({
                          macro_split_pct: {
                            ...userConfig.targets.macro_split_pct,
                            carbs: parseInt(e.target.value) || 0
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fat %</label>
                      <input
                        type="number"
                        value={userConfig.targets.macro_split_pct.fat}
                        onChange={(e) => updateTargets({
                          macro_split_pct: {
                            ...userConfig.targets.macro_split_pct,
                            fat: parseInt(e.target.value) || 0
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex space-x-4 mt-6">
                <button
                  onClick={() => setShowSettings(false)}
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-1"
                >
                  <Save className="h-4 w-4" />
                  <span>Save</span>
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showCamera && (
          <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-4 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Take Photo of Food/Label</h3>
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full rounded-lg"
                  style={{ maxHeight: '400px' }}
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
              <div className="flex space-x-4 mt-4">
                <button
                  onClick={capturePhoto}
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-1"
                >
                  <Camera className="h-4 w-4" />
                  <span>Capture</span>
                </button>
                <button
                  onClick={stopCamera}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddMeal && (
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <h3 className="text-lg font-semibold mb-4">📸 Add Meal - Photo First!</h3>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  <span className="text-red-600">*</span> Photo (Take or Upload)
                </label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                  >
                    <Camera className="h-4 w-4" />
                    <span>Take Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Upload className="h-4 w-4" />
                    <span>Upload Photo</span>
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              {newMeal.photos.length > 0 && (
                <div className="mb-4">
                  <div className="flex space-x-2">
                    {newMeal.photos.map((photo, index) => (
                      <div key={photo.id} className="relative">
                        <img
                          src={photo.url}
                          alt={`Food photo ${index + 1}`}
                          className="w-24 h-24 object-cover rounded-md border-2 border-green-500"
                        />
                        <button
                          type="button"
                          onClick={() => setNewMeal(prev => ({
                            ...prev,
                            photos: prev.photos.filter(p => p.id !== photo.id)
                          }))}
                          className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-red-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Meal Title
              </label>
              <input
                type="text"
                value={newMeal.title}
                onChange={(e) => setNewMeal(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Breakfast, Lunch, Dinner"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Additional Info (optional)
              </label>
              <textarea
                value={newMeal.description}
                onChange={(e) => setNewMeal(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="If unclear: describe food, quantities, or paste label text to improve accuracy"
              />
            </div>

            {isAnalyzing && (
              <div className="flex items-center space-x-2 mb-4 p-4 bg-blue-100 rounded-md">
                <Loader className="h-6 w-6 text-blue-600 animate-spin" />
                <span className="text-blue-800 font-medium">🤖 Analyzing photo...</span>
              </div>
            )}

            {analysisError && (
              <div className="mb-4 p-3 bg-red-100 rounded-md">
                <span className="text-red-800">❌ {analysisError}</span>
              </div>
            )}

            {newMeal.items.length > 0 && (
              <div className="mb-6 p-4 bg-white rounded-md border-2 border-green-300">
                <h4 className="text-sm font-medium text-gray-700 mb-3">✅ Detected Foods:</h4>
                {newMeal.items.map((item) => {
                  const macros = calculateItemMacros(item);
                  const foodName = item.customFood ? item.customFood.name : 'Unknown Food';
                  return (
                    <div key={item.id} className="mb-3 p-3 bg-gray-50 rounded">
                      <p className="font-medium text-gray-900">{foodName}</p>
                      <p className="text-sm text-gray-600">
                        {macros.kcal} kcal | {macros.p}g P | {macros.c}g C | {macros.f}g F
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Confidence: {Math.round(item.confidence * 100)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex space-x-4">
              <button
                onClick={saveMeal}
                disabled={newMeal.items.length === 0 || !newMeal.title}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium flex-1"
              >
                💾 Save Meal
              </button>
              <button
                onClick={() => {
                  setShowAddMeal(false);
                  setNewMeal({ title: '', description: '', items: [], notes: '', photos: [], analysisResults: [] });
                }}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {dailyData.meals.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900">Today's Meals</h2>

            {dailyData.meals.map(meal => {
              const mealTotals = calculateMealTotals(meal.items || []);
              return (
                <div key={meal.id} className="border-l-4 border-green-500 pl-4 py-2 bg-green-50 rounded-r-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="text-lg font-semibold">{meal.title}</h3>
                    <span className="text-sm text-gray-500">
                      {new Date(meal.timestamp).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </span>
                  </div>

                  <div className="space-y-1 mb-3">
                    {meal.items.map((item, idx) => {
                      const itemMacros = calculateItemMacros(item);
                      const foodName = item.customFood ? item.customFood.name : 'Unknown Food';
                      return (
                        <div key={idx} className="text-sm text-gray-700 bg-white p-2 rounded">
                          <span className="font-medium">{foodName}</span>: {itemMacros.kcal} kcal | {itemMacros.p}g P | {itemMacros.c}g C | {itemMacros.f}g F
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-sm font-semibold text-green-900 bg-green-100 p-2 rounded">
                    Meal Total: {mealTotals.kcal} kcal | {mealTotals.p}g P | {mealTotals.c}g C | {mealTotals.f}g F
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NutritionTracker;
