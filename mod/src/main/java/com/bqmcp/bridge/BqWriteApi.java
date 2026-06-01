package com.bqmcp.bridge;

import betterquesting.api.properties.NativeProps;
import betterquesting.api.utils.BigItemStack;
import betterquesting.api.questing.IQuest;
import betterquesting.api.questing.IQuestLine;
import betterquesting.api.questing.IQuestLineEntry;
import betterquesting.api2.storage.DBEntry;
import betterquesting.handlers.SaveLoadHandler;
import betterquesting.questing.QuestDatabase;
import betterquesting.questing.QuestLineDatabase;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fml.common.FMLCommonHandler;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

public class BqWriteApi {
    private static final Logger LOG = LogManager.getLogger("bqmcp_write");
    private static final long GAME_THREAD_TIMEOUT_MS = 10_000;

    public static Map<String, Object> moveQuest(int questId, int lineId, int posX, int posY, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("quest_id", questId);
        params.put("line_id", lineId);
        params.put("pos_x", posX);
        params.put("pos_y", posY);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("moveQuest", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doMoveQuest(questId, lineId, posX, posY, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doMoveQuest(int questId, int lineId, int posX, int posY, boolean commit) {
        IQuestLine line = QuestLineDatabase.INSTANCE.getValue(lineId);
        if (line == null) return error("Questline not found: " + lineId);
        IQuestLineEntry entry = line.getValue(questId);
        if (entry == null) return error("Quest " + questId + " not in questline " + lineId);
        int oldX = entry.getPosX();
        int oldY = entry.getPosY();
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("quest_id", questId);
        r.put("line_id", lineId);
        r.put("old_pos_x", oldX);
        r.put("old_pos_y", oldY);
        r.put("new_pos_x", posX);
        r.put("new_pos_y", posY);
        r.put("would_change", oldX != posX || oldY != posY);
        if (commit) {
            entry.setPosition(posX, posY);
        }
        return r;
    }

    public static Map<String, Object> setPrerequisites(int questId, int[] prereqIds, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("quest_id", questId);
        params.put("prereq_ids", prereqIds);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("setPrerequisites", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doSetPrerequisites(questId, prereqIds, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doSetPrerequisites(int questId, int[] prereqIds, boolean commit) {
        IQuest quest = QuestDatabase.INSTANCE.getValue(questId);
        if (quest == null) return error("Quest not found: " + questId);
        for (int pid : prereqIds) {
            if (QuestDatabase.INSTANCE.getValue(pid) == null) {
                return error("Prerequisite quest not found: " + pid);
            }
        }
        int[] oldReqs = quest.getRequirements();
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("quest_id", questId);
        r.put("old_prerequisites", oldReqs);
        r.put("new_prerequisites", prereqIds);
        r.put("would_change", !java.util.Arrays.equals(oldReqs, prereqIds));
        if (commit) {
            quest.setRequirements(prereqIds);
            for (int pid : prereqIds) {
                quest.setRequirementType(pid, IQuest.RequirementType.NORMAL);
            }
        }
        return r;
    }

    public static Map<String, Object> updateQuest(int questId, String name, String description,
                                                  String iconItem, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("quest_id", questId);
        params.put("name", name);
        params.put("description", description);
        params.put("icon_item", iconItem);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("updateQuest", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doUpdateQuest(questId, name, description, iconItem, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doUpdateQuest(int questId, String name, String description,
                                                     String iconItem, boolean commit) {
        IQuest quest = QuestDatabase.INSTANCE.getValue(questId);
        if (quest == null) return error("Quest not found: " + questId);
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("quest_id", questId);
        r.put("would_change", false);
        if (name != null) {
            r.put("old_name", quest.getProperty(NativeProps.NAME));
            r.put("new_name", name);
            r.put("would_change", true);
        }
        if (description != null) {
            r.put("old_description", quest.getProperty(NativeProps.DESC));
            r.put("new_description", description);
            r.put("would_change", true);
        }
        ItemStack iconStack = null;
        if (iconItem != null) {
            iconStack = parseItemStack(iconItem);
            if (iconStack == null) return error("Invalid icon item: " + iconItem);
            r.put("new_icon", iconItem);
            r.put("would_change", true);
        }
        if (commit) {
            if (name != null) quest.setProperty(NativeProps.NAME, name);
            if (description != null) quest.setProperty(NativeProps.DESC, description);
            if (iconStack != null) quest.setProperty(NativeProps.ICON, new BigItemStack(iconStack));
        }
        return r;
    }

    public static Map<String, Object> createQuest(int lineId, int questId, String name,
                                                  String description, int posX, int posY, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("line_id", lineId);
        params.put("quest_id", questId);
        params.put("name", name);
        params.put("description", description);
        params.put("pos_x", posX);
        params.put("pos_y", posY);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("createQuest", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doCreateQuest(lineId, questId, name, description, posX, posY, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doCreateQuest(int lineId, int questId, String name,
                                                     String description, int posX, int posY, boolean commit) {
        if (QuestDatabase.INSTANCE.getValue(questId) != null) {
            return error("Quest " + questId + " already exists");
        }
        IQuestLine line = QuestLineDatabase.INSTANCE.getValue(lineId);
        if (line == null) return error("Questline not found: " + lineId);
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("quest_id", questId);
        r.put("line_id", lineId);
        r.put("pos_x", posX);
        r.put("pos_y", posY);
        r.put("name", name != null ? name : "New Quest");
        r.put("would_create", true);
        if (commit) {
            IQuest quest = QuestDatabase.INSTANCE.createNew(questId);
            quest.setProperty(NativeProps.NAME, name != null ? name : "New Quest");
            quest.setProperty(NativeProps.DESC, description != null ? description : "");
            quest.setProperty(NativeProps.ICON, new BigItemStack(new ItemStack(net.minecraft.init.Items.BOOK)));
            IQuestLineEntry entry = line.createNew(questId);
            entry.setPosition(posX, posY);
            entry.setSize(24, 24);
        }
        return r;
    }

    public static Map<String, Object> deleteQuest(int questId, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("quest_id", questId);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("deleteQuest", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doDeleteQuest(questId, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doDeleteQuest(int questId, boolean commit) {
        IQuest quest = QuestDatabase.INSTANCE.getValue(questId);
        if (quest == null) return error("Quest not found: " + questId);
        List<Integer> affectingQuests = new ArrayList<>();
        List<Integer> affectingLines = new ArrayList<>();
        for (DBEntry<IQuestLine> lineEntry : QuestLineDatabase.INSTANCE.getEntries()) {
            if (lineEntry.getValue().getValue(questId) != null) {
                affectingLines.add(lineEntry.getID());
            }
        }
        for (DBEntry<IQuest> otherEntry : QuestDatabase.INSTANCE.getEntries()) {
            if (otherEntry.getID() == questId) continue;
            IQuest other = otherEntry.getValue();
            for (int r : other.getRequirements()) {
                if (r == questId) {
                    affectingQuests.add(otherEntry.getID());
                    break;
                }
            }
        }
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("quest_id", questId);
        r.put("would_delete", true);
        r.put("affected_questlines", affectingLines);
        r.put("affected_quests_requiring_this", affectingQuests);
        if (commit) {
            for (DBEntry<IQuestLine> lineEntry : QuestLineDatabase.INSTANCE.getEntries()) {
                lineEntry.getValue().removeID(questId);
            }
            for (DBEntry<IQuest> otherEntry : QuestDatabase.INSTANCE.getEntries()) {
                IQuest other = otherEntry.getValue();
                int[] reqs = other.getRequirements();
                List<Integer> filtered = new ArrayList<>();
                for (int x : reqs) if (x != questId) filtered.add(x);
                int[] arr = new int[filtered.size()];
                for (int i = 0; i < filtered.size(); i++) arr[i] = filtered.get(i);
                if (arr.length != reqs.length) other.setRequirements(arr);
            }
            QuestDatabase.INSTANCE.removeID(questId);
        }
        return r;
    }

    public static Map<String, Object> reorderQuestline(int lineId, int newOrder, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("line_id", lineId);
        params.put("order", newOrder);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("reorderQuestline", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doReorderQuestline(lineId, newOrder, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doReorderQuestline(int lineId, int newOrder, boolean commit) {
        if (QuestLineDatabase.INSTANCE.getValue(lineId) == null) {
            return error("Questline not found: " + lineId);
        }
        int oldOrder = QuestLineDatabase.INSTANCE.getOrderIndex(lineId);
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("line_id", lineId);
        r.put("old_order", oldOrder);
        r.put("new_order", newOrder);
        r.put("would_change", oldOrder != newOrder);
        if (commit) {
            QuestLineDatabase.INSTANCE.setOrderIndex(lineId, newOrder);
        }
        return r;
    }

    public static Map<String, Object> createQuestline(int lineId, String name, String description, boolean commit) {
        Map<String, Object> params = new HashMap<>();
        params.put("line_id", lineId);
        params.put("name", name);
        params.put("description", description);
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("createQuestline", commit, params);
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r = doCreateQuestline(lineId, name, description, commit);
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    private static Map<String, Object> doCreateQuestline(int lineId, String name, String description, boolean commit) {
        if (QuestLineDatabase.INSTANCE.getValue(lineId) != null) {
            return error("Questline " + lineId + " already exists");
        }
        Map<String, Object> r = new HashMap<>();
        r.put("ok", true);
        r.put("line_id", lineId);
        r.put("name", name != null ? name : "New Questline");
        r.put("would_create", true);
        if (commit) {
            IQuestLine line = QuestLineDatabase.INSTANCE.createNew(lineId);
            line.setProperty(NativeProps.NAME, name != null ? name : "New Questline");
            line.setProperty(NativeProps.DESC, description != null ? description : "");
            QuestLineDatabase.INSTANCE.add(lineId, line);
            int maxOrder = -1;
            for (DBEntry<IQuestLine> e : QuestLineDatabase.INSTANCE.getEntries()) {
                int o = QuestLineDatabase.INSTANCE.getOrderIndex(e.getID());
                if (o > maxOrder) maxOrder = o;
            }
            QuestLineDatabase.INSTANCE.setOrderIndex(lineId, maxOrder + 1);
            r.put("assigned_order", maxOrder + 1);
        }
        return r;
    }

    public static Map<String, Object> saveToDisk() {
        BqWriteSafety.assertConsistent("pre-save");
        BqWriteSafety.WriteRequest req = BqWriteSafety.begin("saveToDisk", true,
                new HashMap<String, Object>());
        return runOnGameThread(() -> {
            try {
                Map<String, Object> r;
                try {
                    SaveLoadHandler.INSTANCE.saveDatabases();
                    r = new HashMap<>();
                    r.put("ok", true);
                    r.put("saved", true);
                } catch (Exception e) {
                    LOG.error("Save failed", e);
                    r = error("Save failed: " + e.getMessage());
                }
                return BqWriteSafety.end(req, r);
            } catch (RuntimeException e) {
                BqWriteSafety.abort(req, e.getMessage());
                throw e;
            }
        });
    }

    public static ItemStack parseItemStack(String s) {
        if (s == null || s.isEmpty()) return null;
        String[] parts = s.split(":", 3);
        if (parts.length < 2) return null;
        try {
            ResourceLocation reg = new ResourceLocation(parts[0], parts[1]);
            net.minecraft.item.Item item = net.minecraft.item.Item.REGISTRY.getObject(reg);
            if (item == null) return null;
            int meta = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            return new ItemStack(item, 1, meta);
        } catch (Exception e) {
            LOG.warn("Failed to parse item stack '{}': {}", s, e.getMessage());
            return null;
        }
    }

    private static Map<String, Object> runOnGameThread(Callable<Map<String, Object>> task) {
        net.minecraft.server.MinecraftServer server = FMLCommonHandler.instance().getMinecraftServerInstance();
        if (server == null) {
            Map<String, Object> e = new HashMap<>();
            e.put("error", "Minecraft server not running");
            return e;
        }
        AtomicReference<Map<String, Object>> result = new AtomicReference<>();
        AtomicReference<Throwable> error = new AtomicReference<>();
        Future<?> f = server.addScheduledTask(() -> {
            try {
                result.set(task.call());
            } catch (Throwable t) {
                error.set(t);
            }
        });
        try {
            f.get(GAME_THREAD_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error("Interrupted while waiting for game thread");
        } catch (ExecutionException e) {
            LOG.error("Write task failed", e.getCause());
            return error("Write failed: " + e.getCause().getMessage());
        } catch (TimeoutException e) {
            return error("Game thread task timed out after " + GAME_THREAD_TIMEOUT_MS + "ms");
        }
        if (error.get() != null) {
            LOG.error("Write task threw", error.get());
            return error("Write failed: " + error.get().getMessage());
        }
        return result.get();
    }

    private static Map<String, Object> error(String msg) {
        Map<String, Object> e = new HashMap<>();
        e.put("error", msg);
        return e;
    }
}
