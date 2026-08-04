// Xacheus Completely Free AI (2026)
// NO API KEYS REQUIRED for basic use!
// Uses Pollinations.ai (keyless + anonymous) + optional user keys for better models

// ==================== KEYLESS FREE (Recommended) ====================

// Pollinations Text — completely free, no key, no signup
export async function callPollinationsText(prompt) {
  try {
    const res = await fetch("https://text.pollinations.ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helpful AI assistant for Xacheus. Be concise, professional, and sales-focused for African businesses." },
          { role: "user", content: prompt }
        ],
        model: "openai",
        private: true
      })
    });

    if (!res.ok) throw new Error("Pollinations unavailable");
    const text = await res.text();
    return text.trim() || generateSimulatedResponse(prompt);
  } catch (e) {
    console.warn("[Xacheus] Pollinations fallback:", e.message);
    return generateSimulatedResponse(prompt);
  }
}

// Pollinations Image — completely free, no key, no signup
export const POLLINATIONS_IMAGE = "https://image.pollinations.ai/prompt/";

export function getPollinationsImage(prompt, width = 800, height = 500) {
  const safe = encodeURIComponent(prompt);
  return `${POLLINATIONS_IMAGE}${safe}?width=${width}&height=${height}&seed=${Date.now()}`;
}

// ==================== OPTIONAL BETTER FREE KEYS ====================
// Users can paste keys here for higher quality (still free tiers)

export const FREE_AI_PROVIDERS = {
  gemini: {
    name: "Google Gemini (Better quality)",
    getKeyUrl: "https://aistudio.google.com/app/apikey",
    limits: "1,500 requests/day • No credit card"
  },
  groq: {
    name: "Groq (Very fast)",
    getKeyUrl: "https://console.groq.com/keys",
    limits: "~1,000 requests/day"
  }
};

// ==================== REAL KEY-BASED CALLS (only if user provides key) ====================

export async function callGemini(prompt, apiKey) {
  if (!apiKey) return callPollinationsText(prompt);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1200 }
    })
  });
  if (!res.ok) return callPollinationsText(prompt);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || callPollinationsText(prompt);
}

export async function callGroq(prompt, apiKey) {
  if (!apiKey) return callPollinationsText(prompt);
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200
    })
  });
  if (!res.ok) return callPollinationsText(prompt);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || callPollinationsText(prompt);
}

// ==================== MAIN FUNCTION (Always prefers free no-key) ====================

export async function generateWithAI(prompt, provider = "pollinations", apiKey = "") {
  const clean = prompt.trim();

  // 1. Always try keyless Pollinations first (completely free)
  if (!apiKey || provider === "pollinations") {
    return await callPollinationsText(clean);
  }

  // 2. If user provided a key, try the better model
  try {
    if (provider === "gemini") return await callGemini(clean, apiKey);
    if (provider === "groq") return await callGroq(clean, apiKey);
  } catch (e) {
    console.warn("Key-based AI failed, falling back to free Pollinations");
  }

  // 3. Final fallback
  return await callPollinationsText(clean);
}

// Very basic local fallback (only if everything fails)
function generateSimulatedResponse(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes("whatsapp")) {
    return `Hello! Thank you for your interest. Please tell us your location and how many you need — we'll send prices and delivery details right away.`;
  }
  if (lower.includes("post") || lower.includes("caption")) {
    return `Your next solution is here! Quality service for you. Message us on WhatsApp today.`;
  }
  return `Professional content for your business: ${prompt.slice(0, 80)}. Contact us on WhatsApp to get started.`;
}
