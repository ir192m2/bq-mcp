package com.bqmcp.bridge;

import betterquesting.handlers.SaveLoadHandler;
import betterquesting.questing.QuestDatabase;
import betterquesting.questing.QuestLineDatabase;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.minecraftforge.fml.common.FMLCommonHandler;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

public final class BqWriteSafety {
    private static final Logger LOG = LogManager.getLogger("bqmcp_write");
    private static final Logger AUDIT = LogManager.getLogger("bqmcp_audit");
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private static final String DEFAULT_QUEST_REL = "config/betterquesting/DefaultQuests";
    private static final String BACKUP_ROOT_REL = "bqmcp/backups";
    private static final String AUDIT_LOG_REL = "bqmcp/audit.log";
    private static final SimpleDateFormat TS_FMT = new SimpleDateFormat("yyyyMMdd-HHmmss");
    private static final AtomicLong COUNTER = new AtomicLong();

    private static volatile File BACKUP_ROOT;
    private static volatile File AUDIT_LOG_FILE;
    private static volatile boolean INITIALIZED = false;

    public static void init(FMLPreInitializationEvent event) {
        if (INITIALIZED) return;
        File mcDir = event.getModConfigurationDirectory().getParentFile();
        BACKUP_ROOT = new File(mcDir, BACKUP_ROOT_REL);
        AUDIT_LOG_FILE = new File(mcDir, AUDIT_LOG_REL);
        if (!BACKUP_ROOT.isDirectory() && !BACKUP_ROOT.mkdirs()) {
            LOG.warn("Could not create backup root: {}", BACKUP_ROOT);
        }
        INITIALIZED = true;
        LOG.info("BqWriteSafety initialized. backups={} audit={}", BACKUP_ROOT, AUDIT_LOG_FILE);
    }

    public static final class WriteRequest {
        public final String operation;
        public final boolean commit;
        public final long startMs;
        public final String requestId;
        public final Map<String, Object> params;
        public final String backupPath;

        private WriteRequest(String operation, boolean commit, long startMs,
                             String requestId, Map<String, Object> params, String backupPath) {
            this.operation = operation;
            this.commit = commit;
            this.startMs = startMs;
            this.requestId = requestId;
            this.params = params;
            this.backupPath = backupPath;
        }
    }

    public static WriteRequest begin(String operation, boolean commit, Map<String, Object> params) {
        if (!INITIALIZED) {
            throw new IllegalStateException("BqWriteSafety.init() must be called before begin()");
        }
        String requestId = String.format("%s-%05d", TS_FMT.format(new Date()), COUNTER.incrementAndGet());
        long startMs = System.currentTimeMillis();
        String backupPath = null;
        if (commit) {
            try {
                backupPath = createBackup(requestId);
            } catch (Exception e) {
                LOG.error("Pre-write backup failed; aborting operation={} request_id={}", operation, requestId, e);
                Map<String, Object> failDetail = new LinkedHashMap<>();
                failDetail.put("error_class", e.getClass().getName());
                failDetail.put("error_message", String.valueOf(e.getMessage()));
                failDetail.put("backup_root", BACKUP_ROOT == null ? null : BACKUP_ROOT.getAbsolutePath());
                audit(operation, requestId, "BACKUP_FAIL", params, failDetail);
                throw new RuntimeException("Pre-write backup failed; aborting: " + e.getMessage(), e);
            }
        }
        WriteRequest req = new WriteRequest(operation, commit, startMs, requestId, params, backupPath);
        audit(operation, requestId, "BEGIN", params, null);
        return req;
    }

    public static Map<String, Object> end(WriteRequest req, Map<String, Object> result) {
        long durationMs = System.currentTimeMillis() - req.startMs;
        if (req.commit) {
            try {
                assertConsistent("post-write");
            } catch (Exception e) {
                result.put("integrity_error", e.getMessage());
                audit(req.operation, req.requestId, "INTEGRITY_FAIL", req.params, result);
                throw new RuntimeException("Post-write integrity check failed: " + e.getMessage(), e);
            }
            try {
                SaveLoadHandler.INSTANCE.markDirty();
            } catch (Exception e) {
                LOG.warn("markDirty failed (non-fatal): {}", e.getMessage());
            }
        }
        result.put("request_id", req.requestId);
        result.put("duration_ms", durationMs);
        result.put("commit", req.commit);
        result.put("dry_run", !req.commit);
        if (req.backupPath != null) {
            result.put("backup_path", req.backupPath);
        }
        audit(req.operation, req.requestId, req.commit ? "COMMIT" : "DRY_RUN", req.params, result);
        return result;
    }

