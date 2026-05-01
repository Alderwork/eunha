use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct TrendingRepo {
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub stars_today: Option<i64>,
    pub total_stars: Option<i64>,
    pub url: String,
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE_TTL: Duration = Duration::from_secs(30 * 60); // 30 minutes

static CACHE: Lazy<Mutex<HashMap<String, (Vec<TrendingRepo>, Instant)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fetch_trending(
    time_range: String,
    language: Option<String>,
) -> Result<Vec<TrendingRepo>, String> {
    let lang = language.unwrap_or_default();
    let cache_key = format!("{}:{}", time_range, lang);

    // Check cache
    {
        let cache = CACHE.lock().map_err(|e| format!("Cache lock error: {e}"))?;
        if let Some((repos, cached_at)) = cache.get(&cache_key) {
            if cached_at.elapsed() < CACHE_TTL {
                return Ok(repos.clone());
            }
        }
    }

    // Build URL
    let url = build_url(&time_range, &lang);

    // Fetch HTML
    let html = fetch_html(&url).await?;

    // Parse
    let repos = parse_trending(&html);

    // Store in cache (even if empty — no point re-fetching a broken page)
    {
        let mut cache = CACHE.lock().map_err(|e| format!("Cache lock error: {e}"))?;
        cache.insert(cache_key, (repos.clone(), Instant::now()));
    }

    Ok(repos)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_url(time_range: &str, language: &str) -> String {
    let path = if language.is_empty() {
        "/trending".to_string()
    } else {
        format!("/trending/{}", language)
    };
    format!("https://github.com{}?since={}", path, time_range)
}

async fn fetch_html(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/537.36 eunha/1.0",
        )
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch trending: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to fetch trending: HTTP {}",
            resp.status()
        ));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read trending response: {e}"))
}

fn parse_trending(html: &str) -> Vec<TrendingRepo> {
    let document = Html::parse_document(html);

    // Selectors — all infallible with valid CSS strings
    let article_sel = Selector::parse("article.Box-row").unwrap();
    let name_link_sel = Selector::parse("h2 a").unwrap();
    let desc_sel = Selector::parse("p.col-9").unwrap();
    let lang_sel = Selector::parse("span[itemprop='programmingLanguage']").unwrap();
    let stars_link_sel = Selector::parse("a[href$='/stargazers']").unwrap();
    let stars_today_sel =
        Selector::parse("span.d-inline-block.float-sm-right").unwrap();

    let mut repos = Vec::new();

    for article in document.select(&article_sel) {
        // --- full_name & url ---
        let name_link = match article.select(&name_link_sel).next() {
            Some(el) => el,
            None => continue,
        };
        let href = match name_link.value().attr("href") {
            Some(h) => h.trim_start_matches('/').to_string(),
            None => continue,
        };
        // href is "owner/repo"
        if href.is_empty() || !href.contains('/') {
            continue;
        }
        let full_name = href.clone();
        let url = format!("https://github.com/{}", full_name);

        // --- description ---
        let description = article
            .select(&desc_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty());

        // --- language ---
        let language = article
            .select(&lang_sel)
            .next()
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty());

        // --- total_stars ---
        let total_stars = article
            .select(&stars_link_sel)
            .next()
            .and_then(|el| {
                let raw = el.text().collect::<String>();
                parse_star_count(&raw)
            });

        // --- stars_today (or this week / this month) ---
        // The float-right span contains text like "123 stars today"
        let stars_today = article
            .select(&stars_today_sel)
            .next()
            .and_then(|el| {
                let raw = el.text().collect::<String>();
                parse_star_count(&raw)
            });

        repos.push(TrendingRepo {
            full_name,
            description,
            language,
            stars_today,
            total_stars,
            url,
        });
    }

    repos
}

/// Parse a human-readable star count like "1,234 stars today" or "12,345" → i64
fn parse_star_count(raw: &str) -> Option<i64> {
    // Strip everything that isn't a digit or comma, then remove commas
    let digits: String = raw
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ',')
        .filter(|c| c.is_ascii_digit())
        .collect();

    // If the leading run was empty (e.g. the text starts with a non-digit),
    // try to find the first digit sequence anywhere in the string.
    let digits = if digits.is_empty() {
        raw.split_whitespace()
            .find(|tok| tok.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
            .map(|tok| tok.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
            .unwrap_or_default()
    } else {
        digits
    };

    digits.parse::<i64>().ok()
}
