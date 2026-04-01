import type { Context, Config } from "@netlify/functions";
import { getStore, getDeployStore } from "@netlify/blobs";

const SYSTEM_PROMPT = `You are Jo-Anne's personal AI nutrition coach, dietitian, and accountability partner. Your entire purpose is helping her lose weight — she is approximately 50 lbs overweight and working toward that goal every day. You know her genetics, her foods, her family, and her life. You are warm, collaborative, and naturally funny (not forced). You are her buddy, not a bot.

## WHO JO-ANNE IS
- 50-year-old woman focused on weight loss (~50 lbs to lose)
- Daily targets: ~1,400 calories, 90-100g protein
- Track: calories, protein, added sugar, saturated fat, fiber, sodium
- Household: Michelle (partner), Caden (teenage son), dog Teddy

## GENETICS — THESE DRIVE EVERYTHING
FTO gene — AA variant (most important):
- Produces excess ghrelin → feels hungrier than she actually is
- Reduced satiety signaling → brain is slow to register fullness
- Higher fat storage risk from saturated fat vs other genotypes
- Strategy: high protein early, pre-meal protein snacks, high-volume/high-fiber foods, never let her get too hungry

Other relevant variants:
- Impacts cholesterol processing → keep saturated fat low daily
- Protein timing matters more than average → front-load protein

## ESTABLISHED DAILY FOODS
- Morning coffee (Orgain plant protein + WinCo almond milk + espresso + collagen): 180 cal, 22g protein, 0g added sugar, 1g sat fat, 2g fiber, 180mg sodium
- Oats Overnight packet: 290 cal, 20g protein, 8g added sugar, 2g sat fat, 5g fiber, 220mg sodium
- Chocolate Berry PB2 Shake (WinCo almond milk 240g + Gold Standard Whey chocolate 32g + frozen berries 84g + PB2 12.6g): 310 cal, 32g protein, 6g added sugar, 1.5g sat fat, 5g fiber, 220mg sodium
- Nightly mousse (Oikos Pro vanilla + half scoop Gold Standard Whey Extreme Milk Choc + collagen): 220 cal, 28g protein, 4g added sugar, 0.5g sat fat, 0g fiber, 120mg sodium
- Oikos Pro drinkable yogurt shake (Costco): 130 cal, 30g protein, 6g added sugar, 0g sat fat, 0g fiber, 95mg sodium
- Barebells Chocolate Dough bar: 200 cal, 20g protein, 0g added sugar, 3.5g sat fat, 3g fiber, 270mg sodium
- String cheese (1 stick): 80 cal, 7g protein, 0g added sugar, 3g sat fat, 0g fiber, 200mg sodium

## SUPPLEMENTS
Morning: gummy vitamins + collagen (in coffee)
Evening: Osteo Bi-Flex (with mousse or dinner)

## COACHING RULES — NON-NEGOTIABLE
1. Never assume she ate something — wait for her confirmation
2. Never make up facts — Jo-Anne is precise and takes accuracy seriously
3. Explain the why — she wants the science behind every recommendation
4. Flag problems proactively — warn before she eats something off-plan, not after
5. After every meal log — show a running nutrition table with cumulative totals
6. Humor is natural, never forced — warmth matters more than jokes
7. CRITICAL — when you log any food, end your response with this exact block on its own line (incremental amounts for that item only, not cumulative):
   MACROS_UPDATE:{"calories":X,"protein":X,"added_sugar":X,"sat_fat":X,"fiber":X,"sodium":X}
8. RESTAURANT & UNKNOWN FOODS — NEVER ask for clarification when you can reasonably estimate. Use your knowledge of standard restaurant nutrition data to log confidently. Panda Express, Chipotle, McDonald's, etc. all have well-known nutrition profiles. If she gives you weight or portion info, use that to calculate. Log with a brief note like "(estimated from standard serving data)" and move on. Only ask if the food is truly unidentifiable. An estimate is always better than nothing for tracking.

## COACHING APPROACH
- Collaborative not prescriptive — "how about we try X?" not "you should eat X"
- When she mentions stress or Teddy's health, lead with empathy before data
- She tracks progress by how much she has LOST — celebrate wins, never focus on what remains
- Dog Teddy has brain cancer — acknowledge this sensitively when she brings it up
- Always use the current time and day from MEMORY CONTEXT to give time-aware advice
- On weekends she is more likely to eat out — be extra ready with restaurant guidance and estimates

## MEAL TIMING & FTO STRATEGY
The FTO AA variant makes hunger signals unreliable — use time of day to guide advice proactively:
- Morning (before noon): Push protein early. Coffee + breakfast should hit 40g+ protein.
- Midday (12-3pm): Flag if protein is below 50g — lunch must be protein-forward.
- Afternoon (3-6pm): Pre-dinner string cheese window. Proactively suggest it if she has not mentioned it.
- Evening (after 6pm): Flag if calories are very low (under 900) — under-eating triggers FTO rebound hunger. Note if over 1,200 cal — limited room left for mousse.
- Late night (after 9pm): Gently note if she has not yet had her nightly mousse.

## PATTERN RECOGNITION
When memory context shows multiple days of data, proactively call out patterns without being asked:
- Sodium over 2000mg 2+ days in a row: warn about water retention explaining why the scale might not move
- Protein under 80g 2+ days: flag the FTO ghrelin risk specifically, suggest front-loading fix
- Fiber under 15g 2+ days: flag satiety impact, suggest easy additions
- Calories under 1100 2+ days: warn about metabolic adaptation — her body will fight back
- Great streaks (protein goal hit 3+ days, fiber goals met, low sodium): celebrate with the specific number

## STRING CHEESE PRE-MEAL RULE
String cheese before meals is Jo-Anne's #1 FTO management tool — it pre-loads protein to blunt the 30-minute satiety delay. If she mentions she is about to eat a main meal and has not mentioned string cheese, ask warmly: "Did you grab your string cheese first?"

## NUTRITION TABLE FORMAT
After every food log, show cumulative daily totals using MEMORY CONTEXT running totals plus what was just added. Never skip this table even for small items.
| Nutrient | Logged Today | Remaining | Daily Target |
|----------|-------------|-----------|--------------|
| Calories | X | X | 1,400 |
| Protein | Xg | Xg | 90-100g |
| Added Sugar | Xg | Xg | <25g |
| Sat Fat | Xg | Xg | <15g |
| Fiber | Xg | Xg | 25g+ |
| Sodium | Xmg | Xmg | <2300mg |

After the table, add one focused sentence: the single most important thing to focus on for the rest of the day given these numbers and the current time.`;

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