    public static void abort(WriteRequest req, String reason) {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("reason", reason);
        audit(req.operation, req.requestId, "ABORT", req.params, extra);
    }

    public static void assertConsistent(String phase) {
        int qCount = 0;
        for (Object o : QuestDatabase.INSTANCE.getEntries()) {
            qCount++;
            if (o == null) {
                throw new IllegalStateException("[" + phase + "] null quest entry in QuestDatabase");
            }
        }
        int lCount = 0;
        for (Object o : QuestLineDatabase.INSTANCE.getEntries()) {
            lCount++;
            if (o == null) {
                throw new IllegalStateException("[" + phase + "] null questline entry in QuestLineDatabase");
            }
        }
        int dbSize = QuestDatabase.INSTANCE.size();
        int lineDbSize = QuestLineDatabase.INSTANCE.size();
        if (qCount != dbSize) {
            throw new IllegalStateException("[" + phase + "] quest count mismatch: iterated=" + qCount + " size=" + dbSize);
        }
        if (lCount != lineDbSize) {
            throw new IllegalStateException("[" + phase + "] questline count mismatch: iterated=" + lCount + " size=" + lineDbSize);
        }
        LOG.debug("Integrity OK [{}]: {} quests, {} questlines", phase, qCount, lCount);
    }

    public static String createBackup(String requestId) throws IOException {
        if (!INITIALIZED) {
            throw new IllegalStateException("BqWriteSafety.init() must be called before createBackup()");
        }
        File mcDir = BACKUP_ROOT.getParentFile().getParentFile();
        File src = new File(mcDir, DEFAULT_QUEST_REL);
        File dest = new File(BACKUP_ROOT, requestId);
        return createBackup(src, dest);
    }

    public static String createBackup(File src, File dest) throws IOException {
        if (src == null || !src.isDirectory()) {
            throw new IOException("Source not found or not a directory: " + src);
        }
        if (dest == null) {
            throw new IOException("Destination is null");
        }
        if (!dest.mkdirs() && !dest.isDirectory()) {
            throw new IOException("Could not create backup dir: " + dest);
        }
        copyTree(src.toPath(), dest.toPath());
        String path = dest.getAbsolutePath();
        LOG.info("Backup created: {}", path);
        return path;
    }

    public static int copyTree(Path src, Path dest) throws IOException {
        int fileCount = 0;
        java.util.List<Path> paths = new java.util.ArrayList<>();
        try (java.util.stream.Stream<Path> stream = Files.walk(src)) {
            stream.forEach(paths::add);
        }
        for (Path p : paths) {
            Path rel = src.relativize(p);
            Path target = dest.resolve(rel.toString());
            if (Files.isDirectory(p)) {
                Files.createDirectories(target);
            } else {
                Path parent = target.getParent();
                if (parent != null) Files.createDirectories(parent);
                Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
                fileCount++;
            }
        }
        return fileCount;
    }

    private static void audit(String op, String reqId, String event,
                              Map<String, Object> params, Map<String, Object> extra) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("ts", Instant.now().toString());
        entry.put("request_id", reqId);
        entry.put("operation", op);
        entry.put("event", event);
        if (params != null) entry.put("params", params);
        if (extra != null) entry.put("result", extra);
        String line = GSON.toJson(entry) + "\n";
        try {
            if (AUDIT_LOG_FILE != null) {
                try (FileOutputStream fos = new FileOutputStream(AUDIT_LOG_FILE, true)) {
                    fos.write(line.getBytes(StandardCharsets.UTF_8));
                }
            }
        } catch (IOException e) {
            LOG.warn("Failed to write audit log: {}", e.getMessage());
        }
        AUDIT.info(line.trim());
    }

    public static void listBackups() {
        if (BACKUP_ROOT == null || !BACKUP_ROOT.isDirectory()) return;
        File[] children = BACKUP_ROOT.listFiles();
        if (children == null) return;
        for (File c : children) {
            if (c.isDirectory()) {
                LOG.info("backup: {}", c.getName());
            }
        }
    }
}
