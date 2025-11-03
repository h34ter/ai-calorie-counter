'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Target, Settings, Upload, Loader, X } from 'lucide-react';

const fetchState = async (userId) => {
  try {
    const res = await fetch(`/api/state?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load state');
    return await res.json();
  } catch (e) {
    console.error('Fetch error:', e);
    return null;
  }
};

let saveTimer = null;
const saveState = async (userConfig, meals) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const payload = {
        user_id: userConfig?.user_id || 'luis',
        userConfig: userConfig,
        meals: meals || []
      };
      
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Save error:', e);
    }
  }, 400);
};

// CHANGE THESE DEFAULTS - they'll be used only first time, then always loaded from Blob
const DEFAULT_CONFIG = {
  user_id: "luis",
  body_weight_lb: 150,
  timezone: "America/New_York",
  targets: {
    daily_calories_kcal: 2400,
    macro_split_pct: { protein: 30, carbs: 45, fat: 25 },
    protein_min_g: null
  },
  day_reset_rule: "manual_or_midnight"
};

const NutritionTracker = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [userConfig, setUserConfig] = useState(null);
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

  const fileInputRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');

  // LOAD ONCE ON MOUNT
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchState('luis');
      if (cancelled) return;
      
      if (data?.userConfig) {
        setUserConfig(data.userConfig);
      } else {
        setUserConfig(DEFAULT_CONFIG);
      }
      
      if (Array.isArray(data?.meals)) {
        setMeals(data.meals);
      }
      
      setIsLoading(false);
    })();
    
    return () => { cancelled = true; };
  }, []);

  // SAVE WHENEVER userConfig OR meals CHANGE
  useEffect(() => {
    if (!isLoading && userConfig) {
      saveState(userConfig, meals);
      setSaveStatus('✓ Saved');
      const timer = setTimeout(() => setSaveStatus(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [userConfig, meals, isLoading]);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
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

    const config = userConfig || DEFAULT_CONFIG;
    const target_p_g = Math.round((config.targets.daily_calories_kcal * config.targets.macro_split_pct.protein / 100) / 4);
    const target_c_g = Math.round((config.targets.daily_calories_kcal * config.targets.macro_split_pct.carbs / 100) / 4);
    const target_f_g = Math.round((config.targets.daily_calories_kcal * config.targets.macro_split_pct.fat / 100) / 9);

    const remaining_kcal = config.targets.daily_calories_kcal - totals.kcal;

    return {
      totals: { ...totals, p_kcal, c_kcal, f_kcal, p_pct, c_pct, f_pct },
      targets: { kcal: config.targets.daily_calories_kcal, p_g: target_p_g, c_g: target_c_g, f_g: target_f_g },
      remaining: { kcal: remaining_kcal },
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

  if (isLoading || !userConfig) {
    return (
      <div className="w-full min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const dailyData = calculateDailyTotals();

  return (
    <div className="w-full min-h-screen bg-gray-50 pb-6">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Target className="h-6 w-6 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900">Nutrition</h1>
          </div>
          <div className="flex items-center space-x-3">
            {saveStatus && <span className="text-xs text-green-600 font-medium">{saveStatus}</span>}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <Settings className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      {/* BIG MACROS */}
      <div className="px-4 pt-4 pb-4">
        <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-5 rounded-xl shadow-lg">
          <h2 className="text-white text-sm font-bold mb-4">📊 TODAY</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-white/20">
              <p className="text-white/70 text-xs font-semibold mb-1">CALS</p>
              <p className="text-white text-3xl font-black">{dailyData.totals.kcal}</p>
              <p className="text-white/60 text-xs mt-1">/ {dailyData.targets.kcal}</p>
              <p className="text-green-300 text-xs font-bold mt-1">{dailyData.remaining.kcal} left</p>
            </div>
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-green-400/20">
              <p className="text-green-200 text-xs font-semibold mb-1">PROTEIN</p>
              <p className="text-green-300 text-3xl font-black">{dailyData.totals.p}g</p>
              <p className="text-green-200/70 text-xs mt-1">{dailyData.totals.p_pct}%</p>
            </div>
            <div className="bg-white/10 backdrop-blur p-4 rounded-lg border border-purple-400/20">
              <p className="text-purple-200 text-xs font-semibold mb-1">CARBS</p>
              <p className="text-purple-300 text-3xl font-black">{dailyData.totals.c}g</p>
              <p className="text-purple-200/70 text-xs mt-1">{dailyData.totals.c_pct}%</p>
            </div>
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
          <Upload className="h-5 w-5" />
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

      {/* Add Meal Modal */}
      {showAddMeal && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Add Meal</h3>
            <button
              onClick={() => {
                setShowAddMeal(false);
                setNewMeal({ title: '', description: '', items: [], notes: '', photos: [], analysisResults: [] });
              }}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex-1 px-4 py-4 overflow-y-auto space-y-4 pb-24">
            <div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                <Upload className="h-5 w-5" />
                <span>Upload Photo</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />

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

            {isAnalyzing && (
              <div className="flex items-center space-x-2 p-3 bg-blue-100 rounded-lg">
                <Loader className="h-5 w-5 text-blue-600 animate-spin" />
                <span className="text-sm text-blue-800">🤖 Analyzing...</span>
              </div>
            )}

            {analysisError && (
              <div className="p-3 bg-red-100 rounded-lg">
                <p className="text-sm text-red-800">❌ {analysisError}</p>
              </div>
            )}

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

          <div className="flex-1 px-4 py-4 space-y-4 pb-20">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <label className="text-sm font-semibold text-gray-900 block mb-2">Daily Calorie Target</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={userConfig.targets.daily_calories_kcal}
                  onChange={(e) => updateTargets({ daily_calories_kcal: parseInt(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-bold"
                />
                <span className="text-sm font-bold text-gray-700">kcal</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">Your daily calorie goal. Saves immediately when changed.</p>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <label className="text-sm font-semibold text-gray-900 block mb-2">Body Weight</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={userConfig.body_weight_lb}
                  onChange={(e) => updateUserConfig({ body_weight_lb: parseFloat(e.target.value) || 0 })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-bold"
                />
                <span className="text-sm font-bold text-gray-700">lbs</span>
              </div>
              <p className="text-xs text-gray-600 mt-2">Update your weight anytime. Saves immediately.</p>
            </div>

            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Macro Split (%)</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-bold text-gray-700">🥚 Protein</label>
                    <span className="text-lg font-black text-green-600">{userConfig.targets.macro_split_pct.protein}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={userConfig.targets.macro_split_pct.protein}
                    onChange={(e) => updateTargets({
                      macro_split_pct: {
                        ...userConfig.targets.macro_split_pct,
                        protein: parseInt(e.target.value) || 0
                      }
                    })}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-bold text-gray-700">🍞 Carbs</label>
                    <span className="text-lg font-black text-purple-600">{userConfig.targets.macro_split_pct.carbs}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={userConfig.targets.macro_split_pct.carbs}
                    onChange={(e) => updateTargets({
                      macro_split_pct: {
                        ...userConfig.targets.macro_split_pct,
                        carbs: parseInt(e.target.value) || 0
                      }
                    })}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-bold text-gray-700">🥑 Fat</label>
                    <span className="text-lg font-black text-orange-600">{userConfig.targets.macro_split_pct.fat}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={userConfig.targets.macro_split_pct.fat}
                    onChange={(e) => updateTargets({
                      macro_split_pct: {
                        ...userConfig.targets.macro_split_pct,
                        fat: parseInt(e.target.value) || 0
                      }
                    })}
                    className="w-full"
                  />
                </div>

                <p className="text-xs text-gray-600 mt-3">Total: {userConfig.targets.macro_split_pct.protein + userConfig.targets.macro_split_pct.carbs + userConfig.targets.macro_split_pct.fat}%</p>
              </div>
              <p className="text-xs text-gray-600 mt-3">Macro split saves immediately when changed. All changes persist forever.</p>
            </div>

            <div className="bg-blue-100 p-3 rounded-lg border border-blue-300">
              <p className="text-xs text-blue-900">✓ EVERYTHING you change saves automatically and persists on refresh.</p>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3">
            <button
              onClick={() => setShowSettings(false)}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NutritionTracker;
