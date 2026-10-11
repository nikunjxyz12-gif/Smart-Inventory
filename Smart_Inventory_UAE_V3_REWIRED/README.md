# Smart Inventory — OpenRouter + live web research

This version uses OpenRouter for AI analysis and Tavily for current web search. The API keys stay in `.env` on the server and are never placed in browser code.

## Setup
1. Put your OpenRouter API key in `OPENROUTER_API_KEY`.
2. Put your Tavily API key in `TAVILY_API_KEY`.
3. Run `npm start`.
4. Open http://localhost:3000

Each Analyze action performs four focused Tavily searches (market trends, competition/pricing, demand, and new-product opportunities) and then sends the retrieved evidence to the free OpenRouter model for synthesis. Tavily currently offers 1,000 free API credits/month with no credit card required; basic search uses 1 credit per search, so the default four searches use about four credits per Analyze action.

The web evidence is shown as source links in the Market & Competition page.
