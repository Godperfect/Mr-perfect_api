"use strict";

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const shortid = require("shortid");
const axios = require("axios");

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

const meta = {
  name: "Youtube",
  version: "1.0.0",
  description: "API to search YouTube or scrape detailed information from YouTube video pages",
  author: "Mr-Perfect",
  method: "get",
  category: "Downloader",
  path: "/youtube?query=&url="
};

// Function to clean URL by removing search parameters before shortening
function cleanUrlForShortening(url) {
  try {
    // Parse the URL
    const urlObj = new URL(url);

    // Check if it's a YouTube URL
    if (urlObj.hostname.includes('youtube.com')) {
      // For YouTube URLs, just keep the video ID in a youtu.be format
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return `https://youtu.be/${videoId}`;
      }
    }

    // For non-YouTube URLs, remove all search parameters
    urlObj.search = '';
    return urlObj.toString();
  } catch (error) {
    console.error("Error cleaning URL:", error);
    return url; // Return original if parsing fails
  }
}

async function shortenExternalUrl(longUrl) {
  // Clean URL and remove search parameters before shortening
  const cleanedUrl = cleanUrlForShortening(longUrl);

  // Validate URL before attempting to shorten
  if (!cleanedUrl || typeof cleanedUrl !== 'string' || !cleanedUrl.startsWith('http')) {
    console.error("Invalid URL provided for shortening:", cleanedUrl);
    return cleanedUrl;
  }

  // Always use TinyURL for shortening
  const encodedUrl = encodeURIComponent(cleanedUrl);

  try {
    console.log("Shortening URL with TinyURL...");

    // Use TinyURL's direct API
    const tinyurlApi = `https://tinyurl.com/api-create.php?url=${encodedUrl}`;

    const response = await axios({
      method: 'get',
      url: tinyurlApi,
      timeout: 10000,
      responseType: 'text',
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
      }
    });

    if (response.status === 200 && response.data && typeof response.data === 'string' && response.data.startsWith('https://tinyurl.com/')) {
      console.log("Successfully shortened URL:", response.data);
      return response.data;
    } else {
      console.error("Invalid TinyURL response:", response.data);
      throw new Error("Invalid TinyURL response");
    }
  } catch (error) {
    console.error("Error shortening URL with TinyURL:", error.message);
    // Return cleaned URL as fallback
    return cleanedUrl;
  }
}

// Internal URL shortener using shortid
function createShortUrl(originalUrl, prefix) {
  const uniqueId = shortid.generate();
  return `/${prefix}/${uniqueId}`;
}

// Helper function to scroll page and load more content
async function scrollPage(page, scrollContainer) {
  let lastHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
  let attempts = 0;
  const maxAttempts = 5; // Limit scrolling attempts

  while (attempts < maxAttempts) {
    await page.evaluate(`window.scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`);
    await page.waitForTimeout(2000);
    let newHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
    if (newHeight === lastHeight) {
      break;
    }
    lastHeight = newHeight;
    attempts++;
  }
}

