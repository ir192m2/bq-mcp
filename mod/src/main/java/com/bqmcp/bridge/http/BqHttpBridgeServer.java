package com.bqmcp.bridge.http;

import betterquesting.api.properties.IPropertyType;
import betterquesting.api.properties.NativeProps;
import betterquesting.api.questing.IQuest;
import betterquesting.api.questing.IQuestLine;
import betterquesting.api.questing.IQuestLineEntry;
import betterquesting.api.questing.tasks.ITask;
import betterquesting.api.questing.rewards.IReward;
import betterquesting.api2.storage.DBEntry;
import betterquesting.questing.QuestDatabase;
import betterquesting.questing.QuestLineDatabase;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import net.minecraft.client.Minecraft;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BqHttpBridgeServer {
    public static final int PORT = 18733;

    private static final Logger LOG = LogManager.getLogger("bqmcp_bridge");
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private HttpServer server;
    private final ExecutorService httpThreadPool = Executors.newFixedThreadPool(4);

    public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
        server.createContext("/api/health", new HealthHandler());
        server.createContext("/api/questlines", new QuestLinesHandler());
        server.createContext("/api/questlines/", new QuestLineDetailHandler());
        server.createContext("/api/quests/", new QuestDetailHandler());
        server.createContext("/api/quests", new QuestSearchHandler());
        server.createContext("/api/validate", new ValidateHandler());
        server.setExecutor(httpThreadPool);
        server.start();
        LOG.info("BQ HTTP Bridge started on port {}", PORT);
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            httpThreadPool.shutdown();
        }
    }

    private static void sendJson(HttpExchange exchange, Object data) throws IOException {
        String json = GSON.toJson(data);
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static void sendError(HttpExchange exchange, int code, String message) throws IOException {
        Map<String, Object> err = new HashMap<String, Object>();
        err.put("error", message);
        String json = GSON.toJson(err);
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new HashMap<String, String>();
        if (query == null || query.isEmpty()) return params;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            try {
                String key = URLDecoder.decode(kv[0], "UTF-8");
                String val = kv.length > 1 ? URLDecoder.decode(kv[1], "UTF-8") : "";
                params.put(key, val);
            } catch (Exception e) {
                LOG.warn("Failed to decode query param: {}", part);
            }
        }
        return params;
    }

    private static <T> T qp(IQuest quest, IPropertyType<T> prop) {
        return quest.getProperty(prop, prop.getDefault());
    }

    private static <T> T lp(IQuestLine line, IPropertyType<T> prop) {
        return line.getProperty(prop, prop.getDefault());
    }

    private static String itemStr(ItemStack stack) {
        if (stack == null || stack.isEmpty()) return null;
        ResourceLocation reg = stack.getItem().getRegistryName();
        if (reg == null) return null;
        String s = reg.toString();
        if (stack.getMetadata() > 0) s += ":" + stack.getMetadata();
        return s;
    }

    // ===== HANDLERS =====

    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            Map<String, Object> r = new HashMap<String, Object>();
            r.put("status", "ok");
            r.put("quest_count", QuestDatabase.INSTANCE.getEntries().size());
            r.put("questline_count", QuestLineDatabase.INSTANCE.getEntries().size());
            try {
                Minecraft mc = Minecraft.getMinecraft();
                if (mc.player != null) r.put("player", mc.player.getName());
            } catch (Exception ignored) {}
            sendJson(ex, r);
        }
    }

    static class QuestLinesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            List<Map<String, Object>> lines = new ArrayList<Map<String, Object>>();
            for (DBEntry<IQuestLine> entry : QuestLineDatabase.INSTANCE.getSortedEntries()) {
                IQuestLine line = entry.getValue();
                Map<String, Object> info = new HashMap<String, Object>();
                info.put("id", entry.getID());
                info.put("name", lp(line, NativeProps.NAME));
                info.put("description", lp(line, NativeProps.DESC));
                info.put("quest_count", line.getEntries().size());
                info.put("order", QuestLineDatabase.INSTANCE.getOrderIndex(entry.getID()));
                lines.add(info);
            }
            Map<String, Object> r = new HashMap<String, Object>();
            r.put("count", lines.size());
            r.put("questlines", lines);
            sendJson(ex, r);
        }
    }

    static class QuestLineDetailHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            String path = ex.getRequestURI().getPath();
            String idStr = path.replace("/api/questlines/", "").replace("/", "");
            int lineId;
            try { lineId = Integer.parseInt(idStr); }
            catch (NumberFormatException e) { sendError(ex, 400, "Invalid quest line ID: " + idStr); return; }

            IQuestLine line = QuestLineDatabase.INSTANCE.getValue(lineId);
            if (line == null) { sendError(ex, 404, "Quest line not found: " + lineId); return; }

            Map<String, Object> r = new HashMap<String, Object>();
            r.put("id", lineId);
            r.put("name", lp(line, NativeProps.NAME));
            r.put("description", lp(line, NativeProps.DESC));
            r.put("order", QuestLineDatabase.INSTANCE.getOrderIndex(lineId));

            List<Map<String, Object>> quests = new ArrayList<Map<String, Object>>();
            for (DBEntry<IQuestLineEntry> entry : line.getEntries()) {
                Map<String, Object> qi = new HashMap<String, Object>();
                qi.put("quest_id", entry.getID());
                qi.put("pos_x", entry.getValue().getPosX());
                qi.put("pos_y", entry.getValue().getPosY());
                qi.put("size_x", entry.getValue().getSizeX());
                qi.put("size_y", entry.getValue().getSizeY());
                quests.add(qi);
            }
            r.put("quests", quests);
            sendJson(ex, r);
        }
    }

    static class QuestDetailHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            String path = ex.getRequestURI().getPath();
            String idStr = path.replace("/api/quests/", "").replace("/", "");
            int qid;
            try { qid = Integer.parseInt(idStr); }
            catch (NumberFormatException e) { sendError(ex, 400, "Invalid quest ID: " + idStr); return; }

            IQuest quest = QuestDatabase.INSTANCE.getValue(qid);
            if (quest == null) { sendError(ex, 404, "Quest not found: " + qid); return; }

            Map<String, Object> r = new HashMap<String, Object>();
            r.put("id", qid);
            r.put("name", qp(quest, NativeProps.NAME));
            r.put("description", qp(quest, NativeProps.DESC));
            r.put("icon", itemStr(qp(quest, NativeProps.ICON).getBaseStack()));
            r.put("visibility", qp(quest, NativeProps.VISIBILITY).toString());
            r.put("frame", qp(quest, NativeProps.FRAME).toString());
            r.put("logic_quest", qp(quest, NativeProps.LOGIC_QUEST).toString());
            r.put("logic_task", qp(quest, NativeProps.LOGIC_TASK).toString());
            r.put("repeat_time", qp(quest, NativeProps.REPEAT_TIME));
            r.put("locked_progress", qp(quest, NativeProps.LOCKED_PROGRESS));
            r.put("auto_claim", qp(quest, NativeProps.AUTO_CLAIM));
            r.put("simultaneous", qp(quest, NativeProps.SIMULTANEOUS));
            r.put("global_share", qp(quest, NativeProps.GLOBAL_SHARE));
            r.put("silent", qp(quest, NativeProps.SILENT));

            int[] prereqs = quest.getRequirements();
            List<Map<String, Object>> pList = new ArrayList<Map<String, Object>>();
            for (int pid : prereqs) {
                Map<String, Object> p = new HashMap<String, Object>();
                p.put("id", pid);
                p.put("type", quest.getRequirementType(pid).toString());
                pList.add(p);
            }
            r.put("prerequisites", pList);

            List<Map<String, Object>> tList = new ArrayList<Map<String, Object>>();
            for (DBEntry<ITask> te : quest.getTasks().getEntries()) {
                Map<String, Object> t = new HashMap<String, Object>();
                t.put("id", te.getID());
                t.put("type", te.getValue().getClass().getSimpleName());
                t.put("name", te.getValue().getUnlocalisedName());
                tList.add(t);
            }
            r.put("tasks", tList);

            List<Map<String, Object>> rwList = new ArrayList<Map<String, Object>>();
            for (DBEntry<IReward> re : quest.getRewards().getEntries()) {
                Map<String, Object> rw = new HashMap<String, Object>();
                rw.put("id", re.getID());
                rw.put("type", re.getValue().getClass().getSimpleName());
                rw.put("name", re.getValue().getUnlocalisedName());
                rwList.add(rw);
            }
            r.put("rewards", rwList);

            List<Map<String, Object>> inLines = new ArrayList<Map<String, Object>>();
            for (DBEntry<IQuestLine> le : QuestLineDatabase.INSTANCE.getEntries()) {
                IQuestLine ql = le.getValue();
                IQuestLineEntry qle = ql.getValue(qid);
                if (qle != null) {
                    Map<String, Object> ln = new HashMap<String, Object>();
                    ln.put("line_id", le.getID());
                    ln.put("line_name", lp(ql, NativeProps.NAME));
                    ln.put("pos_x", qle.getPosX());
                    ln.put("pos_y", qle.getPosY());
                    inLines.add(ln);
                }
            }
            r.put("in_questlines", inLines);
            sendJson(ex, r);
        }
    }

    static class QuestSearchHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            Map<String, String> params = parseQuery(ex.getRequestURI().getQuery());
            String query = params.getOrDefault("q", "").toLowerCase(Locale.ROOT);
            int limit = Math.min(Integer.parseInt(params.getOrDefault("limit", "50")), 500);
            int offset = Integer.parseInt(params.getOrDefault("offset", "0"));
            if (query.isEmpty()) { sendError(ex, 400, "Missing query parameter 'q'"); return; }

            List<Map<String, Object>> matched = new ArrayList<Map<String, Object>>();
            for (DBEntry<IQuest> entry : QuestDatabase.INSTANCE.getEntries()) {
                IQuest quest = entry.getValue();
                String name = qp(quest, NativeProps.NAME).toLowerCase(Locale.ROOT);
                String desc = qp(quest, NativeProps.DESC).toLowerCase(Locale.ROOT);
                if (name.contains(query) || desc.contains(query)) {
                    Map<String, Object> info = new HashMap<String, Object>();
                    info.put("id", entry.getID());
                    info.put("name", qp(quest, NativeProps.NAME));
                    info.put("description", qp(quest, NativeProps.DESC));
                    matched.add(info);
                }
            }
            int to = Math.min(offset + limit, matched.size());
            Map<String, Object> r = new HashMap<String, Object>();
            r.put("total", matched.size());
            r.put("offset", offset);
            r.put("limit", limit);
            r.put("results", offset < matched.size() ? matched.subList(offset, to) : new ArrayList<Map<String, Object>>());
            sendJson(ex, r);
        }
    }

    static class ValidateHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (!"GET".equals(ex.getRequestMethod())) { sendError(ex, 405, "Method not allowed"); return; }
            Map<String, String> params = parseQuery(ex.getRequestURI().getQuery());
            int lineId = -1;
            try { lineId = Integer.parseInt(params.getOrDefault("line_id", "-1")); }
            catch (Exception ignored) {}

            List<Map<String, Object>> issues = new ArrayList<Map<String, Object>>();
            Collection<DBEntry<IQuestLine>> lines;
            if (lineId >= 0) {
                IQuestLine line = QuestLineDatabase.INSTANCE.getValue(lineId);
                if (line == null) { sendError(ex, 404, "Quest line not found: " + lineId); return; }
                lines = new ArrayList<DBEntry<IQuestLine>>();
                lines.add(new DBEntry<IQuestLine>(lineId, line));
            } else {
                lines = QuestLineDatabase.INSTANCE.getEntries();
            }

            for (DBEntry<IQuestLine> le : lines) {
                IQuestLine line = le.getValue();
                String lineName = lp(line, NativeProps.NAME);
                for (DBEntry<IQuestLineEntry> qle : line.getEntries()) {
                    int qid = qle.getID();
                    IQuest quest = QuestDatabase.INSTANCE.getValue(qid);
                    if (quest == null) {
                        Map<String, Object> issue = new HashMap<String, Object>();
                        issue.put("severity", "CRITICAL");
                        issue.put("quest_id", qid);
                        issue.put("questline", lineName);
                        issue.put("message", "Quest " + qid + " referenced in questline but not in quest database");
                        issues.add(issue);
                        continue;
                    }
                    for (int pid : quest.getRequirements()) {
                        if (QuestDatabase.INSTANCE.getValue(pid) == null) {
                            Map<String, Object> issue = new HashMap<String, Object>();
                            issue.put("severity", "CRITICAL");
                            issue.put("quest_id", qid);
                            issue.put("quest_name", qp(quest, NativeProps.NAME));
                            issue.put("message", "Prerequisite quest " + pid + " does not exist");
                            issues.add(issue);
                        }
                    }
                    if (quest.getTasks().size() <= 0) {
                        Map<String, Object> issue = new HashMap<String, Object>();
                        issue.put("severity", "WARN");
                        issue.put("quest_id", qid);
                        issue.put("quest_name", qp(quest, NativeProps.NAME));
                        issue.put("message", "Quest has no tasks");
                        issues.add(issue);
                    }
                    for (DBEntry<IQuestLineEntry> other : line.getEntries()) {
                        if (other.getID() == qid) continue;
                        IQuestLineEntry a = qle.getValue();
                        IQuestLineEntry b = other.getValue();
                        if (a.getPosX() < b.getPosX() + b.getSizeX() &&
                            a.getPosX() + a.getSizeX() > b.getPosX() &&
                            a.getPosY() < b.getPosY() + b.getSizeY() &&
                            a.getPosY() + a.getSizeY() > b.getPosY()) {
                            Map<String, Object> issue = new HashMap<String, Object>();
                            issue.put("severity", "WARN");
                            issue.put("quest_id", qid);
                            issue.put("quest_name", qp(quest, NativeProps.NAME));
                            issue.put("overlapping_quest_id", other.getID());
                            issue.put("position", "(" + a.getPosX() + "," + a.getPosY() + ")");
                            issue.put("message", "Overlaps with quest " + other.getID() + " at (" + b.getPosX() + "," + b.getPosY() + ")");
                            issues.add(issue);
                        }
                    }
                }
            }
            Map<String, Object> r = new HashMap<String, Object>();
            r.put("issue_count", issues.size());
            r.put("issues", issues);
            r.put("status", issues.isEmpty() ? "ok" : "issues_found");
            sendJson(ex, r);
        }
    }
}
