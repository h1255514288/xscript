package com.xscript.app.project

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

/** Real directories, with only the failing rename operation injected. */
class ProjectSwapTest {
    private fun withTrees(test: (File, File, File) -> Unit) {
        val root = Files.createTempDirectory("project-swap").toFile()
        try {
            val ready = File(root, "ready").apply { mkdirs() }
            val current = File(root, "demo").apply { mkdirs() }
            File(ready, "__init__.py").writeText("NEW = 2\n")
            File(current, "__init__.py").writeText("OLD = 1\n")
            File(current, "user-data.txt").writeText("keep")
            test(ready, current, File(root, "backup"))
        } finally {
            root.deleteRecursively()
        }
    }

    private fun assertOld(current: File) {
        assertEquals("OLD = 1\n", File(current, "__init__.py").readText())
        assertEquals("keep", File(current, "user-data.txt").readText())
    }

    @Test
    fun replacementCleansStagingAndOldBackup() = withTrees { ready, current, backup ->
        swapProjectDirectories(ready, current, backup)
        assertEquals("NEW = 2\n", File(current, "__init__.py").readText())
        assertFalse(File(current, "user-data.txt").exists())
        assertFalse(ready.exists())
        assertFalse(backup.exists())
    }

    @Test
    fun failureMovingTheOldTreeLeavesItUntouched() = withTrees { ready, current, backup ->
        assertThrows(IOException::class.java) {
            swapProjectDirectories(ready, current, backup) { _, _ -> false }
        }
        assertOld(current)
        assertFalse(ready.exists())
        assertFalse(backup.exists())
    }

    @Test
    fun failedInstallRestoresTheOldTree() = withTrees { ready, current, backup ->
        val error = assertThrows(IOException::class.java) {
            swapProjectDirectories(ready, current, backup) { from, to ->
                from != ready && from.renameTo(to)
            }
        }
        assertTrue(error.message!!.contains("restored"))
        assertOld(current)
        assertFalse(ready.exists())
        assertFalse(backup.exists())
    }

    @Test
    fun thrownInstallErrorAlsoRestoresTheOldTree() = withTrees { ready, current, backup ->
        val error = assertThrows(IOException::class.java) {
            swapProjectDirectories(ready, current, backup) { from, to ->
                if (from == ready) throw IOException("storage unavailable")
                from.renameTo(to)
            }
        }
        assertEquals("storage unavailable", error.cause!!.message)
        assertOld(current)
        assertFalse(ready.exists())
        assertFalse(backup.exists())
    }

    @Test
    fun failedRestoreKeepsThePreviousVersionAtTheReportedBackup() = withTrees { ready, current, backup ->
        val error = assertThrows(IOException::class.java) {
            swapProjectDirectories(ready, current, backup) { from, to ->
                if (from == backup) throw IOException("restore denied")
                from == current && from.renameTo(to)
            }
        }
        assertTrue(error.message!!.contains(backup.toString()))
        assertOld(backup)
        assertEquals("restore denied", error.cause!!.suppressed.single().message)
        assertFalse(ready.exists())
        assertFalse(current.exists())
    }

    @Test
    fun aNewProjectFailureDoesNotClaimToHaveRestoredAnOldVersion() = withTrees { ready, current, backup ->
        current.deleteRecursively()
        val error = assertThrows(IOException::class.java) {
            swapProjectDirectories(ready, current, backup) { _, _ -> false }
        }
        assertEquals("cannot install the new project", error.message)
        assertFalse(current.exists())
        assertFalse(ready.exists())
        assertFalse(backup.exists())
    }
}
