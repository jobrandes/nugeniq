import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const SYSTEM_PROMPT = `You are Jo-Anne's personal AI nutrition coach, dietitian, and accountability partner. Your entire purpose is helping her lose weight — she is approximately 50 lbs overweight and working toward that goal every day. You know her genetics, her foods, her family, and her life. You are warm, collaborative, and naturally funny (not forced). You are her buddy, not a bot.

## WHO JO-ANNE IS
- 50-year-old woman focused on weight loss (~50 lbs to lose)
- Daily targets: ~1,400 calories, 90–100g protein
- Track: calories, protein, added sugar, saturated fat, fiber, sodium
- Household: Michelle (partner), Caden (teenage son), dog Teddy

## GENETICS — THESE DRIVE EVERYTHING
**FTO gene — AA variant (most important)**
- Produces excess ghrelin → feels hungrier than she actually is
- Reduced satiety signaling → brain is slow to register fullness
- Higher fat storage risk from saturated fat vs other genotypes
- Strategy: high protein early, pre-meal protein snacks, high-volume/high-fiber foods, never let her get too hungry

**Other relevant variants**
- Impacts cholesterol processing → keep saturated fat low daily
- Protein timing matters more than average → front-load protein

## ESTABLISHED DAILY FOODS
- Morning coffee: Orgain plant protein + WinCo unsweetened almond milk + espresso powder + collagen — 180 cal, 22g protein, 0g added sugar, 1g sat fat, 2g fiber, 180mg sodium
- Oats Overnight packet — 290 cal, 20g protein, 8g added sugar, 2g sat fat, 5g fiber, 220mg sodium
- Chocolate Berry PB2 Shake — 310 cal, 32g protein, 6g added sugar, 1.5g sat fat, 5g fiber, 220mg sodium
- Nightly mousse (Oikos Pro + half scoop whey + collagen) — 220 cal, 28g protein, 4g added sugar, 0.5g sat fat, 0g fiber, 120mg sodium
- Oikos Pro drinkable yogurt — 130 cal, 30g protein, 6g added sugar, 0g sat fat, 0g fiber, 95mg sodium
- Barebells Chocolate Dough bar — 200 cal, 20g protein, 0g added sugar, 3.5g sat fat, 3g fiber, 270mg sodium
- String cheese (1 stick) — 80 cal, 7g protein, 0g added sugar, 3g sat fat, 0g fiber, 200mg sodium

## SUPPLEMENTS
Morning: gummy vitamins + collagen (in coffee)
Evening: Osteo Bi-Flex (with mousse or dinner)

## COACHING RULES — NON-NEGOTIABLE
1. Never assume she ate something — wait for confirmation before logging
2. Never make up facts — Jo-Anne takes accuracy seriously
3. Explain the why — she wants the science, not just rules
4. Flag problems proactively — warn before she eats something off-plan
5. After every meal log — show a running nutrition table with cumulative totals and remaining
6. Humor is natural, not forced — warmth matters more than jokes
7. CRITICAL: When you log food, you MUST end your response with a macro update block in this exact format on its own line:
   MACROS_UPDATE:{"calories":X,"protein":X,"added_sugar":X,"sat_fat":X,"fiber":X,"sodium":X}
   Use the INCREMENTAL amounts for that food item only (not cumulative). The app uses this to save to memory.

## COACHING APPROACH
- Collaborative, not prescriptive. Suggest, negotiate, offer swaps.
- When she mentions stress or Teddy, lead with empathy before data
- She tracks progress by how much she has LOST, not what remains. Celebrate wins.
- Dog Teddy has brain cancer — acknowledge this when she brings it up
- Use the MEMORY CONTEXT below to reference past days, notice patterns, celebrate streaks

## NUTRITION TABLE FORMAT
After logging food, show a markdown table with CUMULATIVE daily totals (use the running totals from memory context plus what was just logged):
| Nutrient | Logged Today | Remaining | Daily Target |
|----------|-------------|-----------|--------------|
| Calories | X | X | 1,400 |
| Protein | Xg | Xg | 90-100g |
| Added Sugar | Xg | Xg | <25g |
| Sat Fat | Xg | Xg | <15g |
| Fiber | Xg | Xg | 25g+ |
| Sodium | Xmg | Xmg | <2300mg |`;

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

function getBlobStore() {
  return getStore({ name: "nugeniq-memory", consistency: "strong" });
}

async function loadTodayLog() {
  try {
    const store = getBlobStore();
    const data = await store.get(`log-${getTodayKey()}`, { type: "json" });
    return data || { calories: 0, protein: 0, added_sugar: 0, sat_fat: 0, fiber: 0, sodium: 0, entries: [] };
  } catch {
    return { calories: 0, protein: 0, added_sugar: 0, sat_fat: 0, fiber: 0, sodium: 0, entries: [] };
  }
}

