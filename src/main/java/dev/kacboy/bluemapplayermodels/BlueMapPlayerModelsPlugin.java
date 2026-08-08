package dev.kacboy.bluemapplayermodels;

import de.bluecolored.bluemap.api.BlueMapAPI;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class BlueMapPlayerModelsPlugin extends JavaPlugin implements Listener {
    private static final String WEB_DIR = "bluemap-player-models-paper";
    private static final String SCRIPT_NAME = "player-models.js";

    private final AtomicReference<BlueMapAPI> blueMap = new AtomicReference<>();
    private final Consumer<BlueMapAPI> enableListener = this::onBlueMapEnable;
    private final Consumer<BlueMapAPI> disableListener = api -> blueMap.compareAndSet(api, null);

    private volatile Path skinDirectory;

    @Override
    public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
        BlueMapAPI.onEnable(enableListener);
        BlueMapAPI.onDisable(disableListener);

        // Refresh skin files occasionally in case somebody changes their skin.
        Bukkit.getScheduler().runTaskTimer(this, this::queueOnlineSkinRefresh, 20L * 15L, 20L * 60L * 10L);
        getLogger().info("BlueMapPlayerModelsPaper enabled; waiting for BlueMap API.");
    }

    @Override
    public void onDisable() {
        BlueMapAPI.unregisterListener(enableListener);
        BlueMapAPI.unregisterListener(disableListener);
        blueMap.set(null);
    }

    private void onBlueMapEnable(BlueMapAPI api) {
        blueMap.set(api);
        try {
            Path addonRoot = Files.createDirectories(api.getWebApp().getWebRoot().resolve(WEB_DIR));
            skinDirectory = Files.createDirectories(addonRoot.resolve("skins"));
            copyResource("/web/" + SCRIPT_NAME, addonRoot.resolve(SCRIPT_NAME));
            api.getWebApp().registerScript(WEB_DIR + "/" + SCRIPT_NAME);

            getLogger().info("Installed BlueMap web extension for BlueMap " + api.getBlueMapVersion()
                    + " / API " + api.getAPIVersion());

            Bukkit.getScheduler().runTask(this, this::queueOnlineSkinRefresh);
        } catch (IOException exception) {
            getLogger().severe("Could not install BlueMap web files: " + exception.getMessage());
            exception.printStackTrace();
        }
    }

    private void copyResource(String resource, Path target) throws IOException {
        try (InputStream input = getClass().getResourceAsStream(resource)) {
            if (input == null) throw new IOException("Missing bundled resource " + resource);
            Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        Bukkit.getScheduler().runTaskLater(this, () -> queueSkin(uuid), 40L);
    }

    private void queueOnlineSkinRefresh() {
        // Bukkit player collection is captured on the server thread.
        List<UUID> uuids = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) uuids.add(player.getUniqueId());
        for (UUID uuid : uuids) queueSkin(uuid);
    }

    private void queueSkin(UUID uuid) {
        BlueMapAPI api = blueMap.get();
        Path root = skinDirectory;
        if (api == null || root == null) return;

        Bukkit.getAsyncScheduler().runNow(this, scheduledTask -> {
            try {
                BufferedImage image = api.getPlugin().getSkinProvider().load(uuid).orElse(null);
                if (image == null) {
                    getLogger().warning("No skin available yet for " + uuid);
                    return;
                }

                // A normal modern Minecraft skin is 64x64. BlueMap's provider may also return 64x32 legacy skins.
                if (image.getWidth() != 64 || (image.getHeight() != 64 && image.getHeight() != 32)) {
                    getLogger().warning("Ignoring unexpected skin size " + image.getWidth() + "x" + image.getHeight()
                            + " for " + uuid);
                    return;
                }

                Path target = root.resolve(uuid.toString() + ".png");
                Path temporary = root.resolve(uuid.toString() + ".png.tmp");
                if (!ImageIO.write(image, "png", temporary.toFile())) {
                    throw new IOException("PNG writer unavailable");
                }
                try {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (IOException atomicMoveFailed) {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (Exception exception) {
                getLogger().warning("Failed to cache skin for " + uuid + ": " + exception.getMessage());
            }
        });
    }
}
