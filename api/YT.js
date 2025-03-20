const axios = require("axios");

const meta = {
    name: "YouTubeV2",
    version: "1.5.0",
    description: "Fetch YouTube video information and download links",
    author: "LocDev",
    method: "get",
    category: "downloader",
    path: "/youtube?url="
};

// API request headers
const headers = {
    "authority": "iloveyt.net",
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "origin": "https://iloveyt.net",
    "referer": "https://iloveyt.net/vi2",
    "sec-ch-ua": `"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest"
};

// **Function to fetch video data from iloveyt.net**
async function fetchYouTubeData(url) {
    const formData = `url=${encodeURIComponent(url)}`;
    const { data } = await axios.post("https://iloveyt.net/proxy.php", formData, { headers });
    return data;
}

// **Main API function**
async function onStart({ res, req }) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({
            status: false,
            error: "URL parameter is required"
        });
    }

    try {
        console.log("Processing URL:", url);
        const videoData = await fetchYouTubeData(url);
        console.log("Received Data:", videoData);

        return res.json({
            status: true,
            data: videoData,
            url: url,
            timestamp: new Date().toISOString(),
            powered_by: "Mr-Perfect Api"
        });
    } catch (error) {
        console.error("Error Fetching Data:", error.message);
        return res.status(500).json({
            status: false,
            error: "Failed to fetch data",
            details: error.message
        });
    }
}

module.exports = { meta, onStart };