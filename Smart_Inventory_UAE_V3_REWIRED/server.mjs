import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tiny .env loader so the prototype has zero npm dependencies.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

function classify(change) {
  if (change >= 20) return 'green';
  if (change <= -20) return 'red';
  return 'yellow';
}

function cleanRows(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((r) => {
    const prev = Number(r?.prev) || 0;
    const curr = Number(r?.curr) || 0;
    const stock = Number(r?.stock) || 0;
    const price = Number(r?.price) || 0;
    const cost = Number(r?.cost) || 0;
    const change = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;
    return {
      product: String(r?.product ?? '').trim().slice(0, 160),
      previousSales: prev,
      currentSales: curr,
      currentStock: stock,
      sellingPrice: price,
      costPrice: cost,
      profitPerUnit: price - cost,
      salesChangePercent: Number(change.toFixed(1)),
      status: classify(change)
    };
  }).filter(r => r.product);
}

const schema = {
  type: 'object',
  properties: {
    marketSummary: { type: 'string' },
    marketItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product: { type: 'string' },
          market: { type: 'string' },
          demand: { type: 'string' },
          competition: { type: 'string' },
          implication: { type: 'string' }
        },
        required: ['product', 'market', 'demand', 'competition', 'implication']
      }
    },
    businessTakeaway: { type: 'string' }
  },
  required: ['marketSummary', 'marketItems', 'businessTakeaway']
};

