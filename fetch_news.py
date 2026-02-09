
"""
JS Intelligence - News Article Scoring Pipeline
================================================
- API Health Check first
- 5 AI Evaluators score articles
- Random peer pairing (Perplexity always paired)
- LLM #5 (Perplexity) has final say
- 6th LLM consolidates into 4 "My score is due to..." bullets
"""

import os
import requests
import json
import random
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Try to import sheet_manager (may not exist in demo mode)
try:
    from sheet_manager import SheetManager
    SHEETS_AVAILABLE = True
except ImportError:
    SHEETS_AVAILABLE = False

# API Keys - Load from environment variables
API_KEYS = {
    'newsapi': os.getenv('NEWSAPI_KEY', ''),
    'newsdata': os.getenv('NEWSDATA_KEY', ''),
    'openai': os.getenv('OPENAI_API_KEY', ''),
    'anthropic': os.getenv('ANTHROPIC_API_KEY', ''),
    'google': os.getenv('GOOGLE_API_KEY', ''),
    'xai': os.getenv('XAI_API_KEY', ''),
    'perplexity': os.getenv('PERPLEXITY_API_KEY', '')
}

AI_MODELS = ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Perplexity']


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 0: API HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════════════════

def check_api_health():
    """Check all AI APIs before proceeding"""
    print("=" * 60)
    print("JS INTELLIGENCE - API HEALTH CHECK")
    print("=" * 60)
    print("Checking AI engines...")

    status = {}

    # ChatGPT
    try:
        r = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["openai"]}'},
            json={'model': 'gpt-4o-mini', 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 5},
            timeout=10
        )
        status['ChatGPT'] = r.status_code == 200
        print(f"  ChatGPT: {'OK' if status['ChatGPT'] else 'FAILED'}")
    except Exception as e:
        status['ChatGPT'] = False
        print(f"  ChatGPT: FAILED ({e})")

    # Claude
    try:
        r = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={'x-api-key': API_KEYS['anthropic'], 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
            json={'model': 'claude-3-haiku-20240307', 'max_tokens': 5, 'messages': [{'role': 'user', 'content': 'ping'}]},
            timeout=10
        )
        status['Claude'] = r.status_code == 200
        print(f"  Claude: {'OK' if status['Claude'] else 'FAILED'}")
    except Exception as e:
        status['Claude'] = False
        print(f"  Claude: FAILED ({e})")

    # Gemini
    try:
        r = requests.post(
            f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEYS["google"]}',
            json={'contents': [{'parts': [{'text': 'ping'}]}]},
            timeout=10
        )
        status['Gemini'] = r.status_code == 200
        print(f"  Gemini: {'OK' if status['Gemini'] else 'FAILED'}")
    except Exception as e:
        status['Gemini'] = False
        print(f"  Gemini: FAILED ({e})")

    # Grok
    try:
        r = requests.post(
            'https://api.x.ai/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["xai"]}'},
            json={'model': 'grok-3-mini', 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 5},
            timeout=10
        )
        status['Grok'] = r.status_code == 200
        print(f"  Grok: {'OK' if status['Grok'] else 'FAILED'}")
    except Exception as e:
        status['Grok'] = False
        print(f"  Grok: FAILED ({e})")

    # Perplexity
    try:
        r = requests.post(
            'https://api.perplexity.ai/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["perplexity"]}'},
            json={'model': 'sonar', 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 5},
            timeout=10
        )
        status['Perplexity'] = r.status_code == 200
        print(f"  Perplexity: {'OK' if status['Perplexity'] else 'FAILED'}")
    except Exception as e:
        status['Perplexity'] = False
        print(f"  Perplexity: FAILED ({e})")

    all_ok = all(status.values())
    if all_ok:
        print("\nAll engines online.")
    else:
        failed = [k for k, v in status.items() if not v]
        print(f"\nWARNING: {len(failed)} engine(s) unavailable: {', '.join(failed)}")

    return status


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: FETCH NEWS
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_newsapi():
    """Fetch from NewsAPI.org"""
    print("\nFetching from NewsAPI...")
    articles = []
    queries = ['artificial intelligence', 'AI technology']

    for query in queries:
        try:
            r = requests.get(
                'https://newsapi.org/v2/everything',
                params={'q': query, 'language': 'en', 'sortBy': 'publishedAt', 'pageSize': 10, 'apiKey': API_KEYS['newsapi']},
                timeout=10
            )
            if r.status_code == 200:
                for a in r.json().get('articles', []):
                    articles.append({
                        'title': a.get('title', ''),
                        'link': a.get('url', ''),
                        'publisher': a.get('source', {}).get('name', ''),
                        'author': a.get('author', ''),
                        'date': a.get('publishedAt', '')[:10],
                        'description': a.get('description', '')
                    })
        except Exception as e:
            print(f"  NewsAPI error: {e}")

    print(f"  Found {len(articles)} articles")
    return articles


