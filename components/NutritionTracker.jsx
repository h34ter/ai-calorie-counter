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

const FOOD_CATALOG = {
  // Empty - all food detection now relies purely on AI analysis
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
        
        analyzePhoto(newPhoto);
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
      
      analyzePhoto(newPhoto);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Real food analysis function using GPT-5 Vision + USDA Database
  const performRealFoodAnalysis = async (base64Image, photo) => {
    try {
      // Step 1: Use GPT-5 Vision to analyze the food image
      const gptAnalysis = await analyzeImageWithGPT5(base64Image);
      
      // Step 2: Look up precise nutrition data from USDA database
      const nutritionData = await lookupUSDANutrition(gptAnalysis.detectedFoods);
      
      // Step 3: Combine GPT-5 analysis with USDA nutrition data
      const combinedResults = combineAnalysisResults(gptAnalysis, nutritionData);
      
      return combinedResults;
      
    } catch (error) {
      console.error('Real food analysis failed:', error);
      throw new Error('AI food analysis service temporarily unavailable');
    }
  };

  // GPT-4 Vision API Integration with detailed error handling
  const analyzeImageWithGPT5 = async (base64Image) => {
    const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    
    try {
      console.log('Starting GPT-4 Vision analysis...');
      console.log('Image data length:', base64Image.length);
      if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
  throw new Error('OpenAI API key not configured...');
}
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze this food image and return a JSON response with the following structure:
                  {
                    "detectedFoods": [
                      {
                        "name": "Food name (specific, e.g., 'Grilled Chicken Breast')",
                        "confidence": 0.95,
                        "estimatedWeight": "weight in grams",
                        "estimatedServings": 1.5,
                        "measurementType": "cooked/servings/pieces",
                        "portionDescription": "detailed portion description"
                      }
                    ],
                    "suggestedMealType": "Breakfast/Lunch/Dinner/Snack",
                    "confidence": 0.90,
                    "analysisNotes": "Any additional observations"
                  }
                  
                  Be as accurate as possible with food identification and portion estimation. If multiple foods are visible, include all of them.`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: base64Image,
                    detail: "high"
                  }
                }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: 0.1
        })
      });

      console.log('API Response status:', response.status);
      console.log('API Response headers:', response.headers);

      if (!response.ok) {
        const errorData = await response.text();
        console.error('API Error Response:', errorData);
        throw new Error(`GPT-4 API error: ${response.status} - ${errorData}`);
      }

const data = await response.json();
      console.log('Raw API response:', data);
      
      const analysisText = data.choices[0].message.content;
      console.log('Analysis text:', analysisText);
      
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = analysisText;
        
        if (analysisText.includes('```
          jsonText = analysisText.split('```json').split('```
        } else if (analysisText.includes('```')) {
          jsonText = analysisText.split('``````')[0].trim();
        }
        
        // Remove any remaining backticks or whitespace
        jsonText = jsonText.replace(/^`+|`+$/g, '').trim();
        
        console.log('Cleaned JSON text:', jsonText);
        
        // Parse the JSON response from GPT-4
        const analysis = JSON.parse(jsonText);
        console.log('Parsed analysis:', analysis);
        return analysis;
      } catch (parseError) {
        console.error('Failed to parse GPT-4 response:', analysisText);
        console.error('Parse error:', parseError);
        
        // Try to extract just the object if there's extra content
        try {
          const objectMatch = analysisText.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            console.log('Attempting recovery with extracted object');
            return JSON.parse(objectMatch[0]);
          }
        } catch (recoveryError) {
          console.error('Recovery attempt failed:', recoveryError);
        }
        
        throw new Error(`Invalid response format from GPT-4: ${parseError.message}`);
      }

        
        // Try to extract just the object if there's extra content
        try {
          const objectMatch = analysisText.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            console.log('Attempting recovery with extracted object');
            return JSON.parse(objectMatch[0]);
          }
        } catch (recoveryError) {
          console.error('Recovery attempt failed:', recoveryError);
        }
        
        throw new Error(`Invalid response format from GPT-4: ${parseError.message}`);
      }
    } catch (error) {
      console.error('GPT-4 Vision analysis error:', error);
      throw error;
    }
  };

  // USDA FoodData Central API Integration (Free)
  const lookupUSDANutrition = async (detectedFoods) => {
    const USDA_API_KEY = 'DEMO_KEY'; // You can get a free key from USDA
    const nutritionResults = [];

    for (const food of detectedFoods) {
      try {
        // Search for food in USDA database
        const searchResponse = await fetch(
          `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(food.name)}&pageSize=5&api_key=${USDA_API_KEY}`
        );
        
        if (!searchResponse.ok) continue;
        
        const searchData = await searchResponse.json();
        
        if (searchData.foods && searchData.foods.length > 0) {
          // Get detailed nutrition for the best match
          const bestMatch = searchData.foods[0];
          const detailResponse = await fetch(
            `https://api.nal.usda.gov/fdc/v1/food/${bestMatch.fdcId}?api_key=${USDA_API_KEY}`
          );
          
          if (detailResponse.ok) {
            const nutritionDetail = await detailResponse.json();
            const nutrition = extractNutritionFromUSDA(nutritionDetail);
            
            nutritionResults.push({
              foodName: food.name,
              usdaMatch: bestMatch.description,
              nutrition: nutrition,
              originalFood: food
            });
          }
        }
      } catch (error) {
        console.error(`USDA lookup failed for ${food.name}:`, error);
        // Use estimated nutrition if USDA lookup fails
        nutritionResults.push({
          foodName: food.name,
          nutrition: getEstimatedNutrition(food.name),
          originalFood: food,
          source: 'estimated'
        });
      }
    }

    return nutritionResults;
  };

  // Extract nutrition data from USDA response
  const extractNutritionFromUSDA = (usdaFood) => {
    const nutrients = usdaFood.foodNutrients || [];
    
    const findNutrient = (nutrientId) => {
      const nutrient = nutrients.find(n => n.nutrient?.id === nutrientId);
      return nutrient?.amount || 0;
    };

    return {
      kcal: findNutrient(1008), // Energy (kcal)
      protein: findNutrient(1003), // Protein
      carbs: findNutrient(1005), // Carbohydrates
      fat: findNutrient(1004), // Total lipid (fat)
      fiber: findNutrient(1079), // Fiber
      source: 'USDA FoodData Central'
    };
  };

  // Fallback nutrition estimation for foods not found in USDA
  const getEstimatedNutrition = (foodName) => {
    const estimates = {
      // Common foods with reasonable estimates per 100g
      'chicken': { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
      'rice': { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      'egg': { kcal: 155, protein: 13, carbs: 1.1, fat: 11 },
      'bread': { kcal: 265, protein: 9, carbs: 49, fat: 3.2 },
      'broccoli': { kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
      'banana': { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 }
    };

    const lowerFoodName = foodName.toLowerCase();
    for (const [key, nutrition] of Object.entries(estimates)) {
      if (lowerFoodName.includes(key)) {
        return { ...nutrition, source: 'estimated' };
      }
    }

    // Default fallback
    return { kcal: 100, protein: 5, carbs: 15, fat: 3, source: 'estimated' };
  };

  // Combine GPT-5 analysis with USDA nutrition data
  const combineAnalysisResults = (gptAnalysis, nutritionData) => {
    const detectedFoods = gptAnalysis.detectedFoods.map(gptFood => {
      const nutritionMatch = nutritionData.find(n => n.foodName === gptFood.name);
      
      if (nutritionMatch) {
        // Calculate nutrition based on estimated portion
        const portionMultiplier = calculatePortionMultiplier(gptFood);
        
        return {
          name: gptFood.name,
          confidence: gptFood.confidence,
          estimatedWeight: gptFood.estimatedWeight,
          estimatedServings: gptFood.estimatedServings,
          measurementType: gptFood.measurementType,
          estimatedNutrition: {
            kcal: Math.round(nutritionMatch.nutrition.kcal * portionMultiplier),
            protein: Math.round(nutritionMatch.nutrition.protein * portionMultiplier * 10) / 10,
            carbs: Math.round(nutritionMatch.nutrition.carbs * portionMultiplier * 10) / 10,
            fat: Math.round(nutritionMatch.nutrition.fat * portionMultiplier * 10) / 10
          },
          nutritionSource: nutritionMatch.nutrition.source || 'USDA',
          usdaMatch: nutritionMatch.usdaMatch
        };
      }

      // Fallback if no USDA match
      return {
        name: gptFood.name,
        confidence: gptFood.confidence,
        estimatedWeight: gptFood.estimatedWeight,
        estimatedServings: gptFood.estimatedServings,
        measurementType: gptFood.measurementType,
        estimatedNutrition: getEstimatedNutrition(gptFood.name),
        nutritionSource: 'estimated'
      };
    });

    const totalCalories = detectedFoods.reduce((sum, food) => sum + food.estimatedNutrition.kcal, 0);

    return {
      detectedFoods,
      suggestedMealType: gptAnalysis.suggestedMealType,
      totalEstimatedCalories: totalCalories,
      confidence: gptAnalysis.confidence,
      analysisMethod: 'GPT-5 Vision + USDA Database',
      analysisNotes: gptAnalysis.analysisNotes
    };
  };

  // Calculate portion multiplier based on GPT-5 estimates
  const calculatePortionMultiplier = (gptFood) => {
    if (gptFood.estimatedWeight) {
      // USDA data is typically per 100g
      return parseFloat(gptFood.estimatedWeight) / 100;
    }
    if (gptFood.estimatedServings) {
      return parseFloat(gptFood.estimatedServings);
    }
    return 1; // Default to 1 serving
  };

  const analyzePhoto = async (photo) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    
    try {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(photo.blob);
      });

      const realAnalysis = await performRealFoodAnalysis(base64, photo);
      
      setNewMeal(prev => ({
        ...prev,
        photos: prev.photos.map(p => 
          p.id === photo.id ? { ...p, analyzed: true } : p
        ),
        analysisResults: [...prev.analysisResults, {
          photoId: photo.id,
          ...realAnalysis
        }]
      }));

      if (realAnalysis.detectedFoods && realAnalysis.detectedFoods.length > 0) {
        const newItems = realAnalysis.detectedFoods.map((food, index) => ({
          id: `item_${Date.now()}_${index}`,
          ref: '',
          grams: food.estimatedWeight || '',
          servings: food.estimatedServings || '1',
          measured: food.measurementType || 'servings',
          fraction: 1,
          aiDetected: true,
          confidence: food.confidence,
          customFood: {
            name: food.name,
            kcal: food.estimatedNutrition.kcal,
            p: food.estimatedNutrition.protein,
            c: food.estimatedNutrition.carbs,
            f: food.estimatedNutrition.fat
          },
          editable: true
        }));

        setNewMeal(prev => ({
          ...prev,
          items: newItems,
          title: prev.title || realAnalysis.suggestedMealType || 'Detected Meal'
        }));
      }
      
    } catch (error) {
      setAnalysisError('Failed to analyze photo. Please try again.');
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
      source: 'photo'
    };

    setMeals(prev => [...prev, meal]);
    setNewMeal({
      title: '',
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
                  <span>Capture & Analyze</span>
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
            <h3 className="text-lg font-semibold mb-4">Add Meal with AI Photo Analysis</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Meal Title</label>
              <input
                type="text"
                value={newMeal.title}
                onChange={(e) => setNewMeal(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Breakfast, Lunch, Snack (auto-filled from AI)"
              />
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-gray-700">Take or Upload Food Photo</label>
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
              
              {newMeal.photos.length === 0 && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <Camera className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-500 mb-2">Take a photo or upload an image of your food</p>
                  <p className="text-sm text-gray-400">AI will automatically analyze the photo and estimate nutrition</p>
                </div>
              )}
              
              {isAnalyzing && (
                <div className="flex items-center space-x-2 mb-3 p-4 bg-blue-100 rounded-md">
                  <Loader className="h-6 w-6 text-blue-600 animate-spin" />
                  <div>
                    <span className="text-blue-800 font-medium">Analyzing photo with AI...</span>
                    <p className="text-sm text-blue-600">Detecting food items and estimating nutrition</p>
                  </div>
                </div>
              )}
              
              {analysisError && (
                <div className="mb-3 p-3 bg-red-100 rounded-md">
                  <span className="text-red-800">{analysisError}</span>
                </div>
              )}
              
              {newMeal.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {newMeal.photos.map((photo, index) => (
                    <div key={photo.id} className="relative">
                      <img
                        src={photo.url}
                        alt={`Food photo ${index + 1}`}
                        className="w-full h-32 object-cover rounded-md"
                      />
                      {photo.analyzed && (
                        <div className="absolute top-2 left-2 bg-green-500 text-white text-xs rounded-full px-2 py-1 flex items-center space-x-1">
                          <Brain className="h-3 w-3" />
                          <span>AI Analyzed</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setNewMeal(prev => ({
                          ...prev,
                          photos: prev.photos.filter(p => p.id !== photo.id),
                          analysisResults: prev.analysisResults.filter(r => r.photoId !== photo.id),
                          items: []
                        }))}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        Ãƒâ€”
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {newMeal.analysisResults.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Ã°Å¸Â¤â€“ AI Analysis Results:</h4>
                  {newMeal.analysisResults.map((result, index) => (
                    <div key={index} className="p-4 bg-green-50 rounded-md mb-3 border border-green-200">
                      <div className="flex items-center space-x-2 mb-2">
                        <Brain className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium text-green-800">
                          Detected Foods: {result.detectedFoods?.map(f => f.name).join(', ')}
                        </span>
                      </div>
                      <div className="text-sm text-green-700 space-y-1">
                        <div>Estimated Total Calories: ~{result.totalEstimatedCalories} kcal</div>
                        <div>AI Confidence: {Math.round(result.confidence * 100)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {newMeal.items.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Detected Food Items (Editable):</h4>
                  <div className="space-y-4">
                    {newMeal.items.map((item) => {
                      const macros = calculateItemMacros(item);
                      const foodName = item.customFood ? item.customFood.name : 'Unknown Food';
                      return (
                        <div key={item.id} className="p-4 bg-white rounded-md border border-gray-200">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={foodName}
                                onChange={(e) => updateFoodItem(item.id, 'customFood', { ...item.customFood, name: e.target.value })}
                                className="font-medium text-gray-900 border-b border-gray-300 bg-transparent focus:outline-none focus:border-blue-500"
                                placeholder="Food name"
                              />
                              <span className="text-green-600 text-xs bg-green-100 px-2 py-1 rounded-full">
                                Ã°Å¸Â¤â€“ AI Detected {item.confidence ? `(${Math.round(item.confidence * 100)}%)` : ''}
                              </span>
                            </div>
                            <button
                              onClick={() => removeFoodItem(item.id)}
                              className="text-red-500 hover:text-red-700 text-sm"
                            >
                              Remove
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Calories</label>
                              <input
                                type="number"
                                value={item.customFood?.kcal || 0}
                                onChange={(e) => updateFoodItem(item.id, 'customFood', { 
                                  ...item.customFood, 
                                  kcal: parseInt(e.target.value) || 0 
                                })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Protein (g)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={item.customFood?.p || 0}
                                onChange={(e) => updateFoodItem(item.id, 'customFood', { 
                                  ...item.customFood, 
                                  p: parseFloat(e.target.value) || 0 
                                })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Carbs (g)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={item.customFood?.c || 0}
                                onChange={(e) => updateFoodItem(item.id, 'customFood', { 
                                  ...item.customFood, 
                                  c: parseFloat(e.target.value) || 0 
                                })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Fat (g)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={item.customFood?.f || 0}
                                onChange={(e) => updateFoodItem(item.id, 'customFood', { 
                                  ...item.customFood, 
                                  f: parseFloat(e.target.value) || 0 
                                })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Serving Size</label>
                              <input
                                type="number"
                                step="0.1"
                                value={item.servings || 1}
                                onChange={(e) => updateFoodItem(item.id, 'servings', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            {item.measured === 'cooked' && (
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Weight (g)</label>
                                <input
                                  type="number"
                                  value={item.grams || ''}
                                  onChange={(e) => updateFoodItem(item.id, 'grams', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>
                            )}
                          </div>

                          <div className="text-sm font-medium text-blue-900 bg-blue-50 p-2 rounded">
                            Total: {macros.kcal} kcal | {macros.p}g protein | {macros.c}g carbs | {macros.f}g fat
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => {
                      const newItem = {
                        id: `manual_${Date.now()}`,
                        ref: '',
                        servings: '1',
                        measured: 'servings',
                        fraction: 1,
                        aiDetected: false,
                        customFood: {
                          name: 'Manual Food Item',
                          kcal: 0,
                          p: 0,
                          c: 0,
                          f: 0
                        },
                        editable: true
                      };
                      setNewMeal(prev => ({
                        ...prev,
                        items: [...prev.items, newItem]
                      }));
                    }}
                    className="mt-3 px-4 py-2 border border-dashed border-gray-400 rounded-md text-gray-600 hover:border-gray-600 hover:text-gray-800 transition-colors"
                  >
                    + Add Manual Food Item
                  </button>
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes (optional)</label>
              <textarea
                value={newMeal.notes}
                onChange={(e) => setNewMeal(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Any additional details about the meal..."
              />
            </div>

            <div className="flex space-x-4">
              <button
                onClick={saveMeal}
                disabled={newMeal.items.length === 0}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Save AI-Analyzed Meal
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
            <h2 className="text-xl font-semibold text-gray-900">Ã¢Â¸Â» Ã°Å¸Â¤â€“ Today's AI-Analyzed Meals</h2>
            
            {dailyData.meals.map(meal => {
              const mealTotals = calculateMealTotals(meal.items);
              return (
                <div key={meal.id} className="border-l-4 border-green-500 pl-4 py-2 bg-green-50 rounded-r-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="text-lg font-semibold">Ã°Å¸ÂÂ½Ã¯Â¸Â {meal.title}</h3>
                    <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full">AI Analyzed</span>
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
                          Ã°Å¸Â¤â€“ <span className="font-medium">{foodName}</span>: {itemMacros.kcal} kcal | {itemMacros.p}g P | {itemMacros.c}g C | {itemMacros.f}g F
                        </div>
                      );
                    })}
                  </div>
                  
                  <div className="text-sm font-semibold text-green-900 bg-green-100 p-2 rounded">
                    Ã°Å¸â€Â¢ Meal Total: {mealTotals.kcal} kcal | {mealTotals.p}g P | {mealTotals.c}g C | {mealTotals.f}g F
                  </div>
                  
                  {meal.notes && (
                    <div className="text-xs text-gray-600 mt-2 italic">Note: {meal.notes}</div>
                  )}

                  {meal.photos && meal.photos.length > 0 && (
                    <div className="mt-3">
                      <div className="flex space-x-2">
                        {meal.photos.map((photo, photoIdx) => (
                          <div key={photo.id} className="relative">
                            <img
                              src={photo.url}
                              alt={`${meal.title} photo ${photoIdx + 1}`}
                              className="w-20 h-20 object-cover rounded-md border-2 border-green-200"
                            />
                            <div className="absolute top-0 right-0 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                              <Brain className="h-2 w-2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="mt-8 space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Ã¢Â¸Â» Ã°Å¸â€œÅ  Daily Summary Ã¢â‚¬â€ [{currentDate}]</h2>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <table className="w-full">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 font-semibold">Macro</th>
                      <th className="py-2 font-semibold">Grams</th>
                      <th className="py-2 font-semibold">Calories</th>
                      <th className="py-2 font-semibold">% Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1">Protein</td>
                      <td className="py-1">{dailyData.totals.p} g</td>
                      <td className="py-1">{dailyData.totals.p_kcal}</td>
                      <td className="py-1">{dailyData.totals.p_pct}%</td>
                    </tr>
                    <tr>
                      <td className="py-1">Carbs</td>
                      <td className="py-1">{dailyData.totals.c} g</td>
                      <td className="py-1">{dailyData.totals.c_kcal}</td>
                      <td className="py-1">{dailyData.totals.c_pct}%</td>
                    </tr>
                    <tr>
                      <td className="py-1">Fat</td>
                      <td className="py-1">{dailyData.totals.f} g</td>
                      <td className="py-1">{dailyData.totals.f_kcal}</td>
                      <td className="py-1">{dailyData.totals.f_pct}%</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-1 font-semibold">Total</td>
                      <td className="py-1">Ã¢â‚¬â€</td>
                      <td className="py-1 font-semibold">{dailyData.totals.kcal}</td>
                      <td className="py-1">Ã¢â‚¬â€</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <h3 className="text-lg font-semibold text-green-900 mb-3">Ã°Å¸Å½Â¯ Daily Goals Status</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Calories:</span>
                    <span className="font-medium">{dailyData.totals.kcal} / {dailyData.targets.kcal} ({dailyData.remaining.kcal} remaining)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Protein:</span>
                    <span className="font-medium">{dailyData.totals.p}g / {dailyData.targets.p_g}g ({Math.round(dailyData.remaining.p_g * 10) / 10}g remaining)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Macro Balance:</span>
                    <span className="font-medium">
                      P: {dailyData.totals.p_pct}% | C: {dailyData.totals.c_pct}% | F: {dailyData.totals.f_pct}%
                    </span>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-green-100 rounded-md">
                  <div className="text-sm text-green-800">
                    Ã°Å¸Â¤â€“ <span className="font-medium">AI Analysis Summary:</span> {dailyData.meals.length} meals analyzed with computer vision today
                  </div>
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