// Function to scrape detailed information from a YouTube video page
async function scrapeVideoPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector("#contents", { timeout: 30000 });

    // Check which YouTube design is being used
    const isDesign1 = await page.$("#title > h1").catch(() => null);

    // Expand video description
    if (isDesign1) {
      await page.click("#description-inline-expander #expand").catch(() => {
        console.log("Could not expand description (Design 1)");
      });
    } else {
      await page.click("#meta #more").catch(() => {
        console.log("Could not expand description (Design 2)");
      });
    }

    // Scroll to load more content
    const scrollContainer = "ytd-app";
    await scrollPage(page, scrollContainer);

    // Extract preview URL - improved method
    let previewUrl = await page.evaluate(() => {
      // Try different methods to get the video URL
      const videoElement = document.querySelector('video');
      if (videoElement && videoElement.src) {
        return videoElement.src;
      }

      // Get from ytplayer config if available
      if (window.ytplayer && window.ytplayer.config && 
          window.ytplayer.config.args && 
          window.ytplayer.config.args.url_encoded_fmt_stream_map) {
        const streamMap = window.ytplayer.config.args.url_encoded_fmt_stream_map;
        const urlMatch = streamMap.match(/url=([^&]+)/);
        if (urlMatch && urlMatch[1]) {
          return decodeURIComponent(urlMatch[1]);
        }
      }

      // Try from video player data
      const videoData = document.getElementById('movie_player') ? 
                        document.getElementById('movie_player').getVideoData() : null;
      if (videoData && videoData.video_id) {
        // Return a direct link to the video
        return `https://youtu.be/${videoData.video_id}`;
      }

      // Last fallback - use the current URL as a direct YouTube link
      const videoId = new URL(window.location.href).searchParams.get('v');
      if (videoId) {
        return `https://youtu.be/${videoId}`;
      }

      return null;
    });

    // Extract all data from the page
    const dataFromPage = await page.evaluate((newDesign) => {
      const date = document
        .querySelector(newDesign ? "#description-inline-expander > yt-formatted-string span:nth-child(3)" : "#info-strings yt-formatted-string")
        ?.textContent?.trim();
      const views = document
        .querySelector(newDesign ? "#description-inline-expander > yt-formatted-string span:nth-child(1)" : "#info-text #count")
        ?.textContent?.trim();

      // Get likes count safely
      let likesText = document
        .querySelector(`${newDesign ? "#top-row" : "#menu"} #top-level-buttons-computed > ytd-toggle-button-renderer:first-child #text`)
        ?.getAttribute("aria-label");
      let likes = 0;
      if (likesText) {
        const likesMatch = likesText.match(/\d+/g);
        if (likesMatch && likesMatch.length) {
          likes = parseInt(likesMatch.join(''));
        }
      }

      // Channel info
      const channelName = document.querySelector(`${newDesign ? "#owner" : "ytd-video-owner-renderer"} #channel-name #text > a`)?.textContent?.trim();
      const channelLink = document.querySelector(`${newDesign ? "#owner" : ""} ytd-video-owner-renderer > a`)?.getAttribute("href");

      // Extract views count safely
      let viewsCount = 0;
      if (views) {
        const viewsMatch = views.match(/\d+/g);
        if (viewsMatch && viewsMatch.length) {
          viewsCount = parseInt(viewsMatch.join(''));
        }
      }

      return {
        title: document.querySelector(`${newDesign ? "#title >" : "#info-contents"} h1`)?.textContent?.trim(),
        likes: likes,
        channel: {
          name: channelName,
          link: channelLink ? `https://www.youtube.com${channelLink}` : null,
          thumbnail: document.querySelector(`${newDesign ? "#owner" : "ytd-video-owner-renderer"} #avatar #img`)?.getAttribute("src"),
        },
        date: date,
        views: viewsCount,
        description: newDesign
          ? document.querySelector("#description-inline-expander > yt-formatted-string")?.textContent?.replace(date || "", "").replace(views || "", "").trim()
          : document.querySelector("#meta #description")?.textContent?.trim(),
        duration: document.querySelector(".ytp-time-duration")?.textContent?.trim(),
        hashtags: Array.from(document.querySelectorAll(`${newDesign ? "#super-title" : "#info-contents .super-title"} a`)).map((el) =>
          el.textContent.trim()
        ),
        suggestedVideos: Array.from(document.querySelectorAll("ytd-compact-video-renderer")).map((el) => ({
          title: el.querySelector("#video-title")?.textContent?.trim(),
          link: `https://www.youtube.com${el.querySelector("#thumbnail")?.getAttribute("href") || ''}`,
          channelName: el.querySelector("#channel-name #text")?.textContent?.trim(),
          date: el.querySelector("#metadata-line span:nth-child(2)")?.textContent?.trim(),
          views: el.querySelector("#metadata-line span:nth-child(1)")?.textContent?.trim(),
          duration: el.querySelector("#overlays #text")?.textContent?.trim(),
          thumbnail: el.querySelector("#img")?.getAttribute("src"),
        })),
        comments: Array.from(document.querySelectorAll("#contents > ytd-comment-thread-renderer")).map((el) => ({
          author: el.querySelector("#author-text")?.textContent?.trim(),
          link: `https://www.youtube.com${el.querySelector("#author-text")?.getAttribute("href") || ''}`,
          date: el.querySelector(".published-time-text")?.textContent?.trim(),
          likes: el.querySelector("#vote-count-middle")?.textContent?.trim(),
          comment: el.querySelector("#content-text")?.textContent?.trim(),
          avatar: el.querySelector("#author-thumbnail #img")?.getAttribute("src"),
        })),
      };
    }, isDesign1);

    return { dataFromPage, previewUrl };
  } catch (error) {
    console.error("Error scraping video page:", error);
    throw error;
  }
}

