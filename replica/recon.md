# Recon Map — 11XScore AI Football

**Source app:** `com.scorecast.ai` (Android) / `id6745304289` (iOS)  
**Developer:** HRY Apps — HRY GROUP, Ankara, Turkey  
**Website:** https://11xscore.com  
**Date:** 2026-11-05  
**Analyst:** replica-recon skill

---

## Step 1 – Scope

| | |
|---|---|
| **App** | 11XScore AI Football |
| **Platforms** | Android (1M+ downloads, 4.5★/22.7K reviews) · iOS |
| **Slice** | Core loop: browse fixtures → view AI match analysis → follow match live |
| **Out of scope** | Betting integration, payment back-end, actual ML model, 3rd-party data feeds |
| **For whom** | Football fans wanting AI-driven pre-match and live match insights; community social layer |

---

## Step 2 – Sources

| Source | URL | What it gave |
|---|---|---|
| Marketing site | https://11xscore.com | Core feature list, 3-step flow, copy |
| Play Store listing | https://play.google.com/store/apps/details?id=com.scorecast.ai | Screenshots, feature bullets, reviews, data safety |
| App Store listing | https://apps.apple.com/app/id6745304289 | iOS version confirms parity |
| Privacy policy | https://11xscore.com/privacy/ | Data collected: device IDs |
| Terms | https://11xscore.com/term | No gambling/betting claim |
| Developer portfolio | HRY Apps Play Store page | Sister app: Scorefy Football Predictions |

---

## Step 3 – Screen Inventory

| ID | Screen | Route / Entry | Purpose | Key Components | States seen |
|---|---|---|---|---|---|
| S01 | Home / Today's Fixtures | App launch, bottom-nav "Home" | Browse matches for today (and nearby days) | Date strip, league group headers, match cards with team names + kickoff time + AI confidence badge | Loaded list, loading skeleton, empty (no matches today), filtered (live only / high-confidence) |
| S02 | Match Detail — Pre-match | Tap any fixture on S01 | Show full AI analysis before kickoff | Win/Draw/Win probability bar, top AI pick chip, confidence score, Goals Over/Under toggles, BTTS, HT-FT, Corners, xG comparison bar, Form strip (last 5), H2H mini-table, Standings row | Pre-match, premium-locked overlay (for some markets), no-data fallback |
| S03 | Match Detail — Live | Tap a live fixture; auto-transition during match | Live win probabilities + match events | Minute ticker, live score, momentum bar, shot/xG counters, event log (goals, cards, subs) | Active (match in progress), half-time pause, finished (shows result) |
| S04 | AI Combo | Bottom-nav "AI Combo" or top tab | Pre-built multi-match AI selections | Combo card (N picks, combined confidence), individual pick chips, expand-to-detail tap | Populated, refreshing (new day), empty (no combos today), premium gate |
| S05 | Leagues / Explore | Bottom-nav "Leagues" | Browse all supported competitions | Searchable list of leagues, country flag + league logo, follow toggle | Full list, search results, empty search |
| S06 | Favorites | Bottom-nav "Favorites" | Followed leagues and upcoming matches the user pinned | League rows, match cards, notification toggle per match | Empty-state ("Follow leagues to see matches here"), populated |
| S07 | Community Feed | Bottom-nav "Community" | See other users' match predictions and opinions | Prediction post cards (user avatar, match, pick, confidence label, like/comment count), create-post FAB | Feed, loading, empty, logged-out prompt |
| S08 | Weekly Challenge | Tab inside S07 | Compete on a prediction leaderboard | Leaderboard table, current-week standings, user rank badge, challenge rules | Active, waiting-for-results, finished |
| S09 | User Profile | Community → user avatar; own tab | View own stats and posted predictions | Avatar, username, win %, total predictions, recent prediction history list | Own profile (editable), other user (read-only) |
| S10 | Notifications / Alerts | System permission request + settings | Push alerts when followed matches end | Toggle list per league/match, notification permission modal | Enabled, disabled, permission-denied |
| S11 | Settings | Burger or profile menu | App language, notifications, premium, about | Language picker (76 langs), theme, notification toggles, subscription management link | Standard settings |
| S12 | Onboarding / Paywall | First launch or premium feature tap | Explain premium tier; upsell | Feature comparison, subscribe button, free-trial offer, restore purchase | Trial offer, subscription active, paywall |