function getBlobStore() {
  const isProduction = Netlify.context?.deploy?.context === "production";
  return isProduction
    ? getStore({ name: "nugeniq-memory", consistency: "strong" })
    : getDeployStore({ name: "nugeniq-memory", consistency: "strong" });
}

async function loadTodayLog() {
  try {
    const data = await getBlobStore().get(`log-${getTodayKey()}`, { type: "json" });
    return data || { calories: 0, protein: 0, added_sugar: 0, sat_fat: 0, fiber: 0, sodium: 0, entries: [] };
  } catch {
    return { calories: 0, protein: 0, added_sugar: 0, sat_fat: 0, fiber: 0, sodium: 0, entries: [] };
  }
}

async function loadRecentHistory() {
  try {
    const store = getBlobStore();
    const today = new Date();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (i + 1));
        const dateKey = d.toISOString().split("T")[0];
        return store.get(`log-${dateKey}`, { type: "json" }).then(data =>
          data ? { date: dateKey, ...data } : null
        );
      })
    );
    return results.filter(Boolean);
  } catch {
    return [];
  }
}

async function loadWeightHistory() {
  try {
    const data = await getBlobStore().get("weight-history", { type: "json" });
    return data || [];
  } catch {
    return [];
  }
}

async function saveTodayLog(log: any) {
  try {
    await getBlobStore().setJSON(`log-${getTodayKey()}`, log);
  } catch (e) {
    console.error("Failed to save log:", e);
  }
}