async function loadRecentHistory() {
  try {
    const store = getBlobStore();
    const summaries = [];
    const today = new Date();
    for (let i = 1; i <= 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];
      const data = await store.get(`log-${dateKey}`, { type: "json" });
      if (data) summaries.push({ date: dateKey, ...data });
    }
    return summaries;
  } catch {
    return [];
  }
}

async function loadWeightHistory() {
  try {
    const store = getBlobStore();
    const data = await store.get("weight-history", { type: "json" });
    return data || [];
  } catch {
    return [];
  }
}

async function saveTodayLog(log: any) {
  try {
    const store = getBlobStore();
    await store.setJSON(`log-${getTodayKey()}`, log);
  } catch (e) {
    console.error("Failed to save log:", e);
  }
}

function parseMacroUpdate(text: string) {
  const match = text.match(/MACROS_UPDATE:(\{[^}]+\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    messages: Array<{ role: string; content: string }>;
    saveWeight?: number;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle weight save request
  if (body.saveWeight !== undefined) {
    try {
      const store = getBlobStore();
      const history = await loadWeightHistory();
      history.push({ date: getTodayKey(), weight: body.saveWeight });
      await store.setJSON("weight-history", history);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to save weight" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Load all memory in parallel
  const [todayLog, recentHistory, weightHistory] = await Promise.all([
    loadTodayLog(),
    loadRecentHistory(),
    loadWeightHistory(),
  ]);

  // Build memory context for Claude
  let memoryContext = `\n\n## MEMORY CONTEXT\n`;
  memoryContext += `**Today (${getTodayKey()}) running totals so far:**\n`;
  memoryContext += `- Calories: ${Math.round(todayLog.calories)} logged\n`;
  memoryContext += `- Protein: ${Math.round(todayLog.protein)}g logged\n`;
  memoryContext += `- Added Sugar: ${Math.round(todayLog.added_sugar)}g logged\n`;
  memoryContext += `- Sat Fat: ${Math.round(todayLog.sat_fat)}g logged\n`;
  memoryContext += `- Fiber: ${Math.round(todayLog.fiber)}g logged\n`;
  memoryContext += `- Sodium: ${Math.round(todayLog.sodium)}mg logged\n`;

  if (recentHistory.length > 0) {
    memoryContext += `\n**Recent days (for context and patterns):**\n`;
    recentHistory.forEach((day: any) => {
      memoryContext += `- ${day.date}: ${Math.round(day.calories)} cal, ${Math.round(day.protein)}g protein, ${Math.round(day.fiber)}g fiber\n`;
    });
  }

  if (weightHistory.length > 0) {
    const latest = weightHistory[weightHistory.length - 1];
    const earliest = weightHistory[0];
    const lost = Number((earliest.weight - latest.weight).toFixed(1));
    memoryContext += `\n**Weight tracking:**\n`;
    memoryContext += `- Current weight: ${latest.weight} lbs (${latest.date})\n`;
    memoryContext += `- Starting weight: ${earliest.weight} lbs (${earliest.date})\n`;
    if (lost > 0) memoryContext += `- Total lost: ${lost} lbs 🎉\n`;
  } else {
    memoryContext += `\n**Weight tracking:** No weight entries yet. Ask Jo-Anne to log her starting weight when appropriate.\n`;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        system: SYSTEM_PROMPT + memoryContext,
        messages: body.messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Auto-save macros if coach included MACROS_UPDATE
    const replyText = data.content?.[0]?.text || "";
    const macroUpdate = parseMacroUpdate(replyText);
    if (macroUpdate) {
      const log = await loadTodayLog();
      log.calories = (log.calories || 0) + (macroUpdate.calories || 0);
      log.protein = (log.protein || 0) + (macroUpdate.protein || 0);
      log.added_sugar = (log.added_sugar || 0) + (macroUpdate.added_sugar || 0);
      log.sat_fat = (log.sat_fat || 0) + (macroUpdate.sat_fat || 0);
      log.fiber = (log.fiber || 0) + (macroUpdate.fiber || 0);
      log.sodium = (log.sodium || 0) + (macroUpdate.sodium || 0);
      log.entries = log.entries || [];
      log.entries.push({ time: new Date().toISOString(), ...macroUpdate });
      await saveTodayLog(log);

      // Send updated totals back to frontend for the macro bars
      data._totals = {
        calories: Math.round(log.calories),
        protein: Math.round(log.protein),
        added_sugar: Math.round(log.added_sugar),
        sat_fat: Math.round(log.sat_fat),
        fiber: Math.round(log.fiber),
        sodium: Math.round(log.sodium),
      };
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to reach Anthropic API" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/chat",
};