---

## Step 4 – User Flows

```
F01  New user: picks a match and reads AI analysis
     S01 fixture list → S02 pre-match detail
     edge: match has premium lock → S12 paywall
     happy-path clicks: 2

F02  User follows a match live
     S01 → tap live badge → S03 live detail
     edge: match kicks off while user is on S02 → auto-transition to S03
     clicks: 2

F03  User browses AI Combo
     S04 (direct bottom-nav) → tap combo → expands in-place or opens S02 for each pick
     edge: combo refreshes mid-day → stale state banner
     clicks: 1-2

F04  User follows a league
     S05 leagues → search/scroll → tap follow toggle
     edge: already following → unfollow confirmation
     clicks: 2-3

F05  User posts a community prediction
     S07 feed → FAB → pick match → pick outcome → post
     edge: not logged in → auth prompt
     clicks: 4-5

F06  User enables push alerts for a match
     S01 → match card long-press or S06 → notification toggle → system permission dialog
     clicks: 2-3 + OS dialog

F07  User upgrades to premium
     S12 (triggered from S02 paywall lock or S11 settings)
     → subscription plan picker → store payment sheet
     clicks: 3-4 + store auth
```

---

## Step 5 – Components

| Component | Variants | States | Used in |
|---|---|---|---|
| **Match Card** | Fixture (pre-match), Live (score + timer), Finished | Default, with AI confidence badge, with notification bell | S01, S06, S04 (expanded) |
| **Probability Bar** | 3-way W/D/W, 2-way Over/Under, BTTS toggle | Loading, populated, premium-locked | S02, S03 |
| **Confidence Badge** | Chip with %, colour-coded (green high / amber mid / grey low) | High / Medium / Low | S01, S02, S04 |
| **AI Top Pick Chip** | Outlined chip with market + outcome label | Active, locked | S02 |
| **Form Strip** | 5-match coloured dots (W=green, D=grey, L=red) | 5-match, partial | S02 |
| **xG Comparison Bar** | Two-sided horizontal bar with home/away xG values | Pre-match (projected), Live (accumulated) | S02, S03 |
| **H2H Mini-Table** | Last N meetings with result column | 5-row default, expand | S02 |
| **League Row** | Logo + name + follow toggle | Following, not following | S05, S06 |
| **Community Post Card** | Avatar + match chip + pick + engagement row | Default, liked, own post | S07 |
| **Leaderboard Table** | Rank + user + score columns, highlighted own row | Active week, final | S08 |
| **Paywall Overlay** | Modal or in-line with blur backdrop | Trial offer, subscription, restored | S12, S02 |
| **Combo Card** | N picks + combined confidence pill | Loaded, expanded, locked | S04 |
| **Date Strip** | Horizontal scrollable date tabs | Today highlighted, upcoming | S01 |
| **Bottom Navigation** | 5 tabs: Home / AI Combo / Leagues / Community / Profile | Active tab indicator | Global |
| **Toast / Snackbar** | Notification confirmation, error message | Success, error | Global |

---

## Step 6 – Inferred Data Model