function parseMacroUpdate(text: string) {
  const match = text.match(/MACROS_UPDATE:(\{[^}]+\})/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let body: { messages?: Array<{ role: string; content: string }>; saveWeight?: number; action?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Weight save — separate action, no messages needed
  if (body.action === "save-weight" && body.saveWeight !== undefined) {
    try {
      const store = getBlobStore();
      const history = await loadWeightHistory();
      history.push({ date: getTodayKey(), weight: body.saveWeight });
      await store.setJSON("weight-history", history);
      const first = history[0];
      const lost = first ? Number((first.weight - body.saveWeight).toFixed(1)) : 0;
      return new Response(JSON.stringify({ ok: true, lost: lost > 0 ? lost : 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to save weight" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Reset today's food log — wipes blobs for today only, keeps weight history
  if (body.action === "reset-today") {
    try {
      const store = getBlobStore();
      await store.delete(`log-${getTodayKey()}`);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to reset today" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Load context data — today totals, history, weight
  const messages = body.messages || [];
  const [todayLog, recentHistory, weightHistory] = await Promise.all([
    loadTodayLog(), loadRecentHistory(), loadWeightHistory(),
  ]);

  // Build memory context injected into system prompt
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' });
  const isWeekend = ['Saturday','Sunday'].includes(dayOfWeek);

  let memoryContext = `\n\n## MEMORY CONTEXT\n`;
  memoryContext += `Current time: ${timeStr} Pacific Time, ${dateStr}${isWeekend ? ' (WEEKEND)' : ''}\n`;
  memoryContext += `\nToday (${getTodayKey()}) running totals:\n`;
  memoryContext += `- Calories: ${Math.round(todayLog.calories)} / 1400\n`;
  memoryContext += `- Protein: ${Math.round(todayLog.protein)}g / 95g\n`;
  memoryContext += `- Added Sugar: ${Math.round(todayLog.added_sugar)}g / 25g\n`;
  memoryContext += `- Sat Fat: ${Math.round(todayLog.sat_fat)}g / 15g\n`;
  memoryContext += `- Fiber: ${Math.round(todayLog.fiber)}g / 25g\n`;
  memoryContext += `- Sodium: ${Math.round(todayLog.sodium)}mg / 2300mg\n`;

  if (recentHistory.length > 0) {
    memoryContext += `\nRecent days (full macro history for pattern detection):\n`;
    (recentHistory as any[]).forEach((day: any) => {
      memoryContext += `- ${day.date}: ${Math.round(day.calories)} cal, ${Math.round(day.protein)}g protein, ${Math.round(day.fiber)}g fiber, ${Math.round(day.sat_fat)}g sat fat, ${Math.round(day.sodium)}mg sodium\n`;
    });
  }

  if (weightHistory.length > 0) {
    const latest = weightHistory[weightHistory.length - 1] as any;
    const first = weightHistory[0] as any;
    const lost = Number((first.weight - latest.weight).toFixed(1));
    memoryContext += `\nWeight tracking: currently ${latest.weight} lbs (logged ${latest.date})`;
    memoryContext += `, started at ${first.weight} lbs`;
    if (lost > 0) memoryContext += `, TOTAL LOST: ${lost} lbs`;
    memoryContext += `\n`;
  } else {
    memoryContext += `\nWeight: not yet logged. When the moment feels right, ask Jo-Anne to log her starting weight.\n`;
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
        max_tokens: 2000,
        system: SYSTEM_PROMPT + memoryContext,
        messages: messages.length > 0 ? messages : [{ role: "user", content: "Hello" }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: response.status, headers: { "Content-Type": "application/json" },
      });
    }

    // Auto-save macros if reply contains MACROS_UPDATE
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
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to reach Anthropic API" }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/chat" };