def fetch_newsdata():
    """Fetch from NewsData.io"""
    print("Fetching from NewsData...")
    articles = []

    try:
        r = requests.get(
            'https://newsdata.io/api/1/news',
            params={'q': 'artificial intelligence', 'language': 'en', 'category': 'technology', 'apikey': API_KEYS['newsdata']},
            timeout=10
        )
        if r.status_code == 200:
            for a in r.json().get('results', []):
                articles.append({
                    'title': a.get('title', ''),
                    'link': a.get('link', ''),
                    'publisher': a.get('source_id', ''),
                    'author': a.get('creator', [''])[0] if a.get('creator') else '',
                    'date': a.get('pubDate', '')[:10] if a.get('pubDate') else '',
                    'description': a.get('description', '')
                })
    except Exception as e:
        print(f"  NewsData error: {e}")

    print(f"  Found {len(articles)} articles")
    return articles


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: FIVE AI EVALUATORS
# ═══════════════════════════════════════════════════════════════════════════════

SCORING_PROMPT = """Rate this news article for LinkedIn shareability (0-100%).

SCORING CRITERIA:
- Credibility & sourcing (named sources, evidence)
- Accuracy & verification (verifiable facts)
- Objectivity & bias (multiple perspectives, neutral tone)
- Structure & clarity (headline accuracy, logical flow)
- Timeliness & relevance (current, newsworthy)
- Journalistic ethics (avoids manipulation)

Title: {title}
Description: {description}

Return JSON only: {{"score": <0-100>, "rationale": "<2-3 sentence explanation>"}}"""


def call_chatgpt(prompt):
    try:
        r = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["openai"]}', 'Content-Type': 'application/json'},
            json={'model': 'gpt-4o-mini', 'messages': [{'role': 'user', 'content': prompt}], 'response_format': {'type': 'json_object'}},
            timeout=30
        )
        if r.status_code == 200:
            return json.loads(r.json()['choices'][0]['message']['content'])
    except:
        pass
    return None


def call_claude(prompt):
    try:
        r = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={'x-api-key': API_KEYS['anthropic'], 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01'},
            json={'model': 'claude-3-haiku-20240307', 'max_tokens': 300, 'messages': [{'role': 'user', 'content': prompt}]},
            timeout=30
        )
        if r.status_code == 200:
            import re
            content = r.json()['content'][0]['text']
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                return json.loads(match.group())
    except:
        pass
    return None


def call_gemini(prompt):
    try:
        r = requests.post(
            f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEYS["google"]}',
            json={'contents': [{'parts': [{'text': prompt}]}]},
            timeout=30
        )
        if r.status_code == 200:
            import re
            content = r.json()['candidates'][0]['content']['parts'][0]['text']
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                return json.loads(match.group())
    except:
        pass
    return None


