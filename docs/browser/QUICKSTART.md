# Chrome Extension -- Quick Start Guide

Get the LinkedIn Network Intelligence extension running in under 5 minutes.

## Step 1: Start the App (1 min)

```bash
cd /home/aepod/dev/ctox
docker compose up -d
```

Wait for the app to be reachable:
```bash
curl -s http://localhost:3000/ > /dev/null && echo "App is ready"
```

## Step 2: Build the Extension (30 sec)

```bash
cd /home/aepod/dev/ctox/browser
npm install
npm run build
```

You should see 4 bundles created in `dist/`.

## Step 3: Load in Chrome (30 sec)

1. Go to `chrome://extensions` in Chrome
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `browser/` folder (the one with `manifest.json`)
5. Pin the extension to your toolbar (puzzle-piece icon > pin)

## Step 4: Create a Token (30 sec)

```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  INSERT INTO extension_tokens (extension_id, token_hash, display_prefix, created_at)
  VALUES ('ext-001', encode(sha256('my-test-token'::bytea), 'hex'), 'my-test-t', now())
  ON CONFLICT DO NOTHING;
"
```

## Step 5: Register the Extension (30 sec)

1. Click the extension icon in Chrome's toolbar
2. Enter `my-test-token` in the token field
3. Click **Connect**
4. The popup should switch to the main dashboard showing "Captures Today: 0"

## Step 6: Capture a Page (30 sec)

1. Navigate to any LinkedIn profile (e.g., `https://www.linkedin.com/in/satyanadella/`)
2. A small dark widget labeled "LNI" appears in the bottom-right corner
3. Click the blue **Capture** button on the widget
4. The dot turns yellow ("Capturing...") then green ("Captured!")

## Verify It Worked

Check the database for your capture:
```bash
docker exec ctox-db psql -U netnav -d netnav -c "
  SELECT url, page_type, length(html_content) as bytes, created_at
  FROM page_cache ORDER BY created_at DESC LIMIT 1;
"
```

You should see a row with the LinkedIn URL you captured.

## What's Next

- **Side Panel**: Click "Open Side Panel" in the popup footer to see goals and tasks
- **Offline Mode**: Stop the app (`docker compose down`), capture a page, restart -- the queue flushes automatically
- **Full Documentation**: See [docs/browser/README.md](README.md) for architecture, API reference, and development guide
