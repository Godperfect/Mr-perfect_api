const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const meta = {
    name: "CapCutDownloader",
    version: "1.2.0",
    description: "Fetch CapCut video information and provide direct download link",
    author: "Mr-Perfect",
    method: "get",
    category: "downloader",
    path: "/capcut?url="
};

// **Function to extract CapCut video download link**
async function fetchCapCutData(url) {
    try {
        console.log("Fetching VidBurner Page...");
        const response = await axios.get(`https://vidburner.com/capcut-video-downloader/?url=${encodeURIComponent(url)}`);

        // Load the HTML into Cheerio
        const $ = cheerio.load(response.data);

        // Extract the download link using regex
        const scriptTags = $("script").map((i, el) => $(el).html()).get();
        let downloadLink = null;

        scriptTags.forEach(script => {
            const match = script.match(/href=["'](https:\/\/vidburner\.com\/[^\s"']+\.mp4)["']/);
            if (match) {
                downloadLink = match[1];
            }
        });

        if (!downloadLink) {
            throw new Error("Download link not found");
        }

        console.log("Download Link Found:", downloadLink);
        return { status: true, downloadLink };
    } catch (error) {
        console.error("Error Fetching Data:", error.message);
        return { status: false, error: "Download link not found" };
    }
}

// **Function to download video from extracted link**
async function downloadVideo(videoUrl) {
    try {
        const filePath = path.join(__dirname, "downloads", `${Date.now()}.mp4`);
        const writer = fs.createWriteStream(filePath);

        console.log("Downloading Video...");
        const response = await axios({
            url: videoUrl,
            method: "GET",
            responseType: "stream"
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on("finish", () => resolve(filePath));
            writer.on("error", reject);
        });
    } catch (error) {
        console.error("Error Downloading Video:", error.message);
        return null;
    }
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
        const videoData = await fetchCapCutData(url);

        if (!videoData.status) {
            return res.json({ status: false, error: videoData.error });
        }

        const localFilePath = await downloadVideo(videoData.downloadLink);

        if (!localFilePath) {
            return res.status(500).json({
                status: false,
                error: "Failed to download video"
            });
        }

        return res.json({
            status: true,
            downloadUrl: `http://yourserver.com/downloads/${path.basename(localFilePath)}`,
            timestamp: new Date().toISOString(),
            powered_by: "Mr-Perfect API"
        });
    } catch (error) {
        console.error("Error Processing Request:", error.message);
        return res.status(500).json({
            status: false,
            error: "Failed to process request",
            details: error.message
        });
    }
}

module.exports = { meta, onStart };