const axios = require("axios");
const cheerio = require("cheerio");

const meta = {
  name: "YTsearch",
  version: "1.0.0",
  description: "Search YouTube videos and return top 3 results",
  author: "Priyanshi Kaur",
  method: "get",
  category: "Social",
  path: "/ytsearch?query="
};

async function onStart({ res, req }) {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({
      status: false,
      error: "Query parameter is required"
    });
  }

  try {
    // Encode the search query for URL
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;

    // Fetch YouTube search page
    const response = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });

    // Extract data from the page
    const $ = cheerio.load(response.data);
    const scriptData = $("script").filter(function() {
      return $(this).text().includes("ytInitialData");
    }).first().text();

    // Process the script data to extract video information
    let videoData = [];
    if (scriptData) {
      // Extract JSON data from script
      const jsonStr = scriptData.substring(
        scriptData.indexOf("ytInitialData") + "ytInitialData = ".length,
        scriptData.indexOf("};", scriptData.indexOf("ytInitialData")) + 1
      );

      try {
        const data = JSON.parse(jsonStr);
        const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;

        if (contents) {
          videoData = contents
            .filter(item => item.videoRenderer)
            .slice(0, 3)
            .map(item => {
              const video = item.videoRenderer;
              const videoId = video.videoId;
              const title = video.title?.runs[0]?.text || "N/A";
              const thumbnail = video.thumbnail?.thumbnails?.pop()?.url || "";
              const channelName = video.ownerText?.runs[0]?.text || "N/A";
              const viewCount = video.viewCountText?.simpleText || "N/A";
              const duration = video.lengthText?.simpleText || "N/A";

              return {
                title: title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                duration: duration,
                views: viewCount,
                author: channelName,
                thumbnail: thumbnail
              };
            });
        }
      } catch (parseError) {
        console.error("Failed to parse YouTube data:", parseError.message);
      }
    }

    // Alternative extraction if the above method fails
    if (videoData.length === 0) {
      const videoElements = $('div#contents ytd-video-renderer');
      videoData = videoElements.slice(0, 3).map((i, el) => {
        const $el = $(el);
        const videoId = $el.find('a#thumbnail').attr('href')?.split('v=')[1]?.split('&')[0] || "";
        return {
          title: $el.find('#video-title').text().trim() || "N/A",
          url: `https://www.youtube.com/watch?v=${videoId}`,
          duration: $el.find('span.ytd-thumbnail-overlay-time-status-renderer').text().trim() || "N/A",
          views: $el.find('#metadata-line span:first-child').text().trim() || "N/A",
          author: $el.find('#channel-info #text-container').text().trim() || "N/A",
          thumbnail: $el.find('img#img').attr('src') || ""
        };
      }).get();
    }

    // Check if we have results
    if (videoData.length === 0) {
      return res.status(404).json({
        status: false,
        error: "No results found or unable to parse YouTube results"
      });
    }

    // Return the results
    return res.json({
      status: true,
      query: query,
      results: videoData,
      timestamp: new Date().toISOString(),
      powered_by: "Priyanshi's API"
    });

  } catch (error) {
    console.error("YTsearch API Error:", error.message);
    return res.status(500).json({
      status: false,
      error: error.message
    });
  }
}

module.exports = { meta, onStart };