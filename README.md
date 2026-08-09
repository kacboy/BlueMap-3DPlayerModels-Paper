# BlueMap-3DPlayerModels-Paper 0.5.1

Paper 26.2 + BlueMap 5.23 addon that renders live players as skin-textured 3D models.

## 0.5.1 additions

- Correct 64x32 legacy/OG skin support.
- Hat/head outer layer on both 64x32 and 64x64 skins.
- Jacket, sleeves and trouser outer layers on modern 64x64 skins.
- Official Minecraft cape caching from the online player's Paper profile.
- Simple 3D cape rendered from the cached cape texture.
- Native BlueMap head icon becomes transparent when close while the name remains spaced normally.
- Uses a versioned `player-models-0.5.1.js` file to avoid stale browser cache.

## Build

The included GitHub Action builds with Java 25 and Paper API `26.2.build.111-stable`.

After the Action succeeds, download the artifact and put `BlueMap-3DPlayerModels-Paper-0.5.1.jar` in your server's `plugins/` folder, replacing the old version. Restart the server and hard-refresh BlueMap.

Browser console should show:

    [BlueMap3DPlayerModelsPaper] v0.5.1 renderer loaded

Cached web files are created under BlueMap's web root:

    bluemap-3d-player-models-paper/
      player-models-0.5.1.js
      skins/<uuid>.png
      capes/<uuid>.png
