// ── Timeout helper ──────────────────────────────────────────────────────────
function withTimeout(promise, ms, label = 'API') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// ── Platform testers ────────────────────────────────────────────────────────

async function testChatGPT(prompt, apiKey) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const resp = await withTimeout(
    client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.7,
    }),
    45000,
    'ChatGPT'
  );
  return resp.choices[0]?.message?.content || '';
}

async function testPerplexity(prompt, apiKey) {
  const resp = await withTimeout(
    fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
      }),
    }),
    45000,
    'Perplexity'
  );
  const data = await resp.json();
  let content = data.choices?.[0]?.message?.content || '';
  const citations = data.citations || [];
  if (citations.length) {
    content += '\n\nCitations:\n' + citations.join('\n');
  }
  return content;
}

async function testGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const resp = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.7 },
      }),
    }),
    45000,
    'Gemini'
  );
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function testClaude(prompt, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const resp = await withTimeout(
    client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
    45000,
    'Claude'
  );
  return resp.content[0]?.text || '';
}

// ── Analysis ────────────────────────────────────────────────────────────────

function analyzeResponse(text, brandTerms, competitors, domain) {
  const lower = text.toLowerCase();

  const brandMentioned = brandTerms.some((t) => lower.includes(t.toLowerCase()));
  const competitorsFound = competitors.filter((c) => lower.includes(c.toLowerCase()));
  const domainCited = domain ? lower.includes(domain.toLowerCase()) : false;

  let brandPosition = null;
  if (brandMentioned) {
    const firstBrand = Math.min(
      ...brandTerms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0)
    );
    if (competitorsFound.length) {
      const firstComp = Math.min(
        ...competitorsFound.map((c) => lower.indexOf(c.toLowerCase())).filter((i) => i >= 0)
      );
      brandPosition = firstBrand < firstComp ? 'before_competitors' : 'after_competitors';
    } else {
      brandPosition = 'mentioned_no_competitors';
    }
  }

  return {
    brand_mentioned: brandMentioned,
    competitors_found: competitorsFound,
    domain_cited: domainCited,
    brand_position: brandPosition,
    response_preview: text.substring(0, 400),
  };
}

// ── Test a single prompt across all platforms ───────────────────────────────

async function testSinglePrompt(prompt, platforms, brandTerms, competitors, domain) {
  const results = {};

  const tests = Object.entries(platforms).map(async ([name, { fn, key }]) => {
    try {
      const response = await fn(prompt, key);
      results[name] = {
        ...analyzeResponse(response, brandTerms, competitors, domain),
        error: false,
      };
    } catch (err) {
      results[name] = {
        brand_mentioned: false,
        competitors_found: [],
        domain_cited: false,
        brand_position: null,
        response_preview: `ERROR: ${err.message}`,
        error: true,
      };
    }
  });

  await Promise.all(tests);
  return results;
}

// ── Main handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      endpoint: 'POST /api/test-prompts',
      description: 'Test prompts across AI platforms for brand mentions',
      required_body: {
        prompts: ['array of prompt strings'],
        brand: 'primary brand name',
        brand_aliases: ['optional array of aliases'],
        competitors: ['array of competitor names'],
        domain: 'client domain (optional)',
      },
      env_vars_needed: 'OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY (at least one)',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    prompts = [],
    brand = '',
    brand_aliases = [],
    competitors = [],
    domain = '',
  } = req.body;

  if (!prompts.length) {
    return res.status(400).json({ error: 'No prompts provided' });
  }
  if (!brand) {
    return res.status(400).json({ error: 'Brand name required' });
  }

  // Build brand terms
  const brandTerms = [brand, ...brand_aliases].filter(Boolean);

  // Build platform registry from env vars
  const platforms = {};
  if (process.env.OPENAI_API_KEY) {
    platforms.ChatGPT = { fn: testChatGPT, key: process.env.OPENAI_API_KEY };
  }
  if (process.env.PERPLEXITY_API_KEY) {
    platforms.Perplexity = { fn: testPerplexity, key: process.env.PERPLEXITY_API_KEY };
  }
  if (process.env.GEMINI_API_KEY) {
    platforms.Gemini = { fn: testGemini, key: process.env.GEMINI_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    platforms.Claude = { fn: testClaude, key: process.env.ANTHROPIC_API_KEY };
  }

  const platformNames = Object.keys(platforms);
  if (!platformNames.length) {
    return res.status(500).json({ error: 'No API keys configured. Set OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY as env vars.' });
  }

  console.log(`Testing ${prompts.length} prompts across ${platformNames.join(', ')}`);

  // Process prompts — batch of 5 at a time to avoid rate limits
  const BATCH_SIZE = 5;
  const allResults = [];

  for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
    const batch = prompts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (prompt) => {
        const platformResults = await testSinglePrompt(prompt, platforms, brandTerms, competitors, domain);
        return { prompt, platforms: platformResults };
      })
    );
    allResults.push(...batchResults);

    // Small delay between batches
    if (i + BATCH_SIZE < prompts.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Build summary
  const totalTests = allResults.length * platformNames.length;
  const totalBrandHits = allResults.reduce((sum, r) => {
    return sum + Object.values(r.platforms).filter((p) => p.brand_mentioned === true).length;
  }, 0);
  const totalErrors = allResults.reduce((sum, r) => {
    return sum + Object.values(r.platforms).filter((p) => p.error === true).length;
  }, 0);

  const perPlatform = {};
  platformNames.forEach((name) => {
    const hits = allResults.filter((r) => r.platforms[name]?.brand_mentioned === true).length;
    perPlatform[name] = {
      brand_mentions: hits,
      total_prompts: allResults.length,
      mention_rate: `${Math.round((hits / allResults.length) * 100)}%`,
    };
  });

  // Top competitors across all responses
  const compCounts = {};
  allResults.forEach((r) => {
    Object.values(r.platforms).forEach((p) => {
      (p.competitors_found || []).forEach((c) => {
        compCounts[c] = (compCounts[c] || 0) + 1;
      });
    });
  });

  return res.status(200).json({
    summary: {
      prompts_tested: allResults.length,
      platforms: platformNames,
      total_api_calls: totalTests,
      total_brand_mentions: totalBrandHits,
      brand_mention_rate: `${Math.round((totalBrandHits / Math.max(totalTests, 1)) * 100)}%`,
      total_errors: totalErrors,
      per_platform: perPlatform,
      top_competitors: Object.entries(compCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, mentions: count })),
    },
    results: allResults,
  });
};
