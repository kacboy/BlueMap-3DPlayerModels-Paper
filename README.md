# BlueMap-3DPlayerModels-Paper

Adds live 3D Minecraft player models to BlueMap on Paper servers.

The plugin uses BlueMap's existing live player data for position and rotation, then renders a skinned 3D player model directly in the BlueMap web app.

## Features

- Live 3D player models in BlueMap
- Player position, body yaw, and head pitch tracking
- Smooth movement interpolation
- Supports modern 64x64 Minecraft skins
- Supports legacy 64x32 Minecraft skins
- Supports Classic/Steve and Slim/Alex arm models
- Hat / head overlay layer
- Jacket, sleeve, and pants overlay layers on modern skins
- Official Minecraft cape support when a cape is available
- Keeps BlueMap's native player nametag
- Hides the native BlueMap player-head icon when the camera is close to the 3D model
- Preserves nametag spacing by making the icon transparent rather than removing it
- Skin and cape caching
- Uses BlueMap's existing player feed instead of publishing duplicate player-position data

## Requirements

- Paper 26.2
- Java 25
- BlueMap 5.23
- BlueMapAPI 2.8.0

The included build currently targets Paper `26.2.build.111-stable`.

## Installation

1. Build or download `BlueMap-3DPlayerModels-Paper-1.1.0.jar`.
2. Put the jar in your server's `plugins/` folder.
3. Restart the server.
4. Open BlueMap.
5. Hard-refresh the browser if an older version of the renderer was previously cached.

You can confirm the frontend loaded by opening the browser console. You should see:

```text
[BlueMap3DPlayerModelsPaper] v1.1.0 renderer loaded
```

## Configuration

There is currently no separate config file. The small frontend settings can be adjusted in:

```text
src/main/resources/web/player-models-1.1.0.js
```

### Player icon hide distance

```js
const HIDE_NATIVE_MARKER_DISTANCE = 35;
```

This controls how close the BlueMap camera must be before the normal BlueMap player-head icon becomes transparent.

Examples:

```js
const HIDE_NATIVE_MARKER_DISTANCE = 20; // hide only when quite close
const HIDE_NATIVE_MARKER_DISTANCE = 50; // hide from farther away
```

The player's BlueMap nametag remains visible.

### Player update polling interval

```js
const POLL_MS = 1000;
```

This is how often the renderer refreshes BlueMap's live player data, in milliseconds.

Examples:

```js
const POLL_MS = 500;  // twice per second
const POLL_MS = 1000; // once per second (default)
const POLL_MS = 2000; // once every two seconds
```

Movement is interpolated between updates, so lowering this value is usually unnecessary.

## Skin support

### Modern skins

Classic/Steve and Slim/Alex arm models are detected automatically from the player's Paper profile.

Modern 64x64 Java Edition skins are supported, including:

- base skin
- hat layer
- jacket layer
- sleeve layers
- pants layers

### Legacy skins

Legacy 64x32 Java Edition skins are supported.

For legacy skins, the left arm and left leg use the classic mirrored right-limb texture layout, matching the old Minecraft skin format.

## Capes

If Paper reports an official cape URL on the player's profile, the plugin downloads and caches the cape and renders it behind the player model.

Players without a cape simply render without one.

## How it works

The Paper plugin handles web asset installation and player skin/cape caching.

The BlueMap web renderer:

1. reads BlueMap's existing live `players.json` data,
2. creates a Three.js player model for each visible player,
3. applies the cached Minecraft skin,
4. updates position and rotation,
5. smoothly interpolates movement,
6. keeps BlueMap's native nametag available.

## Building

A GitHub Actions workflow is included.

You can also build with Gradle:

```bash
gradle build
```

The jar will be created under:

```text
build/libs/
```

## Notes

- Armor rendering is intentionally not included.
- The renderer currently uses classic/Steve-width arms.
- BlueMap frontend internals are not a guaranteed stable API, so future BlueMap releases may require compatibility updates.