def call_grok(prompt):
    try:
        r = requests.post(
            'https://api.x.ai/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["xai"]}', 'Content-Type': 'application/json'},
            json={'model': 'grok-3-mini', 'messages': [{'role': 'user', 'content': prompt}]},
            timeout=30
        )
        if r.status_code == 200:
            import re
            content = r.json()['choices'][0]['message']['content']
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                return json.loads(match.group())
    except:
        pass
    return None


def call_perplexity(prompt):
    try:
        r = requests.post(
            'https://api.perplexity.ai/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["perplexity"]}', 'Content-Type': 'application/json'},
            json={'model': 'sonar', 'messages': [{'role': 'user', 'content': prompt}]},
            timeout=30
        )
        if r.status_code == 200:
            import re
            content = r.json()['choices'][0]['message']['content']
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if match:
                return json.loads(match.group())
    except:
        pass
    return None


def score_article(article):
    """Get scores from all 5 AI models"""
    prompt = SCORING_PROMPT.format(title=article.get('title', ''), description=article.get('description', ''))

    scores = {}

    print("  AI-1 (ChatGPT)...", end=" ", flush=True)
    result = call_chatgpt(prompt)
    if result:
        scores['ChatGPT'] = result
        print(f"{result.get('score', '?')}%")
    else:
        print("FAILED")

    print("  AI-2 (Claude)...", end=" ", flush=True)
    result = call_claude(prompt)
    if result:
        scores['Claude'] = result
        print(f"{result.get('score', '?')}%")
    else:
        print("FAILED")

    print("  AI-3 (Gemini)...", end=" ", flush=True)
    result = call_gemini(prompt)
    if result:
        scores['Gemini'] = result
        print(f"{result.get('score', '?')}%")
    else:
        print("FAILED")

    print("  AI-4 (Grok)...", end=" ", flush=True)
    result = call_grok(prompt)
    if result:
        scores['Grok'] = result
        print(f"{result.get('score', '?')}%")
    else:
        print("FAILED")

    print("  AI-5 (Perplexity)...", end=" ", flush=True)
    result = call_perplexity(prompt)
    if result:
        scores['Perplexity'] = result
        print(f"{result.get('score', '?')}%")
    else:
        print("FAILED")

    return scores


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: RANDOM PEER PAIRING (Perplexity always paired)
# ═══════════════════════════════════════════════════════════════════════════════

def create_peer_pairs(scores):
    """Create random peer pairs, ensuring Perplexity is always paired"""
    available = [k for k in scores.keys() if k != 'Perplexity']
    random.shuffle(available)

    pairs = []

    # Perplexity gets paired with first available
    if 'Perplexity' in scores and available:
        partner = available.pop(0)
        pairs.append(('Perplexity', partner))

    # Pair remaining
    while len(available) >= 2:
        a = available.pop(0)
        b = available.pop(0)
        pairs.append((a, b))

    # If one left over, pair with Perplexity for review
    if available and 'Perplexity' in scores:
        pairs.append((available[0], 'Perplexity'))

    return pairs


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: PEER EDIT PASS
# ═══════════════════════════════════════════════════════════════════════════════