// Orange is intentionally NOT AI-generated. These are built-in potential products
// selected for each business field, so Orange uses zero AI/web-search requests.
const ORANGE_PRODUCTS = {
  'Electronics & Mobile Accessories': [
    ['Car Phone Mount','Complements mobile accessories and can be sold alongside chargers and cables.'],
    ['Smart Watch','Expands the store into a related wearable-tech category.'],
    ['Bluetooth Tracker','Useful for customers who want to track keys, bags, and other belongings.'],
    ['3-in-1 Charging Cable','Practical add-on for customers with multiple devices.'],
    ['Phone Cleaning Kit','Low-cost accessory that complements phone-related products.'],
    ['iPhone 18 Phone Cover','A new iPhone release can create demand for new compatible cases.'],
    ['iPhone 18 Screen Guard','A new iPhone model can create demand for compatible screen protection.']
  ],
  'Furniture & Home': [
    ['Ergonomic Office Chair','Useful for customers creating home or office workspaces.'],
    ['Standing Desk','Related to modern home-office setups and changing work habits.'],
    ['Bedside Table','Affordable furniture that complements bedroom purchases.'],
    ['LED Desk Lamp','Useful alongside desks and study or work furniture.'],
    ['Storage Organizer','Practical product for customers looking for better home storage.'],
    ['Full-Length Mirror','Complements bedroom and home furnishing ranges.'],
    ['Small Side Table','Versatile furniture for living rooms, bedrooms, or offices.']
  ],
  'Clothing & Fashion': [
    ['Oversized T-Shirts','Casual clothing option that can complement everyday ranges.'],
    ['Cargo Trousers','Adds another casual fashion option to the range.'],
    ['Caps','Affordable accessory that can be sold alongside clothing.'],
    ['Crossbody Bags','Practical fashion accessory with broad everyday use.'],
    ['Lightweight Jackets','Useful extra layer for customers.'],
    ['Sunglasses','Complements fashion purchases as an accessory.'],
    ['Basic Hoodies','Versatile casual clothing item for different customers.']
  ],
  'Shoes & Footwear': [
    ['Casual Sneakers','Versatile footwear suitable for everyday use.'],
    ['Slides','Simple and practical casual footwear.'],
    ['Running Shoes','Expands the range toward sports and fitness customers.'],
    ['Shoe Cleaning Kit','Low-cost add-on for customers buying footwear.'],
    ['Socks','Affordable complementary product that pairs naturally with shoes.'],
    ['Sports Sandals','Another casual option for customers wanting comfortable footwear.']
  ],
  'Supermarket & Grocery': [
    ['Protein Bars','Convenient snack option for customers looking for quick food.'],
    ['Ready-to-Drink Coffee','Practical grab-and-go beverage.'],
    ['Flavoured Water','Adds another beverage choice.'],
    ['Snack Packs','Convenient option for school, work, or travel.'],
    ['Breakfast Cereal','Common household product that complements grocery sales.'],
    ['Instant Noodles','Affordable and convenient food option.'],
    ['Healthy Snack Packs','Gives customers an alternative to traditional snacks.']
  ],
  'Convenience Store': [
    ['Ready-to-Drink Coffee','Convenient product for customers in a hurry.'],
    ['Flavoured Drinks','Another quick beverage option.'],
    ['Snack Boxes','Convenient choice for customers wanting multiple snacks.'],
    ['Travel-Size Toiletries','Useful for customers needing small personal-care items.'],
    ['Phone Charging Cables','Useful emergency purchase for customers.'],
    ['Reusable Water Bottles','Practical everyday product.'],
    ['Umbrellas','Useful occasional purchase when weather conditions change.']
  ],
  'Food & Beverage': [
    ['Chicken Wraps','Portable meal that can complement existing food items.'],
    ['Fresh Lemonade','Simple beverage option that can complement meals.'],
    ['Milkshakes','Adds a dessert or drink option.'],
    ['Mini Dessert Cups','Affordable sweet item customers can add to meals.'],
    ['Breakfast Sandwiches','Expands the menu toward morning customers.'],
    ['Loaded Fries','Gives customers a more varied side option.'],
    ['Snack Boxes','Convenient option for customers wanting smaller portions.']
  ],
  'Café / Restaurant': [
    ['Iced Matcha','Adds another modern cold-drink option.'],
    ['Fresh Lemonade','Refreshing beverage that can complement meals.'],
    ['Mini Dessert Cups','Small dessert option for customers.'],
    ['Breakfast Sandwiches','Can attract morning customers.'],
    ['Loaded Fries','Shareable side option that can complement meals.'],
    ['Chicken Wraps','Convenient meal option.'],
    ['Milkshakes','Adds another cold beverage or dessert choice.']
  ],
  'Beauty & Personal Care': [
    ['Face Masks','Affordable skincare product that can complement beauty items.'],
    ['Hair Styling Tools','Expands the store’s hair-care range.'],
    ['Makeup Organizer','Practical accessory for customers buying cosmetics.'],
    ['Travel Toiletry Bag','Useful complementary product.'],
    ['Body Scrub','Expands personal-care options.'],
    ['Hair Accessories Set','Low-cost add-on product.'],
    ['Perfume Gift Set','Suitable for personal use or gifting.']
  ],
  'Health & Pharmacy': [
    ['Digital Thermometer','Useful basic health product.'],
    ['Pill Organizer','Practical item for organizing regular medication.'],
    ['First Aid Kit','Useful household emergency product.'],
    ['Reusable Hot/Cold Pack','Practical general-purpose comfort product.'],
    ['Hand Sanitizer','Everyday hygiene product.'],
    ['Face Masks','Simple protective and hygiene product.'],
    ['Compression Support Sleeves','Related to general fitness and physical support.']
  ],
  'Sports & Fitness': [
    ['Resistance Bands','Affordable home-workout product.'],
    ['Gym Gloves','Useful accessory for customers who train regularly.'],
    ['Shaker Bottle','Natural add-on to fitness products.'],
    ['Yoga Mat','Expands the range toward home fitness.'],
    ['Sports Bag','Complements gym and sports equipment.'],
    ['Skipping Rope','Affordable fitness product.'],
    ['Foam Roller','Useful recovery and stretching accessory.']
  ],
  'Toys & Games': [
    ['Building Blocks','Encourages creative and construction-based play.'],
    ['Remote-Controlled Car','Adds an interactive toy option.'],
    ['Card Games','Affordable group entertainment product.'],
    ['Puzzle Sets','Educational and brain-game option.'],
    ['Board Games','Suitable for family and group entertainment.'],
    ['Remote-Controlled Drone','Higher-value technology-based toy.'],
    ['Art & Craft Kits','Creative activity product.']
  ],
  'Books & Stationery': [
    ['Planner','Useful for students and working customers.'],
    ['Premium Notebooks','Higher-value alternative to basic notebooks.'],
    ['Highlighter Sets','Practical student and study accessory.'],
    ['Desk Organizer','Useful for study and office setups.'],
    ['Study Flashcards','Helpful revision product for students.'],
    ['Art Supplies Set','Expands the stationery range.'],
    ['Reusable Water Bottle','Practical complementary product for students.']
  ],
  'Jewellery & Accessories': [
    ['Minimalist Bracelets','Affordable everyday accessory.'],
    ['Pendant Necklaces','Expands the jewellery range.'],
    ['Fashion Rings','Offers another small accessory option.'],
    ['Hair Accessories','Lower-cost complementary products.'],
    ['Watch Accessories','Related add-on for customers interested in watches.'],
    ['Jewellery Organizer','Useful product that complements jewellery purchases.'],
    ['Gift Jewellery Sets','Convenient option for customers buying gifts.']
  ],
  'Home Improvement & Hardware': [
    ['Cordless Screwdriver','Useful for basic household repairs.'],
    ['Tool Organizer','Practical for customers storing equipment.'],
    ['LED Work Light','Useful for repair and DIY work.'],
    ['Measuring Tape','Affordable essential tool.'],
    ['Multi-Bit Screwdriver Set','Practical household tool.'],
    ['Extension Cord','Useful electrical accessory.'],
    ['Storage Boxes','Complements home organization and DIY needs.']
  ],
  'Pet Supplies': [
    ['Pet Grooming Brush','Useful everyday grooming product.'],
    ['Interactive Pet Toy','Gives owners an option for keeping pets entertained.'],
    ['Pet Water Bottle','Practical for travelling with pets.'],
    ['Pet Bed','Expands the range toward comfort products.'],
    ['Collapsible Food Bowl','Useful for travel and outdoor use.'],
    ['Pet Waste Bag Holder','Affordable everyday accessory.'],
    ['Cat Scratching Pad','Useful product for cat owners.']
  ],
  'Baby Products': [
    ['Baby Feeding Set','Practical product for parents.'],
    ['Baby Changing Bag','Useful everyday accessory.'],
    ['Baby Bath Set','Expands the personal-care range.'],
    ['Baby Storage Organizer','Helps parents organize baby items.'],
    ['Baby Feeding Bibs','Affordable complementary product.'],
    ['Baby Safety Locks','Useful household safety product.'],
    ['Baby Travel Organizer','Practical for parents travelling with children.']
  ],
  'Automotive Accessories': [
    ['Car Phone Mount','Useful everyday driving accessory.'],
    ['Car Cleaning Kit','Practical add-on for vehicle owners.'],
    ['Car Air Freshener','Affordable repeat-purchase accessory.'],
    ['Tyre Inflator','Useful emergency and maintenance product.'],
    ['Car USB Charger','Practical electronics accessory.'],
    ['Seat Organizer','Helps customers organize items inside their vehicle.'],
    ['Sunshade','Useful vehicle accessory for hot conditions.']
  ],
  'Gifts & Souvenirs': [
    ['Personalized Keychains','Affordable customizable gift.'],
    ['Gift Boxes','Useful add-on for customers preparing presents.'],
    ['Photo Frames','Simple personal or decorative gift.'],
    ['Scented Candles','Suitable gifting and home item.'],
    ['Mini Desk Decor','Affordable small gift option.'],
    ['Souvenir Magnets','Simple travel-related souvenir.'],
    ['Gift Card Sets','Flexible gifting option.']
  ],
  'General Retail': [
    ['Reusable Shopping Bags','Practical everyday product.'],
    ['Water Bottles','Broad-use product for different customers.'],
    ['Phone Charging Cables','Useful everyday accessory.'],
    ['Storage Organizers','Practical household product.'],
    ['Travel Accessories','Useful for customers preparing for trips.'],
    ['Gift Sets','Flexible option for different occasions.'],
    ['Umbrellas','Useful occasional purchase.']
  ],
  'Other': [
    ['Reusable Shopping Bags','Practical product that can suit many retail businesses.'],
    ['Water Bottles','Broad-use everyday product.'],
    ['Gift Sets','Flexible option for different occasions.'],
    ['Travel Accessories','Useful for customers preparing for trips.'],
    ['Storage Organizers','Practical household product.']
  ]
};

