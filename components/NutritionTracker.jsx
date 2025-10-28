'use client';
import React, { useState, useRef } from 'react';
import { Calendar, Target, TrendingUp, CheckCircle, AlertCircle, Settings, Save, Camera, Upload, Brain, Loader } from 'lucide-react';

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

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
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

  const capturePhoto = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (canvas && video) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      canvas.toBlob((blob) => {
        const photoUrl = URL.createObjectURL(blob);
        const photoId = `photo_${Date.now()}`;
        
        const newPhoto = {
          id: photoId,
          url: photoUrl,
          timestamp: new Date().toISOString(),
          blob: blob,
          analyzed: false
        };
        
        setNewMeal(prev => ({
          ...prev,
          photos: [...prev.photos, newPhoto]
        }));
      }, 'image/jpeg', 0.8);
    }
    
    stopCamera();
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const photoUrl = URL.createObjectURL(file);
      const photoId = `photo_${Date.now()}`;
      
      const newPhoto = {
        id: photoId,
        url: photoUrl,
        timestamp: new Date().toISOString(),
        blob: file,
        analyzed: false
      };
      
      setNewMeal(prev => ({
        ...prev,
        photos: [...prev.photos, newPhoto]
      }));
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const analyzeFromDescription = async () => {
    const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
      setAnalysisError('OpenAI API key not configured.');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const desc = (newMeal.description || '').trim();
      const photo = newMeal.photos[0] || null;
      const base64 = photo
        ? await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(photo.blob); })
        : null;

            const systemInstruction = `
You are a precision nutrition analyzer. Your job is to extract or calculate accurate macro totals.

INPUT: User may provide ONE of:
1. Food description (e.g., "2 bananas, 200g rice, grilled chicken breast")
2. Nutrition label text (e.g., "Per serving: 250 kcal, 15g protein, 30g carbs, 8g fat")
3. Both (description + label)

CRITICAL INSTRUCTIONS:
- If nutrition label data is provided, USE IT AS PRIMARY SOURCE (most accurate)
- If only food description, use USDA reference data below
- ALWAYS multiply by quantity (e.g., "3 bananas" = 3x individual banana values)
- Round to 1 decimal place for protein/carbs/fat
- Be CONSERVATIVE if uncertain

USDA Reference (per standard serving as noted):
- Banana (1 medium ~118g): 89 kcal, 1.1g protein, 23g carbs, 0.3g fat
- Rice (cooked, 1 cup ~195g): 206 kcal, 4.3g protein, 45g carbs, 0.4g fat
- Chicken breast (cooked, 3.5oz ~100g): 165 kcal, 31g protein, 0g carbs, 3.6g fat
- Egg (1 medium ~50g): 78 kcal, 6.3g protein, 0.6g carbs, 5.3g fat
- Bread (1 slice ~28g): 79 kcal, 2.7g protein, 14g carbs, 1g fat
- Broccoli (cooked, 1 cup ~156g): 55 kcal, 3.7g protein, 11g carbs, 0.6g fat
- Pasta (cooked, 1 cup ~140g): 220 kcal, 8g protein, 43g carbs, 1.3g fat
- Olive oil (1 tbsp ~14g): 119 kcal, 0g protein, 0g carbs, 14g fat
- Milk (1 cup ~240ml): 149 kcal, 8g protein, 12g carbs, 8g fat
- Oats (1 cup dry ~156g): 607 kcal, 26g protein, 104g carbs, 11g fat
- Yogurt (1 cup ~227g): 149 kcal, 10g protein, 11g carbs, 5g fat
- Salmon (3.5oz cooked ~100g): 208 kcal, 20g protein, 0g carbs, 13g fat
- Almonds (1 oz ~28g): 161 kcal, 6g protein, 6g carbs, 14g fat
- Cheese (1 oz ~28g): 113 kcal, 7g protein, 0.4g carbs, 9g fat

PARSING LOGIC:
1. Look for numbers + food names (e.g., "2 bananas" = multiply banana ref by 2)
2. Look for "grams" or "g" notation (e.g., "200g rice" = scale rice reference by quantity)
3. Look for label-style text (e.g., "per 100g: 320 kcal..." or "Nutrition: 15g protein")
4. If quantities unclear, assume standard serving size

EXAMPLES:
Input: "2 bananas, 200g cooked rice, 1 chicken breast"
→ (2×89) + (206×(200/195)) + 165 = 178 + 211 + 165 = 554 kcal, 33g P, 91g C, 4.7g F

Input: "Per serving: 320 kcal, 12g protein, 45g carbs, 10g fat. Had 1.5 servings"
→ 480 kcal, 18g P, 67.5g C, 15g F

Input: "1 egg, slice of toast, butter"
→ 78 + 79 + (119×0.5 for ~0.5 tbsp butter) = ~218 kcal, 9g P, 14.6g C, 12g F

Return ONLY this JSON, no markdown, no explanation:
{
  "title": "meal name (e.g., Chicken & Rice)",
  "summary": "one-line description",
  "totals": {
    "kcal": number,
    "protein": number,
    "carbs": number,
    "fat": number
  },
  "confidence": 0.0 to 1.0,
  "source": "label" or "estimated"
}

CONFIDENCE SCORING:
- 0.95-1.0 = Label data provided
- 0.8-0.95 = Specific quantities + food names
- 0.6-0.8 = Vague quantities or mixed data
- <0.6 = Uncertain (but still estimate)
`;


      const content = [
        { type: "text", text: systemInstruction },
        { type: "text", text: desc || "No user description provided." }
      ];
      if (base64) content.push({ type: "image_url", image_url: { url: base64, detail: "high" } });

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content }],
          max_tokens: 600,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`GPT-4 API error: ${response.status} - ${txt}`);
      }

      const data = await response.json();
      console.log('Raw response text:', analysisText);
      let analysisText = data.choices?.[0]?.message?.content || '';

           let jsonText = analysisText.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.includes('``````json')[1].split('```
      else if (jsonText.includes('```')) jsonText = jsonText.split('``````')[0].trim();
      
      // Remove leading/trailing backticks
      jsonText = jsonText.replace(/^`+|`+$/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (parseError) {
        // If JSON parse fails, try to extract JSON object from text
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            // Last resort: create default response from description
            const desc = (newMeal.description || '').trim();
            parsed = {
              title: desc.slice(0, 40) || 'Meal',
              summary: desc.slice(0, 80) || 'Analyzed meal',
              totals: { kcal: 500, protein: 25, carbs: 60, fat: 15 },
              confidence: 0.3,
              source: 'estimated'
            };
          }
        } else {
          // Completely failed - use default
          const desc = (newMeal.description || '').trim();
          parsed = {
            title: desc.slice(0, 40) || 'Meal',
            summary: desc.slice(0, 80) || 'Analyzed meal',
            totals: { kcal: 500, protein: 25, carbs: 60, fat: 15 },
            confidence: 0.2,
            source: 'estimated'
          };
        }
      }


      const title = parsed.title || (desc ? desc.slice(0, 40) : 'Meal');
      const totals = parsed.totals || {};
      const customFood = {
        name: parsed.summary || title,
        kcal: Math.max(0, Math.round(Number(totals.kcal) || 0)),
        p: Math.max(0, Math.round((Number(totals.protein) || 0) * 10) / 10),
        c: Math.max(0, Math.round((Number(totals.carbs) || 0) * 10) / 10),
        f: Math.max(0, Math.round((Number(totals.fat) || 0) * 10) / 10),
      };

      const item = {
        id: `item_${Date.now()}`,
        ref: '',
        servings: '1',
        measured: 'servings',
        fraction: 1,
        aiDetected: true,
        confidence: Math.min(0.99, Math.max(0, Number(parsed.confidence) || 0.8)),
        customFood,
        editable: true
      };

      setNewMeal(prev => ({
        ...prev,
        title: prev.title || title,
        items: [item],
        analysisResults: [
          ...prev.analysisResults,
          {
            photoId: newMeal.photos?.[0]?.id || null,
            detectedFoods: [{ name: customFood.name, confidence: item.confidence, estimatedNutrition: customFood }],
            totalEstimatedCalories: customFood.kcal,
            suggestedMealType: prev.title || title,
            confidence: item.confidence,
            analysisMethod: base64 ? 'GPT-4o (text + photo)' : 'GPT-4o (text only)',
            analysisNotes: parsed.summary || 'Generated from description'
          }
        ],
        photos: prev.photos.map(p => (p.id === newMeal.photos?.[0]?.id ? { ...p, analyzed: true } : p))
      }));
    } catch (err) {
      console.error('Description analysis error:', err);
      setAnalysisError(err.message || 'Failed to analyze description.');
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
              customFood: {
                ...item.customFood,
                ...value
              }
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
      meal.timestamp.startsWith(currentDate) && !meal.correction_of_meal_id
    );

    const totals = dayMeals.reduce((daily, meal) => {
      const mealTotals = calculateMealTotals(meal.items);
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
    const remaining_p = target_p_g - totals.p;
    const remaining_c = target_c_g - totals.c;
    const remaining_f = target_f_g - totals.f;

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
      photos: newMeal.photos,
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
    <div className="max-w-4xl mx-auto p-6 bg-gray-50 min-h-screen">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-blue-900">Calories</h3>
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-2xl font-bold text-blue-900">{dailyData.totals.kcal}</p>
            <p className="text-sm text-blue-700">/ {dailyData.targets.kcal} target</p>
            <p className="text-sm text-blue-600">{dailyData.remaining.kcal} remaining</p>
          </div>

          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-green-900">Protein</h3>
              {dailyData.status.protein_ok ? 
                <CheckCircle className="h-5 w-5 text-green-600" /> : 
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              }
            </div>
            <p className="text-2xl font-bold text-green-900">{dailyData.totals.p}g</p>
            <p className="text-sm text-green-700">/ {dailyData.targets.p_g}g target</p>
            <p className="text-sm text-green-600">{Math.round(dailyData.remaining.p_g * 10) / 10}g remaining</p>
          </div>

          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-purple-900">Macros</h3>
              <div className="flex space-x-1">
                {dailyData.status.protein_ok && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                {dailyData.status.carbs_ok && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                {dailyData.status.fat_ok && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
              </div>
            </div>
            <p className="text-sm text-purple-700">
              P: {dailyData.totals.p_pct}% | C: {dailyData.totals.c_pct}% | F: {dailyData.totals.f_pct}%
            </p>
            <p className="text-sm text-purple-600">
              Target: {userConfig.targets.macro_split_pct.protein}% | {userConfig.targets.macro_split_pct.carbs}% | {userConfig.targets.macro_split_pct.fat}%
            </p>
          </div>
        </div>

        <div className="mb-6">
          <button
            onClick={() => setShowAddMeal(true)}
            className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Camera className="h-5 w-5" />
            <span>Add Meal</span>
          </button>
        </div>

        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">Nutrition Settings</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Daily Calorie Target</label>
                  <input
                    type="number"
                    value={userConfig.targets.daily_calories_kcal}
                    onChange={(e) => updateTargets({ daily_calories_kcal: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Body Weight (lbs)</label>
                  <input
                    type="number"
                    value={userConfig.body_weight_lb}
                    onChange={(e) => updateUserConfig({ body_weight_lb: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Save className="h-4 w-4" />
                  <span>Save Settings</span>
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
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
              <h3 className="text-lg font-semibold mb-4">Take Photo of Food</h3>
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
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Camera className="h-4 w-4" />
                  <span>Capture</span>
                </button>
                <button
                  onClick={stopCamera}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showAddMeal && (
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <h3 className="text-lg font-semibold mb-4">Add Meal</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Meal Title</label>
              <input
                type="text"
                value={newMeal.title}
                onChange={(e) => setNewMeal(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Breakfast, Lunch, Dinner"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">What did you have?</label>
              <textarea
                value={newMeal.description}
                onChange={(e) => setNewMeal(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Type: 2 bananas, 200g rice, grilled chicken..."
              />
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-gray-700">Photo (optional)</label>
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
                          className="w-24 h-24 object-cover rounded-md"
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

            {isAnalyzing && (
              <div className="flex items-center space-x-2 mb-4 p-4 bg-blue-100 rounded-md">
                <Loader className="h-6 w-6 text-blue-600 animate-spin" />
                <span className="text-blue-800 font-medium">Analyzing...</span>
              </div>
            )}

            {analysisError && (
              <div className="mb-4 p-3 bg-red-100 rounded-md">
                <span className="text-red-800">{analysisError}</span>
              </div>
            )}

            {newMeal.items.length > 0 && (
              <div className="mb-6 p-4 bg-white rounded-md border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Estimated Nutrition:</h4>
                {newMeal.items.map((item) => {
                  const macros = calculateItemMacros(item);
                  const foodName = item.customFood ? item.customFood.name : 'Unknown Food';
                  return (
                    <div key={item.id}>
                      <p className="font-medium text-gray-900">{foodName}</p>
                      <p className="text-sm text-gray-600">
                        {macros.kcal} kcal | {macros.p}g P | {macros.c}g C | {macros.f}g F
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex space-x-4">
              <button
                onClick={analyzeFromDescription}
                disabled={!newMeal.description.trim()}
                className="flex items-center space-x-2 px-5 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <Brain className="h-4 w-4" />
                <span>Analyze & Add</span>
              </button>
              <button
                onClick={saveMeal}
                disabled={newMeal.items.length === 0}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Save Meal
              </button>
              <button
                onClick={() => setShowAddMeal(false)}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
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
              const mealTotals = calculateMealTotals(meal.items);
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

            <div className="mt-8 space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Daily Summary [{currentDate}]</h2>
              
              <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-blue-700">Total Calories</p>
                    <p className="text-3xl font-bold text-blue-900">{dailyData.totals.kcal}</p>
                    <p className="text-sm text-blue-600">/ {dailyData.targets.kcal} goal</p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Protein</p>
                    <p className="text-3xl font-bold text-green-900">{dailyData.totals.p}g</p>
                    <p className="text-sm text-green-600">/ {dailyData.targets.p_g}g goal</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-700">Carbs</p>
                    <p className="text-3xl font-bold text-purple-900">{dailyData.totals.c}g</p>
                    <p className="text-sm text-purple-600">/ {dailyData.targets.c_g}g goal</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-700">Fat</p>
                    <p className="text-3xl font-bold text-orange-900">{dailyData.totals.f}g</p>
                    <p className="text-sm text-orange-600">/ {dailyData.targets.f_g}g goal</p>
                  </div>
                </div>
                
                <div className="mt-4 p-3 bg-gray-100 rounded">
                  <p className="text-sm text-gray-700">
                    Breakdown: <span className="font-semibold">{dailyData.totals.p_pct}% Protein</span> | 
                    <span className="font-semibold"> {dailyData.totals.c_pct}% Carbs</span> | 
                    <span className="font-semibold"> {dailyData.totals.f_pct}% Fat</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NutritionTracker;