def peer_review(reviewer_name, original_score, original_rationale):
    """Have one AI review another's score"""
    prompt = f"""Review this news article evaluation and suggest edits:

Original Score: {original_score}%
Original Rationale: {original_rationale}

Provide your critique and suggested adjusted score (if any).
Return JSON: {{"suggested_score": <0-100>, "critique": "<brief critique>", "accept_original": <true/false>}}"""

    callers = {
        'ChatGPT': call_chatgpt,
        'Claude': call_claude,
        'Gemini': call_gemini,
        'Grok': call_grok,
        'Perplexity': call_perplexity
    }

    if reviewer_name in callers:
        return callers[reviewer_name](prompt)
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: FINAL ARBITRATION (LLM #5 - Perplexity has final say)
# ═══════════════════════════════════════════════════════════════════════════════

def final_arbitration(scores, peer_reviews):
    """Perplexity makes final decision on all scores"""
    summary = "Review these AI evaluations and peer reviews. For each, decide the FINAL score.\n\n"

    for ai_name, data in scores.items():
        summary += f"{ai_name}: Score={data.get('score')}%, Rationale={data.get('rationale', '')}\n"
        if ai_name in peer_reviews:
            pr = peer_reviews[ai_name]
            summary += f"  Peer Review: Suggested={pr.get('suggested_score')}%, Critique={pr.get('critique', '')}\n"

    summary += "\nReturn JSON with final scores: {\"final_scores\": {\"ChatGPT\": <score>, \"Claude\": <score>, ...}, \"consensus\": <weighted avg>}"

    result = call_perplexity(summary)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6: CONSOLIDATE INTO 4 BULLETS
# ═══════════════════════════════════════════════════════════════════════════════

def consolidate_bullets(scores):
    """6th LLM creates 4 'My score is due to...' bullets"""
    rationales = "\n".join([f"- {k}: {v.get('rationale', '')}" for k, v in scores.items() if v])

    prompt = f"""From these 5 AI rationales, extract the 4 strongest points and rewrite as bullets.
Each bullet MUST start with "My score is due to..."
Focus on news journalism scoring standards.

Rationales:
{rationales}

Output EXACTLY 4 bullets, nothing else."""

    result = call_chatgpt(prompt)
    if result and 'bullets' in result:
        return result['bullets']

    # Fallback: try to get raw text
    try:
        r = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEYS["openai"]}'},
            json={'model': 'gpt-4o-mini', 'messages': [{'role': 'user', 'content': prompt}]},
            timeout=30
        )
        if r.status_code == 200:
            return r.json()['choices'][0]['message']['content']
    except:
        pass

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════

# LLM Weights - Perplexity gets 2x weight as arbitrator
LLM_WEIGHTS = {
    'ChatGPT': 1.0,
    'Claude': 1.0,
    'Gemini': 1.0,
    'Grok': 1.0,
    'Perplexity': 2.0  # Final arbitrator gets 2x weight
}

# Track rationale quality by LLM (for page 7 selection)
RATIONALE_TRACKER_FILE = '/Users/johnshay/jj_shay_takeaways/rationale_tracker.json'


def load_rationale_tracker():
    """Load historical rationale performance"""
    try:
        with open(RATIONALE_TRACKER_FILE, 'r') as f:
            return json.load(f)
    except:
        return {llm: {'uses': 0, 'total_engagement': 0} for llm in AI_MODELS}


def save_rationale_tracker(tracker):
    """Save rationale performance"""
    with open(RATIONALE_TRACKER_FILE, 'w') as f:
        json.dump(tracker, f, indent=2)


def select_best_rationale_llm(scores):
    """Select which LLM's rationale to use for page 7 - rotates and tracks"""
    tracker = load_rationale_tracker()

    # Get LLMs with valid rationales
    valid_llms = [k for k, v in scores.items() if v and v.get('rationale') and len(v.get('rationale', '')) > 20]

    if not valid_llms:
        return 'ChatGPT', None  # Default fallback

    # Round-robin: pick LLM with fewest uses
    min_uses = min(tracker.get(llm, {}).get('uses', 0) for llm in valid_llms)
    candidates = [llm for llm in valid_llms if tracker.get(llm, {}).get('uses', 0) == min_uses]

    selected = random.choice(candidates)

    # Update tracker
    if selected not in tracker:
        tracker[selected] = {'uses': 0, 'total_engagement': 0}
    tracker[selected]['uses'] += 1
    save_rationale_tracker(tracker)

    rationale = scores[selected].get('rationale', '')
    print(f"  📝 Page 7 Rationale: Using {selected} (uses: {tracker[selected]['uses']})")

    return selected, rationale


