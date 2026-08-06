/**
 * ADD THIS TO YOUR EXISTING localhost:3000 SERVER
 * ------------------------------------------------
 * This is not a standalone server — it's the two new routes the frontend now calls:
 *
 *   GET /api/youtube-latest?channelUrl=...   → latest 3 videos from a YouTube channel
 *   GET /api/tiktok-oembed?url=...           → preview info for ONE specific TikTok video URL
 *
 * Drop the route handlers below into your existing Express app (wherever you already
 * defined /api/roster and /upload), and add the two requires at the top if you don't
 * already have them.
 *
 * Requirements:
 *   - Node 18+ (for built-in fetch). If you're on an older Node, run:
 *       npm install node-fetch
 *     and add: const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
 *
 *   - A YouTube Data API v3 key. Get one at https://console.cloud.google.com/
 *     (enable "YouTube Data API v3", create an API key, restrict it to that API).
 *     Set it as an environment variable so it's never exposed to the browser:
 *       YOUTUBE_API_KEY=your_key_here
 *
 *   - TikTok needs no key — oEmbed is a public endpoint. But it only works for a
 *     single video URL at a time (TikTok has no "latest posts by profile" API for
 *     third parties), which is why the frontend asks managers to paste specific
 *     video links rather than a channel URL.
 */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

/**
 * Resolve a pasted YouTube channel URL/handle into a channel ID.
 * Handles the common URL shapes:
 *   https://www.youtube.com/@handle
 *   https://www.youtube.com/channel/UCxxxxxxxx
 *   https://www.youtube.com/c/CustomName
 *   https://www.youtube.com/user/LegacyUsername
 */
async function resolveChannelId(channelUrl) {
  const url = new URL(channelUrl);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['channel','UCxxx'] or ['@handle']

  // Already a channel ID
  if (parts[0] === 'channel' && parts[1]) {
    return parts[1];
  }

  // @handle (new-style) — first segment starts with '@', or preceded by nothing
  const handleSegment = parts.find(p => p.startsWith('@'));
  if (handleSegment) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handleSegment)}&key=${YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    if (data.items && data.items[0]) return data.items[0].id;
  }

  // Legacy /c/CustomName or /user/LegacyUsername — fall back to search
  const nameSegment = parts[1] || parts[0];
  if (nameSegment) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(nameSegment)}&key=${YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    if (data.items && data.items[0]) return data.items[0].snippet.channelId;
  }

  throw new Error('Could not resolve channel URL to a channel ID');
}

// GET /api/youtube-latest?channelUrl=https://www.youtube.com/@someTalent
app.get('/api/youtube-latest', async (req, res) => {
  try {
    const { channelUrl } = req.query;
    if (!channelUrl) return res.status(400).json({ error: 'channelUrl is required' });
    if (!YOUTUBE_API_KEY) return res.status(500).json({ error: 'YOUTUBE_API_KEY is not configured on the server' });

    const channelId = await resolveChannelId(channelUrl);

    // Get the channel's uploads playlist ID
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
    );
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist for this channel');

    // Get latest 3 videos from that playlist
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=3&playlistId=${uploadsPlaylistId}&key=${YOUTUBE_API_KEY}`
    );
    const playlistData = await playlistRes.json();

    const posts = (playlistData.items || []).map(item => ({
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      link: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
    }));

    res.json(posts);
  } catch (err) {
    console.error('youtube-latest error:', err);
    res.status(500).json({ error: 'Failed to fetch latest YouTube videos' });
  }
});

// GET /api/tiktok-oembed?url=https://www.tiktok.com/@someTalent/video/1234567890
app.get('/api/tiktok-oembed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!oembedRes.ok) throw new Error('TikTok oEmbed request failed — is this a valid, public video URL?');
    const data = await oembedRes.json();

    res.json({
      title: data.title || '',
      thumbnail_url: data.thumbnail_url || '',
      author_name: data.author_name || '',
    });
  } catch (err) {
    console.error('tiktok-oembed error:', err);
    res.status(500).json({ error: 'Failed to fetch TikTok video preview' });
  }
});
