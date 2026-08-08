# BlueMapPlayerModelsPaper

Small Paper addon for **Paper 26.2** + **BlueMap 5.23** that adds skin-textured 3D online-player models to the BlueMap webapp.

## What version 0.2 does

- Uses BlueMap's existing `/live/players.json` data for UUID, position, yaw and pitch.
- Uses BlueMap's own configured skin provider to cache each online player's full skin.
- Registers a custom JavaScript file with BlueMap through `BlueMapAPI#getWebApp().registerScript(...)`.
- Adds a Three.js group to `window.bluemap.mapViewer.markers`.
- Smoothly interpolates player position and rotation in the browser.
- Supports standard 64x64 skins with classic-width arms.
- Uses Minecraft-correct per-vertex cuboid UVs, fixing rotated/misaligned skin faces.
- Leaves BlueMap's native player head/name markers enabled and asks BlueMap to repair them if they are missing after a map reload.

This build intentionally does **not** include armor, crouching/walking animations, outer skin layers, or slim-arm auto-detection. BlueMap's normal player head/name markers are deliberately kept.

## Build it

You need **JDK 25** and **Gradle**.

From this folder:

```bash
gradle build
```

The plugin jar will be:

```text
build/libs/BlueMapPlayerModelsPaper-0.2.0.jar
```

Put that jar beside BlueMap in your Paper server's `plugins/` folder and restart the server.

## What you should see in the log

```text
BlueMapPlayerModelsPaper enabled; waiting for BlueMap API.
Installed BlueMap web extension for BlueMap 5.23 / API 2.8.0
```

Then hard-refresh the BlueMap page (`Ctrl+F5`). Open the browser console if needed; the frontend logs:

```text
[BlueMapPlayerModelsPaper] 3D player renderer loaded
```

## Files installed by the plugin

Inside BlueMap's configured web root:

```text
bluemap-player-models-paper/
  player-models.js
  skins/
    <uuid>.png
```

## Troubleshooting

If the model is gray, check whether the corresponding skin PNG exists in the BlueMap web root. The plugin refreshes online skins at startup, on join, and every 10 minutes.

If no model appears, confirm the BlueMap page can request the same `.../live/players.json` URL that BlueMap's ordinary player markers use.

If the model faces backward, change the sign in `targetYaw` in `player-models.js`. Coordinate conventions can change between BlueMap webapp revisions; 0.2 uses the convention observed in BlueMap 5.23's current webapp.

## Why this design

BlueMap 5.23's webapp creates its own player manager from:

```text
map.data.liveDataRoot + "/live/players.json"
```

and exposes the active map as `window.bluemap.mapViewer.map`. The addon uses those same values rather than publishing a second player-position API.