def calculate_consensus(scores, working_llm_count=None):
    """Calculate WEIGHTED average with outlier removal and confidence check"""
    valid_scores = [(k, int(v.get('score', 0))) for k, v in scores.items() if v and v.get('score')]

    if not valid_scores:
        return 0, 0, [], 0, None

    actual_count = len(valid_scores)

    # OUTLIER REMOVAL: Drop highest and lowest if 4+ LLMs
    if actual_count >= 4:
        sorted_scores = sorted(valid_scores, key=lambda x: x[1])
        trimmed = sorted_scores[1:-1]  # Remove first and last
        print(f"  🔄 Outlier removal: dropped {sorted_scores[0][0]}({sorted_scores[0][1]}%) and {sorted_scores[-1][0]}({sorted_scores[-1][1]}%)")
    else:
        trimmed = valid_scores

    # WEIGHTED AVERAGE
    weighted_sum = sum(score * LLM_WEIGHTS.get(llm, 1.0) for llm, score in trimmed)
    weight_total = sum(LLM_WEIGHTS.get(llm, 1.0) for llm, _ in trimmed)
    consensus = round(weighted_sum / weight_total) if weight_total > 0 else 0

    # CONFIDENCE: Calculate standard deviation
    mean = sum(s for _, s in valid_scores) / len(valid_scores)
    variance = sum((s - mean) ** 2 for _, s in valid_scores) / len(valid_scores)
    std_dev = variance ** 0.5
    confidence = max(0, 100 - std_dev * 2)  # Higher std_dev = lower confidence

    # Track which LLMs contributed
    contributing_llms = [k for k, _ in valid_scores]

    # Log if LLM count changed from expected
    if working_llm_count is not None and actual_count != working_llm_count:
        print(f"  ⚠️  LLM count changed: expected {working_llm_count}, got {actual_count}")
        print(f"      Contributing: {', '.join(contributing_llms)}")

    print(f"  📊 AI Radar score: {consensus}% (confidence: {confidence:.0f}%, std_dev: {std_dev:.1f})")

    return consensus, actual_count, contributing_llms, confidence, std_dev


def verify_consensus_with_random_llms(scores, calculated_consensus):
    """Two random LLMs independently verify the consensus calculation"""
    valid_scores = {k: v for k, v in scores.items() if v and v.get('score')}

    if len(valid_scores) < 2:
        print("  ⚠️  Not enough LLMs to verify AI Radar")
        return calculated_consensus, False

    # Pick 2 random LLMs for verification
    available_llms = list(valid_scores.keys())
    verifiers = random.sample(available_llms, 2)

    print(f"  🔍 AI Radar Verification: {verifiers[0]} and {verifiers[1]} cross-checking...")

    # Build verification prompt
    score_list = ", ".join([f"{k}={v.get('score')}%" for k, v in valid_scores.items()])
    verify_prompt = f"""Verify this consensus calculation:

Individual Scores: {score_list}
Calculated Consensus: {calculated_consensus}%
Number of LLMs: {len(valid_scores)}

Check if the average is correct. Return JSON: {{"verified_consensus": <your calculation>, "matches": <true/false>, "note": "<any discrepancy>"}}"""

    callers = {
        'ChatGPT': call_chatgpt,
        'Claude': call_claude,
        'Gemini': call_gemini,
        'Grok': call_grok,
        'Perplexity': call_perplexity
    }

    verifications = []
    for verifier in verifiers:
        if verifier in callers:
            result = callers[verifier](verify_prompt)
            if result:
                verifications.append({
                    'llm': verifier,
                    'verified': result.get('verified_consensus', calculated_consensus),
                    'matches': result.get('matches', True)
                })
                print(f"      {verifier}: verified={result.get('verified_consensus', '?')}%, matches={result.get('matches', '?')}")

    # Check if both verifiers agree
    if len(verifications) == 2:
        v1, v2 = verifications[0], verifications[1]
        if v1['matches'] and v2['matches']:
            print(f"  ✅ AI Radar VERIFIED by both {verifiers[0]} and {verifiers[1]}")
            return calculated_consensus, True
        else:
            # If mismatch, use average of verifications
            avg_verified = round((v1['verified'] + v2['verified']) / 2)
            print(f"  ⚠️  Verification mismatch! Adjusting AI Radar: {calculated_consensus}% → {avg_verified}%")
            return avg_verified, False

    return calculated_consensus, len(verifications) > 0


