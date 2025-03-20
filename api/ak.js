const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const meta = {
  name: "youtube-search-scraper",
  version: "1.0.0",
  description: "API to search YouTube or scrape detailed information from YouTube video pages",
  author: "Wataru",
  method: "get",
  category: "scraping",
  path: "/youtube?query=&url="
};

async function scrollPage(page, scrollContainer) {
  let lastHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
  while (true) {
    await page.evaluate(`window.scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight)`);
    await page.waitForTimeout(2000);
    let newHeight = await page.evaluate(`document.querySelector("${scrollContainer}").scrollHeight`);
    if (newHeight === lastHeight) {
      break;
    }
    lastHeight = newHeight;
  }
}

async function scrapeVideoPage(page, url) {
  await page.goto(url);
  await page.waitForSelector("#contents");

  const isDesign1 = await page.$("#title > h1");

  if (isDesign1) {
    await page.click("#description-inline-expander #expand").catch(() => {});
  } else {
    await page.click("#meta #more").catch(() => {});
  }

  const scrollContainer = "ytd-app";
  await scrollPage(page, scrollContainer);
  await page.waitForTimeout(5000);

  const dataFromPage = await page.evaluate((newDesign) => {
    const date = document
      .querySelector(newDesign ? "#description-inline-expander > yt-formatted-string span:nth-child(3)" : "#info-strings yt-formatted-string")
      ?.textContent.trim();
    const views = document
      .querySelector(newDesign ? "#description-inline-expander > yt-formatted-string span:nth-child(1)" : "#info-text #count")
      ?.textContent.trim();
    return {
      title: document.querySelector(`${newDesign ? "#title >" : "#info-contents"} h1`)?.textContent.trim(),
      likes: parseInt(
        document
          .querySelector(`${newDesign ? "#top-row" : "#menu"} #top-level-buttons-computed > ytd-toggle-button-renderer:first-child #text`)
          ?.getAttribute("aria-label")
          ?.replace(/[^0-9]/g, "")
      ) || 0,
      channel: {
        name: document.querySelector(`${newDesign ? "#owner" : "ytd-video-owner-renderer"} #channel-name #text > a`)?.textContent.trim(),
        link: `https://www.youtube.com${document.querySelector(`${newDesign ? "#owner" : ""} ytd-video-owner-renderer > a`)?.getAttribute("href")}`,
        thumbnail: document.querySelector(`${newDesign ? "#owner" : "ytd-video-owner-renderer"} #avatar #img`)?.getAttribute("src"),
      },
      date,
      views: views && parseInt(views.replace(/[^0-9]/g, "")),
      description: newDesign
        ? document.querySelector("#description-inline-expander > yt-formatted-string")?.textContent.replace(date || "", "").replace(views || "", "").trim()
        : document.querySelector("#meta #description")?.textContent.trim(),
      duration: document.querySelector(".ytp-time-duration")?.textContent.trim(),
      hashtags: Array.from(document.querySelectorAll(`${newDesign ? "#super-title" : "#info-contents .super-title"} a`)).map((el) =>
        el.textContent.trim()
      ),
      suggestedVideos: Array.from(document.querySelectorAll("ytd-compact-video-renderer")).map((el) => ({
        title: el.querySelector("#video-title")?.textContent.trim(),
        link: `https://www.youtube.com${el.querySelector("#thumbnail")?.getAttribute("href")}`,
        channelName: el.querySelector("#channel-name #text")?.textContent.trim(),
        date: el.querySelector("#metadata-line span:nth-child(2)")?.textContent.trim(),
        views: el.querySelector("#metadata-line span:nth-child(1)")?.textContent.trim(),
        duration: el.querySelector("#overlays #text")?.textContent.trim(),
        thumbnail: el.querySelector("#img")?.getAttribute("src"),
      })),
      comments: Array.from(document.querySelectorAll("#contents > ytd-comment-thread-renderer")).map((el) => ({
        author: el.querySelector("#author-text")?.textContent.trim(),
        link: `https://www.youtube.com${el.querySelector("#author-text")?.getAttribute("href")}`,
        date: el.querySelector(".published-time-text")?.textContent.trim(),
        likes: el.querySelector("#vote-count-middle")?.textContent.trim(),
        comment: el.querySelector("#content-text")?.textContent.trim(),
        avatar: el.querySelector("#author-thumbnail #img")?.getAttribute("src"),
      })),
    };
  }, isDesign1);

  return dataFromPage;
}

async function searchYouTube(page, query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  await page.goto(searchUrl);
  await page.waitForSelector("ytd-video-renderer");

  // Extract video data from search results
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
        views = metaItems[0]?.textContent.trim();
        uploadTime = metaItems[1]?.textContent.trim();
      }

      const durationElement = item.querySelector("#overlays #text");

      return {
        title: videoElement?.textContent.trim(),
        url: `https://www.youtube.com${linkElement?.getAttribute("href")}`,
        channel: channelElement?.textContent.trim(),
        views: views,
        uploaded: uploadTime,
        duration: durationElement?.textContent.trim(),
        thumbnail: thumbnailElement?.getAttribute("src"),
        videoId: linkElement?.getAttribute("href")?.split("v=")[1]?.split("&")[0]
      };
    }).filter(item => item.url && item.title);
  });

  return searchResults;
}

async function onStart({ res, req }) {
  // Initialize puppeteer with stealth plugin
  puppeteer.use(StealthPlugin());

  // Get parameters from query
  const { url, query } = req.query;

  if (!url && !query) {
    return res.status(400).json({ 
      status: false, 
      error: 'Either URL or query parameter is required' 
    });
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);

    let result;

    if (url) {
      // Scrape video page if URL is provided
      if (!url.includes('youtube.com/watch?v=')) {
        await browser.close();
        return res.status(400).json({ 
          status: false, 
          error: 'Invalid YouTube video URL' 
        });
      }

      result = {
        type: "video_info",
        url: url,
        data: await scrapeVideoPage(page, url)
      };
    } else {
      // Search YouTube if query is provided
      result = {
        type: "search_results",
        query: query,
        data: await searchYouTube(page, query)
      };
    }

    await browser.close();

    return res.json({
      status: true,
      timestamp: new Date().toISOString(),
      result: result,
      powered_by: "Wataru API"
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: false,
      error: 'Failed to process YouTube request',
      message: error.message,
      powered_by: "Wataru API"
    });
  }
}

module.exports = { meta, onStart };