function getOrangeProducts(field) {
  return (ORANGE_PRODUCTS[field] || ORANGE_PRODUCTS.Other).map(([name, reason]) => ({
    name, reason,
    risk: 'Test a small quantity first and compare local UAE prices before placing a larger order.'
  }));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tavilySearch(query) {
  const response = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: 3,
      include_answer: false,
      include_raw_content: false
    })
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Tavily returned an invalid response (${response.status}).`); }
  if (!response.ok) throw new Error(data?.detail || data?.error || `Tavily search failed (${response.status}).`);
  return Array.isArray(data?.results) ? data.results : [];
}

async function analyze(body) {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('PASTE_YOUR')) {
    throw new Error('OPENROUTER_API_KEY is not configured. Open the .env file and paste your OpenRouter API key.');
  }
  if (!TAVILY_API_KEY || TAVILY_API_KEY.includes('PASTE_YOUR')) {
    throw new Error('TAVILY_API_KEY is not configured. Open the .env file and paste your Tavily API key.');
  }

  const country = String(body?.country || '').trim();
  const region = String(body?.region || '').trim();
  const field = String(body?.field || '').trim();
  const rows = cleanRows(body?.rows);
  if (!country || !field || !rows.length) throw new Error('Country, business field, and at least one product are required.');
  if (!/united arab emirates|uae/i.test(country)) throw new Error('This Smart Inventory version is UAE-only. Enter United Arab Emirates or UAE as the country.');

  const location = region ? `${region}, United Arab Emirates` : 'United Arab Emirates';
  const productNames = rows.map(r => r.product).join(', ');

  // Keep live research focused: two business-level searches cover the whole sheet.
  // Orange is built in and therefore does not use Tavily.
  const queries = [
    `${location} ${field} UAE retailers prices promotions competitors demand ${rows.slice(0, 8).map(r => r.product).join(', ')}`,
    `${location} ${field} UAE 2026 market demand trends consumer products competition`
  ];

  const searchResults = [];
  for (const q of queries) {
    try {
      const results = await tavilySearch(q);
      searchResults.push(...results.map(r => ({ title: r.title, url: r.url, content: r.content || '' })));
    } catch (err) {
      console.error('Tavily search skipped:', err.message);
    }
  }

  const uniqueSources = [];
  const seen = new Set();
  for (const r of searchResults) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    uniqueSources.push(r);
  }

  const sales = rows.map(r => ({
    product: r.product, previous_sales: r.previousSales, current_sales: r.currentSales,
    current_stock: r.currentStock, selling_price: r.sellingPrice, cost_price: r.costPrice,
    profit_per_unit: r.profitPerUnit, sales_change_percent: r.salesChangePercent,
    inventory_signal: r.status
  }));

  const webEvidence = uniqueSources.slice(0, 12).map((r, i) =>
    `[SOURCE ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`
  ).join('\n\n');

  const prompt = `You are the market-research analysis engine for Smart Inventory, a UAE-only inventory decision-support prototype.

BUSINESS CONTEXT
Location: ${location}
Business field: ${field}
Products currently sold: ${productNames}

INTERNAL SALES DATA
${JSON.stringify(sales, null, 2)}

LIVE UAE WEB RESEARCH
${webEvidence || 'No usable web results were returned.'}

TASK
Create a concise, PRODUCT-SPECIFIC Market & Competition analysis for the existing products.
For EACH product in the internal sales data, return one marketItems entry with the exact same product name and these four fields:
1. market: 1-2 sentences on what the live UAE research suggests about this product/category.
2. demand: 1 sentence on current demand signals. Connect to sales data when useful, but do not claim external demand unless the web evidence supports it.
3. competition: 1-2 sentences naming real brands, retailers, price ranges, discounts or competitive pressure ONLY when supported by the sources.
4. implication: 1-2 sentences explaining what the research + this product's sales/stock means for THIS business.

IMPORTANT
- Do not write generic placeholders such as “competition evidence is available”, “live research was retrieved”, “complementary product”, or “market conditions vary”.
- Do not invent brands, prices, demand trends, product releases or retailer information.
- If a specific fact is not supported by the sources, use a short honest statement such as “The available sources do not provide a clear product-specific demand signal.”
- Use the actual numbers from the internal sales data in implication when relevant (example: “sales rose from 65 to 137 while stock is 22”).
- Keep each field useful and readable, not a long report.
- The Market & Demand field should combine market + demand information naturally; demand is kept separate for the UI.
- Do NOT generate Orange products. Orange is handled by the website itself.

Also provide:
- marketSummary: 2-3 sentences summarising the overall UAE market for this business and the products actually entered.
- businessTakeaway: 2-3 sentences giving the main practical takeaway from the research and sales data.

Return ONLY valid JSON in this shape:
{"marketSummary":"...","marketItems":[{"product":"...","market":"...","demand":"...","competition":"...","implication":"..."}],"businessTakeaway":"..."}`;

  const apiResponse = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Smart Inventory' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY a single JSON object. Do not use Markdown fences. Do not add commentary before or after the JSON.' }],
    })
  });

  const raw = await apiResponse.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`OpenRouter returned an invalid response (${apiResponse.status}).`); }
  if (!apiResponse.ok) {
    console.error('OpenRouter error:', data?.error || data);
    return fallbackResult(rows, country, region, field, uniqueSources);
  }

  let output = data?.choices?.[0]?.message?.content ?? '';
  if (Array.isArray(output)) {
    output = output.map(part => typeof part === 'string' ? part : (part?.text || '')).join('');
  }
  const outputText = String(output).trim();
  if (!outputText) throw new Error('OpenRouter returned no analysis. Please try again.');

  // Free models do not always return perfectly clean JSON even when JSON mode is requested.
  // Accept fenced JSON or JSON surrounded by a short explanatory sentence.
  function extractJson(text) {
    let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
    }
    return null;
  }

  const parsed = extractJson(outputText);
  if (!parsed || typeof parsed !== 'object') {
    console.error('OpenRouter raw content:', outputText.slice(0, 4000));
    return fallbackResult(rows, country, region, field, uniqueSources);
  }

  // Never allow a missing/empty AI field to make the Research page look blank.
  const safeSummary = String(parsed.marketSummary || '').trim() ||
    buildResearchSummary(rows, region, field, uniqueSources);
  const safeTakeaway = String(parsed.businessTakeaway || '').trim() ||
    'Use the sales signals together with the UAE research sources below, then review the evidence with the people running the business before making the final stock decision.';

  const byProduct = new Map((Array.isArray(parsed.marketItems) ? parsed.marketItems : []).map(x => [String(x.product || '').toLowerCase(), x]));
  const marketItems = rows.map(r => byProduct.get(r.product.toLowerCase()) || {
    product: r.product,
    market: 'No sufficiently supported product-specific market finding was returned.',
    demand: 'No sufficiently supported demand finding was returned.',
    competition: 'No sufficiently supported competition finding was returned.',
    implication: 'Use the sales signal as the starting point and verify local conditions before acting.'
  });

  const orangeList = getOrangeProducts(field);

  return {
    context: { country, region, field },
    marketSummary: safeSummary,
    marketItems,
    businessTakeaway: safeTakeaway,
    orangeProducts: orangeList,
    analysis: rows,
    sources: uniqueSources.slice(0, 12).map(r => ({ url: r.url, title: r.title }))
  };
}


function buildResearchSummary(rows, region, field, sources) {
  const place = region ? `${region}, UAE` : 'the UAE';
  const productList = rows.slice(0, 8).map(r => r.product).join(', ');
  if (sources.length) {
    return `UAE market research was retrieved for ${field} in ${place}, covering the products ${productList}. The sources below should be used to compare current demand, competition, pricing, promotions and product trends. The inventory signals are calculated from your own sales data; final decisions should be made by the business team after reviewing the evidence.`;
  }
  return `This analysis is scoped to ${place} and the ${field} business. No usable live research sources were returned, so the inventory recommendations are based on the sales data you entered. Verify local UAE competition, prices and demand before making purchasing decisions.`;
}

function fallbackResult(rows, country, region, field, sources) {
  const marketItems = rows.map(r => ({
    product: r.product,
    market: sources.length ? `Live UAE research was retrieved for ${r.product}, but the AI summary was unavailable. Review the linked sources before making a decision.` : `No live research result was available for ${r.product}.`,
    demand: r.salesChangePercent >= 20 ? 'Your sales data shows strong growth; external demand evidence should be checked before increasing stock.' : r.salesChangePercent <= -20 ? 'Your sales data shows a decline; check whether local demand is also weakening.' : 'Your sales data shows only a small change; monitor the next period for a clearer demand signal.',
    competition: sources.length ? 'Competition evidence is available in the research sources. Compare local sellers, pricing and promotions before changing stock.' : 'Competition could not be verified because web research returned no usable results.',
    implication: r.status === 'green' ? 'Sales are rising strongly, so consider more stock after checking local demand and available margin.' : r.status === 'red' ? 'Sales are falling strongly, so avoid unnecessary restocking and monitor remaining stock.' : 'Sales are relatively stable, so keep stock broadly similar and watch the next period.'
  }));
  return {
    context: { country: 'United Arab Emirates', region, field },
    marketSummary: `UAE-focused analysis for ${field}. The inventory signals below are calculated directly from your sales data. ${sources.length ? 'Live UAE research was also retrieved, but the AI summary could not be parsed, so the site is showing a safe fallback instead of leaving the results blank.' : 'Live research was unavailable, so the site is showing a safe data-based fallback.'}`,
    marketItems,
    businessTakeaway: 'Use the sales signals as the starting point and verify local UAE prices, competitors and demand before making the final decision.',
    orangeProducts: getOrangeProducts(field),
    analysis: rows,
    sources: sources.slice(0, 12).map(r => ({ url: r.url, title: r.title }))
  };
}

function sendJson(res, status, value) {
  const text = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/') urlPath = '/index.html';
  const safePath = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) return sendJson(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (err, file) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    return sendJson(res, 200, {
      ok: true,
      aiConfigured: Boolean(OPENROUTER_API_KEY && !OPENROUTER_API_KEY.includes('PASTE_YOUR')),
      provider: 'OpenRouter free AI + Tavily web search',
      model: MODEL,
      webSearchConfigured: Boolean(TAVILY_API_KEY && !TAVILY_API_KEY.includes('PASTE_YOUR'))
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/api/analyze')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_500_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const result = await analyze(parsed);
        sendJson(res, 200, result);
      } catch (e) {
        console.error(e);
        sendJson(res, 500, { error: e.message || 'Analysis failed.' });
      }
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res);
  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => console.log(`Smart Inventory running at http://localhost:${PORT}`));