// Function to search YouTube
async function searchYouTube(page, query) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector("ytd-video-renderer", { timeout: 30000 });

    // Extract search results
    const searchResults = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("ytd-video-renderer")).map(item => {
        const videoElement = item.querySelector("#video-title");
        const linkElement = item.querySelector("#thumbnail");
        const channelElement = item.querySelector("#channel-info #channel-name #text");
        const thumbnailElement = item.querySelector("#thumbnail img");
        const metaItems = item.querySelectorAll("#metadata-line span");

        let views = "";
        let uploadTime = "";

        if (metaItems.length >= 2) {
          views = metaItems[0]?.textContent?.trim();
          uploadTime = metaItems[1]?.textContent?.trim();
        }

        const durationElement = item.querySelector("#overlays #text");

        let videoId = null;
        if (linkElement && linkElement.getAttribute("href")) {
          const hrefMatch = linkElement.getAttribute("href").match(/v=([^&]+)/);
          videoId = hrefMatch ? hrefMatch[1] : null;
        }

        return {
          title: videoElement?.textContent?.trim(),
          url: linkElement ? `https://www.youtube.com${linkElement.getAttribute("href")}` : null,
          channel: channelElement?.textContent?.trim(),
          views: views,
          uploaded: uploadTime,
          duration: durationElement?.textContent?.trim(),
          thumbnail: thumbnailElement?.getAttribute("src"),
          videoId: videoId
        };
      }).filter(item => item.url && item.title);
    });

    // Add download URLs
    for (let result of searchResults) {
      if (result.videoId) {
        result.download_url = createShortUrl(result.url, "download");
      }
    }

    return searchResults;
  } catch (error) {
    console.error("Error searching YouTube:", error);
    throw error;
  }
}

// Main handler function
async function onStart({ res, req }) {
  // Get parameters from query
  const { url, query } = req.query;

  if (!url && !query) {
    return res.status(400).json({ 
      status: false, 
      error: 'Either URL or query parameter is required' 
    });
  }

  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu"
      ],
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');

    let result;

    if (url) {
      // Scrape video page if URL is provided
      if (!url.includes('youtube.com/watch?v=')) {
        return res.status(400).json({ 
          status: false, 
          error: 'Invalid YouTube video URL' 
        });
      }

      const { dataFromPage, previewUrl } = await scrapeVideoPage(page, url);

      // Create internal download URL
      const download_url = createShortUrl(url, "download");

      // Process preview URL - always use TinyURL
      let shortPreviewUrl = null;

      if (previewUrl) {
        console.log("Original preview URL:", previewUrl);

        // Always use TinyURL regardless of whether it's already shortened
        try {
          // Clean the URL first by removing search parameters
          const cleanedUrl = cleanUrlForShortening(previewUrl);
          console.log("Cleaned URL for shortening:", cleanedUrl);

          // Always send to TinyURL for shortening
          console.log("Sending to TinyURL for shortening...");
          shortPreviewUrl = await shortenExternalUrl(cleanedUrl);
          console.log("TinyURL result:", shortPreviewUrl);
        } catch (error) {
          console.error("URL shortening failed:", error);
          // Fallback to a cleaned version
          shortPreviewUrl = cleanUrlForShortening(previewUrl);
        }
      } else {
        // If no preview URL was found, use a cleaned version of the original URL
        const videoId = new URL(url).searchParams.get('v');
        if (videoId) {
          shortPreviewUrl = `https://youtu.be/${videoId}`;
        }
      }

      console.log("Final preview URL:", shortPreviewUrl);

      // Include the shortened preview URL directly in the response
      result = {
        type: "video_info",
        url: url,
        download_url: download_url,
        preview_url: shortPreviewUrl,
        data: {
          ...dataFromPage,
          previewUrl: shortPreviewUrl
        }
      };
    } else {
      // Search YouTube if query is provided
      result = {
        type: "search_results",
        query: query,
        data: await searchYouTube(page, query)
      };
    }

    return res.json({
      status: true,
      timestamp: new Date().toISOString(),
      result: result,
      powered_by: "Mr-Perfect API"
    });
  } catch (error) {
    console.error("Error in YouTube API:", error);
    return res.status(500).json({
      status: false,
      error: 'Failed to process YouTube request',
      message: error.message,
      powered_by: "Mr-Perfect API"
    });
  } finally {
    if (browser) {
      await browser.close().catch(err => console.error("Error closing browser:", err));
    }
  }
}

module.exports = { meta, onStart };