def add_to_sheet(articles_with_scores):
    """Add to NEWS OUT sheet"""
    print(f"\nAdding {len(articles_with_scores)} articles to NEWS OUT...")

    sm = SheetManager()
    sheet = sm.spreadsheet.worksheet('NEWS OUT')

    existing = sheet.get_all_values()
    existing_titles = {row[3].lower() for row in existing[1:] if len(row) > 3}

    added = 0
    for article in articles_with_scores:
        title = article.get('title', '')
        if title.lower() in existing_titles:
            continue

        scores = article.get('scores', {})
        # Get consensus - if not already calculated, calculate now
        if 'consensus' in article:
            consensus = article['consensus']
        else:
            consensus, _, _ = calculate_consensus(scores)

        llm_count = article.get('llm_count', 5)
        verified = '✓' if article.get('verified', False) else '?'
        confidence = article.get('confidence', 0)
        selected_llm = article.get('selected_rationale_llm', 'ChatGPT')
        selected_rationale = article.get('selected_rationale', '')

        row = [
            'FALSE',
            str(consensus),
            article.get('date', ''),
            title,
            article.get('link', ''),
            article.get('publisher', ''),
            article.get('author', ''),
            str(scores.get('ChatGPT', {}).get('score', '')),
            str(scores.get('Claude', {}).get('score', '')),
            str(scores.get('Gemini', {}).get('score', '')),
            str(scores.get('Grok', {}).get('score', '')),
            str(scores.get('Perplexity', {}).get('score', '')),
            str(consensus),
            f'{llm_count}/5 {verified} ({confidence:.0f}%)',  # LLM count + verification + confidence
            scores.get('ChatGPT', {}).get('rationale', ''),
            scores.get('Claude', {}).get('rationale', ''),
            scores.get('Gemini', {}).get('rationale', ''),
            scores.get('Grok', {}).get('rationale', ''),
            scores.get('Perplexity', {}).get('rationale', ''),
            f'{selected_llm}',  # Which LLM's rationale is used for page 7
            selected_rationale,  # The actual rationale text for page 7
        ]

        sheet.append_row(row)
        added += 1
        print(f"  Added: {title[:50]}... (AI Radar: {consensus}%)")

    return added


def check_paywall_quick(url: str) -> tuple:
    """
    Quick paywall/firewall check at ingestion time.
    Returns (is_paywalled: bool, penalty: int, reason: str)
    """
    try:
        from content_validator import ContentValidator
        validator = ContentValidator()

        # Check domain first (fast)
        paywall_domain = validator._check_paywall_domain(url)
        if paywall_domain:
            return True, 30, paywall_domain

        # Quick content fetch to check for paywall indicators
        validation = validator.validate_article(url)
        if validation.is_paywalled:
            return True, 30, validation.paywall_reason

        return False, 0, None
    except Exception as e:
        # If validator fails, proceed without penalty
        return False, 0, None