```
Match
  id, home_team_id, away_team_id, league_id,
  kickoff_at, status (scheduled|live|finished),
  home_score, away_score, minute
  evidence: S01 card, S03 live screen
  confidence: high

Team
  id, name, logo_url, country_code
  evidence: match cards, xG bar labels
  confidence: high

League
  id, name, logo_url, country_code, tier
  evidence: S05 leagues list, S01 group headers
  confidence: high

Prediction (AI-generated)
  id, match_id,
  home_win_prob, draw_prob, away_win_prob,
  over_25_prob, under_25_prob,
  btts_yes_prob, btts_no_prob,
  corners_over_prob, ht_ft_market (json),
  confidence_score (0-100),
  top_pick_market, top_pick_outcome,
  generated_at
  evidence: S02 probability bars, confidence badge, top pick chip
  confidence: high

LiveStats
  match_id, minute,
  home_xg, away_xg,
  home_shots, away_shots,
  home_shots_on_target, away_shots_on_target,
  momentum (home|balanced|away),
  events (json array: {minute, type, team, player?})
  updated_at
  evidence: S03 live screen, Play Store bullet "xG, shot quality, momentum"
  confidence: medium

MatchForm
  team_id, last_5 (json array of W|D|L), recorded_at
  evidence: S02 form strip
  confidence: high

HeadToHead
  home_team_id, away_team_id,
  meetings (json array of {date, home_score, away_score}),
  computed_at
  evidence: S02 H2H mini-table
  confidence: high

AICombo
  id, generated_at, picks (json array of {match_id, market, outcome}),
  combined_confidence, is_premium
  evidence: S04 AI Combo screen
  confidence: medium

User
  id, username, avatar_url, premium_until?,
  total_predictions, win_pct
  evidence: S09 profile screen, S07 community posts
  confidence: medium

CommunityPost
  id, user_id, match_id, pick_market, pick_outcome,
  created_at, likes_count, comments_count
  evidence: S07 feed
  confidence: medium

UserLeagueFollow
  user_id, league_id, notifications_enabled
  evidence: S05 follow toggle, S10 alerts
  confidence: high

WeeklyChallenge
  id, week_start, week_end,
  entries (user_id, correct_predictions, rank)
  evidence: S08 leaderboard
  confidence: medium (could be server-side only)

Subscription
  user_id, plan, starts_at, ends_at, store_platform
  evidence: S12 paywall, S11 settings subscription link
  confidence: medium
```

---

## Step 7 – Feature Matrix

See `replica/features.csv`.

---

## Step 8 – What Cannot Be Cloned

| Item | Reason | Recommendation |
|---|---|---|
| **AI prediction model** | Proprietary ML trained on years of match data; confidence scores are the brand asset | Build a simpler statistical model (Poisson/Elo) or license a football data API that includes predictions |
| **Historical match data** | Licensed from a data provider (likely Opta, StatsBomb, or Sportradar) | License a football data API (API-Football, Sportmonks, or ESPN) |
| **Live data feed** | Real-time events, xG, momentum require a paid live data partner | Same API providers offer live feeds at higher tiers |
| **Community network effects** | The 1M+ user base and weekly challenge participation are owned | Seed with early community; growth takes time |
| **76-language translations** | 76 professional localisations — years of work | Pick 5-10 key markets for v1 |
| **iOS + Android at parity** | Two native (or cross-platform) codebases | Use React Native or Flutter for single codebase |
| **Brand trust / prediction history** | Users trust it because of track record | Transparent model accuracy dashboard helps |

---

## Step 9 – Size Estimate

| Dimension | Count |
|---|---|
| Screens | 12 |
| Flows | 7 |
| Entities | 13 |
| Components | 15 |

**Hard parts:**
1. **Live data integration** — polling or WebSocket feed from a football data provider; xG and momentum metrics require a premium tier feed
2. **AI prediction layer** — even a simplified Poisson/Elo model needs historical data ingestion, training pipeline, and scheduled batch inference before each match day
3. **Community & leaderboard** — real-time feed, follow graph, weekly scoring engine

**Size: L (a quarter)**

A minimal clone (fixtures → pre-match AI probabilities → community posts, no live data) is **M (a few weeks)** using a third-party API for predictions.

**What is out of scope for v1:** Live xG/momentum metrics, 76 languages, iOS parity, actual ML model, premium subscription store integration.

**Next step:** `/replica-architect`
