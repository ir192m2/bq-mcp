package com.bqmcp.bridge;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.*;

public class BqWriteSafetyTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    @Test
    public void createBackup_copiesAllFiles() throws IOException {
        File src = tempFolder.newFolder("DefaultQuests");
        File quests = new File(src, "Quests");
        quests.mkdirs();
        try (FileWriter w = new FileWriter(new File(quests, "1.json"))) {
            w.write("{\"id\":1}");
        }
        File lines = new File(src, "QuestLines");
        lines.mkdirs();
        try (FileWriter w = new FileWriter(new File(lines, "10.json"))) {
            w.write("{\"id\":10}");
        }
        File dest = tempFolder.newFolder("backup");

        int count = BqWriteSafety.copyTree(src.toPath(), dest.toPath());

        assertEquals(2, count);
        assertTrue(new File(dest, "Quests/1.json").exists());
        assertTrue(new File(dest, "QuestLines/10.json").exists());
    }

    @Test
    public void createBackup_throwsWhenSourceMissing() {
        File src = new File(tempFolder.getRoot(), "nonexistent");
        File dest = new File(tempFolder.getRoot(), "backup");
        try {
            BqWriteSafety.createBackup(src, dest);
            fail("Should have thrown IOException for missing source");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("not found") || e.getMessage().contains("Source"));
        }
    }

    @Test
    public void createBackup_throwsWhenSourceIsFile() throws IOException {
        File src = tempFolder.newFile("not_a_dir");
        File dest = new File(tempFolder.getRoot(), "backup");
        try {
            BqWriteSafety.createBackup(src, dest);
            fail("Should have thrown IOException for non-directory source");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("not a directory") || e.getMessage().contains("Source"));
        }
    }

    @Test
    public void createBackup_throwsWhenDestIsNull() throws IOException {
        File src = tempFolder.newFolder("src");
        try {
            BqWriteSafety.createBackup(src, null);
            fail("Should have thrown IOException for null dest");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("null"));
        }
    }

    @Test
    public void createBackup_returnsDestPath() throws IOException {
        File src = tempFolder.newFolder("src");
        try (FileWriter w = new FileWriter(new File(src, "f.json"))) {
            w.write("{}");
        }
        File dest = new File(tempFolder.getRoot(), "bk");
        String returned = BqWriteSafety.createBackup(src, dest);
        assertEquals(dest.getAbsolutePath(), returned);
    }

    @Test
    public void createBackup_createsNestedDirectories() throws IOException {
        File src = tempFolder.newFolder("src");
        File nested = new File(src, "a/b/c");
        nested.mkdirs();
        try (FileWriter w = new FileWriter(new File(nested, "deep.json"))) {
            w.write("{}");
        }
        File dest = new File(tempFolder.getRoot(), "dest");
        BqWriteSafety.createBackup(src, dest);
        assertTrue(new File(dest, "a/b/c/deep.json").exists());
    }

    @Test
    public void createBackup_overwritesExistingFiles() throws IOException {
        File src = tempFolder.newFolder("src");
        try (FileWriter w = new FileWriter(new File(src, "f.json"))) {
            w.write("new content");
        }
        File dest = tempFolder.newFolder("dest");
        new File(dest, "f.json").createNewFile();
        try (FileWriter w = new FileWriter(new File(dest, "f.json"))) {
            w.write("OLD content");
        }
        BqWriteSafety.createBackup(src, dest);
        String content = new String(Files.readAllBytes(new File(dest, "f.json").toPath()));
        assertEquals("new content", content);
    }

    @Test
    public void createBackup_emptySourceWorks() throws IOException {
        File src = tempFolder.newFolder("empty");
        File dest = new File(tempFolder.getRoot(), "dest");
        int count = BqWriteSafety.copyTree(src.toPath(), dest.toPath());
        assertEquals(0, count);
        assertTrue(dest.isDirectory());
    }
}