def fetch_and_score():
    """Main pipeline"""

    # STEP 0: API Health Check
    api_status = check_api_health()
    working_llm_count = sum(1 for v in api_status.values() if v)
    print(f"\n📊 Working LLMs: {working_llm_count}/5")

    if not all(api_status.values()):
        failed = [k for k, v in api_status.items() if not v]
        print(f"⚠️  Proceeding with {working_llm_count} engines (missing: {', '.join(failed)})")

    # STEP 1: Fetch News
    print("\n" + "=" * 60)
    print("STEP 1: FETCHING NEWS")
    print("=" * 60)

    articles = []
    articles.extend(fetch_newsapi())
    articles.extend(fetch_newsdata())

    # Dedupe
    seen = set()
    unique = []
    for a in articles:
        t = a.get('title', '').lower()
        if t and t not in seen:
            seen.add(t)
            unique.append(a)

    print(f"\nTotal unique: {len(unique)} articles")
    print("Article Loaded.")

    # STEP 2: Score with 5 AIs
    print("\n" + "=" * 60)
    print("STEP 2: FIVE AI EVALUATORS")
    print("=" * 60)

    scored = []
    for i, article in enumerate(unique[:10]):  # Limit for speed
        print(f"\n[{i+1}/{min(len(unique), 10)}] {article.get('title', '')[:50]}...")

        # ========================================
        # PAYWALL CHECK - Ding score if behind firewall
        # ========================================
        link = article.get('link', '')
        is_paywalled, paywall_penalty, paywall_reason = check_paywall_quick(link)
        if is_paywalled:
            print(f"  🔒 PAYWALL DETECTED: {paywall_reason}")
            print(f"     → Score will be penalized by -{paywall_penalty} points")
            article['is_paywalled'] = True
            article['paywall_penalty'] = paywall_penalty
            article['paywall_reason'] = paywall_reason
        else:
            article['is_paywalled'] = False
            article['paywall_penalty'] = 0

        scores = score_article(article)
        article['scores'] = scores

        # STEP 3: Random Peer Pairing
        print("  Random Peer Pairing (Perplexity included)...")
        pairs = create_peer_pairs(scores)
        print(f"    Pairs: {pairs}")

        # STEP 4: Peer Edit (simplified for speed)
        print("  Peer Edit Cycle...")
        peer_reviews = {}
        for a, b in pairs[:1]:  # Just one pair for speed
            if a in scores and b in scores:
                review = peer_review(b, scores[a].get('score', 0), scores[a].get('rationale', ''))
                if review:
                    peer_reviews[a] = review
        print("  Peer Edit Cycle Complete.")

        # STEP 5: Final Arbitration + AI Radar Verification
        print("  Final Arbitration (Perplexity)...")
        consensus, llm_count, contributing, confidence, std_dev = calculate_consensus(scores, working_llm_count)
        print(f"  Calculated AI Radar: {consensus}% (from {llm_count} LLMs)")

        # Two random LLMs verify the consensus
        verified_consensus, was_verified = verify_consensus_with_random_llms(scores, consensus)

        # STEP 5b: Select which LLM's rationale to use for Page 7
        selected_llm, selected_rationale = select_best_rationale_llm(scores)

        # Apply paywall penalty to consensus score
        final_consensus = verified_consensus
        if article.get('paywall_penalty', 0) > 0:
            final_consensus = max(0, verified_consensus - article['paywall_penalty'])
            print(f"  🔒 Paywall penalty applied: {verified_consensus}% → {final_consensus}%")

        article['consensus'] = final_consensus
        article['original_consensus'] = verified_consensus  # Keep original for reference
        article['llm_count'] = llm_count
        article['verified'] = was_verified
        article['confidence'] = confidence
        article['selected_rationale_llm'] = selected_llm
        article['selected_rationale'] = selected_rationale
        print(f"  Final AI Radar: {final_consensus}% (confidence: {confidence:.0f}%)")

        scored.append(article)

    # STEP 6: Add to Sheet
    print("\n" + "=" * 60)
    print("STEP 6: ADDING TO SHEET")
    print("=" * 60)

    added = add_to_sheet(scored)

    print("\n" + "=" * 60)
    print(f"DONE! Added {added} new articles")
    print("Displaying Results...")
    print("=" * 60)

    return added


if __name__ == "__main__":
    fetch_and_score()
